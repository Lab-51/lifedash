// === FILE PURPOSE ===
// Per-entity learned facts (BRAIN-UX.1 Tasks 1 + 3) — the `entity_facts`
// auditable-memory store backing the Brain's EntityInspector modal. Mirrors the
// twin_facts triad (list/forget/provenance) but scoped to a Brain entity
// (person or topic) instead of the user's own twin profile.
//
// === HOW FACTS ARE LEARNED (Task 3) ===
// ONE core routine, mineFactsForMeeting(meetingId, entities, provider), with two
// entry points:
//   1. entityFactPostSessionHook — automatic, per finished session. Loads the
//      session's OWN linked entities (never assumes dispatcher ordering) and
//      no-ops honestly when entity extraction has not linked any yet, when
//      learning is paused, when no model is configured, or when this session was
//      already mined (idempotence via sourceMeetingId).
//   2. analyzeHistory(entityId) — user-initiated backfill for ONE entity. Mines
//      only the linked sessions that have no facts for this entity yet, ONE
//      model call at a time (never Promise.all — a local model must not be
//      parallel-hammered), and reports honest counts.
// Extraction reads the session's brief + a char-budgeted transcript excerpt
// (newest speech kept, truncation disclosed in the prompt), routes through the
// `twin_learning` task (whose ≥4096 output-token floor lives in resolveTaskModel)
// and REUSES twinResearchService.generateValidated — the twin domain's ONE
// validate-retry-skip pipeline. Facts are capped at ~5 per entity per session and
// are NEVER padded: an empty result is a valid result.
//
// === HOOK ORDER (entities BEFORE their facts) ===
// This module imports listMeetingEntities/normalizeEntityName from entityService,
// so ES-module evaluation finishes entityService's self-registration (the ENTITIES
// hook — itself ordered after twinMemoryService's FACTS hook) BEFORE this module's
// registration line. Registration order = run order on the dispatcher, so a
// session's entities exist by the time this hook mines facts about them. The hook
// still verifies that itself and no-ops honestly, so an order change degrades to
// "no facts this session", never to fabricated ones.
//
// === DEPENDENCIES ===
// drizzle-orm, zod, db/connection (getDb), db/schema (entities/entityLinks/
// entityFacts/meetings/meetingBriefs/transcripts), ai-provider (resolveTaskModel),
// twinResearchService (generateValidated), twinMemoryService (isLearningPaused),
// entityService (listMeetingEntities/normalizeEntityName), postSessionDispatcher,
// shared twin types (EntityFact, AnalyzeEntityHistoryResult), meetingService
// (getMeeting — MEET-DEL.1 existence recheck), db/errors (isForeignKeyViolation —
// MEET-DEL.1 FK-violation classification).
//
// === MEET-DEL.1: deleted-meeting race absorption ===
// mineFactsForMeeting's own insert is guarded twice: a fresh getMeeting() check
// right before the write (closes most of the race the long-running mining call
// opens), AND an isForeignKeyViolation() check around the insert itself (closes
// the remainder). Both entry points (the automatic hook AND the user-initiated
// analyzeHistory backfill) share this ONE core routine, so both get the guard for
// free. Either signal resolves to the same typed no-op this module already used
// for every other skip: {status:'skipped', reason:'meeting-deleted', newFacts:0}.

import { asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/connection';
import { entities, entityFacts, entityLinks, meetingBriefs, meetings, transcripts } from '../db/schema';
import { createLogger } from './logger';
import { resolveTaskModel, type ResolvedProvider } from './ai-provider';
import { generateValidated } from './twinResearchService';
import { isLearningPaused } from './twinMemoryService';
import { listMeetingEntities, normalizeEntityName, type LinkedEntity } from './entityService';
import { registerPostSessionHook, type PostSessionHook } from './postSessionDispatcher';
import { getMeeting } from './meetingService';
import { isForeignKeyViolation } from '../db/errors';
import type { EntityFact, AnalyzeEntityHistoryResult } from '../../shared/types/twin';

const log = createLogger('EntityFacts');

/** Max facts learned about ONE entity from ONE session — bounds growth, keeps signal high. */
const FACTS_PER_ENTITY_CAP = 5;

/** Whole-transcript char budget (~6k tokens at ~4 chars/token), matching
 *  meetingAgentService.TRANSCRIPT_WINDOW_CHAR_BUDGET's philosophy: when over budget
 *  drop from the OLD end so the most recent speech survives. */
const TRANSCRIPT_CHAR_BUDGET = 24000;

/** The brief is a bounded second input; it never crowds out the transcript. */
const BRIEF_CHAR_BUDGET = 2000;

/**
 * The user-facing error `entity:analyze-history` rejects with when no model is
 * configured — the app's convention for user-initiated AI actions (see
 * ipc/meeting-agent.ts, ipc/cards.ts). An honest failure, never a fake zero-count
 * "success". The automatic hook path logs and skips instead.
 */
export const NO_MODEL_ERROR_MESSAGE = 'No AI provider configured for learning. Go to Settings to add one.';

type Db = ReturnType<typeof getDb>;

/** Outcome of mining ONE session for facts about a set of entities. `skipped`
 *  never hard-fails a caller; `newFacts` is the number of rows actually persisted. */
export interface MineFactsResult {
  status: 'ok' | 'skipped';
  /** Why nothing was mined (only present on `skipped`) — each no-op is reported
   *  honestly rather than collapsed into a zero-count "success". `meeting-deleted`
   *  (MEET-DEL.1) is the deleted-meeting race — closed either by a fresh
   *  existence recheck or by catching the insert's FK violation. */
  reason?: 'no-material' | 'failed' | 'paused' | 'already-mined' | 'no-entities' | 'no-model' | 'meeting-deleted';
  newFacts: number;
}

// ---------------------------------------------------------------------------
// Extraction prompt + schema
// ---------------------------------------------------------------------------

const MINING_SYSTEM = `You extract concrete FACTS about specific people and topics from ONE of a professional's meetings.
Rules:
- Only about the entities listed below, referenced by their EXACT name as given. Ignore anything else.
- Each fact is ONE short, self-contained, attributable statement about that entity — what they own, decided, committed to, raised, or how the topic stands (e.g. "owns the pricing decision", "raised concerns about the Q3 timeline").
- Extract ONLY what the provided material clearly supports — never invent, guess, or infer beyond it.
- Return AT MOST 5 facts per entity. If nothing substantive was said about an entity, return NO facts for it — never pad to reach a count.
- If the material supports nothing about any listed entity, return an empty array [].
Respond with ONLY the JSON described below — no prose, no markdown code fences.`;

const MINING_OUTPUT_SPEC =
  'a JSON array of { "entity": string, "fact": string } — the entity name exactly as listed, at most 5 facts per entity.';

/** Validates the model's output; malformed output is rejected by generateValidated's
 *  retry-then-skip discipline (one retry, then skip — no facts rather than bad ones). */
export const minedFactsSchema = z.array(
  z.object({
    entity: z.string().min(1),
    fact: z.string().min(1),
  }),
);

interface MinedFact {
  entity: string;
  fact: string;
}

// ---------------------------------------------------------------------------
// Source-material loaders (pure DB reads)
// ---------------------------------------------------------------------------

/** The most recent brief summary for the session (the distilled second input). */
async function loadBriefSummary(db: Db, meetingId: string): Promise<string> {
  const [row] = await db
    .select({ summary: meetingBriefs.summary })
    .from(meetingBriefs)
    .where(eq(meetingBriefs.meetingId, meetingId))
    .orderBy(desc(meetingBriefs.createdAt))
    .limit(1);
  return row?.summary ?? '';
}

/** The session's transcript as chronological "Speaker: text" lines. */
async function loadTranscriptLines(db: Db, meetingId: string): Promise<string[]> {
  const rows = await db
    .select({ content: transcripts.content, speaker: transcripts.speaker })
    .from(transcripts)
    .where(eq(transcripts.meetingId, meetingId))
    .orderBy(asc(transcripts.startTime));
  return rows
    .map((r) => {
      const content = r.content?.trim() ?? '';
      if (!content) return '';
      return r.speaker ? `${r.speaker}: ${content}` : content;
    })
    .filter((line) => line.length > 0);
}

/**
 * Fit the whole transcript into the char budget by dropping from the OLD end
 * (keeping the newest speech) — the same philosophy as
 * meetingAgentService.buildTranscriptWindow, minus the time window. `truncated`
 * is disclosed in the prompt so the model knows earlier speech is missing.
 */
export function buildTranscriptExcerpt(
  lines: string[],
  budget: number = TRANSCRIPT_CHAR_BUDGET,
): { text: string; truncated: boolean } {
  const kept: string[] = [];
  let total = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const cost = lines[i].length + 1;
    if (total + cost > budget) break;
    kept.unshift(lines[i]);
    total += cost;
  }
  // A single line longer than the whole budget still yields its newest portion.
  if (kept.length === 0 && lines.length > 0) {
    return { text: lines[lines.length - 1].slice(0, budget), truncated: true };
  }
  return { text: kept.join('\n'), truncated: kept.length < lines.length };
}

/** True when this session was already mined (any fact carries its id as provenance)
 *  — the hook's idempotence check. */
async function hasFactsForMeeting(db: Db, meetingId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: entityFacts.id })
    .from(entityFacts)
    .where(eq(entityFacts.sourceMeetingId, meetingId))
    .limit(1);
  return Boolean(row);
}

/** The sessions already mined FOR THIS ENTITY — the (entityId, sourceMeetingId)
 *  dedupe key of the history path. */
async function loadMinedMeetingIds(db: Db, entityId: string): Promise<Set<string>> {
  const rows = await db
    .select({ sourceMeetingId: entityFacts.sourceMeetingId })
    .from(entityFacts)
    .where(eq(entityFacts.entityId, entityId));
  return new Set(rows.map((r) => r.sourceMeetingId));
}

/** The entity itself (name + kind drive the prompt), or null when it is gone. */
async function loadEntity(db: Db, entityId: string): Promise<LinkedEntity | null> {
  const [row] = await db
    .select({ id: entities.id, name: entities.name, kind: entities.kind })
    .from(entities)
    .where(eq(entities.id, entityId))
    .limit(1);
  return row ? { id: row.id, name: row.name, kind: row.kind } : null;
}

/** Every session this entity is linked to (newest link first). */
async function loadEntityMeetingIds(db: Db, entityId: string): Promise<string[]> {
  const rows = await db
    .select({ meetingId: entityLinks.meetingId })
    .from(entityLinks)
    .where(eq(entityLinks.entityId, entityId))
    .orderBy(desc(entityLinks.createdAt));
  return rows.map((r) => r.meetingId);
}

// ---------------------------------------------------------------------------
// Context building + candidate selection
// ---------------------------------------------------------------------------

/** The bounded mining context: who to look for, the brief, the newest transcript. */
function buildMiningContext(
  targets: LinkedEntity[],
  briefSummary: string,
  excerpt: { text: string; truncated: boolean },
): string {
  const blocks: string[] = [
    `Entities to extract facts about (use these exact names):\n${targets.map((e) => `- ${e.name} (${e.kind})`).join('\n')}`,
  ];
  const brief = briefSummary.trim().slice(0, BRIEF_CHAR_BUDGET);
  if (brief) blocks.push(`Meeting brief:\n${brief}`);
  if (excerpt.text) {
    const header = excerpt.truncated
      ? 'Transcript excerpt (TRUNCATED — earlier speech omitted; this is the most recent portion):'
      : 'Transcript:';
    blocks.push(`${header}\n${excerpt.text}`);
  }
  return blocks.join('\n\n');
}

/**
 * Turn the model's candidates into persistable rows: keep only facts naming an
 * entity that actually exists AND is linked to this session (matched by
 * normalizedName), drop blanks/duplicates within the batch, and cap each entity at
 * ~5 facts for this session. Never invents or pads.
 */
function selectFactRows(
  candidates: MinedFact[],
  targets: LinkedEntity[],
  meetingId: string,
): { entityId: string; content: string; sourceMeetingId: string }[] {
  const idByName = new Map(targets.map((e) => [normalizeEntityName(e.name), e.id]));
  const perEntity = new Map<string, number>();
  const seen = new Set<string>();
  const rows: { entityId: string; content: string; sourceMeetingId: string }[] = [];

  for (const candidate of candidates) {
    const content = candidate.fact.trim();
    const entityId = idByName.get(normalizeEntityName(candidate.entity ?? ''));
    if (!content || !entityId) continue; // unknown/unlinked entity ⇒ never persisted
    const key = `${entityId}::${content
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[.!?;,]+$/g, '')}`;
    if (seen.has(key)) continue;
    const used = perEntity.get(entityId) ?? 0;
    if (used >= FACTS_PER_ENTITY_CAP) continue;
    seen.add(key);
    perEntity.set(entityId, used + 1);
    rows.push({ entityId, content, sourceMeetingId: meetingId });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Core mining routine (shared by BOTH entry points)
// ---------------------------------------------------------------------------

/**
 * Mine ONE session for facts about the given (already linked) entities and persist
 * them with provenance. Exactly one model call per invocation (plus generateValidated's
 * single retry on malformed JSON). Returns `skipped` when there is no material or the
 * output was unusable — never fabricated counts, never padded facts.
 */
export async function mineFactsForMeeting(
  meetingId: string,
  targets: LinkedEntity[],
  provider: ResolvedProvider,
): Promise<MineFactsResult> {
  if (targets.length === 0) return { status: 'skipped', reason: 'no-entities', newFacts: 0 };

  const db = getDb();
  // Sequential DB reads (no Promise.all anywhere in this service — the history path
  // must never run model calls concurrently, and one rule is easier to verify).
  const briefSummary = await loadBriefSummary(db, meetingId);
  const lines = await loadTranscriptLines(db, meetingId);
  if (!briefSummary.trim() && lines.length === 0) {
    return { status: 'skipped', reason: 'no-material', newFacts: 0 };
  }

  const context = buildMiningContext(targets, briefSummary, buildTranscriptExcerpt(lines));
  const parsed = await generateValidated({
    provider,
    taskType: 'twin_learning',
    system: `${MINING_SYSTEM}\n\nReturn ${MINING_OUTPUT_SPEC}`,
    context,
    schema: minedFactsSchema,
    label: `Entity fact mining (meeting ${meetingId})`,
  });
  if (parsed == null) return { status: 'skipped', reason: 'failed', newFacts: 0 };

  const rows = selectFactRows(parsed as MinedFact[], targets, meetingId);
  if (rows.length === 0) return { status: 'ok', newFacts: 0 }; // an empty result IS a result

  // MEET-DEL.1: re-check existence immediately before the write — the mining call
  // above is long-running, which is exactly the window a delete can land in. This
  // alone cannot close the race (see the FK catch below); it just closes most of
  // it cheaply, before spending a write on a meeting that is already gone.
  if (!(await getMeeting(meetingId))) {
    log.info(`Meeting ${meetingId} deleted before entity fact mining completed — discarded`);
    return { status: 'skipped', reason: 'meeting-deleted', newFacts: 0 };
  }

  try {
    await db.insert(entityFacts).values(rows);
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      // The existence check above closes most of the race window; a delete
      // landing between that check and this insert still hits the FK — same
      // benign no-op, never a raw SQL error carrying fact content.
      log.info(`Meeting ${meetingId} deleted before entity fact mining completed — discarded`);
      return { status: 'skipped', reason: 'meeting-deleted', newFacts: 0 };
    }
    throw err; // genuine failure — never silently swallowed
  }

  log.info(`Learned ${rows.length} entity fact(s) from meeting ${meetingId}`);
  return { status: 'ok', newFacts: rows.length };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List every fact learned about an entity, newest first, with the source
 * meeting's title joined in for provenance display (`entity:list-facts`).
 * `sourceMeetingTitle` is omitted only if the join can't resolve a title (the
 * FK is NOT NULL + cascades, so in practice every row has one).
 */
export async function listFacts(entityId: string): Promise<EntityFact[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: entityFacts.id,
      entityId: entityFacts.entityId,
      content: entityFacts.content,
      sourceMeetingId: entityFacts.sourceMeetingId,
      sourceMeetingTitle: meetings.title,
      createdAt: entityFacts.createdAt,
    })
    .from(entityFacts)
    .leftJoin(meetings, eq(entityFacts.sourceMeetingId, meetings.id))
    .where(eq(entityFacts.entityId, entityId))
    .orderBy(desc(entityFacts.createdAt));

  return rows.map((row) => ({
    id: row.id,
    entityId: row.entityId,
    content: row.content,
    sourceMeetingId: row.sourceMeetingId,
    sourceMeetingTitle: row.sourceMeetingTitle ?? undefined,
    createdAt: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString(),
  }));
}

/**
 * Hard-delete a fact (`entity:forget-fact`) — matching the twin-ledger "forget"
 * verb, but WITHOUT a soft-delete/restore step (unlike `TwinFact`'s forgotten
 * status): entity facts have no restore affordance.
 */
export async function forgetFact(factId: string): Promise<void> {
  const db = getDb();
  await db.delete(entityFacts).where(eq(entityFacts.id, factId));
}

/**
 * Backfill facts for ONE entity from its past sessions (`entity:analyze-history`).
 * Mines ONLY sessions that have no facts for this entity yet (dedupe by
 * (entityId, sourceMeetingId)), SEQUENTIALLY — one local model call at a time, never
 * Promise.all, so LM Studio is never parallel-hammered. Counts are honest:
 * `minedMeetings` = sessions actually run through extraction, `skippedMeetings` =
 * sessions skipped (already mined for this entity, or nothing to mine from),
 * `newFacts` = rows actually persisted. Rejects with {@link NO_MODEL_ERROR_MESSAGE}
 * when no model is configured — a user-initiated action fails honestly rather than
 * reporting a fake zero-count success.
 *
 * The learning-pause gate is deliberately NOT applied here: pausing stops AUTOMATIC
 * learning, while this runs only because the user explicitly asked for it.
 */
export async function analyzeHistory(entityId: string): Promise<AnalyzeEntityHistoryResult> {
  const provider = await resolveTaskModel('twin_learning');
  if (!provider) throw new Error(NO_MODEL_ERROR_MESSAGE);

  const db = getDb();
  const entity = await loadEntity(db, entityId);
  if (!entity) {
    log.warn(`analyzeHistory — entity ${entityId} no longer exists; nothing to mine`);
    return { status: 'ok', minedMeetings: 0, newFacts: 0, skippedMeetings: 0 };
  }

  const meetingIds = await loadEntityMeetingIds(db, entityId);
  const alreadyMined = await loadMinedMeetingIds(db, entityId);

  let minedMeetings = 0;
  let newFacts = 0;
  let skippedMeetings = 0;

  // Strictly sequential: one meeting (one model call) at a time.
  for (const meetingId of meetingIds) {
    if (alreadyMined.has(meetingId)) {
      skippedMeetings++;
      continue;
    }
    const result = await mineFactsForMeeting(meetingId, [entity], provider);
    if (result.status === 'ok') {
      minedMeetings++;
      newFacts += result.newFacts;
    } else {
      skippedMeetings++;
    }
  }

  log.info(
    `analyzeHistory(${entity.name}) — mined ${minedMeetings} session(s), ${newFacts} new fact(s), ${skippedMeetings} skipped`,
  );
  return { status: 'ok', minedMeetings, newFacts, skippedMeetings };
}

// ---------------------------------------------------------------------------
// Post-session wiring (self-registered — runs AFTER entity extraction)
// ---------------------------------------------------------------------------

/**
 * Mine the just-finished session for facts about the entities it was about.
 * Self-sufficient (loads its own entities, assumes no dispatcher ordering),
 * idempotent (skips a session that already produced facts), gated by
 * isLearningPaused, and defensive — it NEVER throws, so it can never harm the
 * brief. Every no-op is logged honestly; none is reported as success.
 */
export async function mineFactsForSession(meetingId: string): Promise<MineFactsResult> {
  try {
    if (await isLearningPaused()) {
      log.debug('mineFactsForSession — learning paused; no-op (no extraction)');
      return { status: 'skipped', reason: 'paused', newFacts: 0 };
    }

    const db = getDb();
    if (await hasFactsForMeeting(db, meetingId)) {
      log.debug(`mineFactsForSession — meeting ${meetingId} already mined; no-op`);
      return { status: 'skipped', reason: 'already-mined', newFacts: 0 };
    }

    const targets = await listMeetingEntities(meetingId);
    if (targets.length === 0) {
      log.debug(`mineFactsForSession — no entities linked to meeting ${meetingId} yet; no-op`);
      return { status: 'skipped', reason: 'no-entities', newFacts: 0 };
    }

    const provider = await resolveTaskModel('twin_learning');
    if (!provider) {
      // The automatic path logs and skips (only the user-initiated analyze-history
      // path raises a user-facing error).
      log.info('mineFactsForSession — no model configured for twin_learning; skipping');
      return { status: 'skipped', reason: 'no-model', newFacts: 0 };
    }

    return await mineFactsForMeeting(meetingId, targets, provider);
  } catch (err) {
    // Defensive: mining can NEVER throw into the post-session dispatcher.
    log.error('mineFactsForSession failed — no entity facts learned this session:', err);
    return { status: 'skipped', reason: 'failed', newFacts: 0 };
  }
}

/**
 * The post-session hook. A thin wrapper so `mineFactsForSession(meetingId)` stays
 * the public surface. Exported so tests can re-register it after resetting the
 * dispatcher.
 */
export const entityFactPostSessionHook: PostSessionHook = async (ctx) => {
  await mineFactsForSession(ctx.meetingId);
};

// Self-register on module import. The entityService import above forces that module
// (and, through it, twinMemoryService) to finish its own top-level registration
// BEFORE this line runs, so the run order is facts → entities → entity facts:
// a session's entities exist before we mine facts about them. Boot-reached via
// ipc/brain.ts, which already imports this module for the entity:* channels. Only
// pushes a function reference — no DB/AI work at import time; ES-module caching
// guarantees exactly ONE registration no matter how many importers.
registerPostSessionHook(entityFactPostSessionHook);
