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
        promise: Promise.resolve({ result: text, segments: [{ text, t0: 0, t1: 1000 }], isAborted: false }),
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
