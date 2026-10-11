// === FILE PURPOSE ===
// Digital Twin living memory (V3.4). Owns the twin_facts lifecycle:
//   - extractFacts()  — learn discrete facts from a finished session (post-session hook)
//   - listFacts()     — read facts for the memory-management UI
//   - forgetFact()    — mark a fact 'forgotten' (excluded from injection, restorable)
//   - restoreFact()   — bring a forgotten fact back to 'active'
//   - purgeFact() / purgeAllForgotten() — "Delete permanently": erase a forgotten
//                       fact's text for good, keeping only a fingerprint
//   - isLearningPaused() — the main-side read of the learning-pause gate
//
// === HOW EXTRACTION WORKS (V3.4 Task 2) ===
// A single post-session hook (learningPostSessionHook, self-registered on import)
// runs extractFacts after every brief. Extraction reads ONLY already-distilled,
// already-model-routed data — the session's brief + the suggestions the user
// ACCEPTED live — never the raw transcript. It routes through the `twin_learning`
// task and REUSES twinResearchService.generateValidated (the twin domain's one
// validate-retry-skip pipeline — no second pipeline). Learned facts are deduped
// (normalized-equality, mirroring the triage discipline) against existing ACTIVE
// facts + within the batch, capped at ~5/session, and stored with provenance
// (sourceMeetingId). The whole pass is gated by isLearningPaused() and can never
// throw into the dispatcher (defensive + error-isolated), so a learning failure
// never harms brief generation.
//
// === REGENERATE REPLACES (TWIN-LOOP Task 2) ===
// A meeting's active facts always come from its latest SUCCESSFUL extraction: a
// pass in which the model returned >=1 candidate deletes that meeting's earlier
// ACTIVE facts and inserts the new set in one transaction — even when every
// candidate dedupes away (then the new set is empty and the old facts simply go:
// the extraction succeeded and found nothing new to keep for this meeting). The
// old set is kept ONLY when the pass was skipped (paused, no model, no material,
// the latest brief is a failure card), failed, or the model returned zero
// candidates ([]). Forgotten facts, other meetings' facts, interview facts and kept
// facts of deleted meetings are never touched. Passes for the same meeting run one
// at a time, in call order; each reads the latest brief when it RUNS, which is why
// a failure-card brief (a later Regenerate that failed) is a skip, never material.
// The forgotten list is re-read INSIDE the replace transaction, so a fact the user
// Forgets while a pass's model call is in flight is never re-learned as active.
// Accepted (L1): a fact the user restored via undo is an ordinary active fact of
// its meeting, so the next successful Regenerate of that meeting replaces it too.
//
// === LIVE-REFRESH TRIGGER (TWIN-GRAPH.2 Task 4) ===
// A successful extraction that actually changed rows (>=1 fact inserted, or the
// meeting's old facts removed) broadcasts data:changed({scope:'twin-memory'}) so a
// renderer sitting on Twin -> Memory picks the change up without leaving and
// returning to the tab (see renderer/services/twinMemoryLiveSync.ts, the twin-side
// sibling to brainLiveSync — that file is NOT touched by this scope). A skip
// (paused, no model, no material) or a pass that changed nothing fires nothing.
//
// === DEPENDENCIES ===
// drizzle-orm, db/connection (getDb), db/schema (settings/twinFacts/
// liveSuggestions), ai-provider (resolveTwinLearningModel), twinResearchService
// (generateValidated — the shared extraction helper), dataChangeNotifier
// (notifyDataChanged), postSessionDispatcher (registerPostSessionHook), shared
// twin types, meetingService (getMeeting — MEET-DEL.1 existence recheck),
// db/errors (isForeignKeyViolation — MEET-DEL.1 FK-violation classification),
// briefRecordService (loadLatestBriefRecord/fitNotesWithinBudget — BRIEF-QUAL.2
// Task 3, the shared "brief + full notes" read path), shared briefRecordText
// (structureToText — renders the record's structure into the notes block), shared
// briefSentinel (isFailedBriefText — a failure-card brief is never material).
//
// === MEET-DEL.1: deleted-meeting race absorption ===
// extractFacts's own insert is guarded twice: a fresh getMeeting() check right
// before the write (closes most of the race a deleted meeting opens under the
// long-running extraction call), AND an isForeignKeyViolation() check in the
// existing outer catch (closes the remainder — a delete landing between that
// check and the insert). Either signal resolves to the SAME typed no-op this
// function already used for every other skip: {status:'skipped', reason:
// 'meeting-deleted', facts:[]}, logged once at info — never a raw FK error.

import { createHash } from 'node:crypto';
import { and, asc, desc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/connection';
import { settings, twinFacts, liveSuggestions } from '../db/schema';
import { createLogger } from './logger';
import { resolveTwinLearningModel, type ResolvedProvider } from './ai-provider';
import { generateValidated } from './twinResearchService';
import { notifyDataChanged } from './dataChangeNotifier';
import { registerPostSessionHook, type PostSessionHook } from './postSessionDispatcher';
import { getMeeting } from './meetingService';
import { isForeignKeyViolation } from '../db/errors';
import { loadLatestBriefRecord, fitNotesWithinBudget } from './briefRecordService';
import { structureToText } from '../../shared/utils/briefRecordText';
import { isFailedBriefText } from '../../shared/briefSentinel';
import { rankFactsByRelevance } from './twinRelevance';
import {
  TWIN_FACTS_IN_USE_SETTING_KEY,
  TWIN_LEARNING_PAUSED_SETTING_KEY,
  resolveFactsInUse,
} from '../../shared/types/twin';
import type {
  TwinFact,
  TwinFactCategory,
  TwinFactStatus,
  TwinMemoryListFilter,
  BackfillFactLabelsResult,
} from '../../shared/types/twin';

const log = createLogger('TwinMemory');

/** Max facts learned per session — keeps memory growth bounded and signal high. */
const TWIN_FACT_CAP = 5;

/** Bound the extraction context so a big brief + many accepted items can't blow
 *  the model's window (the twin_learning ≥4096 output floor handles the reply). */
const MAX_EXTRACTION_CONTEXT_CHARS = 6000;

/** Defensive ceiling on a stored label's length (TWIN-READ.1 Task 1) — labels are
 *  meant to be 2-4 words, but this only guards against a runaway/garbage model
 *  output; it is never the primary shaping mechanism. */
const LABEL_MAX_CHARS = 60;

/** Facts labeled per backfillFactLabels() call — chunked so a single
 *  user-triggered pass stays fast and never blocks the caller; naturally
 *  resumable (each call re-queries "still unlabelled", no cursor to track). */
const BACKFILL_CHUNK_SIZE = 20;

/** Per-meeting tail of the extraction chain (see extractFacts). */
const extractionTails = new Map<string, Promise<void>>();

const FACT_CATEGORIES = ['person', 'project', 'preference', 'domain', 'commitment'] as const;

/** Outcome of a per-session fact-extraction pass. `skipped` never hard-fails the
 *  post-session dispatcher; `facts` carries the newly learned (active) facts. */
export interface ExtractFactsResult {
  status: 'ok' | 'skipped';
  /** Why nothing was learned (only present on `skipped`). `meeting-deleted`
   *  (MEET-DEL.1) is the deleted-meeting race — closed either by a fresh
   *  existence recheck or by catching the insert's FK violation. */
  reason?: 'no-model' | 'no-learning-model' | 'failed' | 'paused' | 'meeting-deleted';
  facts: TwinFact[];
}

// ---------------------------------------------------------------------------
// Extraction prompt + schema
// ---------------------------------------------------------------------------

const EXTRACTION_SYSTEM = `You distill a professional's finished meeting into a few DURABLE facts worth remembering long-term about the user's world — the people they work with, their projects, their stated preferences, their domain, and commitments they made.
Rules:
- Extract ONLY facts clearly supported by the provided brief and confirmed items — never invent, guess, or infer beyond them.
- Each fact is ONE short, self-contained sentence that will still be true and useful in FUTURE meetings — avoid meeting-specific ephemera (e.g. "the call started late", "we reviewed the deck").
- Prefer durable, reusable knowledge over one-off details.
- Also give each fact a SHORT 2-4 word "label" naming it (e.g. "Prefers async standups") — a phrase, not a sentence, no trailing punctuation. If you cannot produce a good short label, omit the field entirely rather than guessing.
- Do NOT repeat anything already listed under "Already known" below.
- Return AT MOST 5 facts. If nothing durable is worth remembering, return an empty array [].
Respond with ONLY the JSON described below — no prose, no markdown code fences.`;

const EXTRACTION_OUTPUT_SPEC =
  'a JSON array of { "fact": string, "category": "person"|"project"|"preference"|"domain"|"commitment", "label"?: string } — at most 5 durable facts. "label" is a short 2-4 word phrase naming the fact; omit it if you cannot produce a good one.';

/**
 * Validates the model's output; malformed/over-cap-shape output is rejected by
 * generateValidated's retry-then-skip discipline. `label` is intentionally
 * `z.unknown().optional()`, NOT a strict string schema: a model that ignores the
 * field, returns the wrong type, or returns garbage must NEVER fail validation
 * for the whole batch and lose otherwise-good facts — sanitizeLabel() validates
 * it defensively in code instead, degrading a bad label to null.
 */
const extractedFactsSchema = z.array(
  z.object({
    fact: z.string().min(1),
    category: z.enum(FACT_CATEGORIES),
    label: z.unknown().optional(),
  }),
);

interface ExtractedFact {
  fact: string;
  category: TwinFactCategory;
  label?: unknown;
}

/** A fact after dedupe, with its label validated/sanitized (never raw model output). */
interface DedupedFact {
  fact: string;
  category: TwinFactCategory;
  label: string | null;
}

/**
 * Defensive validation for the model's optional label field. NEVER throws;
 * anything that isn't a non-empty string quietly degrades to null (the derived
 * fallback in shared/twin/factLabel.ts covers it) rather than corrupting or
 * dropping the fact itself. Overlong output is capped, never rejected.
 */
function sanitizeLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.length > LABEL_MAX_CHARS ? trimmed.slice(0, LABEL_MAX_CHARS).trim() : trimmed;
}

/** Accepted live-suggestion (the user one-tap-confirmed it during the meeting). */
interface AcceptedItem {
  type: string;
  title: string;
  description: string | null;
}

type Db = ReturnType<typeof getDb>;

// ---------------------------------------------------------------------------
// Row mapping + dedupe
// ---------------------------------------------------------------------------

/** Normalize a raw twin_facts row into the public shape (Date -> ISO string). */
function rowToFact(row: typeof twinFacts.$inferSelect): TwinFact {
  return {
    id: row.id,
    fact: row.fact,
    label: row.label ?? null,
    category: row.category,
    sourceMeetingId: row.sourceMeetingId,
    // MEET-DEL.1's kept-fact snapshot provenance — read straight through, same
    // as sourceMeetingId (never re-derived here; the column already is the
    // single source of truth for this value).
    sourceMeetingLabel: row.sourceMeetingLabel,
    status: row.status,
    createdAt: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString(),
  };
}

/** Case/whitespace/trailing-punctuation-insensitive key for dedupe (mirrors the
 *  triage discipline — lowercased-title matching — extended for sentence facts). */
function normalizeFact(fact: string): string {
  return fact
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?;,]+$/g, '')
    .trim();
}

/** The fingerprint a purged fact keeps (TWIN-LOOP.2 Task 3): sha256 hex of the
 *  normalized text. Forgotten (not yet purged) facts are compared through the same
 *  hash, so "forgotten" and "purged" block re-learning by ONE rule. */
function fingerprintOf(fact: string): string {
  return createHash('sha256').update(normalizeFact(fact), 'utf8').digest('hex');
}

/**
 * Drop candidates that duplicate an existing ACTIVE fact or an earlier candidate in
 * this same batch (normalized-equality — same Set discipline as triage), or whose
 * fingerprint is BLOCKED (a fact the user Forgot or permanently deleted), then cap
 * at ~5/session. Blocked facts are a post-generation FILTER only — never disclosed
 * to the model (they are NOT in the prompt's "Already known" list), so a fact the
 * user explicitly Forgot or deleted is never silently re-learned as a new active
 * row. Preserves the model's ordering for the survivors.
 */
function dedupeFacts(
  candidates: ExtractedFact[],
  existingKnown: string[],
  blocked: ReadonlySet<string>,
): DedupedFact[] {
  const seen = new Set(existingKnown.map(normalizeFact));
  const out: DedupedFact[] = [];
  for (const c of candidates) {
    const fact = c.fact.trim();
    if (!fact) continue;
    const key = normalizeFact(fact);
    if (!key || seen.has(key)) continue; // dedupe vs existing active + within batch
    if (blocked.has(fingerprintOf(fact))) continue; // forgotten or purged
    seen.add(key);
    out.push({ fact, category: c.category, label: sanitizeLabel(c.label) });
    if (out.length >= TWIN_FACT_CAP) break; // ~5-cap per session
  }
  return out;
}

// ---------------------------------------------------------------------------
// Source-material loaders (pure DB reads — the distilled inputs to extraction)
// ---------------------------------------------------------------------------

/** Suggestions the user ACCEPTED live during the meeting (already model-routed —
 *  the consent-consistent, distilled second input; NOT the raw transcript). */
async function loadAcceptedSuggestions(db: Db, meetingId: string): Promise<AcceptedItem[]> {
  const rows = await db
    .select({ type: liveSuggestions.type, title: liveSuggestions.title, description: liveSuggestions.description })
    .from(liveSuggestions)
    .where(and(eq(liveSuggestions.meetingId, meetingId), eq(liveSuggestions.status, 'accepted')));
  return rows.map((r) => ({ type: r.type, title: r.title, description: r.description }));
}

/** Every currently-ACTIVE fact's text EXCEPT this meeting's own (TWIN-LOOP Task 2)
 *  — feeds BOTH the prompt exclusion list and the post-parse dedupe. This meeting's
 *  earlier active facts are about to be replaced, so they must be neither disclosed
 *  as "Already known" nor allowed to suppress a rewording. Filtered in JS, not SQL:
 *  `source_meeting_id <> $1` is NULL (not true) for interview and kept facts, which
 *  would silently drop exactly the rows that must stay in the list. Newest first, so
 *  when the context budget forces a choice among equally (ir)relevant facts, recency wins. */
async function loadActiveFactStrings(db: Db, excludeMeetingId: string): Promise<string[]> {
  const rows = await db
    .select({ fact: twinFacts.fact, sourceMeetingId: twinFacts.sourceMeetingId })
    .from(twinFacts)
    .where(eq(twinFacts.status, 'active'))
    .orderBy(desc(twinFacts.createdAt));
  return rows.filter((r) => r.sourceMeetingId !== excludeMeetingId).map((r) => r.fact);
}

/**
 * Fingerprints of every fact that must never be re-learned: each FORGOTTEN fact
 * (hashed from its text) and each PURGED fact (its stored fingerprint — the text is
 * gone). Feeds the post-parse dedupe ONLY (never the prompt), so a forgotten fact's
 * content is never re-surfaced to the model. A row carrying a fingerprint blocks
 * whatever its status, so a tombstone can never stop blocking. Takes a `select`-
 * capable handle so the replace transaction re-reads through the same rule.
 */
async function loadBlockedFingerprints(db: Pick<Db, 'select'>): Promise<Set<string>> {
  const rows = await db
    .select({ fact: twinFacts.fact, fingerprint: twinFacts.fingerprint })
    .from(twinFacts)
    .where(or(eq(twinFacts.status, 'forgotten'), isNotNull(twinFacts.fingerprint)));
  return new Set(rows.map((r) => r.fingerprint ?? fingerprintOf(r.fact)));
}

/** Header for the record's rendered structure (BRIEF-QUAL.2) — the block label
 *  carries the meaning, so EXTRACTION_SYSTEM above needs no wording change. */
const FULL_NOTES_BLOCK_HEADER = 'Full notes (the complete record behind the brief):\n';
const BLOCK_SEPARATOR = '\n\n';
const KNOWN_FACTS_HEADER = 'Already known (do NOT repeat these):';
/** Most of the budget the "Already known" block may CLAIM AHEAD of the full notes
 *  (TWIN-LOOP Task 3). Below this the block is sized exactly as before; above it the
 *  notes win the room and the block shrinks to the facts relevant to this meeting. */
const KNOWN_FACTS_RESERVE_CHARS = 1000;

function knownFactsBlock(facts: string[]): string {
  return `${KNOWN_FACTS_HEADER}\n${facts.map((f) => `- ${f}`).join('\n')}`;
}

/**
 * The "Already known" facts that fit in `room` characters (TWIN-LOOP Task 3). When
 * the whole list fits it is returned untouched (byte-identical to before). Otherwise
 * the facts are ranked by relevance to THIS meeting (twinRelevance.rankFactsByRelevance
 * - the one shared ranker), packed whole-item (never a cut-off fact) into the room, and
 * returned in their original order. This only shapes what the MODEL is shown; the
 * post-parse dedupe still sees every fact.
 */
function fitKnownFacts(facts: string[], relevanceText: string, room: number): string[] {
  if (facts.length === 0 || knownFactsBlock(facts).length <= room) return facts;
  const unique = [...new Set(facts)];
  const chosen = new Set<string>();
  let used = KNOWN_FACTS_HEADER.length;
  for (const fact of rankFactsByRelevance(unique, relevanceText)) {
    const cost = '\n- '.length + fact.length;
    if (used + cost > room) continue;
    used += cost;
    chosen.add(fact);
  }
  return unique.filter((f) => chosen.has(f));
}

/**
 * Assemble the bounded extraction context from the distilled inputs + the
 * do-not-repeat exclusion list. Exported for direct unit testing — the
 * null-structure (`notes: ''`) case must stay byte-identical to before
 * BRIEF-QUAL.2 Task 3 forever.
 *
 * `notes` (BRIEF-QUAL.2 — the brief's record, rendered via
 * briefRecordText.structureToText; '' when the brief has no structure) is
 * inserted as its own block right after "Meeting brief:" and before "Confirmed
 * live…", so the record's completeness survives even where the writer judged a
 * minor topic out of the narrative. It is fitted to whatever room remains
 * after today's other blocks (fitNotesWithinBudget, cut only at a `\n`
 * boundary) and dropped entirely when nothing fits — the brief's own synthesis
 * always wins the budget first. Returns '' when there is no source material at
 * all.
 */
export function buildExtractionContext(
  briefSummary: string,
  accepted: AcceptedItem[],
  knownFacts: string[],
  notes = '',
): string {
  const brief = briefSummary.trim();
  const head: string[] = brief ? [`Meeting brief:\n${brief}`] : [];
  const tail: string[] = [];
  if (accepted.length > 0) {
    const lines = accepted.map((a) =>
      a.description ? `- [${a.type}] ${a.title}: ${a.description}` : `- [${a.type}] ${a.title}`,
    );
    tail.push(`Confirmed live during the meeting:\n${lines.join('\n')}`);
  }
  const joinedLength = (blocks: string[]) => blocks.join(BLOCK_SEPARATOR).length;

  // TWIN-LOOP Task 3: the meeting outranks the memory. Priority is brief, then the
  // full notes, then confirmed-live items, then known facts - the growing fact list
  // may claim at most KNOWN_FACTS_RESERVE_CHARS ahead of the notes, so after a few
  // dozen meetings the memory can no longer crowd the notes out.
  const reservedKnown = Math.min(knownFactsBlock(knownFacts).length, KNOWN_FACTS_RESERVE_CHARS);
  let notesBlock: string[] = [];
  if (notes) {
    const todayLength =
      joinedLength([...head, ...tail]) + (knownFacts.length > 0 ? reservedKnown + BLOCK_SEPARATOR.length : 0);
    const reserved = FULL_NOTES_BLOCK_HEADER.length + 2 * BLOCK_SEPARATOR.length;
    const fitted = fitNotesWithinBudget(notes, MAX_EXTRACTION_CONTEXT_CHARS - todayLength - reserved);
    if (fitted) notesBlock = [`${FULL_NOTES_BLOCK_HEADER}${fitted}`];
  }

  const blocks = [...head, ...notesBlock, ...tail];
  if (knownFacts.length > 0) {
    const room = MAX_EXTRACTION_CONTEXT_CHARS - joinedLength(blocks) - (blocks.length > 0 ? BLOCK_SEPARATOR.length : 0);
    const shown = fitKnownFacts(knownFacts, `${brief}\n${notes}`, room);
    if (shown.length > 0) blocks.push(knownFactsBlock(shown));
  }
  return blocks.join(BLOCK_SEPARATOR);
}

/**
 * TWIN-LOOP Task 2: REPLACE this meeting's active facts with `facts`, in ONE
 * transaction — a failed insert (FK race included) rolls the delete back, so the
 * old set is never lost without a replacement. Only status='active' rows of THIS
 * meeting go: forgotten facts (the user's decision), other meetings' facts,
 * interview facts and kept facts (sourceMeetingId null) are never matched.
 *
 * The blocked fingerprints (forgotten + purged) are re-read HERE, inside the
 * transaction: the list read before the model call is stale by the time the reply
 * lands, and a fact the user Forgot or deleted permanently meanwhile (this meeting's
 * own, so absent from the pre-call dedupe set) would otherwise come back as a new
 * active row. `removed` is the delete's row count (0 when the driver reports none).
 */
async function replaceMeetingFacts(
  db: Db,
  meetingId: string,
  facts: DedupedFact[],
): Promise<{ inserted: (typeof twinFacts.$inferSelect)[]; removed: number }> {
  return db.transaction(async (tx) => {
    const blockedNow = await loadBlockedFingerprints(tx);
    const fresh = facts.filter((c) => !blockedNow.has(fingerprintOf(c.fact)));
    // Never delete without a replacement: nothing new survived, so the old set stays.
    if (fresh.length === 0) return { inserted: [], removed: 0 };

    const deleted = await tx
      .delete(twinFacts)
      .where(and(eq(twinFacts.sourceMeetingId, meetingId), eq(twinFacts.status, 'active')));
    const removed = deleted?.affectedRows ?? 0;

    const inserted = await tx
      .insert(twinFacts)
      .values(
        fresh.map((c) => ({
          fact: c.fact,
          label: c.label, // sanitized by dedupeFacts — null when the model omitted/botched it
          category: c.category,
          sourceMeetingId: meetingId, // provenance on EVERY learned fact
          status: 'active' as const,
        })),
      )
      .returning();
    return { inserted, removed };
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Learn discrete, provenanced facts from a finished session and persist them to
 * twin_facts. Input is the session's brief + the user's ACCEPTED live suggestions
 * (already distilled + model-routed — never the raw transcript). Routes through
 * `twin_learning` and REUSES twinResearchService.generateValidated. Gated by
 * isLearningPaused(); defensive — NEVER throws (so it can never harm the brief),
 * returning `skipped` on any absence/failure. No fabricated facts.
 */
export function extractFacts(meetingId: string): Promise<ExtractFactsResult> {
  // TWIN-LOOP Task 2: one pass per meeting at a time, in call order — so the LATEST
  // call's result is the one that stands (never an older, slower pass finishing last).
  // extractFactsUnserialized never rejects, so the chain can't be poisoned.
  const run = (extractionTails.get(meetingId) ?? Promise.resolve()).then(() => extractFactsUnserialized(meetingId));
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  extractionTails.set(meetingId, tail);
  void tail.then(() => {
    if (extractionTails.get(meetingId) === tail) extractionTails.delete(meetingId);
  });
  return run;
}

async function extractFactsUnserialized(meetingId: string): Promise<ExtractFactsResult> {
  try {
    if (await isLearningPaused()) {
      log.debug('extractFacts — learning paused; no-op (no extraction)');
      return { status: 'skipped', reason: 'paused', facts: [] };
    }

    const provider = await resolveTwinLearningModel();
    if (!provider) {
      // Count-only log: no meeting id, no content. Touches no facts.
      log.info('extractFacts — no explicit or local learning model; skipped (no facts touched)');
      return { status: 'skipped', reason: 'no-learning-model', facts: [] };
    }

    const db = getDb();
    const [briefRecord, accepted] = await Promise.all([
      loadLatestBriefRecord(db, meetingId),
      loadAcceptedSuggestions(db, meetingId),
    ]);
    if (!briefRecord.summary.trim() && accepted.length === 0) {
      // Nothing distilled to learn from (no brief, nothing accepted live). A
      // record cannot exist without a successful brief, so this check alone
      // still covers the "no material at all" case.
      return { status: 'skipped', reason: 'failed', facts: [] };
    }
    if (isFailedBriefText(briefRecord.summary)) {
      // A queued pass reads the latest brief when it RUNS; if a later Regenerate
      // failed meanwhile, that row is the failure card — never learn from it, and
      // keep the facts the last good brief produced.
      log.info(`Latest brief of meeting ${meetingId} is a failure card — facts kept, nothing learned`);
      return { status: 'skipped', reason: 'failed', facts: [] };
    }

    // Active facts of OTHER meetings (and interview/kept facts) feed BOTH the model's
    // "Already known" exclusion list AND the dedupe; this meeting's own are excluded
    // because a successful pass replaces them. Forgotten and purged facts (any meeting,
    // this one included) feed the dedupe ONLY, as fingerprints — so such a fact is
    // neither re-learned nor re-disclosed to the model, and the replace below never
    // touches it.
    const [existingActive, blocked] = await Promise.all([
      loadActiveFactStrings(db, meetingId),
      loadBlockedFingerprints(db),
    ]);
    // BRIEF-QUAL.2: the record's rendered structure, brief-first — see
    // buildExtractionContext's own doc comment for the budget/placement rules.
    const notes = briefRecord.structure ? structureToText(briefRecord.structure) : '';
    const context = buildExtractionContext(briefRecord.summary, accepted, existingActive, notes).slice(
      0,
      MAX_EXTRACTION_CONTEXT_CHARS,
    );

    const parsed = await generateValidated({
      provider,
      taskType: 'twin_learning',
      system: `${EXTRACTION_SYSTEM}\n\nReturn ${EXTRACTION_OUTPUT_SPEC}`,
      context,
      schema: extractedFactsSchema,
      label: `Fact extraction (meeting ${meetingId})`,
    });
    if (parsed == null) return { status: 'skipped', reason: 'failed', facts: [] };

    // The old set is replaced only when at least one NEW fact survives dedupe: a reply of
    // nothing, or only of facts already known elsewhere / forgotten, keeps it. A weak
    // model echoing the "Already known" list must never hard-delete a meeting's memory.
    const candidates = (parsed as ExtractedFact[]).filter((c) => c.fact.trim());
    const deduped = dedupeFacts(candidates, existingActive, blocked);
    if (deduped.length === 0) return { status: 'ok', facts: [] };

    // MEET-DEL.1: re-check existence immediately before the write — the extraction
    // call above is long-running, which is exactly the window a delete can land in.
    // This alone cannot close the race (see the FK catch below); it just closes
    // most of it cheaply, before spending a write on a meeting that is already gone.
    if (!(await getMeeting(meetingId))) {
      log.info(`Meeting ${meetingId} deleted before fact extraction completed — discarded`);
      return { status: 'skipped', reason: 'meeting-deleted', facts: [] };
    }

    const { inserted, removed } = await replaceMeetingFacts(db, meetingId, deduped);

    log.info(`Learned ${inserted.length} fact(s) from meeting ${meetingId} (replaced ${removed})`);
    // Live-refresh trigger: only on an actual change — a renderer sitting on the
    // Memory tab has something new to bloom in (or old facts to drop).
    if (inserted.length > 0 || removed > 0) notifyDataChanged({ scope: 'twin-memory' });
    return { status: 'ok', facts: inserted.map(rowToFact) };
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      // MEET-DEL.1: the existence check above closes most of the race window; a
      // delete landing between that check and this insert still hits the FK —
      // same benign no-op, never a raw SQL error carrying fact text.
      log.info(`Meeting ${meetingId} deleted before fact extraction completed — discarded`);
      return { status: 'skipped', reason: 'meeting-deleted', facts: [] };
    }
    // Defensive: extraction can NEVER throw into the post-session dispatcher, so a
    // learning failure can never fail or delay brief generation.
    log.error('extractFacts failed — no facts learned this session:', err);
    return { status: 'skipped', reason: 'failed', facts: [] };
  }
}

/**
 * List learned facts for the memory-management UI (twin:memory-list), newest
 * first. No filter ⇒ all facts (active + forgotten) so the UI can restore
 * forgotten ones; `status`/`category` narrow the result. A purged fact (a
 * tombstone with no text) is never listed, whatever the filter.
 */
export async function listFacts(filter?: TwinMemoryListFilter): Promise<TwinFact[]> {
  const db = getDb();
  const conditions = [isNull(twinFacts.purgedAt)];
  if (filter?.status) conditions.push(eq(twinFacts.status, filter.status));
  if (filter?.category) conditions.push(eq(twinFacts.category, filter.category));

  const rows = await db
    .select()
    .from(twinFacts)
    .where(and(...conditions))
    .orderBy(desc(twinFacts.createdAt));
  return rows.map(rowToFact);
}

/** Set a fact's lifecycle status and return the updated fact (null if not found).
 *  A purged fact is not found: it can never be restored (its text is gone) or
 *  forgotten again. */
async function setFactStatus(factId: string, status: TwinFactStatus): Promise<TwinFact | null> {
  const db = getDb();
  const [row] = await db
    .update(twinFacts)
    .set({ status })
    .where(and(eq(twinFacts.id, factId), isNull(twinFacts.purgedAt)))
    .returning();
  return row ? rowToFact(row) : null;
}

/**
 * Mark a fact 'forgotten' so it is excluded from injection but kept for restore
 * (twin:memory-forget). Returns the updated fact, or null when not found.
 */
export async function forgetFact(factId: string): Promise<TwinFact | null> {
  return setFactStatus(factId, 'forgotten');
}

/**
 * Restore a forgotten fact back to 'active' (twin:memory-restore). Returns the
 * updated fact, or null when not found.
 */
export async function restoreFact(factId: string): Promise<TwinFact | null> {
  return setFactStatus(factId, 'active');
}

// ---------------------------------------------------------------------------
// Delete permanently (TWIN-LOOP.2 Task 3) — the user's explicit, final erase
// ---------------------------------------------------------------------------

/** The ONLY rows a purge may touch: forgotten and not yet purged. An active fact
 *  is never purgeable (the user must Forget it first), and a purged row is never
 *  re-purged, so a repeated call is a no-op. */
function purgeable() {
  return and(eq(twinFacts.status, 'forgotten'), isNull(twinFacts.purgedAt));
}

/**
 * Erase the text of every purgeable fact matching `factId` (or all of them when
 * omitted), in ONE transaction: the row keeps only its category, its source
 * meeting id, a fingerprint (sha256 of the normalized text — so the fact is never
 * re-learned) and purged_at. Returns how many rows were purged.
 */
async function purgeRows(db: Db, factId?: string): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: twinFacts.id, fact: twinFacts.fact })
      .from(twinFacts)
      .where(factId ? and(eq(twinFacts.id, factId), purgeable()) : purgeable());
    const purgedAt = new Date();
    for (const row of rows) {
      await tx
        .update(twinFacts)
        .set({ fingerprint: fingerprintOf(row.fact), fact: '', label: null, sourceMeetingLabel: null, purgedAt })
        .where(and(eq(twinFacts.id, row.id), purgeable()));
    }
    return rows.length;
  });
}

/**
 * Best-effort space reclaim after a purge. Clearing a column leaves the old row
 * version in the table file until VACUUM removes it, so this is attempted — but
 * the purge is already committed, so a failure here is logged and never fails it.
 * Returns whether VACUUM ran (logged either way; never assumed).
 */
async function vacuumAfterPurge(db: Db): Promise<boolean> {
  try {
    await db.execute(sql`VACUUM twin_facts`);
    log.info('Purge — VACUUM twin_facts ran');
    return true;
  } catch (err) {
    log.warn(`Purge — VACUUM twin_facts did not run (purge already committed): ${errorMessage(err)}`);
    return false;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Delete ONE forgotten fact permanently (twin:memory-purge). Returns true when it
 * was purged; false when there is no such fact, it is active, or it is already
 * purged — in each case nothing changes. Logs counts only, never fact text.
 */
export async function purgeFact(factId: string): Promise<boolean> {
  const db = getDb();
  const purged = (await purgeRows(db, factId)) > 0;
  if (purged) {
    log.info('Purged 1 forgotten fact');
    await vacuumAfterPurge(db);
  }
  return purged;
}

/**
 * Delete EVERY forgotten fact permanently (twin:memory-purge-all-forgotten).
 * Active facts are never touched. Returns the number purged (0 = nothing to do).
 */
export async function purgeAllForgotten(): Promise<number> {
  const db = getDb();
  const purged = await purgeRows(db);
  if (purged > 0) {
    log.info(`Purged ${purged} forgotten fact(s)`);
    await vacuumAfterPurge(db);
  }
  return purged;
}

/**
 * Whether per-session learning is paused. Reads the generic settings surface (no
 * dedicated channel) — the renderer toggles TWIN_LEARNING_PAUSED_SETTING_KEY via
 * settings:set. This is a REAL implementation (not a stub): it gates LEARNING
 * only — extraction, label backfill and entity extraction. Whether learned facts
 * are USED in prompts is areLearnedFactsInUse() below. Defensive — any read error
 * means "not paused".
 */
export async function isLearningPaused(): Promise<boolean> {
  try {
    const db = getDb();
    const [row] = await db.select().from(settings).where(eq(settings.key, TWIN_LEARNING_PAUSED_SETTING_KEY));
    return row?.value === 'true';
  } catch (err) {
    log.error('Failed to read learning-pause setting — treating as not paused:', err);
    return false;
  }
}

/**
 * Whether learned facts are injected into prompts (the "Use learned facts" switch).
 * Gates INJECTION only (twinProfileService.loadInjectableFacts) — independent of
 * isLearningPaused, so the user can stop learning without losing what was learned,
 * and vice versa. With no stored choice the legacy rule applies (see
 * resolveFactsInUse): facts are in use unless learning is paused. Defensive — a
 * read error falls back to the pre-switch behaviour of the pause flag alone.
 */
export async function areLearnedFactsInUse(): Promise<boolean> {
  const paused = await isLearningPaused();
  try {
    const db = getDb();
    const [row] = await db.select().from(settings).where(eq(settings.key, TWIN_FACTS_IN_USE_SETTING_KEY));
    return resolveFactsInUse(row?.value, paused);
  } catch (err) {
    log.error('Failed to read facts-in-use setting — falling back to the pause flag:', err);
    return resolveFactsInUse(undefined, paused);
  }
}

// ---------------------------------------------------------------------------
// Label backfill (TWIN-READ.1 Task 1) — user-triggered, chunked, resumable
// ---------------------------------------------------------------------------

const BACKFILL_LABEL_SYSTEM = `You write a SHORT 2-4 word label naming the point of ONE fact about a professional's world (their people, projects, preferences, domain, or commitments) — a phrase, not a sentence, no trailing punctuation.
Respond with ONLY the JSON described below — no prose, no markdown code fences.`;

const BACKFILL_LABEL_OUTPUT_SPEC = 'a JSON object { "label": string } — a short 2-4 word phrase naming the fact.';

const backfillLabelSchema = z.object({ label: z.string().min(1) });

/** A fact that still needs a label: none stored yet, and not purged (a purged
 *  row has no text to label and must never get one back). */
function needsLabel() {
  return and(isNull(twinFacts.label), isNull(twinFacts.purgedAt));
}

/** Every fact with no stored label yet (any status — a restored fact should
 *  already have one waiting for it), oldest first, capped at the chunk size —
 *  the unit backfillFactLabels processes per call. Purged facts are excluded. */
async function loadUnlabelledFacts(db: Db, limit: number): Promise<{ id: string; fact: string }[]> {
  return db
    .select({ id: twinFacts.id, fact: twinFacts.fact })
    .from(twinFacts)
    .where(needsLabel())
    .orderBy(asc(twinFacts.createdAt))
    .limit(limit);
}

/** Honest count of facts still unlabelled — drives `remaining`, never estimated. */
async function countUnlabelledFacts(db: Db): Promise<number> {
  const rows = await db.select({ id: twinFacts.id }).from(twinFacts).where(needsLabel());
  return rows.length;
}

/**
 * Label ONE fact via the model. Returns null on ANY failure/garbage output
 * (generateValidated's own retry-then-skip discipline, plus sanitizeLabel as a
 * second defensive pass) — never throws. The caller simply leaves this fact
 * unlabelled for this pass; the derived fallback in shared/twin/factLabel.ts
 * covers it until a later pass succeeds.
 */
async function labelOneFact(provider: ResolvedProvider, fact: string): Promise<string | null> {
  const parsed = await generateValidated({
    provider,
    taskType: 'twin_learning',
    system: `${BACKFILL_LABEL_SYSTEM}\n\nReturn ${BACKFILL_LABEL_OUTPUT_SPEC}`,
    context: `Fact:\n${fact}`,
    schema: backfillLabelSchema,
    label: 'Fact label backfill',
  });
  if (!parsed) return null;
  return sanitizeLabel((parsed as { label: unknown }).label);
}

/**
 * User-triggered backfill: label existing facts that have no stored label yet,
 * ONE bounded chunk (~20) per call, via the local model. Follows the
 * `entity:analyze-history` precedent (entityFactService.analyzeHistory) —
 * user-triggered only, NEVER automatic or on a schedule — rather than inventing
 * a new mechanism. Pause-gated by the SAME main-side isLearningPaused()
 * extraction uses (never re-implemented in the renderer): a typed no-op, not a
 * throw. No model configured degrades the same way — a typed no-op, never a
 * throw — because the derived fallback covers an unlabelled fact regardless, so
 * a skipped/failed backfill is a quality regression, never a breakage. Facts are
 * labeled strictly SEQUENTIALLY, one model call at a time (never Promise.all — a
 * local model must not be parallel-hammered, mirroring analyzeHistory). Never
 * blocks the caller: bounded to one chunk, so a single call returns promptly
 * regardless of how many facts remain. Naturally resumable — each call
 * re-queries "still unlabelled" rows, so calling it again continues wherever the
 * last call left off; there is no cursor to track or lose.
 */
export async function backfillFactLabels(): Promise<BackfillFactLabelsResult> {
  if (await isLearningPaused()) {
    log.debug('backfillFactLabels — learning paused; no-op');
    return { status: 'skipped', reason: 'paused', labeled: 0, remaining: 0 };
  }

  const provider = await resolveTwinLearningModel();
  if (!provider) {
    log.info('backfillFactLabels — no explicit or local learning model; skipped (no facts touched)');
    return { status: 'skipped', reason: 'no-learning-model', labeled: 0, remaining: 0 };
  }

  const db = getDb();
  const chunk = await loadUnlabelledFacts(db, BACKFILL_CHUNK_SIZE);

  let labeled = 0;
  // Strictly sequential — one fact (one model call) at a time, never Promise.all.
  for (const row of chunk) {
    const label = await labelOneFact(provider, row.fact);
    if (!label) continue; // failed/garbage output — skip THIS pass, fallback covers it
    // Guarded: a fact purged while its label call was in flight must not get a label
    // (derived from the erased text) written back onto its tombstone.
    const written = await db
      .update(twinFacts)
      .set({ label })
      .where(and(eq(twinFacts.id, row.id), isNull(twinFacts.purgedAt)))
      .returning({ id: twinFacts.id });
    if (written.length > 0) labeled++;
  }

  const remaining = await countUnlabelledFacts(db);
  log.info(`backfillFactLabels — labeled ${labeled}/${chunk.length} fact(s) this pass, ${remaining} still unlabelled`);
  return { status: 'ok', labeled, remaining };
}

// ---------------------------------------------------------------------------
// Post-session wiring (self-registered — no shared boot/index file is edited)
// ---------------------------------------------------------------------------

/**
 * The post-session hook: learn facts from the just-finished session. A thin
 * wrapper so the frozen `extractFacts(meetingId)` signature stays the public
 * surface. Exported so tests can re-register it after resetting the dispatcher.
 */
export const learningPostSessionHook: PostSessionHook = async (ctx) => {
  await extractFacts(ctx.meetingId);
};

// Self-register on module import. twinMemoryService is boot-imported via the
// frozen memory IPC (src/main/ipc/twin.ts) AND via twinProfileService (which
// imports it for injection gating), so importing this module wires fact
// extraction onto the post-session dispatcher WITHOUT editing any shared
// boot/index file (Task 4 shares none of these). registerPostSessionHook only
// pushes a function reference — no DB/AI work happens at import time. ES-module
// caching guarantees exactly ONE registration no matter how many importers.
registerPostSessionHook(learningPostSessionHook);
