// === FILE PURPOSE ===
// Tests for retranscriptionService — redoing one span of a finished
// recording's transcript from the WAV (TRANS-COV.1 Task 4).
//
// Runs against a REAL in-memory PGlite database, following the
// staleRecordingRecovery.test.ts precedent, and for the same reason only
// stronger here: this service DELETES transcript rows. Every guarantee worth
// testing is a guarantee about WHICH ROWS an overlap predicate selects, whether
// a transaction rolled back, and what actually landed in the columns. A hand
// rolled double asserting "delete was called" would pass while deleting the
// wrong rows — and deleting the wrong rows here destroys a user's transcript.
//
// Mocked, because none of them is what is under test: the whisper model
// manager (no models on disk, no native context), the WAV reader (no file, and
// the exact ms it is asked for IS one of the assertions), transcriptionService
// (the isActive guard is driven directly), and whisperPromptService (its real
// roster/entity chain is another phase's concern).
//
// `getDb` returns a PROXY over the real handle that counts `.transaction`
// calls, so "the transaction was never opened" is a direct observation rather
// than an inference from unchanged rows. The success cases assert the counter
// DOES move, which is what stops the zero-assertions from being vacuous.
//
// No real meeting content anywhere — every line of text is invented.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { asc, eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { meetings, settings, transcripts } from '../../db/schema';
import type { TranscriptionCoverage } from '../../../shared/types/transcriptionCoverage';

vi.mock('../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('electron', () => ({ app: { getPath: () => 'C:\\userdata' } }));

// The WAV reader is mocked, but `InvalidSpanError` is kept REAL: the service
// distinguishes 'span-too-long' from every other read failure with an
// `instanceof` check, and a look-alike class defined in this file would make
// that check pass for the wrong reason.
vi.mock('../wavSpanReader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../wavSpanReader')>();
  return { ...actual, resolveRecordingWav: vi.fn(), readPcmSpan: vi.fn() };
});

vi.mock('../whisperModelManager', () => ({
  getLocalModels: vi.fn(),
  getModelPath: (fileName: string) => `C:\\models\\${fileName}`,
  createWhisperContext: vi.fn(),
}));

vi.mock('../transcriptionService', () => ({
  isActive: vi.fn(() => false),
  // The real object, copied — the service reads `accurate` off it and the test
  // asserts those exact beam numbers reach whisper.
  WHISPER_PRESETS: {
    fast: { beamSize: 1, bestOf: 1 },
    balanced: { beamSize: 3, bestOf: 3 },
    accurate: { beamSize: 5, bestOf: 5 },
  },
}));

vi.mock('../whisperPromptService', () => ({
  buildInitialPrompt: vi.fn(async () => 'Alma Reeve, Orbital Rewrite'),
}));

const holder = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof drizzle>,
  proxy: null as unknown as ReturnType<typeof drizzle>,
  transactionCalls: 0,
}));
vi.mock('../../db/connection', () => ({ getDb: () => holder.proxy }));

import { InvalidSpanError, readPcmSpan, resolveRecordingWav } from '../wavSpanReader';
import * as whisperModelManager from '../whisperModelManager';
import * as transcriptionService from '../transcriptionService';
import { retranscribeSpan } from '../retranscriptionService';

const WAV = 'C:\\recordings\\session.wav';
const MODEL = 'ggml-large-v3-turbo-q5_0.bin';
const STARTED = new Date('2026-09-08T09:00:00Z');

/** The catalog entry shape whisperModelManager.getLocalModels() returns. */
const LOCAL_MODEL = {
  name: 'large-v3-turbo-q5',
  fileName: MODEL,
  size: '~874 MB',
  description: 'invented fixture entry',
  recommended: true,
};

let releaseSpy: ReturnType<typeof vi.fn>;
let transcribeDataSpy: ReturnType<typeof vi.fn>;

interface WhisperPiece {
  text: string;
  t0: number;
  t1: number;
}

/** Arm createWhisperContext with a context whose transcribeData resolves. */
function whisperReturns(pieces: WhisperPiece[]): void {
  transcribeDataSpy = vi.fn(() => ({
    stop: vi.fn(),
    promise: Promise.resolve({ result: pieces.map((p) => p.text).join(' '), segments: pieces, isAborted: false }),
  }));
  armContext();
}

/** Arm createWhisperContext with a context whose transcribeData rejects. */
function whisperFails(message: string): void {
  transcribeDataSpy = vi.fn(() => ({ stop: vi.fn(), promise: Promise.reject(new Error(message)) }));
  armContext();
}

function armContext(): void {
  releaseSpy = vi.fn(async () => undefined);
  vi.mocked(whisperModelManager.createWhisperContext).mockResolvedValue({
    context: { transcribeData: transcribeDataSpy, release: releaseSpy },
    backend: 'cpu',
  } as never);
}

/** A PCM span as readPcmSpan would return it for [startMs, endMs) of audio. */
function pcmSpanOf(audioStartMs: number, audioEndMs: number): void {
  vi.mocked(readPcmSpan).mockResolvedValue({
    pcm: Buffer.alloc((audioEndMs - audioStartMs) * 32),
    audioStartMs,
    audioEndMs,
  });
}

async function seedMeeting(coverage?: TranscriptionCoverage | null, language?: string): Promise<string> {
  const [row] = await holder.db
    .insert(meetings)
    .values({
      title: 'Fixture session',
      status: 'completed',
      startedAt: STARTED,
      endedAt: new Date(STARTED.getTime() + 600_000),
      audioPath: WAV,
      transcriptionLanguage: language ?? null,
      transcriptionCoverage: coverage ?? null,
    })
    .returning({ id: meetings.id });
  return row.id;
}

async function seedSegment(meetingId: string, startTime: number, endTime: number, content: string): Promise<void> {
  await holder.db.insert(transcripts).values({ meetingId, content, startTime, endTime });
}

async function readSegments(meetingId: string) {
  return holder.db
    .select({ content: transcripts.content, startTime: transcripts.startTime, endTime: transcripts.endTime })
    .from(transcripts)
    .where(eq(transcripts.meetingId, meetingId))
    .orderBy(asc(transcripts.startTime));
}

async function readCoverage(meetingId: string): Promise<unknown> {
  const [row] = await holder.db
    .select({ coverage: meetings.transcriptionCoverage })
    .from(meetings)
    .where(eq(meetings.id, meetingId));
  return row.coverage;
}

function coverageRecord(): TranscriptionCoverage {
  return {
    version: 1,
    endedBy: 'stop',
    audioMs: 540_000,
    provider: 'local',
    model: 'ggml-base.en.bin',
    windowStampMs: 10_000,
    windowAdvanceMs: 9_000,
    channels: {
      mic: { windows: 0, saved: 0, silentRms: 0, silentVad: 0, droppedHallucination: 0, failed: 0 },
      system: { windows: 0, saved: 0, silentRms: 0, silentVad: 0, droppedHallucination: 0, failed: 0 },
      mixed: { windows: 60, saved: 55, silentRms: 4, silentVad: 0, droppedHallucination: 1, failed: 0 },
    },
    gaps: [],
    retranscribed: [],
  };
}

beforeAll(async () => {
  const pg = new PGlite({ extensions: { vector } });
  holder.db = drizzle(pg, { schema });
  // Counts transactions without changing behaviour — see the header note.
  holder.proxy = new Proxy(holder.db, {
    get(target, prop, receiver) {
      if (prop === 'transaction') {
        return (...args: unknown[]) => {
          holder.transactionCalls += 1;
          return (target as unknown as Record<string, (...a: unknown[]) => unknown>).transaction(...args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as ReturnType<typeof drizzle>;
  await migrate(holder.db as never, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
});

beforeEach(async () => {
  vi.clearAllMocks();
  holder.transactionCalls = 0;
  await holder.db.delete(transcripts);
  await holder.db.delete(meetings);
  await holder.db.delete(settings);

  vi.mocked(transcriptionService.isActive).mockReturnValue(false);
  vi.mocked(whisperModelManager.getLocalModels).mockReturnValue([LOCAL_MODEL]);
  vi.mocked(resolveRecordingWav).mockResolvedValue(WAV);
  pcmSpanOf(107_000, 119_000);
  whisperReturns([{ text: 'invented replacement line', t0: 1_000, t1: 3_000 }]);
});

describe('retranscribeSpan — refusals', () => {
  it('refuses while a recording is active, and creates no whisper context', async () => {
    const id = await seedMeeting();
    vi.mocked(transcriptionService.isActive).mockReturnValue(true);

    const result = await retranscribeSpan({ meetingId: id, startMs: 120_000, endMs: 130_000, modelFileName: MODEL });

    expect(result).toMatchObject({ ok: false, reason: 'recording-active' });
    expect(whisperModelManager.createWhisperContext).not.toHaveBeenCalled();
    expect(readPcmSpan).not.toHaveBeenCalled();
    expect(holder.transactionCalls).toBe(0);
  });

  it('refuses a second retranscription while one is in flight, rather than queueing it', async () => {
    const id = await seedMeeting();
    let releaseWhisper: (value: unknown) => void = () => undefined;
    transcribeDataSpy = vi.fn(() => ({
      stop: vi.fn(),
      promise: new Promise((resolve) => {
        releaseWhisper = resolve;
      }),
    }));
    armContext();

    const first = retranscribeSpan({ meetingId: id, startMs: 120_000, endMs: 130_000, modelFileName: MODEL });
    // Let the first call reach the (hanging) transcribeData await.
    await vi.waitFor(() => expect(transcribeDataSpy).toHaveBeenCalled());

    const second = await retranscribeSpan({ meetingId: id, startMs: 0, endMs: 10_000, modelFileName: MODEL });
    expect(second).toMatchObject({ ok: false, reason: 'recording-active' });
    expect(second).toMatchObject({ detail: expect.stringContaining('Another retranscription') });
    // One context, not two — the second call never got that far.
    expect(whisperModelManager.createWhisperContext).toHaveBeenCalledTimes(1);

    releaseWhisper({ result: '', segments: [], isAborted: false });
    await expect(first).resolves.toMatchObject({ ok: true });
  });

  it("returns 'no-audio' when no WAV can be resolved for the session", async () => {
    const id = await seedMeeting();
    vi.mocked(resolveRecordingWav).mockResolvedValue(null);

    const result = await retranscribeSpan({ meetingId: id, startMs: 120_000, endMs: 130_000, modelFileName: MODEL });

    expect(result).toMatchObject({ ok: false, reason: 'no-audio' });
    expect(whisperModelManager.createWhisperContext).not.toHaveBeenCalled();
  });

  it("returns 'span-too-long' when the reader refuses the span", async () => {
    const id = await seedMeeting();
    vi.mocked(readPcmSpan).mockRejectedValue(new InvalidSpanError('Span of 900000ms exceeds the 600000ms limit.'));

    const result = await retranscribeSpan({ meetingId: id, startMs: 0, endMs: 900_000, modelFileName: MODEL });

    expect(result).toMatchObject({ ok: false, reason: 'span-too-long' });
    expect(whisperModelManager.createWhisperContext).not.toHaveBeenCalled();
  });

  it("returns 'model-missing' for a file name that is not downloaded", async () => {
    const id = await seedMeeting();

    const result = await retranscribeSpan({
      meetingId: id,
      startMs: 120_000,
      endMs: 130_000,
      modelFileName: 'ggml-not-here.bin',
    });

    expect(result).toMatchObject({ ok: false, reason: 'model-missing' });
    expect(whisperModelManager.createWhisperContext).not.toHaveBeenCalled();
  });
});

describe('retranscribeSpan — coordinates', () => {
  it('reads the span converted start-plus-length, padded 1,000 ms on each side', async () => {
    const id = await seedMeeting();

    // Stamped 120,000 is audio 108,000 (12 windows x 9,000 advance), so a
    // 10-second span is audio [108,000, 118,000) and the padded read is
    // [107,000, 119,000). Converting the END pointwise would give 117,000 and
    // silently drop the span's last second — the Task 1 review finding.
    const result = await retranscribeSpan({ meetingId: id, startMs: 120_000, endMs: 130_000, modelFileName: MODEL });

    expect(readPcmSpan).toHaveBeenCalledWith(WAV, 107_000, 119_000);
    expect(result).toMatchObject({ ok: true, clampedEndMs: 130_000 });
  });

  it('shortens clampedEndMs when the recording ends inside the requested span', async () => {
    const id = await seedMeeting();
    // The file holds only up to audio 114,000, so the served span is
    // [108,000, 114,000) — 6 s of the 10 requested.
    pcmSpanOf(107_000, 114_000);

    const result = await retranscribeSpan({ meetingId: id, startMs: 120_000, endMs: 130_000, modelFileName: MODEL });

    expect(result).toMatchObject({ ok: true, clampedEndMs: 126_000 });
  });

  it("returns 'no-audio' when the whole span lies past the end of the recording", async () => {
    const id = await seedMeeting();
    pcmSpanOf(107_000, 107_000);

    const result = await retranscribeSpan({ meetingId: id, startMs: 120_000, endMs: 130_000, modelFileName: MODEL });

    expect(result).toMatchObject({ ok: false, reason: 'no-audio' });
    expect(whisperModelManager.createWhisperContext).not.toHaveBeenCalled();
  });
});

describe('retranscribeSpan — mapping whisper output back', () => {
  it('maps buffer offsets to stamped ms, drops padding-only pieces, and writes speaker null', async () => {
    const id = await seedMeeting();
    whisperReturns([
      // Wholly inside the LEADING padding (audio 107,000-107,900): dropped.
      { text: 'tail of the previous sentence', t0: 0, t1: 900 },
      // audio 108,000-110,000 -> stamped 120,000-122,000.
      { text: 'first invented replacement line', t0: 1_000, t1: 3_000 },
      // audio 112,000-114,000 -> stamped 124,000-126,000.
      { text: 'second invented replacement line', t0: 5_000, t1: 7_000 },
      // Wholly inside the TRAILING padding (audio 118,000-118,500): dropped.
      { text: 'start of the next sentence', t0: 11_000, t1: 11_500 },
    ]);

    const result = await retranscribeSpan({ meetingId: id, startMs: 120_000, endMs: 130_000, modelFileName: MODEL });

    expect(result).toMatchObject({ ok: true, inserted: 2 });
    expect(await readSegments(id)).toEqual([
      { content: 'first invented replacement line', startTime: 120_000, endTime: 122_000 },
      { content: 'second invented replacement line', startTime: 124_000, endTime: 126_000 },
    ]);
    const [row] = await holder.db.select().from(transcripts).where(eq(transcripts.meetingId, id));
    expect(row.speaker).toBeNull();
  });

  it('drops a piece whose stamped start reaches the end of the replaced range — the next window still owns those rows', async () => {
    const id = await seedMeeting();
    await seedSegment(id, 130_000, 140_000, 'invented line the next window already holds');
    whisperReturns([
      // audio 108,000-110,000 -> stamped 120,000-122,000: inside the range.
      { text: 'first invented replacement line', t0: 1_000, t1: 3_000 },
      // The span's TRAILING audio, and NOT padding: buffer offset 10,000 is
      // audio 117,000, inside the requested [108,000, 118,000), which is why
      // the audio-space padding rule alone keeps it. But 117,000 is exactly
      // window 13's first sample, so it is STAMPED 130,000 — at the end of the
      // replaced range, where the surviving [130,000, 140,000) row already
      // names this same audio. Keeping it duplicates that row.
      { text: 'invented line that must not be duplicated', t0: 10_000, t1: 11_000 },
    ]);

    const result = await retranscribeSpan({ meetingId: id, startMs: 120_000, endMs: 130_000, modelFileName: MODEL });

    expect(result).toMatchObject({ ok: true, inserted: 1 });
    expect(await readSegments(id)).toEqual([
      { content: 'first invented replacement line', startTime: 120_000, endTime: 122_000 },
      { content: 'invented line the next window already holds', startTime: 130_000, endTime: 140_000 },
    ]);
  });

  it('keeps the replacement for the tail of a DELETED end-window row — the hole bounds the insert, not the request', async () => {
    const id = await seedMeeting();
    await seedSegment(id, 120_000, 130_000, 'invented line at the head of the span');
    await seedSegment(id, 130_000, 140_000, 'invented line the span ends inside');
    // Stamped [120,000, 135,000) is audio [108,000, 123,000); padded read
    // [107,000, 124,000). The span END is NOT window-aligned, so the delete
    // (which takes whole overlapping rows) removes [130,000, 140,000) ENTIRELY
    // — the hole it leaves runs to 140,000, not to the requested 135,000.
    pcmSpanOf(107_000, 124_000);
    // Buffer offset 15,000 is audio 122,000, inside the requested
    // [108,000, 123,000), and window 13 begins at audio 117,000, so it is
    // STAMPED 135,000 — at the requested end, but INSIDE the hole. A rule
    // bounded by clampedEndMs discards this text and nothing else names it:
    // the row that used to cover stamped 135,000 was just deleted.
    whisperReturns([{ text: 'invented replacement for the deleted tail', t0: 15_000, t1: 16_000 }]);

    const result = await retranscribeSpan({ meetingId: id, startMs: 120_000, endMs: 135_000, modelFileName: MODEL });

    expect(result).toMatchObject({ ok: true, replaced: 2, inserted: 1, clampedEndMs: 135_000 });
    expect(await readSegments(id)).toEqual([
      { content: 'invented replacement for the deleted tail', startTime: 135_000, endTime: 136_000 },
    ]);
  });

  it('asks whisper for the accurate preset at temperature 0, with the meeting glossary as the prompt', async () => {
    const id = await seedMeeting(null, 'cs-mix');

    await retranscribeSpan({ meetingId: id, startMs: 120_000, endMs: 130_000, modelFileName: MODEL });

    expect(transcribeDataSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        beamSize: 5,
        bestOf: 5,
        temperature: 0,
        language: 'cs',
        prompt: 'Alma Reeve, Orbital Rewrite',
      }),
    );
  });
});

describe('retranscribeSpan — replacement is transactional and scoped by overlap', () => {
  it('deletes exactly the overlapping rows and leaves the neighbour untouched', async () => {
    const id = await seedMeeting();
    await seedSegment(id, 100_000, 110_000, 'invented line A');
    await seedSegment(id, 110_000, 120_000, 'invented line B');
    await seedSegment(id, 120_000, 130_000, 'invented line C');
    await seedSegment(id, 130_000, 140_000, 'invented line D');
    // Stamped [105,000, 125,000) is audio [95,000, 115,000); padded read
    // [94,000, 116,000).
    pcmSpanOf(94_000, 116_000);
    // audio 100,000-104,000 -> stamped 111,000-115,000.
    whisperReturns([{ text: 'invented redone line', t0: 6_000, t1: 10_000 }]);

    const result = await retranscribeSpan({ meetingId: id, startMs: 105_000, endMs: 125_000, modelFileName: MODEL });

    expect(readPcmSpan).toHaveBeenCalledWith(WAV, 94_000, 116_000);
    expect(result).toMatchObject({ ok: true, replaced: 3, inserted: 1, clampedEndMs: 125_000 });
    expect(await readSegments(id)).toEqual([
      { content: 'invented redone line', startTime: 111_000, endTime: 115_000 },
      { content: 'invented line D', startTime: 130_000, endTime: 140_000 },
    ]);
    expect(holder.transactionCalls).toBe(1);
  });

  it('keeps a row that only TOUCHES the span at an edge — the range is half-open at both ends', async () => {
    const id = await seedMeeting();
    // One row ends exactly where the span starts, one starts exactly where it
    // ends. Neither OVERLAPS [120,000, 130,000), so neither may be deleted:
    // `lte`/`gte` in the delete predicate would take the neighbouring window's
    // row on every redo, and in the realistic window-aligned layout that is
    // every redo the user runs.
    await seedSegment(id, 110_000, 120_000, 'invented line just before the span');
    await seedSegment(id, 120_000, 130_000, 'invented line inside the span');
    await seedSegment(id, 130_000, 140_000, 'invented line just after the span');

    const result = await retranscribeSpan({ meetingId: id, startMs: 120_000, endMs: 130_000, modelFileName: MODEL });

    expect(result).toMatchObject({ ok: true, replaced: 1 });
    expect(await readSegments(id)).toEqual([
      { content: 'invented line just before the span', startTime: 110_000, endTime: 120_000 },
      { content: 'invented replacement line', startTime: 120_000, endTime: 122_000 },
      { content: 'invented line just after the span', startTime: 130_000, endTime: 140_000 },
    ]);
  });

  it('never touches another meeting, even for the same span', async () => {
    const id = await seedMeeting();
    const other = await seedMeeting();
    await seedSegment(id, 120_000, 130_000, 'invented line in the target session');
    await seedSegment(other, 120_000, 130_000, 'invented line in the other session');

    await retranscribeSpan({ meetingId: id, startMs: 120_000, endMs: 130_000, modelFileName: MODEL });

    expect(await readSegments(other)).toEqual([
      { content: 'invented line in the other session', startTime: 120_000, endTime: 130_000 },
    ]);
  });

  it('leaves the old rows alone when whisper fails — the transaction never opens', async () => {
    const id = await seedMeeting();
    await seedSegment(id, 120_000, 130_000, 'invented line the user wanted redone');
    whisperFails('ggml assert: buffer placement');

    const result = await retranscribeSpan({ meetingId: id, startMs: 120_000, endMs: 130_000, modelFileName: MODEL });

    expect(result).toMatchObject({ ok: false, reason: 'transcription-failed' });
    expect(holder.transactionCalls).toBe(0);
    expect(await readSegments(id)).toEqual([
      { content: 'invented line the user wanted redone', startTime: 120_000, endTime: 130_000 },
    ]);
  });
});

describe('retranscribeSpan — the coverage note', () => {
  it('appends one entry with the real counts to an existing coverage record', async () => {
    const id = await seedMeeting(coverageRecord());
    await seedSegment(id, 120_000, 130_000, 'invented line A');
    await seedSegment(id, 125_000, 135_000, 'invented line B');

    const result = await retranscribeSpan({ meetingId: id, startMs: 120_000, endMs: 130_000, modelFileName: MODEL });

    expect(result).toMatchObject({ ok: true, replaced: 2, inserted: 1 });
    const coverage = (await readCoverage(id)) as TranscriptionCoverage;
    expect(coverage.retranscribed).toHaveLength(1);
    expect(coverage.retranscribed[0]).toMatchObject({
      startMs: 120_000,
      endMs: 130_000,
      model: MODEL,
      replaced: 2,
      inserted: 1,
    });
    expect(Date.parse(coverage.retranscribed[0].at)).not.toBeNaN();
    // The rest of the record is carried through untouched.
    expect(coverage.channels.mixed.windows).toBe(60);
    expect(coverage.provider).toBe('local');
  });

  it('leaves a null coverage record null — a pre-phase session stays "unknown"', async () => {
    const id = await seedMeeting(null);

    const result = await retranscribeSpan({ meetingId: id, startMs: 120_000, endMs: 130_000, modelFileName: MODEL });

    expect(result).toMatchObject({ ok: true });
    expect(await readCoverage(id)).toBeNull();
  });
});

describe('retranscribeSpan — the whisper context', () => {
  it('releases the fresh context after a successful run', async () => {
    const id = await seedMeeting();

    const result = await retranscribeSpan({ meetingId: id, startMs: 120_000, endMs: 130_000, modelFileName: MODEL });

    expect(result).toMatchObject({ ok: true });
    expect(whisperModelManager.createWhisperContext).toHaveBeenCalledWith(`C:\\models\\${MODEL}`);
    expect(releaseSpy).toHaveBeenCalledTimes(1);
  });

  it('releases the fresh context after a failed run', async () => {
    const id = await seedMeeting();
    whisperFails('decoder aborted');

    const result = await retranscribeSpan({ meetingId: id, startMs: 120_000, endMs: 130_000, modelFileName: MODEL });

    expect(result).toMatchObject({ ok: false, reason: 'transcription-failed' });
    expect(releaseSpy).toHaveBeenCalledTimes(1);
  });
});
