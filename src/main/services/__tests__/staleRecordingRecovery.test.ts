// === FILE PURPOSE ===
// Tests for staleRecordingRecovery — closing meetings left stuck at
// status 'recording' because the app was closed or crashed mid-recording.
//
// Runs against a REAL in-memory PGlite database (same harness as
// speakerNameService.test.ts / whisperPromptService.test.ts) rather than a
// hand-rolled db double, because every guarantee here is a guarantee about
// which ROWS a status+null predicate selects and what actually landed in the
// columns afterwards. A double asserting "update was called" would pass while
// selecting the wrong rows — and selecting the wrong rows here means closing a
// meeting that should have stayed open.
//
// The filesystem IS mocked, because the WAV-size arithmetic is the whole point
// of the ended_at derivation and it must be driven to exact byte counts.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { meetings, transcripts, settings } from '../../db/schema';

vi.mock('../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('electron', () => ({ app: { getPath: () => 'C:\\userdata' } }));
vi.mock('node:fs/promises', () => ({ stat: vi.fn() }));

const holder = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof drizzle> }));
vi.mock('../../db/connection', () => ({ getDb: () => holder.db }));

import * as fsp from 'node:fs/promises';
import { recoverStaleRecordings } from '../staleRecordingRecovery';

const STARTED = new Date('2026-09-04T07:34:00Z');

/** 16 kHz mono Int16 = 32,000 bytes/second, plus the 44-byte RIFF header. */
function wavBytesForSeconds(seconds: number): number {
  return 44 + seconds * 32000;
}

async function seedMeeting(
  status: 'recording' | 'processing' | 'completed',
  endedAt: Date | null = null,
): Promise<string> {
  const [row] = await holder.db
    .insert(meetings)
    .values({ title: 'Session', status, startedAt: STARTED, endedAt })
    .returning({ id: meetings.id });
  return row.id;
}

async function seedSegments(meetingId: string, lastEndMs: number): Promise<void> {
  await holder.db
    .insert(transcripts)
    .values({ meetingId, content: 'invented fixture line', startTime: lastEndMs - 4000, endTime: lastEndMs });
}

async function readMeeting(id: string) {
  const [row] = await holder.db
    .select({ status: meetings.status, endedAt: meetings.endedAt })
    .from(meetings)
    .where(eq(meetings.id, id));
  return row;
}

/** No WAV on disk for any meeting. */
function noAudio(): void {
  vi.mocked(fsp.stat).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
}

/** A WAV of exactly `seconds` of audio for every meeting asked about. */
function audioOfSeconds(seconds: number): void {
  vi.mocked(fsp.stat).mockResolvedValue({ size: wavBytesForSeconds(seconds) } as never);
}

beforeAll(async () => {
  const pg = new PGlite({ extensions: { vector } });
  holder.db = drizzle(pg, { schema });
  await migrate(holder.db as never, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
});

beforeEach(async () => {
  vi.clearAllMocks();
  await holder.db.delete(transcripts);
  await holder.db.delete(meetings);
  await holder.db.delete(settings);
});

describe('recoverStaleRecordings', () => {
  it('closes a meeting stuck at status recording, deriving ended_at from the WAV length', async () => {
    const id = await seedMeeting('recording');
    audioOfSeconds(600); // exactly 10 minutes of audio

    const recovered = await recoverStaleRecordings();

    expect(recovered).toBe(1);
    const row = await readMeeting(id);
    expect(row.status).toBe('completed');
    expect(row.endedAt).toEqual(new Date(STARTED.getTime() + 600_000));
  });

  it('prefers the WAV over the transcript, because transcript timestamps drift fast (ISSUES #40)', async () => {
    const id = await seedMeeting('recording');
    // The transcript claims 660 s; the audio says 600 s. The audio is right —
    // windows are stamped ~1 s fast per 10-second window.
    await seedSegments(id, 660_000);
    audioOfSeconds(600);

    await recoverStaleRecordings();

    const row = await readMeeting(id);
    expect(row.endedAt).toEqual(new Date(STARTED.getTime() + 600_000));
  });

  it('falls back to the last transcript segment when no WAV exists', async () => {
    const id = await seedMeeting('recording');
    await seedSegments(id, 125_000);
    noAudio();

    await recoverStaleRecordings();

    const row = await readMeeting(id);
    expect(row.status).toBe('completed');
    expect(row.endedAt).toEqual(new Date(STARTED.getTime() + 125_000));
  });

  it('falls back to a zero-length session when there is neither audio nor transcript', async () => {
    const id = await seedMeeting('recording');
    noAudio();

    await recoverStaleRecordings();

    const row = await readMeeting(id);
    expect(row.status).toBe('completed');
    expect(row.endedAt).toEqual(STARTED);
  });

  it('NEVER touches a meeting that is already completed', async () => {
    const alreadyDone = new Date('2026-09-04T08:00:00Z');
    const id = await seedMeeting('completed', alreadyDone);
    audioOfSeconds(600);

    const recovered = await recoverStaleRecordings();

    expect(recovered).toBe(0);
    const row = await readMeeting(id);
    expect(row.endedAt).toEqual(alreadyDone); // not rewritten from the WAV
  });

  it('recovers every stuck session in one pass, and reports 0 on a healthy launch', async () => {
    await seedMeeting('recording');
    await seedMeeting('recording');
    await seedMeeting('recording');
    audioOfSeconds(60);

    expect(await recoverStaleRecordings()).toBe(3);
    // Second launch: nothing left stuck.
    expect(await recoverStaleRecordings()).toBe(0);
  });

  it('is NOT flag-gated — a later crash is still recovered after an earlier run', async () => {
    await seedMeeting('recording');
    audioOfSeconds(60);
    expect(await recoverStaleRecordings()).toBe(1);

    // A new crash, after the first recovery already ran. A one-shot sweep would
    // skip this forever; this must not.
    const second = await seedMeeting('recording');
    expect(await recoverStaleRecordings()).toBe(1);
    expect((await readMeeting(second)).status).toBe('completed');
  });

  it('keeps going when one row fails, so a single bad session cannot strand the rest', async () => {
    await seedMeeting('recording');
    await seedMeeting('recording');
    // stat throws something that is NOT ENOENT for the first call only.
    vi.mocked(fsp.stat)
      .mockRejectedValueOnce(Object.assign(new Error('EACCES'), { code: 'EACCES' }))
      .mockResolvedValue({ size: wavBytesForSeconds(30) } as never);

    // Both still close: an unreadable WAV degrades to the transcript/zero
    // fallback rather than aborting the pass.
    expect(await recoverStaleRecordings()).toBe(2);
  });
});
