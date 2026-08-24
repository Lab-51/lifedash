// === FILE PURPOSE ===
// ENTITY-NAME.1 Task 2 — the one-time, version-flagged sweep that recomputes every existing
// `entities.normalized_name` through the CURRENT normalizeEntityName and merges the rows that collide.
//
// === WHY IT EXISTS ===
// Task 1 taught normalizeEntityName to fold diacritics: that fixes creation going forward but leaves every
// pre-existing duplicate in place AND creates a worse problem — an existing row's STORED key no longer matches what
// a fresh lookup computes, so entityService's insert-or-get (ON CONFLICT on normalized_name) would mint YET ANOTHER
// row for a name already in the table. A SQL data migration using unaccent()/translate() was rejected at plan time:
// it would be a SECOND normalizer free to drift from the TypeScript one, and PGlite extension availability is
// unproven here. This sweep calls the very function production calls — hence app-level and version-flagged, NOT a
// drizzle migration (migration head stays 0049).
//
// === SAFETY: THIS DELETES ROWS FROM THE USER'S REAL DATABASE ===
// There is no undo in v1, by recorded decision, justified by the automatic merge class "cannot be wrong by
// construction". That claim rests entirely on two things here:
//  1. GROUPING — rows bucket by (kind, newKey). Kinds NEVER merge across: the group key starts with the kind, and
//     mergeGroup asserts single-kindedness again before any write.
//  2. ORDERING — inside a group's ONE transaction: re-point facts, copy links onto the survivor, delete the losers'
//     leftover links, and only THEN delete the loser rows. entity_facts and entity_links both cascade on
//     entities.id, so deleting first would silently DESTROY the facts this sweep exists to keep. This project
//     already lost local data once to a delete-before-reconcile bug (reconcileDeletes against an empty remote).
// The flag is written ONLY after the entire pass succeeds; any failure leaves it unset so the sweep retries next
// launch. This module may throw — main.ts catches and logs, and never lets it block startup (recordingSweepService).
//
// === NON-GOALS ===
// No nickname/short-form inference ("Dan" is NEVER merged into "Daniel" — that is Task 3's user-confirmed merge), no
// display-name renaming, no entity<->entity relationships (the schema is flat by design), no model calls. Facts keep
// `sourceMeetingId` untouched, so the auditable-memory triad (list / forget / provenance) survives a merge.

import { asc, count, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { entities, entityFacts, entityLinks, settings } from '../db/schema';
import { createLogger } from './logger';
import { normalizeEntityName } from './entityService';
import type { TwinEntityKind } from '../../shared/types/twin';

const log = createLogger('EntityFoldSweep');

/** Settings key gating the one-shot sweep — written only after a failure-free run. VERSION-SUFFIXED on purpose: a
 *  future normalizer change bumps this to `:v2` and the whole pass re-runs under the new folding rules. */
export const SWEEP_FLAG_KEY = 'maintenance:entity-name-fold-sweep:v1';

type Db = ReturnType<typeof getDb>;

interface EntityRow {
  id: string;
  name: string;
  normalizedName: string;
  kind: TwinEntityKind;
  createdAt: Date;
}

/** An entity row plus the key the CURRENT normalizer computes for its display name. */
interface PlannedRow extends EntityRow {
  newKey: string;
}

/** What one merge moved. Task 3's IPC surfaces these to the user. */
export interface MergeCounts {
  factsRepointed: number;
  linksMerged: number;
}

export interface FoldSweepResult {
  scanned: number;
  groupsMerged: number;
  entitiesDeleted: number;
  rowsReKeyed: number;
  factsRepointed: number;
  /** True when the flag was already set — nothing was read, compared or written. */
  skipped: boolean;
}

/** True when folding removed something beyond case and whitespace — i.e. the display spelling carries diacritics and
 *  is the richer form to keep. Expressed as the DIFFERENCE between the shared normalizer and the old
 *  case/whitespace-only fold precisely so this file never re-declares the combining-mark range: it follows Task 1's
 *  normalizer automatically and can never drift from it. */
function carriesDiacritics(name: string): boolean {
  return normalizeEntityName(name) !== name.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Survivor order within a group: diacritics first, then most facts, then oldest. The trailing id comparison is not
 *  decoration — `created_at` defaults to now(), so rows inserted in one transaction share a timestamp exactly and a
 *  destructive pass must never choose nondeterministically. */
function compareForSurvival(a: PlannedRow, b: PlannedRow, factsById: Map<string, number>): number {
  const accentDelta = (carriesDiacritics(b.name) ? 1 : 0) - (carriesDiacritics(a.name) ? 1 : 0);
  if (accentDelta !== 0) return accentDelta;
  const factDelta = (factsById.get(b.id) ?? 0) - (factsById.get(a.id) ?? 0);
  if (factDelta !== 0) return factDelta;
  const ageDelta = a.createdAt.getTime() - b.createdAt.getTime();
  if (ageDelta !== 0) return ageDelta;
  return a.id.localeCompare(b.id);
}

/** Moves everything owned by `loserIds` onto `survivorId`, then removes the loser rows — in the one order that is safe.
 *  MUST be given a transaction handle; every caller here wraps it in `db.transaction`. The step order is the contract,
 *  not a style choice (see the SAFETY block above). */
async function applyMerge(tx: Db, survivorId: string, loserIds: string[]): Promise<MergeCounts> {
  // 1. RE-POINT FACTS FIRST. `sourceMeetingId` is neither read nor written here, so every fact keeps its
  //    provenance — only its owner changes.
  const repointed = await tx
    .update(entityFacts)
    .set({ entityId: survivorId })
    .where(inArray(entityFacts.entityId, loserIds))
    .returning({ id: entityFacts.id });

  // 2. COPY THE LOSERS' LINKS onto the survivor. ON CONFLICT DO NOTHING on the composite PK (entityId, meetingId)
  //    collapses a session BOTH spellings were linked to into the survivor's single existing link. Duplicate meetings
  //    across two losers are folded in memory first (earliest wins) so the INSERT never conflicts with its own VALUES.
  const loserLinks = await tx
    .select({ meetingId: entityLinks.meetingId, createdAt: entityLinks.createdAt })
    .from(entityLinks)
    .where(inArray(entityLinks.entityId, loserIds));

  const earliestByMeeting = new Map<string, Date>();
  for (const link of loserLinks) {
    const seen = earliestByMeeting.get(link.meetingId);
    if (!seen || link.createdAt < seen) earliestByMeeting.set(link.meetingId, link.createdAt);
  }
  if (earliestByMeeting.size > 0) {
    await tx
      .insert(entityLinks)
      .values([...earliestByMeeting].map(([meetingId, createdAt]) => ({ entityId: survivorId, meetingId, createdAt })))
      .onConflictDoNothing();
  }

  // 3. DELETE the losers' now-copied links. Step 4's cascade would also remove them, but leaning on a cascade to
  //    finish a destructive sequence hides the ordering this file exists to make explicit.
  await tx.delete(entityLinks).where(inArray(entityLinks.entityId, loserIds));

  // 4. DELETE the loser entities — LAST, and only now that every fact and link has been re-pointed. Both child
  //    tables cascade on this id: run this step first and the facts are gone, not moved.
  await tx.delete(entities).where(inArray(entities.id, loserIds));

  return { factsRepointed: repointed.length, linksMerged: earliestByMeeting.size };
}

/** Standalone merge of one entity into another, in its own transaction. Task 3's user-confirmed merge reuses this
 *  verbatim, so these guards are a PUBLIC contract, not an internal convenience: both rows must exist, they must be the
 *  SAME kind (a person is never collapsed into a topic), and self-merge is refused — all BEFORE any write. */
export async function mergeEntityInto(db: Db, sourceId: string, targetId: string): Promise<MergeCounts> {
  if (sourceId === targetId) throw new Error('mergeEntityInto: refusing to merge an entity into itself');
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: entities.id, kind: entities.kind })
      .from(entities)
      .where(inArray(entities.id, [sourceId, targetId]));
    const source = rows.find((row) => row.id === sourceId);
    const target = rows.find((row) => row.id === targetId);
    if (!source) throw new Error(`mergeEntityInto: source entity ${sourceId} does not exist`);
    if (!target) throw new Error(`mergeEntityInto: target entity ${targetId} does not exist`);
    if (source.kind !== target.kind) {
      throw new Error(`mergeEntityInto: refusing to merge across kinds (${source.kind} into ${target.kind})`);
    }
    return applyMerge(tx as unknown as Db, targetId, [sourceId]);
  });
}

async function alreadyRun(db: Db): Promise<boolean> {
  const rows = await db.select().from(settings).where(eq(settings.key, SWEEP_FLAG_KEY)).limit(1);
  return rows.length > 0;
}

async function markDone(db: Db): Promise<void> {
  await db
    .insert(settings)
    .values({ key: SWEEP_FLAG_KEY, value: 'true' })
    .onConflictDoUpdate({ target: settings.key, set: { value: 'true', updatedAt: new Date() } });
}

async function loadFactCounts(db: Db): Promise<Map<string, number>> {
  const rows = await db
    .select({ entityId: entityFacts.entityId, factCount: count(entityFacts.id) })
    .from(entityFacts)
    .groupBy(entityFacts.entityId);
  return new Map(rows.map((row) => [row.entityId, Number(row.factCount)]));
}

/** `entities.normalized_name` is UNIQUE GLOBALLY, not per kind — so a person and a topic whose names fold to the same
 *  key cannot both be re-keyed, and kinds never merge. Detected up front, in memory, and the whole pass ABORTS BEFORE
 *  ANY WRITE: a run that cannot finish correctly must change nothing rather than commit its deletes and then explode on
 *  the re-key. The flag stays unset — a loud, retried, diagnosable stop, never a silent skip. */
function assertNoCrossKindCollision(planned: PlannedRow[]): void {
  const kindsByKey = new Map<string, Set<TwinEntityKind>>();
  for (const row of planned) {
    const kinds = kindsByKey.get(row.newKey) ?? new Set<TwinEntityKind>();
    kinds.add(row.kind);
    kindsByKey.set(row.newKey, kinds);
  }
  const collisions = [...kindsByKey.values()].filter((kinds) => kinds.size > 1).length;
  if (collisions > 0) {
    throw new Error(
      `Entity name-fold sweep aborted before any write: ${collisions} folded key(s) are claimed by both a person ` +
        'and a topic, and entities.normalized_name is unique across kinds. Nothing was changed; resolve the clash.',
    );
  }
}

/** Buckets rows by kind FIRST, then folded key — so a group can never span kinds. */
function groupRows(planned: PlannedRow[]): PlannedRow[][] {
  const groups = new Map<string, PlannedRow[]>();
  for (const row of planned) {
    const bucket = groups.get(`${row.kind}:${row.newKey}`);
    if (bucket) bucket.push(row);
    else groups.set(`${row.kind}:${row.newKey}`, [row]);
  }
  return [...groups.values()];
}

/** Merges one group in ONE transaction and returns the row that survived. The survivor is chosen once and handed back
 *  rather than recomputed by the caller: two sorts that ever disagreed would re-key a deleted row (a silent zero-row
 *  UPDATE) and leave the real survivor holding a stale key. */
async function mergeGroup(
  db: Db,
  group: PlannedRow[],
  factsById: Map<string, number>,
): Promise<{ survivor: PlannedRow; counts: MergeCounts }> {
  // Guaranteed by the group key (which starts with the kind), and asserted anyway: this is the single check between
  // the sweep and a cross-kind merge, and it costs one in-memory comparison per group.
  if (new Set(group.map((row) => row.kind)).size !== 1) {
    throw new Error('Entity name-fold sweep: refusing to merge a group spanning more than one kind');
  }
  const [survivor, ...losers] = [...group].sort((a, b) => compareForSurvival(a, b, factsById));
  const counts = await db.transaction(async (tx) =>
    applyMerge(
      tx as unknown as Db,
      survivor.id,
      losers.map((loser) => loser.id),
    ),
  );
  return { survivor, counts };
}

/** Runs the one-shot entity name-fold sweep. No-ops (returns `skipped`) once the flag is set. May throw: any failure
 *  leaves the flag unset so the next launch retries, and main.ts is responsible for catching it. */
export async function sweepEntityNameFolds(): Promise<FoldSweepResult> {
  const db = getDb();
  if (await alreadyRun(db)) {
    log.info('Entity name-fold sweep already completed — skipping');
    return { scanned: 0, groupsMerged: 0, entitiesDeleted: 0, rowsReKeyed: 0, factsRepointed: 0, skipped: true };
  }

  const rows: EntityRow[] = await db
    .select({
      id: entities.id,
      name: entities.name,
      normalizedName: entities.normalizedName,
      kind: entities.kind,
      createdAt: entities.createdAt,
    })
    .from(entities)
    // Oldest first, id as the tiebreak: a destructive pass must process groups in the same order on every retry, so a
    // run interrupted after some groups committed resumes over a predictable prefix rather than an arbitrary one.
    .orderBy(asc(entities.createdAt), asc(entities.id));
  const factsById = await loadFactCounts(db);

  // A name folding to nothing (all whitespace or bare combining marks) is left completely alone: an empty key would
  // group unrelated rows together, the one grouping mistake that costs data.
  const planned = rows
    .map((row) => ({ ...row, newKey: normalizeEntityName(row.name) }))
    .filter((row) => row.newKey.length > 0);
  assertNoCrossKindCollision(planned);

  let groupsMerged = 0;
  let entitiesDeleted = 0;
  let factsRepointed = 0;
  const survivors: PlannedRow[] = [];

  for (const group of groupRows(planned)) {
    if (group.length === 1) {
      survivors.push(group[0]);
      continue;
    }
    const { survivor, counts } = await mergeGroup(db, group, factsById);
    groupsMerged += 1;
    entitiesDeleted += group.length - 1;
    factsRepointed += counts.factsRepointed;
    survivors.push(survivor);
  }

  // Re-key only AFTER every merge has committed. That ordering is what makes a unique violation impossible: the losers
  // are gone, so exactly one row per (kind, newKey) remains and no surviving row's target key is still occupied.
  // Row-by-row, and a violation is deliberately NOT caught — it would mean the grouping above was wrong.
  let rowsReKeyed = 0;
  for (const row of survivors) {
    if (row.normalizedName === row.newKey) continue;
    await db.update(entities).set({ normalizedName: row.newKey }).where(eq(entities.id, row.id));
    rowsReKeyed += 1;
  }

  await markDone(db);
  const unfoldable = rows.length - planned.length;
  log.info(
    `Entity name-fold sweep: scanned ${rows.length} entities (${unfoldable} unfoldable), merged ${groupsMerged} ` +
      `groups removing ${entitiesDeleted} rows, re-keyed ${rowsReKeyed} rows, re-pointed ${factsRepointed} facts`,
  );
  return { scanned: rows.length, groupsMerged, entitiesDeleted, rowsReKeyed, factsRepointed, skipped: false };
}
