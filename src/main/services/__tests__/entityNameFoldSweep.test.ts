// === FILE PURPOSE ===
// Tests for the one-time entity name-fold sweep (ENTITY-NAME.1 Task 2) — the pass that
// re-keys every `entities` row through the CURRENT normalizeEntityName and merges the
// rows that now collide.
//
// === WHY A REAL PGLITE DATABASE AND NOT A MOCKED DB ===
// Every guarantee this sweep makes is a DATABASE guarantee that a hand-rolled double
// cannot reproduce, and this is the task that deletes rows from the user's real data
// with no undo:
//   - `entities.normalized_name` is UNIQUE (globally, across kinds) — the constraint the
//     re-key step must never trip;
//   - `entity_facts.entity_id` and `entity_links.entity_id` CASCADE on delete — which is
//     exactly why deleting a loser before re-pointing its facts destroys them, and a mock
//     would happily "pass" that bug;
//   - the per-group work must be ONE transaction that ROLLS BACK completely on failure.
// Same harness as calendarContextService.test.ts / meetingService.deletion.test.ts. No
// AI seam is exercised at all (the sweep makes zero model calls); ai-provider and
// twinResearchService are mocked only because entityService — imported for
// normalizeEntityName — pulls them in.
//
// All names below are INVENTED.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { asc, eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { entities, entityFacts, entityLinks, meetings, settings } from '../../db/schema';
import type { TwinEntityKind } from '../../../shared/types/twin';

// --- Mocks (before importing the module under test) ---------------------------------
vi.mock('../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../ai-provider', () => ({ resolveTaskModel: vi.fn() }));
vi.mock('../twinResearchService', () => ({ generateValidated: vi.fn() }));

/**
 * The SCHEMA-PARAMETERIZED drizzle handle, matching connection.ts:27 exactly. This
 * parameterization is load-bearing and must not be simplified away: mergeEntityInto takes
 * ReturnType<typeof getDb>, which connection.ts declares as ReturnType<typeof drizzle<typeof
 * schema>>, whereas a bare ReturnType<typeof drizzle> infers PgliteDatabase<Record<string,
 * unknown>> and is NOT assignable to it. The two are identical at RUNTIME, so every test here
 * passes either way and only tsc can tell the difference — declared once so the double tracks
 * the real signature instead of five call-site casts hiding a future genuine mismatch.
 */
type Handle = ReturnType<typeof drizzle<typeof schema>>;
const holder = vi.hoisted(() => ({
  db: null as unknown as Handle,
  /** When set, the service sees this instead of the raw db (failure injection). */
  handle: null as unknown as Handle | null,
}));
vi.mock('../../db/connection', () => ({ getDb: () => holder.handle ?? holder.db }));

import { sweepEntityNameFolds, mergeEntityInto, SWEEP_FLAG_KEY } from '../entityNameFoldSweep';

// --- Seeding helpers ----------------------------------------------------------------

/**
 * The PRE-Task-1 normalizer: case + whitespace only, NO diacritic folding. Reproduced
 * here solely to seed a realistic pre-sweep database (rows whose stored key was written
 * by the old rules). Production code never calls this.
 */
function legacyKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

const T0 = new Date('2026-07-01T09:00:00Z').getTime();
/** Distinct, ordered createdAt values so group processing order is deterministic. */
const at = (minutes: number): Date => new Date(T0 + minutes * 60_000);

async function seedMeeting(title: string): Promise<string> {
  const [row] = await holder.db
    .insert(meetings)
    .values({ title, status: 'completed', startedAt: at(0), endedAt: at(45) })
    .returning({ id: meetings.id });
  return row.id;
}

async function seedEntity(name: string, kind: TwinEntityKind, createdAt: Date): Promise<string> {
  const [row] = await holder.db
    .insert(entities)
    .values({ name, normalizedName: legacyKey(name), kind, createdAt })
    .returning({ id: entities.id });
  return row.id;
}

async function seedFact(entityId: string, content: string, sourceMeetingId: string): Promise<void> {
  await holder.db.insert(entityFacts).values({ entityId, content, sourceMeetingId });
}

async function seedLink(entityId: string, meetingId: string): Promise<void> {
  await holder.db.insert(entityLinks).values({ entityId, meetingId });
}

// --- Read helpers -------------------------------------------------------------------

const allEntities = () => holder.db.select().from(entities).orderBy(asc(entities.name));
const factsFor = (entityId: string) => holder.db.select().from(entityFacts).where(eq(entityFacts.entityId, entityId));
const linksFor = (entityId: string) => holder.db.select().from(entityLinks).where(eq(entityLinks.entityId, entityId));
const flagRows = () => holder.db.select().from(settings).where(eq(settings.key, SWEEP_FLAG_KEY));

async function clearTables(): Promise<void> {
  await holder.db.delete(entityFacts);
  await holder.db.delete(entityLinks);
  await holder.db.delete(entities);
  await holder.db.delete(meetings);
  await holder.db.delete(settings);
}

const INJECTED = 'injected mid-pass failure';

/**
 * Wraps the real drizzle handle so the Nth `db.transaction()` call runs its body for
 * real and THEN throws. That is the closest thing to a crash between two groups, and the
 * only way to prove the per-group transaction genuinely rolls back rather than merely
 * being written as one.
 */
function failOnTransaction(n: number): Handle {
  let seen = 0;
  return new Proxy(holder.db as object, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      if (prop !== 'transaction') return value.bind(target);
      return (cb: (tx: unknown) => Promise<unknown>) => {
        seen += 1;
        const shouldFail = seen === n;
        return value.call(target, async (tx: unknown) => {
          const result = await cb(tx);
          if (shouldFail) throw new Error(INJECTED);
          return result;
        });
      };
    },
  }) as Handle;
}

beforeAll(async () => {
  const pg = new PGlite({ extensions: { vector } });
  holder.db = drizzle(pg, { schema });
  await migrate(holder.db as never, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
});

beforeEach(async () => {
  vi.clearAllMocks();
  holder.handle = null;
  await clearTables();
});

// === The merge itself ===============================================================

describe('sweepEntityNameFolds — merging folded duplicates', () => {
  it('merges an accented spelling and its accent-less twin into ONE row, keeping the accented display name and both sides facts and links', async () => {
    const m1 = await seedMeeting('Session one');
    const m2 = await seedMeeting('Session two');
    const accented = await seedEntity('Ánika Solberg', 'person', at(1));
    const plain = await seedEntity('Anika Solberg', 'person', at(2));
    await seedFact(accented, 'Runs the ledger review.', m1);
    // The accent-less row deliberately carries MORE facts: the diacritic rule must
    // outrank the fact-count rule, not merely agree with it.
    await seedFact(plain, 'Owns the migration plan.', m2);
    await seedFact(plain, 'Prefers async updates.', m2);
    await seedLink(accented, m1);
    await seedLink(plain, m2);

    const result = await sweepEntityNameFolds();

    expect(result).toMatchObject({
      scanned: 2,
      groupsMerged: 1,
      entitiesDeleted: 1,
      rowsReKeyed: 1,
      factsRepointed: 2,
    });
    const rows = await allEntities();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(accented);
    expect(rows[0].name).toBe('Ánika Solberg'); // display spelling preserved, not folded
    expect(rows[0].normalizedName).toBe('anika solberg'); // stored key now matches a fresh lookup

    const facts = await factsFor(accented);
    expect(facts).toHaveLength(3);
    // Provenance is untouched — every fact still points at the session it came from.
    expect(facts.filter((f) => f.sourceMeetingId === m1)).toHaveLength(1);
    expect(facts.filter((f) => f.sourceMeetingId === m2)).toHaveLength(2);
    expect((await linksFor(accented)).map((l) => l.meetingId).sort()).toEqual([m1, m2].sort());
    expect(await flagRows()).toHaveLength(1);
  });

  it('collapses a session both spellings were linked to into a SINGLE link on the survivor', async () => {
    const shared = await seedMeeting('Shared session');
    const other = await seedMeeting('Other session');
    const accented = await seedEntity('Ólin Bay', 'topic', at(1));
    const plain = await seedEntity('Olin Bay', 'topic', at(2));
    await seedLink(accented, shared);
    await seedLink(plain, shared); // the collision: both variants linked to the same session
    await seedLink(plain, other);

    const result = await sweepEntityNameFolds();

    expect(result.groupsMerged).toBe(1);
    const links = await linksFor(accented);
    expect(links).toHaveLength(2);
    expect(links.filter((l) => l.meetingId === shared)).toHaveLength(1);
    // Nothing is left pointing at the deleted row.
    expect(await holder.db.select().from(entityLinks)).toHaveLength(2);
  });

  it('breaks a survivor tie by fact count, then by age', async () => {
    const m1 = await seedMeeting('Tie session');
    // Both spellings carry diacritics, so rule 1 ties and fact count decides.
    const fewFacts = await seedEntity('Rëva Lund', 'person', at(1));
    const manyFacts = await seedEntity('Reva Lünd', 'person', at(2));
    await seedFact(fewFacts, 'Chairs the intake call.', m1);
    await seedFact(manyFacts, 'Keeps the risk log.', m1);
    await seedFact(manyFacts, 'Runs the vendor thread.', m1);
    // Both carry diacritics and both have zero facts, so age decides.
    const older = await seedEntity('Mérida Pipeline', 'topic', at(3));
    await seedEntity('Merída Pipeline', 'topic', at(4));

    const result = await sweepEntityNameFolds();

    expect(result.groupsMerged).toBe(2);
    const rows = await allEntities();
    expect(rows.map((r) => r.id).sort()).toEqual([manyFacts, older].sort());
    expect(rows.map((r) => r.name).sort()).toEqual(['Mérida Pipeline', 'Reva Lünd']);
  });

  it('NEVER merges across kinds — a person and a topic folding to one key abort the sweep before any write', async () => {
    // A workstream named after a person is how this collision arises in practice.
    const person = await seedEntity('Ardèn Voss', 'person', at(1));
    const topic = await seedEntity('Arden Voss', 'topic', at(2));

    await expect(sweepEntityNameFolds()).rejects.toThrow(/both a person and a topic/);

    // Both rows survive, untouched and still separate — and nothing else was written
    // either, because entities.normalized_name is unique ACROSS kinds and the pass
    // refuses to start a run it cannot finish.
    const rows = await allEntities();
    expect(rows.map((r) => r.id).sort()).toEqual([person, topic].sort());
    expect(rows.map((r) => r.normalizedName).sort()).toEqual(['arden voss', 'ardèn voss']);
    expect(await flagRows()).toHaveLength(0); // flag unset ⇒ retried next launch
  });
});

// === No-op, idempotence and the flag ================================================

describe('sweepEntityNameFolds — no-op paths', () => {
  it('is a pure re-key no-op on an ASCII-only database, with zero deletes', async () => {
    const m1 = await seedMeeting('Ascii session');
    const a = await seedEntity('Harbor Migration', 'topic', at(1));
    const b = await seedEntity('Quarterly Rollout', 'topic', at(2));
    const c = await seedEntity('Dana Whitfield', 'person', at(3));
    await seedFact(a, 'Ships in two phases.', m1);

    const result = await sweepEntityNameFolds();

    expect(result).toMatchObject({
      scanned: 3,
      groupsMerged: 0,
      entitiesDeleted: 0,
      rowsReKeyed: 0,
      factsRepointed: 0,
    });
    const rows = await allEntities();
    expect(rows.map((r) => r.id).sort()).toEqual([a, b, c].sort());
    expect(rows.map((r) => r.normalizedName).sort()).toEqual([
      'dana whitfield',
      'harbor migration',
      'quarterly rollout',
    ]);
    expect(await factsFor(a)).toHaveLength(1);
    expect(await flagRows()).toHaveLength(1);
  });

  it('is idempotent — a second pass over an already-swept database finds nothing to do', async () => {
    const m1 = await seedMeeting('Idempotence session');
    const accented = await seedEntity('Zürn Ledger', 'topic', at(1));
    const plain = await seedEntity('Zurn Ledger', 'topic', at(2));
    await seedFact(accented, 'Closes at quarter end.', m1);
    await seedFact(plain, 'Owned by finance.', m1);

    const first = await sweepEntityNameFolds();
    expect(first).toMatchObject({ groupsMerged: 1, entitiesDeleted: 1, rowsReKeyed: 1 });

    // Clear the flag so the PASS itself is re-run, not just short-circuited.
    await holder.db.delete(settings).where(eq(settings.key, SWEEP_FLAG_KEY));
    const second = await sweepEntityNameFolds();

    expect(second).toMatchObject({
      scanned: 1,
      groupsMerged: 0,
      entitiesDeleted: 0,
      rowsReKeyed: 0,
      factsRepointed: 0,
    });
    const rows = await allEntities();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(accented);
    expect(await factsFor(accented)).toHaveLength(2);
    expect(plain).not.toBe(rows[0].id);
  });

  it('short-circuits entirely once the completion flag is set', async () => {
    await holder.db.insert(settings).values({ key: SWEEP_FLAG_KEY, value: 'true' });
    const accented = await seedEntity('Zürn Ledger', 'topic', at(1));
    const plain = await seedEntity('Zurn Ledger', 'topic', at(2));

    const result = await sweepEntityNameFolds();

    expect(result).toMatchObject({ skipped: true, scanned: 0, groupsMerged: 0, rowsReKeyed: 0 });
    const rows = await allEntities();
    expect(rows.map((r) => r.id).sort()).toEqual([accented, plain].sort());
    expect(rows.map((r) => r.normalizedName).sort()).toEqual(['zurn ledger', 'zürn ledger']);
  });
});

// === The transaction / failure contract =============================================

describe('sweepEntityNameFolds — mid-pass failure', () => {
  it('leaves the flag UNSET and rolls the failing group back whole, with the committed group intact', async () => {
    const m1 = await seedMeeting('Group A session');
    const m2 = await seedMeeting('Group A second session');
    // Group A — processed first (oldest createdAt) and allowed to commit.
    const aSurvivor = await seedEntity('Ánika Solberg', 'person', at(1));
    const aLoser = await seedEntity('Anika Solberg', 'person', at(2));
    await seedFact(aSurvivor, 'Runs the ledger review.', m1);
    await seedFact(aLoser, 'Owns the migration plan.', m2);
    await seedFact(aLoser, 'Prefers async updates.', m2);
    await seedLink(aLoser, m2);
    // Group B — its transaction is the one that fails.
    const bSurvivor = await seedEntity('Zürn Ledger', 'topic', at(3));
    const bLoser = await seedEntity('Zurn Ledger', 'topic', at(4));
    await seedFact(bSurvivor, 'Closes at quarter end.', m1);
    await seedFact(bLoser, 'Owned by finance.', m1);
    await seedLink(bLoser, m1);

    holder.handle = failOnTransaction(2);
    await expect(sweepEntityNameFolds()).rejects.toThrow(INJECTED);

    // 1. The flag is UNSET, so the whole sweep retries on the next launch.
    expect(await flagRows()).toHaveLength(0);

    // 2. The FAILING group rolled back COMPLETELY — no half-applied merge.
    const rows = await allEntities();
    expect(rows.map((r) => r.id).sort()).toEqual([aSurvivor, bSurvivor, bLoser].sort());
    expect(await factsFor(bSurvivor)).toHaveLength(1);
    expect(await factsFor(bLoser)).toHaveLength(1);
    expect(await linksFor(bLoser)).toHaveLength(1);

    // 3. The COMMITTED group is whole: all three facts moved onto its survivor and none
    //    were destroyed. This is the assertion that fails if the deletes are ever moved
    //    ahead of the re-point — the loser's rows would cascade away instead of moving.
    expect(await factsFor(aSurvivor)).toHaveLength(3);
    expect((await linksFor(aSurvivor)).map((l) => l.meetingId)).toEqual([m2]);

    // 4. Nothing was re-keyed at all: the re-key step runs only after every group.
    const aRow = rows.find((r) => r.id === aSurvivor);
    expect(aRow?.normalizedName).toBe('ánika solberg');
  });
});

// === mergeEntityInto — the guards Task 3 depends on =================================

describe('mergeEntityInto guards', () => {
  it('refuses to merge an entity into itself', async () => {
    const id = await seedEntity('Harbor Migration', 'topic', at(1));
    await expect(mergeEntityInto(holder.db, id, id)).rejects.toThrow(/into itself/);
  });

  it('refuses a merge when either row is missing', async () => {
    const real = await seedEntity('Harbor Migration', 'topic', at(1));
    const ghost = '00000000-0000-4000-8000-000000000001';
    await expect(mergeEntityInto(holder.db, ghost, real)).rejects.toThrow(/source entity .* does not exist/);
    await expect(mergeEntityInto(holder.db, real, ghost)).rejects.toThrow(/target entity .* does not exist/);
  });

  it('refuses to merge across kinds', async () => {
    const person = await seedEntity('Dana Whitfield', 'person', at(1));
    const topic = await seedEntity('Harbor Migration', 'topic', at(2));
    await expect(mergeEntityInto(holder.db, person, topic)).rejects.toThrow(/across kinds/);
    expect(await allEntities()).toHaveLength(2);
  });

  it('moves facts and links onto the target and deletes the source', async () => {
    const m1 = await seedMeeting('Standalone session');
    const source = await seedEntity('Harbour Migration', 'topic', at(1));
    const target = await seedEntity('Harbor Migration', 'topic', at(2));
    await seedFact(source, 'Ships in two phases.', m1);
    await seedLink(source, m1);

    const counts = await mergeEntityInto(holder.db, source, target);

    expect(counts).toEqual({ factsRepointed: 1, linksMerged: 1 });
    expect((await allEntities()).map((r) => r.id)).toEqual([target]);
    expect(await factsFor(target)).toHaveLength(1);
    expect((await linksFor(target)).map((l) => l.meetingId)).toEqual([m1]);
  });
});
