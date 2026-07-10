// === FILE PURPOSE ===
// Entity extraction (V3.4 Task 6) — the Brain's first SEMANTIC layer. Resolves the
// people and topics a finished session was about into flat `entities` rows and
// threads each to the session via `entity_links`. A post-session hook, registered
// AFTER fact extraction, so the twin learns facts first and entities second.
//
// === HOW IT WORKS ===
// extractEntities(meetingId) reads ONLY the session's already-distilled brief (never
// the raw transcript), routes through the `twin_learning` task, and REUSES
// twinResearchService.generateValidated (the twin domain's one validate-retry-skip
// pipeline — NO third pipeline). Output is JSON-schema-constrained, capped at
// ≤8 entities/session, and deduped by `normalizedName` (insert-or-get: an existing
// entity is reused, a new one inserted) before entity_links rows are created.
//
// === SAFETY (mirrors the facts hook) ===
//  - Entity extraction IS learning: gated by twinMemoryService.isLearningPaused()
//    (paused ⇒ no-op) and routed via `twin_learning`.
//  - Provenance: every entity_links row ties an entity to a real source session.
//  - Error-isolated + defensive: extractEntities NEVER throws, so a failure can
//    never fail or delay brief generation (identical discipline to extractFacts).
//  - FLAT scope only: people + topics linked to sessions. NO typed entity↔entity
//    relationships (the 14B research cliff) — do not widen this.
//
// === HOOK ORDER (facts BEFORE entities) ===
// This module imports `isLearningPaused` from twinMemoryService, so ES-module
// evaluation runs twinMemoryService's top-level self-registration (the FACTS hook)
// BEFORE this module's own registration line (the ENTITIES hook). Registration
// order = run order on the post-session dispatcher, so facts always run first —
// regardless of which boot file imports entityService.
//
// === DEPENDENCIES ===
// drizzle-orm, db/connection (getDb), db/schema (entities/entityLinks/meetingBriefs),
// ai-provider (resolveTaskModel), twinResearchService (generateValidated),
// twinMemoryService (isLearningPaused — also fixes hook order), postSessionDispatcher.

import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/connection';
import { entities, entityLinks, meetingBriefs } from '../db/schema';
import { createLogger } from './logger';
import { resolveTaskModel } from './ai-provider';
import { generateValidated } from './twinResearchService';
import { isLearningPaused } from './twinMemoryService';
import { registerPostSessionHook, type PostSessionHook } from './postSessionDispatcher';
import type { TwinEntity, TwinEntityKind } from '../../shared/types/twin';

const log = createLogger('Entities');

/** Max entities resolved per session — keeps the semantic layer bounded + high-signal. */
const ENTITY_CAP = 8;

/** Bound the extraction context so a large brief can't blow the model's window. */
const MAX_EXTRACTION_CONTEXT_CHARS = 6000;

const ENTITY_KINDS = ['person', 'topic'] as const;

/** Outcome of a per-session entity-extraction pass. `skipped` never hard-fails the
 *  post-session dispatcher; `entities` carries the resolved (linked) entities. */
export interface ExtractEntitiesResult {
  status: 'ok' | 'skipped';
  /** Why nothing was resolved (only present on `skipped`). */
  reason?: 'no-model' | 'failed' | 'paused';
  entities: TwinEntity[];
}

// ---------------------------------------------------------------------------
// Extraction prompt + schema
// ---------------------------------------------------------------------------

const EXTRACTION_SYSTEM = `You identify the concrete PEOPLE and TOPICS a professional's finished meeting was about, from the meeting brief.
Rules:
- A "person" is a specific named individual (a real person's name). A "topic" is a specific project, product, initiative, system, or subject matter discussed.
- Extract ONLY people/topics clearly present in the provided brief — never invent, guess, or infer beyond it.
- Use the natural display spelling of each name. Do NOT include generic words, roles without a name, or the user themselves.
- Return AT MOST 8 entities. If the brief names nothing concrete, return an empty array [].
Respond with ONLY the JSON described below — no prose, no markdown code fences.`;

const EXTRACTION_OUTPUT_SPEC =
  'a JSON array of { "name": string, "kind": "person"|"topic" } — at most 8 concrete people/topics.';

/** Validates the model's output; malformed output is rejected by generateValidated's
 *  retry-then-skip discipline. */
const extractedEntitiesSchema = z.array(
  z.object({
    name: z.string().min(1),
    kind: z.enum(ENTITY_KINDS),
  }),
);

interface ExtractedEntity {
  name: string;
  kind: TwinEntityKind;
}

type Db = ReturnType<typeof getDb>;

// ---------------------------------------------------------------------------
// Normalization + dedupe
// ---------------------------------------------------------------------------

/** Case/whitespace-insensitive dedupe + lookup key (the entities.normalized_name
 *  UNIQUE column), so spelling variants ("Acme Corp" / "acme corp") resolve to ONE
 *  entity row. */
export function normalizeEntityName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Reduce the model's raw output to the distinct entities worth persisting: trim,
 * drop blanks, dedupe by `normalizedName` within this batch (first spelling wins),
 * then cap at ≤8/session. Preserves the model's ordering for the survivors.
 */
function dedupeEntities(
  candidates: ExtractedEntity[],
): { name: string; normalizedName: string; kind: TwinEntityKind }[] {
  const seen = new Set<string>();
  const out: { name: string; normalizedName: string; kind: TwinEntityKind }[] = [];
  for (const c of candidates) {
    const name = c.name.trim();
    if (!name) continue;
    const normalizedName = normalizeEntityName(name);
    if (!normalizedName || seen.has(normalizedName)) continue;
    seen.add(normalizedName);
    out.push({ name, normalizedName, kind: c.kind });
    if (out.length >= ENTITY_CAP) break; // ≤8-cap per session
  }
  return out;
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

/** The most recent brief summary for the session (the distilled extraction input). */
async function loadBriefSummary(db: Db, meetingId: string): Promise<string> {
  const [row] = await db
    .select({ summary: meetingBriefs.summary })
    .from(meetingBriefs)
    .where(eq(meetingBriefs.meetingId, meetingId))
    .orderBy(desc(meetingBriefs.createdAt))
    .limit(1);
  return row?.summary ?? '';
}

/**
 * Insert-or-get by `normalizedName`: reuse an existing entity row (any prior
 * session's) or insert a new one, returning its id. ON CONFLICT DO NOTHING on the
 * UNIQUE normalized_name means a concurrent/prior insert is resolved by the
 * follow-up select — one canonical row per normalized name.
 */
async function insertOrGetEntityId(
  db: Db,
  entity: { name: string; normalizedName: string; kind: TwinEntityKind },
): Promise<string | null> {
  const [inserted] = await db
    .insert(entities)
    .values({ name: entity.name, normalizedName: entity.normalizedName, kind: entity.kind })
    .onConflictDoNothing({ target: entities.normalizedName })
    .returning({ id: entities.id });
  if (inserted) return inserted.id;

  const [existing] = await db
    .select({ id: entities.id })
    .from(entities)
    .where(eq(entities.normalizedName, entity.normalizedName));
  return existing?.id ?? null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the people/topics a finished session was about into flat entities and
 * link each to the session (provenance). Input is the session's brief only (already
 * distilled + model-routed — never the raw transcript). Routes through
 * `twin_learning` and REUSES twinResearchService.generateValidated. Gated by
 * isLearningPaused(); defensive — NEVER throws (so it can never harm the brief),
 * returning `skipped` on any absence/failure. No fabricated entities.
 */
export async function extractEntities(meetingId: string): Promise<ExtractEntitiesResult> {
  try {
    if (await isLearningPaused()) {
      log.debug('extractEntities — learning paused; no-op (no extraction)');
      return { status: 'skipped', reason: 'paused', entities: [] };
    }

    const provider = await resolveTaskModel('twin_learning');
    if (!provider) return { status: 'skipped', reason: 'no-model', entities: [] };

    const db = getDb();
    const briefSummary = await loadBriefSummary(db, meetingId);
    if (!briefSummary.trim()) {
      // Nothing distilled to extract from (no brief yet).
      return { status: 'skipped', reason: 'failed', entities: [] };
    }

    const context = `Meeting brief:\n${briefSummary.trim()}`.slice(0, MAX_EXTRACTION_CONTEXT_CHARS);

    const parsed = await generateValidated({
      provider,
      taskType: 'twin_learning',
      system: `${EXTRACTION_SYSTEM}\n\nReturn ${EXTRACTION_OUTPUT_SPEC}`,
      context,
      schema: extractedEntitiesSchema,
      label: `Entity extraction (meeting ${meetingId})`,
    });
    if (parsed == null) return { status: 'skipped', reason: 'failed', entities: [] };

    const deduped = dedupeEntities(parsed as ExtractedEntity[]);
    if (deduped.length === 0) return { status: 'ok', entities: [] };

    // Insert-or-get each entity (dedupe by normalizedName across ALL sessions),
    // then link every resolved entity to this session. Links are idempotent
    // (composite PK + ON CONFLICT DO NOTHING) so a re-extraction never duplicates.
    const linked: TwinEntity[] = [];
    const linkValues: { entityId: string; meetingId: string }[] = [];
    for (const entity of deduped) {
      const entityId = await insertOrGetEntityId(db, entity);
      if (!entityId) continue;
      linkValues.push({ entityId, meetingId });
      linked.push({ name: entity.name, normalizedName: entity.normalizedName, kind: entity.kind });
    }

    if (linkValues.length > 0) {
      await db.insert(entityLinks).values(linkValues).onConflictDoNothing();
    }

    log.info(`Resolved ${linked.length} entity link(s) from meeting ${meetingId}`);
    return { status: 'ok', entities: linked };
  } catch (err) {
    // Defensive: extraction can NEVER throw into the post-session dispatcher, so an
    // entity-extraction failure can never fail or delay brief generation.
    log.error('extractEntities failed — no entities resolved this session:', err);
    return { status: 'skipped', reason: 'failed', entities: [] };
  }
}

// ---------------------------------------------------------------------------
// Post-session wiring (self-registered — runs AFTER the facts hook)
// ---------------------------------------------------------------------------

/**
 * The post-session hook: resolve entities from the just-finished session. A thin
 * wrapper so the frozen `extractEntities(meetingId)` signature stays the public
 * surface. Exported so tests can re-register it after resetting the dispatcher.
 */
export const entityPostSessionHook: PostSessionHook = async (ctx) => {
  await extractEntities(ctx.meetingId);
};

// Self-register on module import. The `isLearningPaused` import above forces
// twinMemoryService to finish its own top-level self-registration (the FACTS hook)
// BEFORE this line runs, so entities always register AFTER facts (registration
// order = run order — the V3.4 plan requires facts-before-entities). Boot-reached
// via ipc/brain.ts, which imports this module for its side effect. Only pushes a
// function reference — no DB/AI work at import time; ES-module caching guarantees
// exactly ONE registration no matter how many importers.
registerPostSessionHook(entityPostSessionHook);
