// === FILE PURPOSE ===
// Unit tests for the TRANS-HALL.1 Task 4 one-shot cleanup sweep. Runs against a
// REAL in-memory PGlite database (same harness as calendarContextService.test.ts /
// calendarPollScheduler.test.ts) because every guarantee here is a deletion
// guarantee: a pure credit line must be deleted, a long real sentence that merely
// triggers the SQL prefilter must survive (the predicate — not the SQL — decides),
// the flag must be written only on success, a second run must no-op, and an
// error must leave the flag unset so the sweep retries next launch.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema';
import { meetings, settings, transcripts } from '../db/schema';

// --- Mocks (before importing the module under test) --------------------------------
vi.mock('./logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
const holder = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof drizzle> }));
vi.mock('../db/connection', () => ({ getDb: () => holder.db }));

import { sweepHallucinatedTranscripts, CLEANUP_FLAG_KEY } from './transcriptCleanupService';

// --- Helpers -----------------------------------------------------------------------

async function seedMeeting(): Promise<string> {
  const [row] = await holder.db
    .insert(meetings)
    .values({ title: 'Test meeting', status: 'completed', startedAt: new Date('2026-08-01T09:00:00Z') })
    .returning({ id: meetings.id });
  return row.id;
}

async function seedSegment(meetingId: string, content: string, startTime = 0): Promise<string> {
  const [row] = await holder.db
    .insert(transcripts)
    .values({ meetingId, content, startTime, endTime: startTime + 1000 })
    .returning({ id: transcripts.id });
  return row.id;
}

async function clearTables(): Promise<void> {
  await holder.db.delete(transcripts);
  await holder.db.delete(meetings);
  await holder.db.delete(settings);
}

async function getFlagValue(): Promise<string | null> {
  const rows = await holder.db.select().from(settings).where(eq(settings.key, CLEANUP_FLAG_KEY));
  return rows.length > 0 ? rows[0].value : null;
}

beforeAll(async () => {
  const pg = new PGlite({ extensions: { vector } });
  holder.db = drizzle(pg, { schema });
  await migrate(holder.db as never, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
});

beforeEach(async () => {
  vi.clearAllMocks();
  await clearTables();
});

// === Verification case 1: a pure credit line is deleted ============================

describe('sweepHallucinatedTranscripts — deletion', () => {
  it('deletes a pure subtitle-credit line', async () => {
    const meetingId = await seedMeeting();
    const id = await seedSegment(meetingId, 'Titulky vytvořil Jan Novák');

    const deleted = await sweepHallucinatedTranscripts();

    expect(deleted).toBe(1);
    const remaining = await holder.db.select().from(transcripts).where(eq(transcripts.id, id));
    expect(remaining).toHaveLength(0);
  });

  // === Verification case 2: a long sentence containing "titulky" SURVIVES ==========
  // This sentence embeds the exact prefilter phrase "titulky vytvořil" so the SQL
  // ILIKE candidate-selection picks it up — but it is far longer than the phrase's
  // length-slack allowance, so isHallucinatedSegment correctly rejects it. Proves the
  // predicate, not the SQL, is the decider.
  it('keeps a long real sentence that merely contains the prefilter phrase', async () => {
    const meetingId = await seedMeeting();
    const longSentence =
      'Ve filmu jsme si všimli, že titulky vytvořil někdo úplně jiný než minule a překlad byl mnohem lepší, protože měl skvělé znalosti kontextu a slangu z originálu.';
    expect(longSentence.length).toBeGreaterThan(100);
    const id = await seedSegment(meetingId, longSentence);

    const deleted = await sweepHallucinatedTranscripts();

    expect(deleted).toBe(0);
    const remaining = await holder.db.select().from(transcripts).where(eq(transcripts.id, id));
    expect(remaining).toHaveLength(1);
    expect(remaining[0].content).toBe(longSentence);
  });

  it('leaves ordinary meeting speech untouched', async () => {
    const meetingId = await seedMeeting();
    const id = await seedSegment(meetingId, "Let's move the deadline to next Friday and sync with design.");

    const deleted = await sweepHallucinatedTranscripts();

    expect(deleted).toBe(0);
    const remaining = await holder.db.select().from(transcripts).where(eq(transcripts.id, id));
    expect(remaining).toHaveLength(1);
  });
});

// === Verification case 3: the flag is written on success ===========================

describe('sweepHallucinatedTranscripts — flag', () => {
  it('writes the settings flag after a successful run, even when nothing was deleted', async () => {
    expect(await getFlagValue()).toBeNull();

    const deleted = await sweepHallucinatedTranscripts();

    expect(deleted).toBe(0);
    expect(await getFlagValue()).toBe('true');
  });

  it('writes the flag after deleting real matches', async () => {
    const meetingId = await seedMeeting();
    await seedSegment(meetingId, 'Thanks for watching');

    await sweepHallucinatedTranscripts();

    expect(await getFlagValue()).toBe('true');
  });
});

// === Verification case 4: a second run no-ops =======================================

describe('sweepHallucinatedTranscripts — one-shot gating', () => {
  it('no-ops on a second run: a hallucinated segment added AFTER the flag is set survives', async () => {
    const meetingId = await seedMeeting();
    const firstId = await seedSegment(meetingId, 'Subtitles by Some Guy');

    const firstRun = await sweepHallucinatedTranscripts();
    expect(firstRun).toBe(1);
    expect(await getFlagValue()).toBe('true');

    // Seeded AFTER the flag was set — a real (non-gated) second run would delete it.
    const secondId = await seedSegment(meetingId, 'thank you for watching');

    const secondRun = await sweepHallucinatedTranscripts();

    expect(secondRun).toBe(0);
    const survivor = await holder.db.select().from(transcripts).where(eq(transcripts.id, secondId));
    expect(survivor).toHaveLength(1);
    // The first segment stays deleted (proves the first run did happen for real).
    const firstRow = await holder.db.select().from(transcripts).where(eq(transcripts.id, firstId));
    expect(firstRow).toHaveLength(0);
  });

  it('does not query the transcripts table at all once the flag is set', async () => {
    await holder.db
      .insert(settings)
      .values({ key: CLEANUP_FLAG_KEY, value: 'true' })
      .onConflictDoUpdate({ target: settings.key, set: { value: 'true' } });
    const selectSpy = vi.spyOn(holder.db, 'select');

    const result = await sweepHallucinatedTranscripts();

    expect(result).toBe(0);
    // Exactly one select call total — the flag check in alreadyRun(). The
    // candidate-selection query against transcripts is never reached.
    expect(selectSpy).toHaveBeenCalledTimes(1);
    selectSpy.mockRestore();
  });
});

// === Verification case 5: the error path leaves the flag unset =====================

describe('sweepHallucinatedTranscripts — error path', () => {
  it('leaves the flag unset when the delete fails partway through', async () => {
    const meetingId = await seedMeeting();
    await seedSegment(meetingId, 'Titulky vytvořil Jan Novák');

    const deleteSpy = vi.spyOn(holder.db, 'delete').mockImplementationOnce(() => {
      throw new Error('simulated DB failure');
    });

    await expect(sweepHallucinatedTranscripts()).rejects.toThrow('simulated DB failure');

    expect(await getFlagValue()).toBeNull();
    deleteSpy.mockRestore();

    // Retries cleanly on the "next launch" — same segment gets deleted, flag gets set.
    const retryDeleted = await sweepHallucinatedTranscripts();
    expect(retryDeleted).toBe(1);
    expect(await getFlagValue()).toBe('true');
  });

  it('leaves the flag unset when the candidate query fails (the flag-check read itself succeeds)', async () => {
    const originalSelect = holder.db.select.bind(holder.db) as typeof holder.db.select;
    let calls = 0;
    const selectSpy = vi.spyOn(holder.db, 'select').mockImplementation((...args: Parameters<typeof originalSelect>) => {
      calls++;
      // 1st call = alreadyRun()'s flag check (must succeed so we reach the
      // candidate query); 2nd call = the transcripts candidate query, which fails.
      if (calls === 2) throw new Error('simulated read failure');
      return originalSelect(...args);
    });

    await expect(sweepHallucinatedTranscripts()).rejects.toThrow('simulated read failure');

    expect(await getFlagValue()).toBeNull();
    selectSpy.mockRestore();
  });
});
