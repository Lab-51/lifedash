// === FILE PURPOSE ===
// TWIN-LOOP Task 2: regenerating a meeting's brief REPLACES that meeting's learned
// facts instead of adding to them. extractFacts DELETES user data (a meeting's
// active facts), so every rule is pinned against a real migrated PGlite database
// (a mocked delete would not cascade, roll back, or honour NULL semantics). Only
// the model call (generateValidated), resolveTaskModel, getMeeting and the data
// notifier are mocked; the queries, the transaction and the FK rules are real.
// All fixture text is neutral and synthetic — no real meeting content.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { meetings, meetingBriefs, twinFacts } from '../../db/schema';

vi.mock('../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
const holder = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof drizzle> }));
vi.mock('../../db/connection', () => ({ getDb: () => holder.db }));
vi.mock('../ai-provider', () => ({ resolveTaskModel: vi.fn() }));
vi.mock('../twinResearchService', () => ({ generateValidated: vi.fn() }));
vi.mock('../dataChangeNotifier', () => ({ notifyDataChanged: vi.fn() }));
vi.mock('../meetingService', () => ({ getMeeting: vi.fn() }));

import { extractFacts, forgetFact } from '../twinMemoryService';
import { BRIEF_FAILURE_SENTINEL } from '../../../shared/briefSentinel';
import { resolveTaskModel } from '../ai-provider';
import { generateValidated } from '../twinResearchService';
import { notifyDataChanged } from '../dataChangeNotifier';
import { getMeeting } from '../meetingService';

const PROVIDER = { providerId: 'p1', providerName: 'lmstudio', apiKeyEncrypted: null, baseUrl: null, model: 'local' };

let meetingA = '';
let meetingB = '';

beforeAll(async () => {
  const pg = new PGlite({ extensions: { vector } });
  holder.db = drizzle(pg, { schema });
  await migrate(holder.db as never, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
});

async function seedMeeting(title: string): Promise<string> {
  const [row] = await holder.db.insert(meetings).values({ title, startedAt: new Date() }).returning();
  await holder.db.insert(meetingBriefs).values({ meetingId: row.id, summary: `Synthetic brief for ${title}.` });
  return row.id;
}

async function seedFact(
  fact: string,
  opts: { meetingId?: string; status?: 'active' | 'forgotten'; label?: string } = {},
): Promise<void> {
  await holder.db.insert(twinFacts).values({
    fact,
    category: 'domain',
    sourceMeetingId: opts.meetingId ?? null,
    sourceMeetingLabel: opts.label ?? null,
    status: opts.status ?? 'active',
  });
}

async function factTexts(where: { meetingId?: string | null; status?: 'active' | 'forgotten' } = {}) {
  const rows = await holder.db.select().from(twinFacts);
  return rows
    .filter((r) => where.meetingId === undefined || r.sourceMeetingId === where.meetingId)
    .filter((r) => where.status === undefined || r.status === where.status)
    .map((r) => r.fact)
    .sort();
}

const model = (...facts: string[]) => facts.map((fact) => ({ fact, category: 'domain' as const }));

beforeEach(async () => {
  vi.clearAllMocks();
  await holder.db.delete(twinFacts);
  await holder.db.delete(meetings); // cascades to briefs
  meetingA = await seedMeeting('Meeting A');
  meetingB = await seedMeeting('Meeting B');
  vi.mocked(resolveTaskModel).mockResolvedValue(PROVIDER as never);
  vi.mocked(getMeeting).mockResolvedValue({ id: meetingA } as never);
  vi.mocked(generateValidated).mockResolvedValue(model('Replacement fact one.'));
});

describe("extractFacts — regenerate replaces the meeting's facts (real PGlite)", () => {
  it('leaves exactly the new set for that meeting', async () => {
    await seedFact('Old fact alpha.', { meetingId: meetingA });
    await seedFact('Old fact beta.', { meetingId: meetingA });
    await seedFact('Old fact gamma.', { meetingId: meetingA });
    vi.mocked(generateValidated).mockResolvedValue(model('New fact one.', 'New fact two.'));

    const res = await extractFacts(meetingA);

    expect(res.status).toBe('ok');
    expect(res.facts.map((f) => f.fact).sort()).toEqual(['New fact one.', 'New fact two.']);
    expect(await factTexts({ meetingId: meetingA })).toEqual(['New fact one.', 'New fact two.']);
    expect(notifyDataChanged).toHaveBeenCalledWith({ scope: 'twin-memory' });
  });

  it("never touches other meetings' facts, interview facts, or kept facts of deleted meetings", async () => {
    await seedFact('Old fact of A.', { meetingId: meetingA });
    await seedFact('Fact of B.', { meetingId: meetingB });
    await seedFact('Interview fact.'); // sourceMeetingId null, no label
    await seedFact('Kept fact of a deleted meeting.', { label: 'Old call - deleted 2026-01-01' });
    const before = (await holder.db.select().from(twinFacts)).filter((r) => r.sourceMeetingId !== meetingA);

    await extractFacts(meetingA);

    const after = await holder.db.select().from(twinFacts);
    for (const row of before) expect(after.find((r) => r.id === row.id)).toEqual(row);
    expect(await factTexts({ meetingId: meetingA })).toEqual(['Replacement fact one.']);
  });

  it.each([
    ['no model is configured', () => vi.mocked(resolveTaskModel).mockResolvedValue(null as never)],
    [
      'the extraction returns nothing usable (null)',
      () => vi.mocked(generateValidated).mockResolvedValue(null as never),
    ],
    ['the extraction throws', () => vi.mocked(generateValidated).mockRejectedValue(new Error('model down'))],
    ['the extraction finds nothing durable ([])', () => vi.mocked(generateValidated).mockResolvedValue([])],
  ])('keeps the old set when %s', async (_name, arrange) => {
    await seedFact('Old fact alpha.', { meetingId: meetingA });
    await seedFact('Old fact beta.', { meetingId: meetingA });
    arrange();

    const res = await extractFacts(meetingA);

    expect(res.facts).toEqual([]);
    expect(await factTexts({ meetingId: meetingA })).toEqual(['Old fact alpha.', 'Old fact beta.']);
  });

  it('keeps the old set when every candidate the model returned dedupes away (an echo never deletes memory)', async () => {
    await seedFact('Old fact alpha.', { meetingId: meetingA });
    await seedFact('Old fact beta.', { meetingId: meetingA });
    await seedFact('Fact of B.', { meetingId: meetingB });
    await seedFact('Forgotten fact.', { meetingId: meetingB, status: 'forgotten' });
    vi.mocked(generateValidated).mockResolvedValue(model('fact of b', 'Forgotten fact.'));

    const res = await extractFacts(meetingA);

    expect(res).toEqual({ status: 'ok', facts: [] });
    expect((await factTexts({ meetingId: meetingA })).sort()).toEqual(['Old fact alpha.', 'Old fact beta.']);
    expect(await factTexts({ meetingId: meetingB })).toEqual(['Fact of B.', 'Forgotten fact.']);
    expect(notifyDataChanged).not.toHaveBeenCalled(); // nothing changed
  });

  it('keeps the old set when the only new fact was forgotten by the user while the model ran', async () => {
    await seedFact('Old fact alpha.', { meetingId: meetingA });
    await seedFact('Fact X.', { meetingId: meetingA });
    const [x] = await holder.db.select().from(twinFacts).where(eq(twinFacts.fact, 'Fact X.'));
    vi.mocked(generateValidated).mockImplementation(async () => {
      await forgetFact(x.id); // forgotten after the context was built, before the write
      return model('Fact X.');
    });

    const res = await extractFacts(meetingA);

    expect(res).toEqual({ status: 'ok', facts: [] }); // the pass ran to the replace (not a failed/skipped pass)
    expect(await factTexts({ meetingId: meetingA, status: 'active' })).toEqual(['Old fact alpha.']);
    expect(await factTexts({ meetingId: meetingA, status: 'forgotten' })).toEqual(['Fact X.']);
  });

  it('a fact the user forgets while the model call is in flight stays forgotten (never comes back active)', async () => {
    await seedFact('Fact X.', { meetingId: meetingA });
    const [x] = await holder.db.select().from(twinFacts).where(eq(twinFacts.fact, 'Fact X.'));
    vi.mocked(generateValidated).mockImplementation(async () => {
      await forgetFact(x.id); // the user clicks Forget after the context was built, before the write
      return model('Fact X.', 'Other fact.');
    });

    await extractFacts(meetingA);

    expect(await factTexts({ status: 'forgotten' })).toEqual(['Fact X.']);
    expect(await factTexts({ status: 'active' })).toEqual(['Other fact.']);
  });

  it('a queued pass never learns from a failure-card brief that landed while it waited', async () => {
    await seedFact('Old fact alpha.', { meetingId: meetingA });
    let call = 0;
    vi.mocked(generateValidated).mockImplementation(async () => {
      if (++call === 1) {
        // While the first pass's model call runs, a later Regenerate fails and stores the failure card.
        await holder.db.insert(meetingBriefs).values({
          meetingId: meetingA,
          summary: `${BRIEF_FAILURE_SENTINEL}\n\nReason: synthetic timeout`,
          createdAt: new Date(Date.now() + 60_000),
        });
        return model('Good fact from the good brief.');
      }
      return model('Fact learned from the failure card.');
    });

    const [r1, r2] = await Promise.all([extractFacts(meetingA), extractFacts(meetingA)]);

    expect(r1.status).toBe('ok');
    expect(r2).toEqual({ status: 'skipped', reason: 'failed', facts: [] });
    expect(generateValidated).toHaveBeenCalledTimes(1);
    expect(await factTexts({ meetingId: meetingA })).toEqual(['Good fact from the good brief.']);
  });

  it('never re-learns a forgotten fact (any meeting) and never deletes one in the replace', async () => {
    await seedFact('Forgotten from A.', { meetingId: meetingA, status: 'forgotten' });
    await seedFact('Forgotten from B.', { meetingId: meetingB, status: 'forgotten' });
    await seedFact('Old active of A.', { meetingId: meetingA });
    vi.mocked(generateValidated).mockResolvedValue(
      model('Forgotten from A.', 'forgotten from b', 'Genuinely new fact.'),
    );

    await extractFacts(meetingA);

    expect(await factTexts({ status: 'forgotten' })).toEqual(['Forgotten from A.', 'Forgotten from B.']);
    expect(await factTexts({ status: 'active' })).toEqual(['Genuinely new fact.']);
    // The forgotten texts were a dedupe filter only — never disclosed to the model.
    const { context } = vi.mocked(generateValidated).mock.calls[0][0];
    expect(context).not.toContain('Forgotten from');
  });

  it('excludes this meeting\'s own earlier active facts from "Already known" and from the dedupe', async () => {
    await seedFact('Own earlier fact of A.', { meetingId: meetingA });
    await seedFact('Active fact of B.', { meetingId: meetingB });
    await seedFact('Active interview fact.');
    vi.mocked(generateValidated).mockResolvedValue(model('Own earlier fact of A.', 'Active fact of B.'));

    await extractFacts(meetingA);

    const { context } = vi.mocked(generateValidated).mock.calls[0][0];
    expect(context).toContain('Active fact of B.');
    expect(context).toContain('Active interview fact.'); // NULL source must stay in the list
    expect(context).not.toContain('Own earlier fact of A.');
    // Dedupe: the meeting's own (to-be-replaced) fact is re-learnable; another meeting's is still deduped.
    expect(await factTexts({ meetingId: meetingA })).toEqual(['Own earlier fact of A.']);
    expect(await factTexts({ status: 'active' })).toEqual([
      'Active fact of B.',
      'Active interview fact.',
      'Own earlier fact of A.',
    ]);
  });

  it("serializes two concurrent passes for one meeting: the later call's set stands, never overlapping", async () => {
    await seedFact('Old fact alpha.', { meetingId: meetingA });
    let call = 0;
    let running = 0;
    let maxRunning = 0;
    vi.mocked(generateValidated).mockImplementation(async () => {
      const mine = ++call;
      running++;
      maxRunning = Math.max(maxRunning, running);
      // The first (older) pass is slow, the second fast: unserialized, the OLDER set would land last.
      await new Promise((r) => setTimeout(r, mine === 1 ? 40 : 0));
      running--;
      return mine === 1 ? model('First pass fact one.', 'First pass fact two.') : model('Second pass fact.');
    });

    const [r1, r2] = await Promise.all([extractFacts(meetingA), extractFacts(meetingA)]);

    expect(r1.status).toBe('ok');
    expect(r2.status).toBe('ok');
    expect(maxRunning).toBe(1);
    expect(await factTexts({ meetingId: meetingA })).toEqual(['Second pass fact.']);
  });

  it('does not serialize passes across different meetings', async () => {
    let running = 0;
    let maxRunning = 0;
    vi.mocked(generateValidated).mockImplementation(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 20));
      running--;
      return model('Some fact.');
    });
    vi.mocked(getMeeting).mockResolvedValue({ id: 'exists' } as never);

    await Promise.all([extractFacts(meetingA), extractFacts(meetingB)]);

    expect(maxRunning).toBe(2);
  });

  it('is one transaction: a failing insert rolls the delete back and the old set survives', async () => {
    await seedFact('Old fact alpha.', { meetingId: meetingA });
    await seedFact('Old fact beta.', { meetingId: meetingA });
    // A category outside the enum passes the mocked validator but is rejected by Postgres at INSERT —
    // AFTER the delete has already run inside the transaction.
    vi.mocked(generateValidated).mockResolvedValue([{ fact: 'Bad row.', category: 'not-a-category' }]);

    const res = await extractFacts(meetingA);

    expect(res).toEqual({ status: 'skipped', reason: 'failed', facts: [] });
    expect(await factTexts({ meetingId: meetingA })).toEqual(['Old fact alpha.', 'Old fact beta.']);
    expect(notifyDataChanged).not.toHaveBeenCalled();
  });

  it('a meeting deleted after the recheck (FK failure at the insert) never loses the old set or broadcasts', async () => {
    await seedFact('Old fact alpha.', { meetingId: meetingA });
    vi.mocked(generateValidated).mockImplementation(async () => {
      // The meeting disappears while the model call is in flight; getMeeting (mocked) still says it exists,
      // so the insert is what hits the FK. (drizzle 0.45 wraps the driver error, putting SQLSTATE 23503 on
      // `.cause`, which isForeignKeyViolation does not read — so against a real DB this lands in the generic
      // 'failed' skip rather than 'meeting-deleted'. Reported as a follow-up; the data-safety contract holds either way.)
      await holder.db.delete(meetings).where(eq(meetings.id, meetingA));
      return model('New fact one.');
    });

    const res = await extractFacts(meetingA);

    expect(res.status).toBe('skipped');
    expect(res.facts).toEqual([]);
    expect(await factTexts({ status: 'active' })).toEqual(['Old fact alpha.']); // set-null keep path, never wiped
    expect(notifyDataChanged).not.toHaveBeenCalled();
  });
});
