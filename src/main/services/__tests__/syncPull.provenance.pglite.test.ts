// === FILE PURPOSE ===
// Sync delete reconciliation vs. twin-fact provenance (TWIN-LOOP.2 Task 4), on a real
// migrated PGlite. A meeting deleted on the web used to be removed by id directly, bypassing
// deleteMeeting, so its learned facts ended with a null source and no label. Sync must apply
// the same provenance snapshot deleteMeeting's keep path takes, in the same transaction, and
// must never delete a fact.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { meetings, syncTracking, twinFacts } from '../../db/schema';

vi.mock('../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
const holder = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof drizzle> }));
vi.mock('../../db/connection', () => ({ getDb: () => holder.db }));
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, app: { getPath: () => '' } }));

import { reconcileDeletes } from '../sync/syncPull';

const PAST = new Date('2026-01-01T00:00:00Z');
const WATERMARK = new Date('2026-06-01T00:00:00Z');

/** A supabase double that answers only the reconcile query: select('id').eq('user_id', …). */
const fakeSupabase = (remoteIds: string[]) =>
  ({
    from: () => ({ select: () => ({ eq: async () => ({ data: remoteIds.map((id) => ({ id })), error: null }) }) }),
  }) as never;

beforeAll(async () => {
  const pg = new PGlite({ extensions: { vector } });
  holder.db = drizzle(pg, { schema });
  await migrate(holder.db as never, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
});

beforeEach(async () => {
  await holder.db.delete(twinFacts);
  await holder.db.delete(meetings);
  await holder.db.delete(syncTracking);
  await holder.db.insert(syncTracking).values({ tableName: 'meetings', lastSyncedAt: WATERMARK });
});

async function seedMeeting(title: string): Promise<string> {
  const [m] = await holder.db.insert(meetings).values({ title, startedAt: PAST, createdAt: PAST }).returning();
  return m.id;
}

describe('sync reconcile - meeting delete keeps fact provenance', () => {
  it('an orphan meeting is deleted, its facts survive stamped with its label, tombstones untouched', async () => {
    const keep = await seedMeeting('Kept');
    const orphan = await seedMeeting('Quarterly review');
    await seedMeeting('Another kept');
    const day = new Date().toISOString().slice(0, 10);
    await holder.db.insert(twinFacts).values([
      { fact: 'active fact', category: 'person', sourceMeetingId: orphan },
      { fact: 'forgotten fact', category: 'person', status: 'forgotten', sourceMeetingId: orphan },
      {
        fact: '',
        category: 'person',
        status: 'forgotten',
        fingerprint: 'b'.repeat(64),
        purgedAt: new Date(),
        sourceMeetingId: orphan,
      },
      { fact: 'other meeting fact', category: 'person', sourceMeetingId: keep },
    ]);
    const all = await holder.db.select({ id: meetings.id }).from(meetings);

    const deleted = await reconcileDeletes(fakeSupabase(all.map((m) => m.id).filter((id) => id !== orphan)), 'user-1');

    expect(deleted).toBe(1);
    expect(await holder.db.select().from(meetings).where(eq(meetings.id, orphan))).toHaveLength(0);
    const facts = await holder.db.select().from(twinFacts);
    expect(facts).toHaveLength(4); // sync never deletes a fact
    const byText = Object.fromEntries(facts.map((f) => [f.fact, f]));
    for (const text of ['active fact', 'forgotten fact']) {
      expect(byText[text].sourceMeetingId).toBeNull();
      expect(byText[text].sourceMeetingLabel).toBe(`Quarterly review — deleted ${day}`);
    }
    expect(byText[''].sourceMeetingLabel).toBeNull(); // purged tombstone: never stamped
    expect(byText['other meeting fact'].sourceMeetingId).toBe(keep);
    expect(byText['other meeting fact'].sourceMeetingLabel).toBeNull();
  });

  it('the stamp and the delete are one transaction: if the delete fails nothing is stamped', async () => {
    const orphan = await seedMeeting('Doomed');
    await seedMeeting('Kept one');
    await seedMeeting('Kept two');
    await holder.db.insert(twinFacts).values({ fact: 'f', category: 'person', sourceMeetingId: orphan });
    const all = (await holder.db.select({ id: meetings.id }).from(meetings)).map((m) => m.id);

    const real = holder.db;
    holder.db = new Proxy(real, {
      get(target, prop, receiver) {
        if (prop !== 'transaction') return Reflect.get(target, prop, receiver);
        return (cb: (tx: unknown) => Promise<unknown>) =>
          target.transaction(async (tx) =>
            cb(
              new Proxy(tx, {
                get(t, p, r) {
                  if (p === 'delete') return () => ({ where: () => Promise.reject(new Error('delete failed')) });
                  return Reflect.get(t, p, r);
                },
              }),
            ),
          );
      },
    });
    try {
      await reconcileDeletes(fakeSupabase(all.filter((id) => id !== orphan)), 'user-1');
    } finally {
      holder.db = real;
    }

    expect(await holder.db.select().from(meetings).where(eq(meetings.id, orphan))).toHaveLength(1);
    const [fact] = await holder.db.select().from(twinFacts);
    expect(fact.sourceMeetingId).toBe(orphan);
    expect(fact.sourceMeetingLabel).toBeNull();
  });
});
