// === FILE PURPOSE ===
// Unit tests for the coverage accounting in the transcription dispatch loop
// (TRANS-COV.1 Task 1). The transcript only keeps what SURVIVED, so a window
// skipped as silent, dropped as a hallucination or lost to a whisper failure is
// invisible in it. These tests pin the record that makes those windows visible:
//   - every dispatched window is counted once, on its own channel, and lands in
//     the bucket matching the exit it took,
//   - a FAILED window also produces a gap in the STAMPED coordinate
//     (index x 10,000 ms), which is the timeline the transcript itself uses, and
//   - start() installs a fresh tally, so one session never inherits another's.
//
// This is ACCOUNTING ONLY: the dispatch behaviour it observes is pinned by
// transcriptionService.channels.test.ts and .vad.test.ts, which are untouched by
// this phase. A separate file (rather than a case added to those) keeps that
// proof intact and lets this one drive the VAD gate and a whisper rejection
// together, which neither of those harnesses does.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const logMock = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

vi.mock('../logger', () => ({ createLogger: () => logMock }));
vi.mock('../transcriptionProviderService', () => ({
  getConfig: vi.fn(),
  isLocalOnly: vi.fn(),
  getDecryptedKey: vi.fn(),
}));
vi.mock('../whisperModelManager', () => ({
  getDefaultModelPath: vi.fn(),
  createWhisperContext: vi.fn(),
  ensureVadModel: vi.fn(),
  createVadContext: vi.fn(),
}));
vi.mock('../meetingService', () => ({ addTranscriptSegment: vi.fn() }));
vi.mock('../liveTriageService', () => ({
  setTranscriptionBusyProbe: vi.fn(),
  onSegment: vi.fn(),
}));
vi.mock('../deepgramTranscriber', () => ({ transcribeSegment: vi.fn() }));
vi.mock('../assemblyaiTranscriber', () => ({ transcribeSegment: vi.fn() }));
vi.mock('../performanceTracker', () => ({ trackTiming: (_label: string, fn: () => unknown) => fn() }));
vi.mock('../whisperPromptService', () => ({ buildInitialPrompt: vi.fn().mockResolvedValue('') }));
vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));
vi.mock('../../db/schema', () => ({
  settings: { __table: 'settings', key: 'key', value: 'value' },
  aiUsage: { __table: 'aiUsage' },
}));
vi.mock('drizzle-orm', () => ({ eq: (...a: unknown[]) => ({ eq: a }) }));

import type { AudioChunkBuffers, ChannelCoverage } from '../../../shared/types';
import * as transcriptionService from '../transcriptionService';
import * as providerService from '../transcriptionProviderService';
import * as whisperModelManager from '../whisperModelManager';
import * as meetingService from '../meetingService';

// Must match transcriptionService's own segment sizing (16 kHz * 10 s * 2 bytes).
const BYTES_PER_SEGMENT = 16000 * 10 * 2;

/** A window of alternating +/-amplitude Int16 samples — its RMS equals `amplitude`. */
function makeWindow(amplitude: number): Buffer {
  const buf = Buffer.alloc(BYTES_PER_SEGMENT);
  for (let i = 0; i < BYTES_PER_SEGMENT / 2; i++) {
    buf.writeInt16LE(i % 2 === 0 ? amplitude : -amplitude, i * 2);
  }
  return buf;
}

// One amplitude per intended outcome. Only SILENT is below the RMS threshold of
// 50; the rest are told apart by the mocks below.
const SILENT = 0;
const VAD_SILENT = 1000;
const HALLUCINATED = 2000;
const SPEECH = 3000;

/**
 * The amplitude of the window a native call was handed.
 *
 * Windows overlap by 1 s, so a dispatched buffer is the tail of the previous
 * window followed by 9 s of the current one — its LAST sample is always the
 * current window's, which is why identification reads from the end rather than
 * comparing the whole buffer.
 */
function amplitudeOf(pcm: ArrayBuffer): number {
  const samples = new Int16Array(pcm);
  return Math.abs(samples[samples.length - 1]);
}

/** The mic-off payload shape: no mic buffer, so everything stays on `mixed`. */
function mixedOnly(amplitude: number): AudioChunkBuffers {
  const window = makeWindow(amplitude);
  return { mixed: window, mic: null, system: window };
}

type TranscribeData = (
  audio: ArrayBuffer,
  options?: Record<string, unknown>,
) => { promise: Promise<unknown>; stop: () => void };

/** Whisper: a hallucination phrase for one amplitude, real text otherwise. */
function makeWhisperContext() {
  return {
    transcribeData: vi.fn<TranscribeData>((audio: ArrayBuffer) => {
      const text = amplitudeOf(audio) === HALLUCINATED ? 'Thanks for watching' : 'window speech';
      return {
        promise: Promise.resolve({ result: text, segments: [{ text, t0: 0, t1: 1000 }], isAborted: false }),
        stop: vi.fn(),
      };
    }),
    release: vi.fn().mockResolvedValue(undefined),
  };
}

/** VAD: no speech for one amplitude, speech for every other. */
function makeVadContext() {
  return {
    detectSpeechData: vi
      .fn()
      .mockImplementation(async (pcm: ArrayBuffer) => (amplitudeOf(pcm) === VAD_SILENT ? [] : [{ t0: 0, t1: 1000 }])),
    release: vi.fn().mockResolvedValue(undefined),
  };
}

function makeWindowStub() {
  return { webContents: { send: vi.fn() }, isDestroyed: () => false };
}

const ZERO: ChannelCoverage = {
  windows: 0,
  saved: 0,
  silentRms: 0,
  silentVad: 0,
  droppedHallucination: 0,
  failed: 0,
};

let whisperCtx: ReturnType<typeof makeWhisperContext>;
let vadCtx: ReturnType<typeof makeVadContext>;
let win: ReturnType<typeof makeWindowStub>;

beforeEach(() => {
  vi.clearAllMocks();
  win = makeWindowStub();
  transcriptionService.setMainWindow(win as never);
  whisperCtx = makeWhisperContext();
  vadCtx = makeVadContext();

  vi.mocked(providerService.getConfig).mockResolvedValue({ type: 'local' } as never);
  vi.mocked(providerService.isLocalOnly).mockResolvedValue(false);
  vi.mocked(whisperModelManager.getDefaultModelPath).mockResolvedValue('/models/whisper-large.bin');
  vi.mocked(whisperModelManager.createWhisperContext).mockResolvedValue({
    context: whisperCtx,
    backend: 'cpu',
  } as never);
  vi.mocked(whisperModelManager.ensureVadModel).mockResolvedValue('/models/ggml-silero-v5.1.2.bin');
  vi.mocked(whisperModelManager.createVadContext).mockResolvedValue({ context: vadCtx, backend: 'cpu' } as never);
  vi.mocked(meetingService.addTranscriptSegment).mockImplementation(
    async (_meetingId, content, startTime, endTime, speaker) =>
      ({ id: 'seg', content, startTime, endTime, speaker: speaker ?? null }) as never,
  );
});

afterEach(async () => {
  await transcriptionService.stop();
});

describe('transcriptionService — coverage accounting', () => {
  it('gives every window an outcome on its own channel', async () => {
    await transcriptionService.start('meeting-coverage', 'en');

    // One window per exit, in dispatch order.
    transcriptionService.addChunk(mixedOnly(SILENT)); // RMS fast path
    transcriptionService.addChunk(mixedOnly(VAD_SILENT)); // VAD gate
    transcriptionService.addChunk(mixedOnly(HALLUCINATED)); // hallucination filter
    transcriptionService.addChunk(mixedOnly(SPEECH)); // persisted

    // All four windows have finished (progress counts each exit exactly once).
    await vi.waitFor(() => expect(transcriptionService.getProgress().currentSegment).toBe(4));

    const tally = transcriptionService.getCoverageTally();
    expect(tally.channels.mixed).toEqual({
      windows: 4,
      saved: 1,
      silentRms: 1,
      silentVad: 1,
      droppedHallucination: 1,
      failed: 0,
    });
    // Nothing was fed to the other two channels, and nothing was invented for them.
    expect(tally.channels.mic).toEqual(ZERO);
    expect(tally.channels.system).toEqual(ZERO);
    // No window failed, so there is no gap.
    expect(tally.gaps).toEqual([]);
    // Accounting only: the saved window still reached the database, and the
    // dropped one still did not.
    expect(vi.mocked(meetingService.addTranscriptSegment).mock.calls.map((c) => c[1])).toEqual(['window speech']);
  });

  it('records a failed window as a gap in the stamped coordinate', async () => {
    whisperCtx.transcribeData.mockImplementation(() => ({
      promise: Promise.reject(new Error('whisper boom')),
      stop: vi.fn(),
    }));

    await transcriptionService.start('meeting-failure', 'en');
    // Window 0 is silent so the failure lands on window 1 — a gap at 10,000 ms
    // rather than at 0, which is what proves the index is actually used.
    transcriptionService.addChunk(mixedOnly(SILENT));
    transcriptionService.addChunk(mixedOnly(SPEECH));

    await vi.waitFor(() => expect(transcriptionService.getCoverageTally().channels.mixed.failed).toBe(1));

    const tally = transcriptionService.getCoverageTally();
    expect(tally.channels.mixed).toEqual({
      windows: 2,
      saved: 0,
      silentRms: 1,
      silentVad: 0,
      droppedHallucination: 0,
      failed: 1,
    });
    // STAMPED coordinate: window 1 is stamped at 1 x 10,000 ms and is 10,000 ms
    // long, even though it starts 9,000 ms into the real audio (ISSUES #40).
    expect(tally.gaps).toEqual([{ startMs: 10_000, endMs: 20_000, channel: 'mixed', reason: 'failed' }]);
    // The renderer is still told, exactly as before this phase.
    expect(win.webContents.send).toHaveBeenCalledWith('transcription:status-changed', {
      status: 'error',
      reason: 'Transcription failed for audio chunk',
    });
  });

  it('starts every session on a fresh tally', async () => {
    await transcriptionService.start('meeting-first', 'en');
    transcriptionService.addChunk(mixedOnly(SPEECH));
    await vi.waitFor(() => expect(transcriptionService.getCoverageTally().channels.mixed.saved).toBe(1));

    await transcriptionService.stop();
    await transcriptionService.start('meeting-second', 'en');

    const tally = transcriptionService.getCoverageTally();
    expect(tally.channels).toEqual({ mic: ZERO, system: ZERO, mixed: ZERO });
    expect(tally.gaps).toEqual([]);
  });

  it('reports the provider and whisper model the session actually ran on', async () => {
    await transcriptionService.start('meeting-model', 'en');

    expect(transcriptionService.getActiveProvider()).toBe('local');
    expect(transcriptionService.getActiveModelName()).toBe('whisper-large.bin');
  });
});
