// === FILE PURPOSE ===
// Query-time full-text search across sessions (meetings/transcripts/briefs),
// cards, and projects (V3.1 Task 6). Uses Postgres FTS -- to_tsvector +
// websearch_to_tsquery -- with the 'simple' config (NOT 'english') because
// transcripts are multilingual (TRANSCRIBE-MULTILANG): no stemming beats
// wrong-language stemming. Query-time only, NO new indexes/migrations --
// personal-tool scale (add a GIN index later only if measured slow).
//
// The user's query is ALWAYS passed as a bound parameter to
// websearch_to_tsquery via drizzle's sql`` tagged template -- never
// string-concatenated into the query text.
//
// ts_headline was verified to work in PGlite (including custom StartSel/StopSel
// markers) -- see SNIPPET_HIGHLIGHT_START/END. No manual-snippet fallback is
// needed.
//
// Results are grouped for the UI into three buckets: sessions (meetings union
// transcripts union briefs, deduped by meeting -- the highest-ranked match per
// meeting wins), cards, and projects.

import { sql } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { EMBEDDING_DIM } from '../db/schema/embeddings';
import { embed, generate, resolveTaskModel } from './ai-provider';
import { recordEmbeddingModelMismatch } from './embeddingService';
import { createLogger } from './logger';
import { SNIPPET_HIGHLIGHT_START, SNIPPET_HIGHLIGHT_END } from '../../shared/types/search';
import type { SearchResultItem, SearchResultType, SearchResults, SearchAnswer } from '../../shared/types/search';

const log = createLogger('Search');

type DB = ReturnType<typeof getDb>;

const FETCH_LIMIT = 20; // rows fetched per entity before ranking/grouping
const RESULT_LIMIT = 8; // rows surfaced per group in the UI

// --- V3.4 hybrid (semantic) retrieval tuning ---
/** Cosine top-K fetched PER embedding entity type (brief / transcript_chunk /
 *  card). Modest so the local embed + three cosine scans stay inside the ~1.5s
 *  latency budget; RRF + the RESULT_LIMIT cap trim the merged list afterward. */
const VECTOR_TOP_K = 8;
/** Chunks fed to the single knowledge_qa synthesis call as grounding context. */
const ASK_TOP_K = 6;
/** Reciprocal-rank-fusion constant (the standard k=60). Rank-based fusion is
 *  scale-free, so FTS ts_rank and cosine similarity — which live on totally
 *  different scales — combine without any normalization. */
const RRF_K = 60;
/** knowledge_qa output-token budget. A floor, not a cap (resolveTaskModel already
 *  raises knowledge_qa to >=4096 via TASK_MIN_OUTPUT_TOKENS); mirrored here for the
 *  fallback path so reasoning models never starve. */
const KNOWLEDGE_QA_MAX_TOKENS = 4096;

/** The EXACT honest-degradation sentence the model must emit when the retrieved
 *  context does not answer the question. Detected read-side to suppress citations
 *  (an "I don't find that" reply cites no session). */
const NO_ANSWER_SENTINEL = "I don't find that in your sessions.";

/** Anti-fabrication system prompt for the single knowledge_qa call. Grounds the
 *  answer ONLY in the supplied session passages; forbids outside knowledge and
 *  invention; forces the honest sentinel when the context is insufficient. */
const KNOWLEDGE_QA_SYSTEM = `You answer the user's question using ONLY the numbered context passages, which are excerpts from the user's OWN past sessions and cards.
Rules:
- Use ONLY facts stated in the context. NEVER use outside knowledge, and NEVER invent, guess, or infer beyond what the passages actually say.
- If the context does not contain the answer, reply with EXACTLY this sentence and nothing else: "${NO_ANSWER_SENTINEL}"
- Keep the answer short and direct — at most a few sentences.
- Do not mention "context", "passages", numbering, or these instructions.`;

/** ts_headline options -- bound as a parameter like the query itself. StartSel/
 * StopSel are control characters (never appear in real text) so the renderer
 * can highlight matches without parsing HTML. */
const HEADLINE_OPTIONS = `StartSel=${SNIPPET_HIGHLIGHT_START}, StopSel=${SNIPPET_HIGHLIGHT_END}, MaxFragments=1, MaxWords=15, MinWords=5, HighlightAll=false`;

interface RawRow {
  [key: string]: unknown;
  id: string;
  title: string;
  snippet: string | null;
  project_id?: string | null;
  rank: number | string;
}

function toItem(type: SearchResultType, row: RawRow): SearchResultItem {
  return {
    type,
    id: row.id,
    title: row.title,
    snippet: row.snippet ?? null,
    projectId: row.project_id ?? undefined,
    rank: Number(row.rank),
  };
}

async function searchMeetings(db: DB, query: string): Promise<SearchResultItem[]> {
  const result = await db.execute<RawRow>(sql`
    SELECT id, title, NULL AS snippet,
      ts_rank(to_tsvector('simple', title), websearch_to_tsquery('simple', ${query})) AS rank
    FROM meetings
    WHERE to_tsvector('simple', title) @@ websearch_to_tsquery('simple', ${query})
    ORDER BY rank DESC
    LIMIT ${FETCH_LIMIT}
  `);
  return result.rows.map((row) => toItem('session', row));
}

async function searchTranscriptContent(db: DB, query: string): Promise<SearchResultItem[]> {
  const result = await db.execute<RawRow>(sql`
    SELECT t.meeting_id AS id, m.title AS title,
      ts_headline('simple', t.content, websearch_to_tsquery('simple', ${query}), ${HEADLINE_OPTIONS}) AS snippet,
      ts_rank(to_tsvector('simple', t.content), websearch_to_tsquery('simple', ${query})) AS rank
    FROM transcripts t
    JOIN meetings m ON m.id = t.meeting_id
    WHERE to_tsvector('simple', t.content) @@ websearch_to_tsquery('simple', ${query})
    ORDER BY rank DESC
    LIMIT ${FETCH_LIMIT}
  `);
  return result.rows.map((row) => toItem('session', row));
}

async function searchBriefs(db: DB, query: string): Promise<SearchResultItem[]> {
  const result = await db.execute<RawRow>(sql`
    SELECT b.meeting_id AS id, m.title AS title,
      ts_headline('simple', b.summary, websearch_to_tsquery('simple', ${query}), ${HEADLINE_OPTIONS}) AS snippet,
      ts_rank(to_tsvector('simple', b.summary), websearch_to_tsquery('simple', ${query})) AS rank
    FROM meeting_briefs b
    JOIN meetings m ON m.id = b.meeting_id
    WHERE to_tsvector('simple', b.summary) @@ websearch_to_tsquery('simple', ${query})
    ORDER BY rank DESC
    LIMIT ${FETCH_LIMIT}
  `);
  return result.rows.map((row) => toItem('session', row));
}

async function searchCards(db: DB, query: string): Promise<SearchResultItem[]> {
  const result = await db.execute<RawRow>(sql`
    SELECT c.id AS id, c.title AS title, b.project_id AS project_id,
      CASE WHEN c.description IS NOT NULL
             AND to_tsvector('simple', c.description) @@ websearch_to_tsquery('simple', ${query})
           THEN ts_headline('simple', c.description, websearch_to_tsquery('simple', ${query}), ${HEADLINE_OPTIONS})
           ELSE NULL END AS snippet,
      ts_rank(to_tsvector('simple', c.title || ' ' || coalesce(c.description, '')), websearch_to_tsquery('simple', ${query})) AS rank
    FROM cards c
    JOIN columns col ON col.id = c.column_id
    JOIN boards b ON b.id = col.board_id
    WHERE c.archived = false
      AND to_tsvector('simple', c.title || ' ' || coalesce(c.description, '')) @@ websearch_to_tsquery('simple', ${query})
    ORDER BY rank DESC
    LIMIT ${FETCH_LIMIT}
  `);
  return result.rows.map((row) => toItem('card', row));
}

async function searchProjects(db: DB, query: string): Promise<SearchResultItem[]> {
  const result = await db.execute<RawRow>(sql`
    SELECT id, name AS title, NULL AS snippet,
      ts_rank(to_tsvector('simple', name), websearch_to_tsquery('simple', ${query})) AS rank
    FROM projects
    WHERE archived = false AND system = false
      AND to_tsvector('simple', name) @@ websearch_to_tsquery('simple', ${query})
    ORDER BY rank DESC
    LIMIT ${FETCH_LIMIT}
  `);
  return result.rows.map((row) => toItem('project', row));
}

function topRanked(items: SearchResultItem[]): SearchResultItem[] {
  return [...items].sort((a, b) => b.rank - a.rank).slice(0, RESULT_LIMIT);
}

/**
 * Merge meeting/transcript/brief matches into one Sessions bucket, deduped by
 * meeting id -- the highest-ranked source per meeting wins, so a transcript or
 * brief hit (which carries a snippet) is preferred over a bare title match when
 * a meeting matches on more than one field. On a tied rank, the snippet-carrying
 * entry wins the tie-break (meeting rows are inserted before transcript/brief
 * rows above, so a strict `>` would otherwise let a snippet-less title match
 * shadow an equally-ranked transcript hit).
 */
function mergeSessionResults(...groups: SearchResultItem[][]): SearchResultItem[] {
  const byId = new Map<string, SearchResultItem>();
  for (const item of groups.flat()) {
    const existing = byId.get(item.id);
    const tiedButHasSnippet = !!existing && item.rank === existing.rank && !!item.snippet && !existing.snippet;
    if (!existing || item.rank > existing.rank || tiedButHasSnippet) byId.set(item.id, item);
  }
  return topRanked([...byId.values()]);
}

/** Today's exact FTS grouping (V3.1) — the identity result when the semantic
 *  layer is absent. Extracted so search() can run it in parallel with the vector
 *  half and short-circuit to it verbatim on any degradation. */
async function runFtsSearch(db: DB, query: string): Promise<SearchResults> {
  const [meetingRows, transcriptRows, briefRows, cardRows, projectRows] = await Promise.all([
    searchMeetings(db, query),
    searchTranscriptContent(db, query),
    searchBriefs(db, query),
    searchCards(db, query),
    searchProjects(db, query),
  ]);
  return {
    sessions: mergeSessionResults(meetingRows, transcriptRows, briefRows),
    cards: topRanked(cardRows),
    projects: topRanked(projectRows),
  };
}

// ---------------------------------------------------------------------------
// V3.4 semantic (vector) retrieval
// ---------------------------------------------------------------------------

/** A single cosine-nearest embedding row, already joined to its display title. */
interface VectorHit {
  type: SearchResultType; // 'session' (brief/transcript) or 'card'
  id: string; // meetingId for a session hit, cardId for a card hit
  title: string; // session title, or card title
  content: string; // the chunk text — grounding for Ask + a plain-text snippet
  projectId: string | null;
  meetingId: string | null; // the source session (null for a card with no source)
  distance: number; // cosine distance (smaller = closer)
}

interface VecRow {
  [key: string]: unknown;
  id: string;
  title: string;
  project_id: string | null;
  meeting_id: string | null;
  content: string;
  distance: number | string;
}

/** Read the model the index was built with (null when the index is empty). */
async function readIndexModel(db: DB): Promise<string | null> {
  const res = await db.execute<{ model: string }>(sql`SELECT model FROM embedding_index_meta LIMIT 1`);
  return res.rows[0]?.model ?? null;
}

/** pgvector text literal for a query embedding (bound as a parameter, cast to vector). */
function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

/** Cosine top-`k` rows for one embedding entity type, joined to the owning
 *  meeting (brief/transcript) or card so each hit carries a display title. Card
 *  rows for archived cards are excluded, mirroring the FTS card query. */
async function cosineEntityRows(
  db: DB,
  lit: string,
  entityType: 'brief' | 'transcript_chunk' | 'card',
  k: number,
): Promise<VecRow[]> {
  if (entityType === 'card') {
    const res = await db.execute<VecRow>(sql`
      SELECT e.entity_id AS id, c.title AS title, e.project_id AS project_id, e.meeting_id AS meeting_id,
        e.content AS content, e.embedding <=> ${lit}::vector AS distance
      FROM embeddings e
      JOIN cards c ON c.id = e.entity_id
      WHERE e.entity_type = 'card' AND c.archived = false
      ORDER BY distance
      LIMIT ${k}
    `);
    return res.rows;
  }
  const res = await db.execute<VecRow>(sql`
    SELECT e.meeting_id AS id, m.title AS title, NULL AS project_id, e.meeting_id AS meeting_id,
      e.content AS content, e.embedding <=> ${lit}::vector AS distance
    FROM embeddings e
    JOIN meetings m ON m.id = e.meeting_id
    WHERE e.entity_type = ${entityType}
    ORDER BY distance
    LIMIT ${k}
  `);
  return res.rows;
}

function toVectorHit(type: SearchResultType, row: VecRow): VectorHit {
  return {
    type,
    id: row.id,
    title: row.title,
    content: row.content,
    projectId: row.project_id ?? null,
    meetingId: row.meeting_id ?? null,
    distance: Number(row.distance),
  };
}

/**
 * Semantic retrieval: cosine top-K per entity type against the frozen embeddings
 * index. Returns the flat chunk hits sorted best-first, or `[]` (never throws) on
 * ANY read-side degradation — so both callers fall back to exactly today's FTS
 * behavior. The read-side model-consistency guard is load-bearing:
 *   - no embedding model configured (resolveTaskModel('embedding') === null), OR
 *   - the index is empty (no embedding_index_meta row), OR
 *   - the current echoed embedding model !== the model the index was built with
 * → skip vector search. We NEVER compare vectors across model spaces. (Mirrors
 * the write-side mismatch guard in embeddingService.)
 */
async function retrieveVectorHits(db: DB, query: string, k: number): Promise<VectorHit[]> {
  try {
    // Cheap gates first, so an absent/empty index never triggers a model call.
    const provider = await resolveTaskModel('embedding');
    if (!provider) return [];
    const indexModel = await readIndexModel(db);
    if (!indexModel) return [];

    const { embeddings: vectors, model: echoedModel } = await embed([query], 'embedding');
    const queryVec = vectors[0];
    if (!queryVec || queryVec.length !== EMBEDDING_DIM) return [];
    if (echoedModel !== indexModel) {
      // Foreign vector space — never mix. Record the mismatch so Settings surfaces
      // the rebuild prompt even on a fully-indexed corpus that produces no new
      // writes (the write-side guard is skipped by content-idempotency there).
      // Best-effort — this must never break the FTS-only fallback below.
      await recordEmbeddingModelMismatch(indexModel, echoedModel);
      return [];
    }

    const lit = toVectorLiteral(queryVec);
    const [briefRows, transcriptRows, cardRows] = await Promise.all([
      cosineEntityRows(db, lit, 'brief', k),
      cosineEntityRows(db, lit, 'transcript_chunk', k),
      cosineEntityRows(db, lit, 'card', k),
    ]);

    const hits: VectorHit[] = [
      ...briefRows.map((r) => toVectorHit('session', r)),
      ...transcriptRows.map((r) => toVectorHit('session', r)),
      ...cardRows.map((r) => toVectorHit('card', r)),
    ];
    hits.sort((a, b) => a.distance - b.distance);
    return hits;
  } catch (err) {
    // A semantic-layer failure can NEVER break search — degrade to FTS-only.
    log.error('Vector retrieval failed — falling back to FTS-only:', err);
    return [];
  }
}

/** Normalize a reply/sentinel for tolerant no-answer matching: fold curly
 *  apostrophes to straight (U+2019 → U+0027), lowercase, and drop trailing
 *  whitespace/punctuation — so a period-less or curly-quoted honest reply is still
 *  recognized (and gets no citations). Deliberately narrow: it does NOT strip
 *  internal punctuation, so a real answer that merely mentions the phrase is not
 *  over-matched beyond today's substring behavior. */
function normalizeForSentinel(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .trim()
    .replace(/[\s.!?;:,]+$/g, '');
}

/** Whether the model's reply is the honest no-answer sentinel (apostrophe- and
 *  trailing-punctuation-insensitive; also true when the reply is essentially only
 *  the sentinel). */
function isNoAnswerReply(text: string): boolean {
  const reply = normalizeForSentinel(text);
  const sentinel = normalizeForSentinel(NO_ANSWER_SENTINEL);
  return reply === sentinel || reply.includes(sentinel);
}

/** Collapse a plain chunk to a short, marker-free excerpt (renders as plain text
 *  through the same Snippet component the FTS ts_headline markers flow through). */
function excerpt(content: string, max = 160): string {
  const clean = content.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : clean.slice(0, max - 1).trimEnd() + '…';
}

/** A vector-only result item — flagged `semantic` so the UI badges it. `rank`
 *  carries cosine similarity (1 - distance) for completeness; ordering is decided
 *  by RRF position, not this value. */
function toSemanticItem(hit: VectorHit): SearchResultItem {
  return {
    type: hit.type,
    id: hit.id,
    title: hit.title,
    snippet: excerpt(hit.content),
    projectId: hit.projectId ?? undefined,
    rank: 1 - hit.distance,
    semantic: true,
  };
}

/** Keep the best (first, since hits are sorted best-first) item per id. */
function dedupById(items: SearchResultItem[]): SearchResultItem[] {
  const byId = new Map<string, SearchResultItem>();
  for (const item of items) if (!byId.has(item.id)) byId.set(item.id, item);
  return [...byId.values()];
}

/**
 * Reciprocal-rank fusion of one bucket's FTS list and vector list (each already
 * sorted best-first). fused(id) = Σ 1/(RRF_K + position) over the lists it
 * appears in — agreement between the two retrievers boosts an item. The kept item
 * is the FTS one when present (real ts_rank + highlighted snippet); a vector-ONLY
 * item keeps its `semantic: true` flag. With an empty vector list this reduces to
 * the FTS order verbatim, so degradation is byte-for-byte today's behavior.
 */
function fuseBucket(ftsItems: SearchResultItem[], vectorItems: SearchResultItem[]): SearchResultItem[] {
  const score = new Map<string, number>();
  const chosen = new Map<string, SearchResultItem>();

  ftsItems.forEach((item, i) => {
    score.set(item.id, (score.get(item.id) ?? 0) + 1 / (RRF_K + i + 1));
    chosen.set(item.id, item); // FTS match preferred (keyword hit, not "semantic only")
  });
  vectorItems.forEach((item, i) => {
    score.set(item.id, (score.get(item.id) ?? 0) + 1 / (RRF_K + i + 1));
    if (!chosen.has(item.id)) chosen.set(item.id, item); // surfaced ONLY by vector → semantic
  });

  return [...chosen.values()].sort((a, b) => (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0)).slice(0, RESULT_LIMIT);
}

/**
 * Hybrid search across sessions, cards, and projects (V3.4). Runs the V3.1 FTS
 * and the semantic (vector) retrieval in PARALLEL and fuses them with RRF. The
 * `search:query` signature is UNCHANGED. When the semantic layer is absent (no
 * embedding model / empty index / model mismatch / any failure) the vector half
 * returns [] and the result is exactly today's FTS output. See file header + the
 * read-side guard in retrieveVectorHits.
 */
export async function search(rawQuery: string): Promise<SearchResults> {
  const query = rawQuery.trim();
  if (!query) return { sessions: [], cards: [], projects: [] };

  const db = getDb();
  const [fts, vectorHits] = await Promise.all([runFtsSearch(db, query), retrieveVectorHits(db, query, VECTOR_TOP_K)]);

  // No vector hits ⇒ no semantic layer to fuse ⇒ exactly today's behavior.
  if (vectorHits.length === 0) return fts;

  const vSessions = dedupById(vectorHits.filter((h) => h.type === 'session').map(toSemanticItem));
  const vCards = dedupById(vectorHits.filter((h) => h.type === 'card').map(toSemanticItem));

  return {
    sessions: fuseBucket(fts.sessions, vSessions),
    cards: fuseBucket(fts.cards, vCards),
    projects: fts.projects, // projects have no embeddings — always FTS-only
  };
}

/** Distinct source-session citations from the grounding chunks (best-first,
 *  capped). Only 'session' hits become citations — they carry a real session
 *  title + meetingId the UI can navigate to; card hits inform the answer but are
 *  not session sources. Empty when the answer is the honest no-answer sentinel.
 *
 *  Card-dominant guard (V3.4 adversarial fix): when the single CLOSEST retrieved
 *  chunk is a card, the answer is card-sourced — the co-occurring session chunks
 *  are all strictly farther, so attributing the answer to them would surface
 *  unrelated sessions as "Sources". Suppress session citations in that case. This
 *  uses ONLY the existing best-first ordering (no fragile cosine threshold) and
 *  under-cites rather than misattributes. */
function buildSessionCitations(grounding: VectorHit[], max = 4): SearchAnswer['citations'] {
  if (grounding[0]?.type === 'card') return [];

  const byMeeting = new Map<string, { meetingId: string; title: string; snippet?: string }>();
  for (const h of grounding) {
    if (h.type !== 'session' || !h.id) continue;
    if (!byMeeting.has(h.id))
      byMeeting.set(h.id, { meetingId: h.id, title: h.title, snippet: excerpt(h.content, 200) });
    if (byMeeting.size >= max) break;
  }
  return [...byMeeting.values()];
}

/**
 * Answer a natural-language question over the user's sessions — the explicit
 * "Ask" action (V3.4 knowledge Q&A). Distinct from search() so per-keystroke
 * search stays model-call-free; the renderer invokes this ONLY on an explicit Ask.
 *
 * Retrieves the top chunks via the SAME hybrid vector retrieval, then makes ONE
 * `knowledge_qa` model call grounded ONLY in that context (anti-fabrication
 * system prompt + honest sentinel). Honest degradation on every path — returns
 * `null` (renderer shows plain results + a non-blocking notice) when:
 *   - no knowledge_qa model is configured,
 *   - the retrieval context is empty (no embedding model / empty index / mismatch),
 *   - the model call fails, or the model returns empty text.
 * NEVER throws to the renderer for an AI reason.
 */
export async function askKnowledge(query: string): Promise<SearchAnswer | null> {
  const q = query.trim();
  if (!q) return null;

  try {
    // Chat model first — a cheap gate that avoids an embed call with no synthesizer.
    const provider = await resolveTaskModel('knowledge_qa');
    if (!provider) return null;

    const db = getDb();
    const hits = await retrieveVectorHits(db, q, VECTOR_TOP_K);
    if (hits.length === 0) return null; // empty context → plain results + notice

    const grounding = hits.slice(0, ASK_TOP_K);
    const context = grounding
      .map((h, i) => `[${i + 1}] (${h.type === 'session' ? 'Session' : 'Card'}: ${h.title})\n${h.content}`)
      .join('\n\n');
    const prompt = `Question: ${q}\n\nContext from the user's own sessions and cards:\n${context}`;

    let text: string;
    try {
      const result = await generate({
        providerId: provider.providerId,
        providerName: provider.providerName,
        apiKeyEncrypted: provider.apiKeyEncrypted,
        baseUrl: provider.baseUrl,
        model: provider.model,
        taskType: 'knowledge_qa',
        prompt,
        system: KNOWLEDGE_QA_SYSTEM,
        temperature: provider.temperature ?? 0,
        maxTokens: provider.maxTokens ?? KNOWLEDGE_QA_MAX_TOKENS,
      });
      text = (result.text ?? '').trim();
    } catch (err) {
      // Generation/network failure — never surface as an error; degrade to results.
      log.error('knowledge_qa generation failed — no answer card:', err);
      return null;
    }
    if (!text) return null;

    // An honest "I don't find that" reply cites no session (tolerant to curly
    // apostrophes / trailing punctuation the model may emit).
    const citations = isNoAnswerReply(text) ? [] : buildSessionCitations(grounding);
    return { text, citations };
  } catch (err) {
    log.error('askKnowledge failed — no answer card:', err);
    return null;
  }
}
