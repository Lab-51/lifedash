// === FILE PURPOSE ===
// Unit tests for the MEET-DEL.1 Task 4 one-shot orphaned-recordings sweep.
// Runs against a REAL in-memory PGlite database (same harness as
// transcriptCleanupService.test.ts) AND a REAL temp directory on disk (same
// convention as whisperModelManager.test.ts), because every guarantee here is
// a deletion guarantee: an orphan WAV must be deleted, a WAV referenced by a
// meeting's audioPath must survive, the in-progress file of a still-recording
// meeting must survive, the flag must be written only on a failure-free run,
// and a second run must no-op.
//
// Per the project's 2026-08-05 verification-design learning — "empty output is
// not evidence unless the target is known to exist" — every "kept" fixture
// below also seeds a genuine orphan in the SAME run, so the assertion that the
// kept file survived can only pass if the sweep actually scanned the
// directory and is capable of deleting; a no-op bug could not fake it.

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema';
import { meetings, settings } from '../db/schema';

// --- Mocks (before importing the module under test) --------------------------------
vi.mock('./logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
const holder = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof drizzle> }));
vi.mock('../db/connection', () => ({ getDb: () => holder.db }));

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lifedash-recording-sweep-'));
const recordingsDir = path.join(tmpRoot, 'recordings');

vi.mock('electron', () => ({
  app: { getPath: () => tmpRoot },
}));

// vi.spyOn cannot redefine a `node:fs/promises` export directly — Node's ESM
// module namespace is not configurable (throws "Cannot redefine property").
// Instead, wrap `unlink` once at mock-factory time as a transparent
// passthrough to the real implementation, except for paths a test has added
// to this hoisted set — avoids any spy mockRestore()/original-binding dance.
const unlinkFailure = vi.hoisted(() => ({ paths: new Set<string>() }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    unlink: vi.fn(async (target: Parameters<typeof actual.unlink>[0]) => {
      if (unlinkFailure.paths.has(String(target))) {
        throw new Error('simulated unlink failure');
      }
      return actual.unlink(target);
    }),
  };
});

import { sweepOrphanedRecordings, SWEEP_FLAG_KEY } from './recordingSweepService';

// --- Helpers -----------------------------------------------------------------------

async function seedMeeting(status: 'recording' | 'completed', audioPath: string | null = null): Promise<string> {
  const [row] = await holder.db
    .insert(meetings)
    .values({ title: 'Test meeting', status, startedAt: new Date('2026-08-01T09:00:00Z'), audioPath })
    .returning({ id: meetings.id });
  return row.id;
}

function writeFile(name: string, content = 'fake wav data'): string {
  const filePath = path.join(recordingsDir, name);
  fs.writeFileSync(filePath, content);
  return filePath;
}

function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

async function getFlagValue(): Promise<string | null> {
  const rows = await holder.db.select().from(settings).where(eq(settings.key, SWEEP_FLAG_KEY));
  return rows.length > 0 ? rows[0].value : null;
}

beforeAll(async () => {
  const pg = new PGlite({ extensions: { vector } });
  holder.db = drizzle(pg, { schema });
  await migrate(holder.db as never, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
});

beforeEach(async () => {
  vi.clearAllMocks();
  unlinkFailure.paths.clear();
  await holder.db.delete(meetings);
  await holder.db.delete(settings);
  fs.rmSync(recordingsDir, { recursive: true, force: true });
  fs.mkdirSync(recordingsDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// === Verification case 1: an orphan WAV is deleted =================================

describe('sweepOrphanedRecordings — deletion', () => {
  it('deletes an orphan WAV that no meeting references', async () => {
    const orphanPath = writeFile('orphan.wav');

    const deleted = await sweepOrphanedRecordings();

    expect(deleted).toBe(1);
    expect(fileExists(orphanPath)).toBe(false);
  });

  // === Verification case 2: a WAV referenced by a meeting is kept ==================
  it('keeps a WAV referenced by a meeting audioPath, while still deleting a genuine orphan in the same run', async () => {
    const referencedPath = writeFile('referenced.wav');
    await seedMeeting('completed', referencedPath);
    const orphanPath = writeFile('orphan.wav');

    const deleted = await sweepOrphanedRecordings();

    expect(deleted).toBe(1); // proves the sweep actually scanned and can delete
    expect(fileExists(referencedPath)).toBe(true);
    expect(fileExists(orphanPath)).toBe(false);
  });

  // === Verification case 3: the active recording's in-progress file is kept =======
  it('keeps the in-progress file of a still-recording meeting, while still deleting a genuine orphan', async () => {
    // Per audioProcessor.ts, a live (or crash-interrupted) recording's file
    // lives at `<recordingsDir>/<meetingId>.wav` with audioPath still NULL —
    // see the RECON FINDING in recordingSweepService.ts.
    const meetingId = await seedMeeting('recording', null);
    const activePath = writeFile(`${meetingId}.wav`);
    const orphanPath = writeFile('orphan.wav');

    const deleted = await sweepOrphanedRecordings();

    expect(deleted).toBe(1);
    expect(fileExists(activePath)).toBe(true);
    expect(fileExists(orphanPath)).toBe(false);
  });
});

// === Verification case 4a: the flag is written on a failure-free run ===============

describe('sweepOrphanedRecordings — flag', () => {
  it('writes the settings flag after a run with no delete failures, even when nothing was orphaned', async () => {
    expect(await getFlagValue()).toBeNull();

    const deleted = await sweepOrphanedRecordings();

    expect(deleted).toBe(0);
    expect(await getFlagValue()).toBe('true');
  });

  it('writes the flag after reclaiming a real orphan', async () => {
    writeFile('orphan.wav');

    await sweepOrphanedRecordings();

    expect(await getFlagValue()).toBe('true');
  });
});

// === Verification case 4b: the flag is NOT written when a delete fails =============

describe('sweepOrphanedRecordings — per-file failure', () => {
  it('leaves the flag unset when one delete fails, still deletes the other orphan, and retries cleanly next launch', async () => {
    const okPath = writeFile('orphan-ok.wav');
    const failPath = writeFile('orphan-will-fail.wav');
    unlinkFailure.paths.add(failPath);

    const deleted = await sweepOrphanedRecordings();

    expect(deleted).toBe(1); // only the ok file
    expect(fileExists(okPath)).toBe(false);
    expect(fileExists(failPath)).toBe(true); // failed delete leaves the file in place
    expect(await getFlagValue()).toBeNull();

    unlinkFailure.paths.delete(failPath);

    // Retries cleanly on the "next launch" — the previously-failed file gets
    // deleted this time, and the flag gets set.
    const retryDeleted = await sweepOrphanedRecordings();
    expect(retryDeleted).toBe(1);
    expect(fileExists(failPath)).toBe(false);
    expect(await getFlagValue()).toBe('true');
  });
});

// === Verification case 5: a second run no-ops =======================================

describe('sweepOrphanedRecordings — one-shot gating', () => {
  it('no-ops on a second run: an orphan added AFTER the flag is set survives', async () => {
    const firstOrphan = writeFile('orphan-1.wav');

    const firstRun = await sweepOrphanedRecordings();
    expect(firstRun).toBe(1);
    expect(fileExists(firstOrphan)).toBe(false);
    expect(await getFlagValue()).toBe('true');

    // Seeded AFTER the flag was set — a real (non-gated) second run would delete it.
    const secondOrphan = writeFile('orphan-2.wav');

    const secondRun = await sweepOrphanedRecordings();

    expect(secondRun).toBe(0);
    expect(fileExists(secondOrphan)).toBe(true);
  });
});

// === Bonus: a missing recordings directory is a valid, complete no-op (not a failure) ===

describe('sweepOrphanedRecordings — no recordings directory yet', () => {
  it('treats a missing recordings directory as a valid, complete no-op and still marks the flag', async () => {
    fs.rmSync(recordingsDir, { recursive: true, force: true }); // fresh install / saving always disabled

    const deleted = await sweepOrphanedRecordings();

    expect(deleted).toBe(0);
    expect(await getFlagValue()).toBe('true');
  });
});
