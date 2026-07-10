// === FILE PURPOSE ===
// V3.4 Task 5 hybrid-retrieval + Ask tests for searchService, against a REAL
// PGlite (pgvector) so the cosine <=> queries, the chunk→entity title joins, and
// the RRF fusion all run for real. ai-provider (embed / generate / resolveTaskModel)
// is mocked so query embeddings + the knowledge_qa call are deterministic.
//
// Proves the load-bearing contracts:
//   - hybrid search fuses FTS + vector via RRF (an item in BOTH ranks first),
//   - a vector-ONLY hit is flagged `semantic: true` (and FTS alone never finds it),
//   - per-entity grouping (sessions / cards / projects) is preserved,
//   - the read-side guard degrades to EXACTLY today's FTS output when the semantic
//     layer is absent (no embedding model / empty index / model mismatch),
//   - askKnowledge returns a cited answer on success, the honest sentinel with NO
//     citations when the context doesn't answer, and null on
//     no-model / empty-context / generation failure — never throwing.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

// ---------------------------------------------------------------------------
// Mocks (declared before importing the module under test)
// ---------------------------------------------------------------------------

vi.mock('../ai-provider', () => ({ embed: vi.fn(), generate: vi.fn(), resolveTaskModel: vi.fn() }));
vi.mock('../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));

// ---------------------------------------------------------------------------
// Imports (after mocks) — schema is REAL so drizzle hits the real PGlite tables.
// ---------------------------------------------------------------------------

import { search, askKnowledge } from '../searchService';
import { getEmbeddingStatus } from '../embeddingService';
import { getDb } from '../../db/connection';
import { embed, generate, resolveTaskModel } from '../ai-provider';
import * as schema from '../../db/schema';
import {
  embeddings,
  embeddingIndexMeta,
  EMBEDDING_DIM,
  EMBEDDING_INDEX_META_ID,
  meetings,
  transcripts,
  meetingBriefs,
  cards,
  columns,
  boards,
  projects,
  settings,
} from '../../db/schema';

type Db = ReturnType<typeof drizzle<typeof schema>>;
let pg: PGlite;
let db: Db;

const INDEX_MODEL = 'model-A';

// ---------------------------------------------------------------------------
// Vector helpers — one-hot directions give deterministic cosine ordering.
// ---------------------------------------------------------------------------

/** Length-`EMBEDDING_DIM` vector with `value` at `idx`, zero elsewhere. */
function axis(idx: number, value = 1): number[] {
  const v = new Array<number>(EMBEDDING_DIM).fill(0);
  v[idx] = value;
  return v;
}

const QUERY_VEC = axis(0); // every mocked query embeds to axis 0
const VEC_EXACT = axis(0); // cosine distance 0 from the query
const VEC_NEAR = (() => {
  const v = axis(0, 0.9);
  v[1] = 0.1; // still mostly axis 0 → small (>0) distance
  return v;
})();
const VEC_FAR = axis(5); // orthogonal to the query → distance ~1

const EMB_PROVIDER = {
  providerId: 'lms',
  providerName: 'lmstudio',
  apiKeyEncrypted: null,
  baseUrl: null,
  model: 'emb',
};
const CHAT_PROVIDER = {
  providerId: 'lms',
  providerName: 'lmstudio',
  apiKeyEncrypted: null,
  baseUrl: null,
  model: 'chat',
  temperature: 0,
  maxTokens: 4096,
};

/** resolveTaskModel that answers per task type (null when a slot is disabled). */
function routeTasks(opts: { embedding?: unknown; knowledgeQa?: unknown }) {
  vi.mocked(resolveTaskModel).mockImplementation(async (taskType: string) => {
    if (taskType === 'embedding') return (opts.embedding ?? null) as never;
    if (taskType === 'knowledge_qa') return (opts.knowledgeQa ?? null) as never;
    return null as never;
  });
}

/** embed() mock: every query embeds to `vec`, echoing `model`. */
function mockEmbed(vec = QUERY_VEC, model = INDEX_MODEL) {
  vi.mocked(embed).mockResolvedValue({ embeddings: [vec], model, usage: { tokens: 1 } } as never);
}

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

async function seedProject(name: string): Promise<string> {
  const [p] = await db.insert(projects).values({ name, sortOrder: 0 }).returning();
  return p.id;
}

async function seedMeeting(title: string, projectId: string | null): Promise<string> {
  const [m] = await db
    .insert(meetings)
    .values({ title, startedAt: new Date(), status: 'completed', projectId })
    .returning();
  return m.id;
}

async function seedTranscript(meetingId: string, content: string): Promise<void> {
  await db.insert(transcripts).values({ meetingId, content, startTime: 0, endTime: 1000 });
}

async function seedCard(projectId: string, title: string, description: string | null): Promise<string> {
  const [b] = await db.insert(boards).values({ projectId, name: 'B', position: 0 }).returning();
  const [c] = await db.insert(columns).values({ boardId: b.id, name: 'Col', position: 0 }).returning();
  const [card] = await db.insert(cards).values({ columnId: c.id, title, description }).returning();
  return card.id;
}

async function seedTranscriptChunk(
  meetingId: string,
  projectId: string | null,
  content: string,
  vec: number[],
): Promise<void> {
  await db.insert(embeddings).values({
    entityType: 'transcript_chunk',
    entityId: meetingId,
    chunkIndex: 0,
    content,
    embedding: vec,
    meetingId,
    projectId,
  });
}

async function seedCardEmbedding(
  cardId: string,
  meetingId: string | null,
  projectId: string | null,
  content: string,
  vec: number[],
): Promise<void> {
  await db.insert(embeddings).values({
    entityType: 'card',
    entityId: cardId,
    chunkIndex: 0,
    content,
    embedding: vec,
    meetingId,
    projectId,
  });
}

async function setIndexModel(model: string): Promise<void> {
  await db
    .insert(embeddingIndexMeta)
    .values({ id: EMBEDDING_INDEX_META_ID, model, dimensions: EMBEDDING_DIM })
    .onConflictDoUpdate({ target: embeddingIndexMeta.id, set: { model, dimensions: EMBEDDING_DIM } });
}

/**
 * A fixed corpus reused by most tests, all matching (by keyword or meaning) the
 * query "roadmap":
 *   - mBoth: title matches FTS AND embedding == query  → in BOTH lists
 *   - mFts : title matches FTS, embedding is far        → FTS-only
 *   - mVec : NO 'roadmap' text anywhere, embedding near → vector-ONLY (semantic)
 */
async function seedRoadmapCorpus(): Promise<{
  mBoth: string;
  mFts: string;
  mVec: string;
  projectId: string;
  cardId: string;
}> {
  const projectId = await seedProject('Roadmap Initiative');
  const mBoth = await seedMeeting('Pricing decision roadmap', projectId);
  const mFts = await seedMeeting('Roadmap planning offsite', projectId);
  const mVec = await seedMeeting('Weekly sync', projectId);

  // A transcript with no 'roadmap' term keeps mVec out of the FTS transcript match.
  await seedTranscript(mVec, 'we agreed the northstar direction and the pricing move');

  await seedTranscriptChunk(mBoth, projectId, 'we decided to raise prices by ten percent on the roadmap', VEC_EXACT);
  await seedTranscriptChunk(mFts, projectId, 'logistics for the offsite venue', VEC_FAR);
  await seedTranscriptChunk(mVec, projectId, 'we agreed the northstar direction and the pricing move', VEC_NEAR);

  const cardId = await seedCard(projectId, 'Draft roadmap doc', 'write the outline');
  await seedCardEmbedding(cardId, mBoth, projectId, 'Draft roadmap doc write the outline', VEC_FAR);

  return { mBoth, mFts, mVec, projectId, cardId };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  pg = new PGlite({ extensions: { vector } });
  db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
}, 60000);

afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(getDb).mockReturnValue(db as never);
  routeTasks({ embedding: EMB_PROVIDER, knowledgeQa: CHAT_PROVIDER });
  mockEmbed();

  // Wipe (child → parent).
  await db.delete(embeddings);
  await db.delete(embeddingIndexMeta);
  await db.delete(settings); // clear any recorded index-mismatch flag between tests
  await db.delete(transcripts);
  await db.delete(meetingBriefs);
  await db.delete(cards);
  await db.delete(columns);
  await db.delete(boards);
  await db.delete(meetings);
  await db.delete(projects);
});

// ---------------------------------------------------------------------------
// Hybrid retrieval
// ---------------------------------------------------------------------------

describe('search — hybrid RRF fusion', () => {
  it('ranks an item found by BOTH FTS and vector above single-retriever hits', async () => {
    const { mBoth } = await seedRoadmapCorpus();
    await setIndexModel(INDEX_MODEL);

    const result = await search('roadmap');

    // mBoth: title (FTS) + exact-vector (top vector) → highest fused score.
    expect(result.sessions[0].id).toBe(mBoth);
    expect(result.sessions[0].semantic).toBeFalsy(); // also a keyword hit → not badged
    expect(embed).toHaveBeenCalledTimes(1); // the query is embedded exactly once
  });

  it('flags a vector-ONLY hit as semantic and surfaces it (FTS alone would miss it)', async () => {
    const { mVec } = await seedRoadmapCorpus();
    await setIndexModel(INDEX_MODEL);

    const hybrid = await search('roadmap');
    const vecHit = hybrid.sessions.find((s) => s.id === mVec);
    expect(vecHit).toBeDefined();
    expect(vecHit!.semantic).toBe(true);

    // Prove the semantic layer is what surfaced it: with no embedding model,
    // 'roadmap' (absent from mVec's title + transcript) does NOT return mVec.
    routeTasks({ embedding: null, knowledgeQa: CHAT_PROVIDER });
    const ftsOnly = await search('roadmap');
    expect(ftsOnly.sessions.some((s) => s.id === mVec)).toBe(false);
  });

  it('preserves per-entity grouping (sessions / cards / projects)', async () => {
    const { cardId } = await seedRoadmapCorpus();
    await setIndexModel(INDEX_MODEL);

    const result = await search('roadmap');

    expect(result.sessions.length).toBeGreaterThan(0);
    expect(result.cards.some((c) => c.id === cardId)).toBe(true);
    expect(result.projects.some((p) => p.title === 'Roadmap Initiative')).toBe(true);
    // Projects have no embeddings → never semantic.
    expect(result.projects.every((p) => !p.semantic)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Read-side degradation → FTS-only, today's exact behavior
// ---------------------------------------------------------------------------

describe('search — FTS-only degradation (read-side guard)', () => {
  it('no embedding model configured → vector path skipped, no embed call', async () => {
    const { mVec } = await seedRoadmapCorpus();
    await setIndexModel(INDEX_MODEL);
    routeTasks({ embedding: null, knowledgeQa: CHAT_PROVIDER });

    const result = await search('roadmap');

    expect(embed).not.toHaveBeenCalled();
    expect(result.sessions.some((s) => s.semantic)).toBe(false);
    expect(result.sessions.some((s) => s.id === mVec)).toBe(false); // vector-only hit absent
  });

  it('empty index (no embedding_index_meta row) → FTS-only, no embed call', async () => {
    const { mVec } = await seedRoadmapCorpus();
    // NB: no setIndexModel — the index-meta table is empty.

    const result = await search('roadmap');

    expect(embed).not.toHaveBeenCalled();
    expect(result.sessions.some((s) => s.id === mVec)).toBe(false);
    expect(result.sessions.some((s) => s.semantic)).toBe(false);
  });

  it('current model ≠ index model → never crosses vector spaces (FTS-only)', async () => {
    const { mVec } = await seedRoadmapCorpus();
    await setIndexModel(INDEX_MODEL);
    mockEmbed(QUERY_VEC, 'model-B'); // echoes a DIFFERENT model than the index

    const result = await search('roadmap');

    expect(embed).toHaveBeenCalledTimes(1); // it did embed, then discarded on mismatch
    expect(result.sessions.some((s) => s.id === mVec)).toBe(false);
    expect(result.sessions.some((s) => s.semantic)).toBe(false);
  });

  it('records the model mismatch on the READ side so Settings can prompt a rebuild (still FTS-only)', async () => {
    // A fully-indexed corpus + a model switch produces NO new writes, so the write-side
    // mismatch guard never fires. The read side must record it so the rebuild affordance
    // (getEmbeddingStatus().mismatch) still appears — otherwise search is silently FTS-only.
    const { mVec } = await seedRoadmapCorpus();
    await setIndexModel(INDEX_MODEL);
    mockEmbed(QUERY_VEC, 'model-B'); // echoes a DIFFERENT model than the index

    const result = await search('roadmap');

    // Degrades cleanly to FTS-only without throwing…
    expect(result.sessions.some((s) => s.id === mVec)).toBe(false);
    expect(result.sessions.some((s) => s.semantic)).toBe(false);

    // …and persists the SAME flag the write side uses, so the UI surfaces "rebuild?".
    const status = await getEmbeddingStatus();
    expect(status.mismatch).toEqual({ stored: INDEX_MODEL, current: 'model-B' });
  });

  it('an empty query short-circuits with no db or model access', async () => {
    const result = await search('   ');
    expect(result).toEqual({ sessions: [], cards: [], projects: [] });
    expect(embed).not.toHaveBeenCalled();
    expect(resolveTaskModel).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// askKnowledge — grounded, cited synthesis with honest degradation
// ---------------------------------------------------------------------------

describe('askKnowledge — cited answer', () => {
  it('makes ONE knowledge_qa call and returns the answer with source-session citations', async () => {
    const { mBoth } = await seedRoadmapCorpus();
    await setIndexModel(INDEX_MODEL);
    vi.mocked(generate).mockResolvedValue({ text: 'You decided to raise prices by 10%.' } as never);

    const answer = await askKnowledge('what did we decide about pricing?');

    expect(generate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(generate).mock.calls[0][0].taskType).toBe('knowledge_qa');
    expect(answer).not.toBeNull();
    expect(answer!.text).toContain('raise prices');
    expect(answer!.citations.length).toBeGreaterThan(0);
    expect(answer!.citations.every((c) => typeof c.meetingId === 'string' && c.title.length > 0)).toBe(true);
    // The closest session (mBoth, exact-vector) is among the cited sessions.
    expect(answer!.citations.some((c) => c.meetingId === mBoth)).toBe(true);
  });

  it('grounds the model ONLY in retrieved chunk context (system prompt forbids outside knowledge)', async () => {
    await seedRoadmapCorpus();
    await setIndexModel(INDEX_MODEL);
    vi.mocked(generate).mockResolvedValue({ text: 'answer' } as never);

    await askKnowledge('what about pricing?');

    const call = vi.mocked(generate).mock.calls[0][0];
    expect(call.system?.toLowerCase()).toContain('only');
    expect(call.prompt).toContain('raise prices by ten percent'); // the chunk text is in the prompt
    expect(call.maxTokens ?? 0).toBeGreaterThanOrEqual(4096); // reasoning-model floor honored
  });

  it('returns the honest sentinel with NO citations when the context does not answer', async () => {
    await seedRoadmapCorpus();
    await setIndexModel(INDEX_MODEL);
    vi.mocked(generate).mockResolvedValue({ text: "I don't find that in your sessions." } as never);

    const answer = await askKnowledge('what is the capital of France?');

    expect(answer).not.toBeNull();
    expect(answer!.text).toContain("don't find that");
    expect(answer!.citations).toEqual([]); // an honest no-answer cites nothing
  });

  it('detects the sentinel with a CURLY apostrophe / trailing punctuation and cites nothing', async () => {
    await seedRoadmapCorpus();
    await setIndexModel(INDEX_MODEL);
    // The model emits the honest reply with a typographic apostrophe (U+2019) and a
    // trailing space — a plain lowercase substring check would miss it and wrongly
    // attach citations to a "no answer" reply.
    vi.mocked(generate).mockResolvedValue({ text: 'I don’t find that in your sessions. ' } as never);

    const answer = await askKnowledge('what is the capital of France?');

    expect(answer).not.toBeNull();
    expect(answer!.citations).toEqual([]);
  });
});

describe('askKnowledge — card-dominant answers do not attribute to unrelated sessions', () => {
  it('suppresses session citations when the closest grounding chunk is a card', async () => {
    const projectId = await seedProject('Card-led');
    const meetingId = await seedMeeting('Weekly sync', projectId);
    // A session chunk FAR from the query…
    await seedTranscriptChunk(meetingId, projectId, 'unrelated logistics discussion', VEC_FAR);
    // …and a card chunk that is the EXACT match → the closest hit overall.
    const cardId = await seedCard(projectId, 'Login refactor', 'ship the auth rewrite');
    await seedCardEmbedding(cardId, null, projectId, 'Login refactor ship the auth rewrite', VEC_EXACT);
    await setIndexModel(INDEX_MODEL);
    vi.mocked(generate).mockResolvedValue({ text: 'The login refactor ships the auth rewrite.' } as never);

    const answer = await askKnowledge('status of the login refactor?');

    expect(answer).not.toBeNull();
    expect(answer!.text).toContain('login refactor');
    // Card is the closest chunk → card-sourced answer → the far session is NOT a source.
    expect(answer!.citations).toEqual([]);
  });
});

describe('askKnowledge — degradation returns null (renderer shows plain results)', () => {
  it('no knowledge_qa model configured → null (no embed, no generate)', async () => {
    await seedRoadmapCorpus();
    await setIndexModel(INDEX_MODEL);
    routeTasks({ embedding: EMB_PROVIDER, knowledgeQa: null });

    const answer = await askKnowledge('what did we decide?');

    expect(answer).toBeNull();
    expect(generate).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled(); // chat-model gate fails before any retrieval
  });

  it('empty retrieval context (no embedding model) → null, no generate call', async () => {
    await seedRoadmapCorpus();
    await setIndexModel(INDEX_MODEL);
    routeTasks({ embedding: null, knowledgeQa: CHAT_PROVIDER });

    const answer = await askKnowledge('what did we decide?');

    expect(answer).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });

  it('generation failure → null (never throws to the renderer)', async () => {
    await seedRoadmapCorpus();
    await setIndexModel(INDEX_MODEL);
    vi.mocked(generate).mockRejectedValue(new Error('model exploded'));

    await expect(askKnowledge('what did we decide?')).resolves.toBeNull();
  });

  it('empty model output → null', async () => {
    await seedRoadmapCorpus();
    await setIndexModel(INDEX_MODEL);
    vi.mocked(generate).mockResolvedValue({ text: '   ' } as never);

    await expect(askKnowledge('what did we decide?')).resolves.toBeNull();
  });
});
