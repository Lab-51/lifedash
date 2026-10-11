// === FILE PURPOSE ===
// TWIN-LOOP.2 Task 3: "Delete permanently". purgeFact / purgeAllForgotten ERASE user
// data, so every rule is pinned against a real migrated PGlite database: a purge
// clears the text, label and source label and keeps only a sha256 fingerprint of the
// normalized text; it never touches an active fact and is a no-op on a purged row; a
// purged fact is never re-learned (before the model call AND inside the replace
// transaction); and no reader — listFacts, the memory graph, profile injection, label
// backfill — ever sees the tombstone. The VACUUM tests record what PGlite actually
// does after a purge, including on a disk-backed database. Only the model call,
// the learning-model resolver, getMeeting and the data notifier are mocked.
// All fixture text is neutral and synthetic — no real meeting content.

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { meetings, meetingBriefs, settings, twinFacts } from '../../db/schema';

const { logMock } = vi.hoisted(() => ({
  logMock: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../logger', () => ({ createLogger: () => logMock }));
const holder = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof drizzle> }));
vi.mock('../../db/connection', () => ({ getDb: () => holder.db }));
vi.mock('../ai-provider', () => ({ resolveTwinLearningModel: vi.fn() }));
vi.mock('../twinResearchService', () => ({ generateValidated: vi.fn() }));
vi.mock('../dataChangeNotifier', () => ({ notifyDataChanged: vi.fn() }));
vi.mock('../meetingService', () => ({ getMeeting: vi.fn() }));

import {
  backfillFactLabels,
  extractFacts,
  forgetFact,
  listFacts,
  purgeAllForgotten,
  purgeFact,
  restoreFact,
} from '../twinMemoryService';
import { buildTwinMemoryGraph } from '../twinGraphService';
import { buildProfileContext } from '../twinProfileService';
import { resolveTwinLearningModel } from '../ai-provider';
import { generateValidated } from '../twinResearchService';
import { getMeeting } from '../meetingService';

const PROVIDER = { providerId: 'p1', providerName: 'lmstudio', apiKeyEncrypted: null, baseUrl: null, model: 'local' };

/** Independent of the service: sha256 hex of the text after the same normalization
 *  (lowercase, collapsed whitespace, trailing punctuation dropped). */
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

let memoryDb: ReturnType<typeof drizzle>;
let meetingA = '';

beforeAll(async () => {
  const pg = new PGlite({ extensions: { vector } });
  memoryDb = drizzle(pg, { schema });
  await migrate(memoryDb as never, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  holder.db = memoryDb;
});

async function seedFact(
  fact: string,
  opts: { meetingId?: string; status?: 'active' | 'forgotten'; label?: string | null; sourceLabel?: string } = {},
) {
  const [row] = await holder.db
    .insert(twinFacts)
    .values({
      fact,
      label: opts.label === undefined ? 'A label' : opts.label,
      category: 'preference',
      sourceMeetingId: opts.meetingId ?? null,
      sourceMeetingLabel: opts.sourceLabel ?? null,
      status: opts.status ?? 'active',
    })
    .returning();
  return row;
}

async function rowById(id: string) {
  const [row] = await holder.db.select().from(twinFacts).where(eq(twinFacts.id, id));
  return row;
}

const model = (...facts: string[]) => facts.map((fact) => ({ fact, category: 'preference' as const }));

beforeEach(async () => {
  vi.clearAllMocks();
  holder.db = memoryDb;
  await holder.db.delete(twinFacts);
  await holder.db.delete(settings);
  await holder.db.delete(meetings);
  const [m] = await holder.db.insert(meetings).values({ title: 'Meeting A', startedAt: new Date() }).returning();
  await holder.db.insert(meetingBriefs).values({ meetingId: m.id, summary: 'Synthetic brief for Meeting A.' });
  meetingA = m.id;
  vi.mocked(resolveTwinLearningModel).mockResolvedValue(PROVIDER as never);
  vi.mocked(getMeeting).mockResolvedValue({ id: meetingA } as never);
});

describe('purgeFact (real PGlite)', () => {
  it('clears the text, label and source label, and keeps a fingerprint + purged_at', async () => {
    const row = await seedFact('  Prefers  Tea  in the AFTERNOON!!', {
      status: 'forgotten',
      meetingId: meetingA,
      sourceLabel: 'Old call — deleted 2026-01-01',
    });

    expect(await purgeFact(row.id)).toBe(true);

    const after = await rowById(row.id);
    expect(after.fact).toBe('');
    expect(after.label).toBeNull();
    expect(after.sourceMeetingLabel).toBeNull();
    expect(after.fingerprint).toBe(sha256('prefers tea in the afternoon'));
    expect(after.purgedAt).toBeInstanceOf(Date);
    expect(after.status).toBe('forgotten');
    expect(after.sourceMeetingId).toBe(meetingA); // a meeting link, not text
  });

  it('never purges an active fact', async () => {
    const row = await seedFact('Active fact stays.');

    expect(await purgeFact(row.id)).toBe(false);
    expect(await rowById(row.id)).toEqual(row);
  });

  it('is a no-op on an already purged row (idempotent), and on a missing id', async () => {
    const row = await seedFact('Forgotten once.', { status: 'forgotten' });
    await purgeFact(row.id);
    const purged = await rowById(row.id);

    expect(await purgeFact(row.id)).toBe(false);
    expect(await rowById(row.id)).toEqual(purged);
    expect(await purgeFact('00000000-0000-4000-8000-000000000000')).toBe(false);
  });

  it('a purged fact can never be restored or forgotten again', async () => {
    const row = await seedFact('Gone for good.', { status: 'forgotten' });
    await purgeFact(row.id);
    const purged = await rowById(row.id);

    expect(await restoreFact(row.id)).toBeNull();
    expect(await forgetFact(row.id)).toBeNull();
    expect(await rowById(row.id)).toEqual(purged);
  });
});

describe('purgeAllForgotten (real PGlite)', () => {
  it('purges every forgotten fact and leaves active facts untouched', async () => {
    const active = await seedFact('Active one.');
    const activeTwo = await seedFact('Active two.', { meetingId: meetingA });
    await seedFact('Forgotten one.', { status: 'forgotten' });
    await seedFact('Forgotten two.', { status: 'forgotten', meetingId: meetingA });

    expect(await purgeAllForgotten()).toBe(2);

    expect(await rowById(active.id)).toEqual(active);
    expect(await rowById(activeTwo.id)).toEqual(activeTwo);
    const forgotten = await holder.db.select().from(twinFacts).where(eq(twinFacts.status, 'forgotten'));
    expect(forgotten.map((r) => [r.fact, r.fingerprint]).sort()).toEqual(
      [
        ['', sha256('forgotten one')],
        ['', sha256('forgotten two')],
      ].sort(),
    );
    expect(await purgeAllForgotten()).toBe(0); // nothing left to purge
  });
});

describe('a purged fact is never re-learned (real PGlite)', () => {
  it('drops a later candidate that normalizes to the purged text', async () => {
    const row = await seedFact('Prefers tea in the afternoon.', { status: 'forgotten' });
    await purgeFact(row.id);
    vi.mocked(generateValidated).mockResolvedValue(model('PREFERS tea in the   afternoon', 'A genuinely new fact.'));

    const res = await extractFacts(meetingA);

    expect(res.facts.map((f) => f.fact)).toEqual(['A genuinely new fact.']);
    const active = await listFacts({ status: 'active' });
    expect(active.map((f) => f.fact)).toEqual(['A genuinely new fact.']);
  });

  it('drops it inside the replace transaction when the purge lands while the model runs', async () => {
    const row = await seedFact('Ships on Fridays.', { meetingId: meetingA });
    vi.mocked(generateValidated).mockImplementation(async () => {
      // The user forgets and then deletes this meeting's own fact after the pre-call
      // read (where it was still active, so not yet blocked) and before the write.
      await forgetFact(row.id);
      await purgeFact(row.id);
      return model('ships on fridays.');
    });

    const res = await extractFacts(meetingA);

    expect(res).toEqual({ status: 'ok', facts: [] });
    expect(await listFacts({ status: 'active' })).toEqual([]);
    const all = await holder.db.select().from(twinFacts);
    expect(all).toHaveLength(1); // only the tombstone
    expect(all[0].fingerprint).toBe(sha256('ships on fridays'));
  });
});

describe('no reader sees a purged fact (real PGlite)', () => {
  async function seedPurgedAndActive() {
    const gone = await seedFact('Purged preference.', { status: 'forgotten', label: null });
    await purgeFact(gone.id);
    await seedFact('Kept preference.');
    await seedFact('Still forgotten.', { status: 'forgotten' });
    return gone;
  }

  it('listFacts excludes it under every filter', async () => {
    const gone = await seedPurgedAndActive();
    for (const filter of [undefined, {}, { status: 'forgotten' as const }, { category: 'preference' as const }]) {
      const ids = (await listFacts(filter)).map((f) => f.id);
      expect(ids).not.toContain(gone.id);
    }
    expect((await listFacts({ status: 'forgotten' })).map((f) => f.fact)).toEqual(['Still forgotten.']);
  });

  it('the memory graph excludes it', async () => {
    const gone = await seedPurgedAndActive();
    const graph = await buildTwinMemoryGraph();
    const facts = graph.nodes.filter((n) => n.type === 'fact');
    expect(facts.map((n) => n.recordId)).not.toContain(gone.id);
    expect(facts).toHaveLength(1);
  });

  it('profile injection excludes it', async () => {
    await seedPurgedAndActive();
    const context = await buildProfileContext('live_assistant');
    expect(context).toContain('Kept preference.');
    expect(context).not.toMatch(/^- $/m); // no empty fact line
    await holder.db.delete(twinFacts).where(eq(twinFacts.fact, 'Kept preference.'));
    expect(await buildProfileContext('live_assistant')).toBe(''); // the tombstone alone injects nothing
  });

  it('label backfill never labels it, and never writes a label onto a fact purged mid-call', async () => {
    const gone = await seedPurgedAndActive();
    const racing = await seedFact('Purged while labelling.', { status: 'forgotten', label: null });
    vi.mocked(generateValidated).mockImplementation(async (opts) => {
      if (String(opts.context).includes('Purged while labelling.')) await purgeFact(racing.id);
      return { label: 'Some label' };
    });

    const res = await backfillFactLabels();

    const contexts = vi.mocked(generateValidated).mock.calls.map(([opts]) => opts.context);
    expect(contexts).toEqual(['Fact:\nPurged while labelling.']); // the tombstone was never sent
    expect((await rowById(gone.id)).label).toBeNull();
    expect((await rowById(racing.id)).label).toBeNull();
    expect(res).toEqual({ status: 'ok', labeled: 0, remaining: 0 });
  });
});

describe('VACUUM after a purge (observed on real PGlite)', () => {
  it('runs on an in-memory database and is logged as having run', async () => {
    const row = await seedFact('Vacuum me.', { status: 'forgotten' });
    await purgeFact(row.id);
    expect(logMock.info).toHaveBeenCalledWith('Purge — VACUUM twin_facts ran');
    expect(logMock.warn).not.toHaveBeenCalled();
  });

  it('a VACUUM failure never fails the purge', async () => {
    const row = await seedFact('Purge despite vacuum failure.', { status: 'forgotten' });
    const spy = vi.spyOn(memoryDb, 'execute').mockRejectedValueOnce(new Error('vacuum refused'));

    expect(await purgeFact(row.id)).toBe(true);
    expect((await rowById(row.id)).fact).toBe('');
    expect(logMock.warn).toHaveBeenCalledWith(expect.stringContaining('VACUUM twin_facts did not run'));
    spy.mockRestore();
  });

  describe('on a disk-backed database', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifedash-purge-vacuum-'));
    let pg: PGlite;
    let diskDb: ReturnType<typeof drizzle>;

    beforeAll(async () => {
      pg = new PGlite(dataDir, { extensions: { vector } });
      diskDb = drizzle(pg, { schema });
      await migrate(diskDb as never, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
    }, 120_000);

    afterAll(async () => {
      await pg.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    });

    /** Whether the twin_facts table file on disk still holds `text`, after a CHECKPOINT
     *  has flushed every dirty page to it. */
    async function heapContains(text: string): Promise<boolean> {
      await pg.exec('CHECKPOINT');
      const res = await pg.query<{ p: string }>(`SELECT pg_relation_filepath('twin_facts') AS p`);
      return fs.readFileSync(path.join(dataDir, res.rows[0].p)).includes(text);
    }

    it('clearing the column alone leaves the old text in the table file; the purge VACUUM removes it', async () => {
      holder.db = diskDb;
      const [control] = await diskDb
        .insert(twinFacts)
        .values({ fact: 'Synthetic marker QXCONTROLWOMBAT.', category: 'domain', status: 'forgotten' })
        .returning();
      const [target] = await diskDb
        .insert(twinFacts)
        .values({ fact: 'Synthetic marker QXPURGEDNUMBAT.', category: 'domain', status: 'forgotten' })
        .returning();
      await pg.exec('CHECKPOINT');

      // Control: an UPDATE that clears the text, with no VACUUM, leaves the old row
      // version (and its text) in the table file.
      await diskDb.update(twinFacts).set({ fact: '' }).where(eq(twinFacts.id, control.id));
      expect(await heapContains('QXCONTROLWOMBAT')).toBe(true);

      expect(await purgeFact(target.id)).toBe(true);
      expect(logMock.info).toHaveBeenCalledWith('Purge — VACUUM twin_facts ran');
      expect(await heapContains('QXPURGEDNUMBAT')).toBe(false);
      expect(await heapContains('QXCONTROLWOMBAT')).toBe(false); // the same VACUUM swept it
    }, 120_000);
  });
});
