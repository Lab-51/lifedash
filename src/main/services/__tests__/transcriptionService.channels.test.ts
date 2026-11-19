// === FILE PURPOSE ===
// Unit tests for two-channel capture in the transcription dispatch loop
// (SPEAKER.1 Task 1). The contracts pinned here:
//   - when a mic buffer is present, mic and system are transcribed SEPARATELY
//     and the mixed sum is never transcribed at all (so no line appears twice),
//   - each channel gets its own RMS fast path, so a channel nobody is speaking
//     on costs one RMS pass and no whisper call — this is what keeps two
//     channels from doubling the whisper load,
//   - mic segments persist with speaker `Me`, system and mixed with null,
//   - each channel carries its OWN rolling whisper prompt, so one speaker's
//     words never seed the other's context, and
//   - the mic-off payload and every cloud provider keep the pre-SPEAKER.1
//     mixed-only pipeline (per-channel cloud transcription would double the
//     paid minutes of every session).
//
// The whisper context, provider service, DB and cloud transcribers are mocked;
// the real dispatch loop (accumulation, RMS, concurrency, progress) runs.

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
// These tests are about the two-channel capture, not the whisper glossary
// (SPEAKER.1 Task 2) — mocked wholesale so its real DB/roster dependency chain
// never loads here.
vi.mock('../whisperPromptService', () => ({ buildInitialPrompt: vi.fn().mockResolvedValue('') }));
vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));
vi.mock('../../db/schema', () => ({
  settings: { __table: 'settings', key: 'key', value: 'value' },
  aiUsage: { __table: 'aiUsage' },
}));
vi.mock('drizzle-orm', () => ({ eq: (...a: unknown[]) => ({ eq: a }) }));

import type { AudioChunkBuffers } from '../../../shared/types';
import * as transcriptionService from '../transcriptionService';
import * as providerService from '../transcriptionProviderService';
import * as whisperModelManager from '../whisperModelManager';
import * as meetingService from '../meetingService';
import * as deepgramTranscriber from '../deepgramTranscriber';

// Must match transcriptionService's own segment sizing (16 kHz * 10 s * 2 bytes).
const BYTES_PER_SEGMENT = 16000 * 10 * 2;

/** A window of alternating ±amplitude Int16 samples — its RMS equals `amplitude`. */
function makeWindow(amplitude: number): Buffer {
  const buf = Buffer.alloc(BYTES_PER_SEGMENT);
  for (let i = 0; i < BYTES_PER_SEGMENT / 2; i++) {
    buf.writeInt16LE(i % 2 === 0 ? amplitude : -amplitude, i * 2);
  }
  return buf;
}

// Distinct amplitudes so every assertion can name which channel's audio it saw.
// All three clear the SILENCE_RMS_THRESHOLD of 50; SILENT does not.
const MIC_WINDOW = makeWindow(3000);
const SYSTEM_WINDOW = makeWindow(2000);
const MIXED_WINDOW = makeWindow(5000);
const SILENT_WINDOW = makeWindow(0);

function split(mic: Buffer, system: Buffer): AudioChunkBuffers {
  return { mixed: MIXED_WINDOW, mic, system };
}

/** The mic-off / legacy shape: no mic buffer, so the mono sum is all there is. */
function mixedOnly(window: Buffer): AudioChunkBuffers {
  return { mixed: window, mic: null, system: window };
}

type TranscribeData = (
  audio: ArrayBuffer,
  options?: Record<string, unknown>,
) => { promise: Promise<unknown>; stop: () => void };

/** Which of the known windows a native transcribeData call was handed. */
function windowName(pcm: ArrayBuffer): string {
  const bytes = Buffer.from(new Uint8Array(pcm));
  if (bytes.equals(MIC_WINDOW)) return 'mic';
  if (bytes.equals(SYSTEM_WINDOW)) return 'system';
  if (bytes.equals(MIXED_WINDOW)) return 'mixed';
  return `other(${bytes.byteLength} bytes)`;
}

/** Windows handed to whisper, in dispatch order. */
function transcribedWindows(): string[] {
  return whisperCtx.transcribeData.mock.calls.map((call) => windowName(call[0]));
}

/** `{ text, speaker }` for every persisted segment, in persistence order. */
function persisted(): Array<{ text: unknown; speaker: unknown }> {
  return vi.mocked(meetingService.addTranscriptSegment).mock.calls.map((call) => ({
    text: call[1],
    speaker: call[4],
  }));
}

/**
 * A whisper context whose result text is derived from the window it was given,
 * so a persisted segment can be traced back to the channel it came from.
 */
function makeWhisperContext() {
  return {
    transcribeData: vi.fn<TranscribeData>((audio: ArrayBuffer) => {
      const text = `${windowName(audio)} speech`;
      return {
        promise: Promise.resolve({
          result: text,
          segments: [{ text, t0: 0, t1: 1000 }],
          isAborted: false,
          language: 'cs', // whisper_full_lang_id — the language the window was decoded in
        }),
        stop: vi.fn(),
      };
    }),
    release: vi.fn().mockResolvedValue(undefined),
  };
}

function makeWindowStub() {
  return { webContents: { send: vi.fn() }, isDestroyed: () => false };
}

let whisperCtx: ReturnType<typeof makeWhisperContext>;
let win: ReturnType<typeof makeWindowStub>;

beforeEach(() => {
  vi.clearAllMocks();
  win = makeWindowStub();
  transcriptionService.setMainWindow(win as never);
  whisperCtx = makeWhisperContext();

  vi.mocked(providerService.getConfig).mockResolvedValue({ type: 'local' } as never);
  vi.mocked(providerService.isLocalOnly).mockResolvedValue(false);
  vi.mocked(whisperModelManager.getDefaultModelPath).mockResolvedValue('/models/whisper.bin');
  vi.mocked(whisperModelManager.createWhisperContext).mockResolvedValue({
    context: whisperCtx,
    backend: 'cpu',
  } as never);
  // VAD unavailable — these tests are about the channel split, not the VAD gate
  // (transcriptionService.vad.test.ts owns that), so the RMS fast path is the
  // only silence stage in play here.
  vi.mocked(whisperModelManager.ensureVadModel).mockResolvedValue(null);
  vi.mocked(meetingService.addTranscriptSegment).mockImplementation(
    async (_meetingId, content, startTime, endTime, speaker) =>
      ({ id: 'seg', content, startTime, endTime, speaker: speaker ?? null }) as never,
  );
});

afterEach(async () => {
  await transcriptionService.stop();
});

describe('transcriptionService — two-channel capture', () => {
  it('transcribes mic and system separately and never the mixed sum', async () => {
    await transcriptionService.start('meeting-split', 'en');
    transcriptionService.addChunk(split(MIC_WINDOW, SYSTEM_WINDOW));

    await vi.waitFor(() => expect(whisperCtx.transcribeData).toHaveBeenCalledTimes(2));
    expect(transcribedWindows().sort()).toEqual(['mic', 'system']);
  });

  it('tallies the language whisper decoded each SAVED window in (2026-09-09), and resets it on start', async () => {
    await transcriptionService.start('meeting-lang', 'auto');
    transcriptionService.addChunk(split(MIC_WINDOW, SYSTEM_WINDOW));

    await vi.waitFor(() => expect(whisperCtx.transcribeData).toHaveBeenCalledTimes(2));
    // 'auto' must reach whisper explicitly: an omitted language keeps whisper's
    // default 'en', so detection never runs and the tally is always { en }.
    for (const call of whisperCtx.transcribeData.mock.calls) {
      expect(call[1]).toMatchObject({ language: 'auto' });
    }
    await vi.waitFor(() => expect(transcriptionService.getCoverageTally().languages).toEqual({ cs: 2 }));

    await transcriptionService.stop();
    await transcriptionService.start('meeting-lang-2', 'auto');
    expect(transcriptionService.getCoverageTally().languages).toEqual({});
  });

  it('costs one whisper call, not two, when only one channel has speech', async () => {
    await transcriptionService.start('meeting-one-sided', 'en');
    // The user talks; nothing is coming out of the speakers.
    transcriptionService.addChunk(split(MIC_WINDOW, SILENT_WINDOW));

    // Both windows are accounted for…
    await vi.waitFor(() => expect(transcriptionService.getProgress().currentSegment).toBe(2));
    // …but the silent one never reached whisper: per-channel RMS gating is what
    // keeps two channels from doubling the transcription load.
    expect(transcribedWindows()).toEqual(['mic']);
  });

  it('labels mic segments `Me` and leaves system segments unlabelled', async () => {
    await transcriptionService.start('meeting-speakers', 'en');
    transcriptionService.addChunk(split(MIC_WINDOW, SYSTEM_WINDOW));

    await vi.waitFor(() => expect(meetingService.addTranscriptSegment).toHaveBeenCalledTimes(2));
    expect([...persisted()].sort((a, b) => String(a.text).localeCompare(String(b.text)))).toEqual([
      { text: 'mic speech', speaker: 'Me' },
      { text: 'system speech', speaker: null },
    ]);
  });

  it('keeps each channel on its own rolling whisper prompt', async () => {
    await transcriptionService.start('meeting-prompts', 'en');
    // Two full windows per channel: the second window of each carries the first
    // window's surviving text forward as context.
    transcriptionService.addChunk(split(MIC_WINDOW, SYSTEM_WINDOW));
    transcriptionService.addChunk(split(MIC_WINDOW, SYSTEM_WINDOW));

    await vi.waitFor(() => expect(whisperCtx.transcribeData).toHaveBeenCalledTimes(4));

    // The prompt handed to each channel's SECOND window must be that channel's
    // own previous text — never the other speaker's.
    for (const call of whisperCtx.transcribeData.mock.calls) {
      const prompt = call[1]?.prompt;
      if (prompt === undefined) continue;
      expect(prompt).toBe(`${windowName(call[0])} speech`);
    }
    // Non-vacuity: at least one window did carry a prompt forward.
    expect(whisperCtx.transcribeData.mock.calls.filter((c) => c[1]?.prompt !== undefined).length).toBeGreaterThan(0);
  });

  it('drops a window that echoes the previous window verbatim and clears the rolling prompt', async () => {
    // Real-use bug (2026-11-19): whisper copies its rolling prompt back on
    // quiet audio, so each sentence landed twice, 10 s apart.
    const sentence = 'takze tedka zapojujeme celou firmu do tohohle a snazime se';
    const texts = [sentence, sentence, 'a tohle je uplne nova veta ktera navazuje dal'];
    let call = 0;
    whisperCtx.transcribeData.mockImplementation(() => {
      const text = texts[Math.min(call++, texts.length - 1)];
      return {
        promise: Promise.resolve({
          result: text,
          segments: [{ text, t0: 0, t1: 1000 }],
          isAborted: false,
          language: 'cs',
        }),
        stop: vi.fn(),
      };
    });

    await transcriptionService.start('meeting-echo', 'cs');
    for (let i = 0; i < 3; i++) {
      transcriptionService.addChunk(mixedOnly(MIXED_WINDOW));
      await vi.waitFor(() => expect(whisperCtx.transcribeData).toHaveBeenCalledTimes(i + 1));
      await vi.waitFor(() => expect(transcriptionService.getProgress().currentSegment).toBe(i + 1));
      // Let the window's persist loop and prompt bookkeeping finish first.
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(persisted().map((p) => p.text)).toEqual([sentence, texts[2]]);
    // The window after the echo got no rolling prompt, breaking the loop.
    expect(whisperCtx.transcribeData.mock.calls[1][1]?.prompt).toBe(sentence);
    expect(whisperCtx.transcribeData.mock.calls[2][1]?.prompt).toBeUndefined();
  });

  it('transcribes the mixed sum alone, unlabelled, when the mic is off', async () => {
    await transcriptionService.start('meeting-mic-off', 'en');
    transcriptionService.addChunk(mixedOnly(MIXED_WINDOW));

    await vi.waitFor(() => expect(meetingService.addTranscriptSegment).toHaveBeenCalledTimes(1));
    expect(transcribedWindows()).toEqual(['mixed']);
    expect(persisted()).toEqual([{ text: 'mixed speech', speaker: null }]);
  });

  it('keeps sending the mixed sum to a cloud provider even when the mic is live', async () => {
    // Per-channel cloud transcription would double the paid minutes of every
    // session, so the split is a local-Whisper-only optimisation.
    vi.mocked(providerService.getConfig).mockResolvedValue({ type: 'deepgram' } as never);
    vi.mocked(providerService.getDecryptedKey).mockResolvedValue('dg-key');
    vi.mocked(deepgramTranscriber.transcribeSegment).mockResolvedValue({
      text: 'cloud speech',
      segments: [{ text: 'cloud speech', startMs: 0, endMs: 1000 }],
    } as never);

    await transcriptionService.start('meeting-cloud', 'en');
    transcriptionService.addChunk(split(MIC_WINDOW, SYSTEM_WINDOW));

    await vi.waitFor(() => expect(deepgramTranscriber.transcribeSegment).toHaveBeenCalledTimes(1));
    expect(vi.mocked(deepgramTranscriber.transcribeSegment).mock.calls[0][0].equals(MIXED_WINDOW)).toBe(true);
    expect(persisted()).toEqual([{ text: 'cloud speech', speaker: null }]);
  });
});

describe('transcriptionService — slower-than-realtime guard', () => {
  // Real-use complaint (2026-11-19): 10 s windows took ~18 s each, two at a
  // time, for the whole call, and the meeting app stuttered.
  let clock = 0;

  /** Every whisper call "takes" `ms` on the mocked clock and returns unique text. */
  function whisperTakes(ms: () => number) {
    let n = 0;
    whisperCtx.transcribeData.mockImplementation(() => {
      const text = `window ${n++}`;
      return {
        promise: Promise.resolve().then(() => {
          clock += ms();
          return { result: text, segments: [{ text, t0: 0, t1: 1000 }], isAborted: false, language: 'en' };
        }),
        stop: vi.fn(),
      };
    });
  }

  /** Feed `count` full mixed windows one at a time, letting each settle. */
  async function feedWindows(count: number, expectWhisperCalls: (fed: number) => number) {
    for (let i = 1; i <= count; i++) {
      transcriptionService.addChunk(mixedOnly(MIXED_WINDOW));
      await vi.waitFor(() => expect(whisperCtx.transcribeData).toHaveBeenCalledTimes(expectWhisperCalls(i)));
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  function fallbackToasts(): string[] {
    return win.webContents.send.mock.calls
      .filter((c) => c[0] === 'transcription:status-changed' && c[1]?.status === 'fallback')
      .map((c) => String(c[1].reason));
  }

  beforeEach(() => {
    clock = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
  });

  afterEach(() => {
    vi.mocked(Date.now).mockRestore();
  });

  it('stays in normal mode while windows finish well inside real time', async () => {
    whisperTakes(() => 2000);
    await transcriptionService.start('meeting-fast', 'en');
    await feedWindows(5, (fed) => fed);

    expect(fallbackToasts()).toEqual([]);
    expect(whisperCtx.transcribeData.mock.calls[4][1]).toMatchObject({ beamSize: 3, bestOf: 3 });
  });

  it('does not step down on slow windows that are not consecutive', async () => {
    const durations = [9000, 9000, 2000, 9000, 9000, 2000];
    let i = 0;
    whisperTakes(() => durations[i++ % durations.length]);
    await transcriptionService.start('meeting-spiky', 'en');
    await feedWindows(6, (fed) => fed);

    expect(fallbackToasts()).toEqual([]);
  });

  it('switches to the fast preset after three consecutive slow windows', async () => {
    whisperTakes(() => 9000);
    await transcriptionService.start('meeting-slow', 'en');
    await feedWindows(4, (fed) => fed);

    expect(whisperCtx.transcribeData.mock.calls[2][1]).toMatchObject({ beamSize: 3, bestOf: 3 });
    expect(whisperCtx.transcribeData.mock.calls[3][1]).toMatchObject({ beamSize: 1, bestOf: 1 });
    expect(fallbackToasts()).toHaveLength(1);
  });

  it('parks speech windows after six slow windows and transcribes them at stop, in order', async () => {
    whisperTakes(() => 9000);
    await transcriptionService.start('meeting-deferred', 'en');
    // Windows 1-6 reach whisper; 7 and 8 are parked.
    await feedWindows(8, (fed) => Math.min(fed, 6));

    expect(fallbackToasts()).toHaveLength(2);
    expect(persisted()).toHaveLength(6);

    await transcriptionService.stop();

    // 8 full windows plus the short flush of the 1 s overlap remainder.
    expect(whisperCtx.transcribeData).toHaveBeenCalledTimes(9);
    expect(persisted().map((p) => p.text)).toEqual(Array.from({ length: 9 }, (_, n) => `window ${n}`));
    // Parked windows keep the offsets they were recorded at.
    const starts = vi.mocked(meetingService.addTranscriptSegment).mock.calls.map((c) => c[2]);
    expect(starts.slice(0, 8)).toEqual([0, 10000, 20000, 30000, 40000, 50000, 60000, 70000]);
  });

  it('starts the next recording back in normal mode', async () => {
    whisperTakes(() => 9000);
    await transcriptionService.start('meeting-a', 'en');
    await feedWindows(4, (fed) => fed);
    await transcriptionService.stop();

    whisperCtx.transcribeData.mockClear();
    whisperTakes(() => 2000);
    await transcriptionService.start('meeting-b', 'en');
    await feedWindows(1, (fed) => fed);
    expect(whisperCtx.transcribeData.mock.calls[0][1]).toMatchObject({ beamSize: 3, bestOf: 3 });
  });
});
