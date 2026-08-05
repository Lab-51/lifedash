// === FILE PURPOSE ===
// Unit tests for the VAD gate in the transcription dispatch loop
// (TRANS-HALL.1 Task 3). The gate is SKIP-ONLY, so these tests pin both halves
// of that contract:
//   - a window with no detected speech is skipped whole (nothing transcribed,
//     progress still increments, exactly like the RMS skip), and
//   - a window with any detected speech reaches transcribeData with the FULL,
//     byte-identical window — never a trimmed or remapped one.
// Plus the degradation contract: model unavailable / context init rejecting /
// detection throwing must all fall back to today's RMS-only pipeline, logged
// once, with no unhandled rejection — and, per the "presence is not execution"
// rule, the disabled path is proven to call nothing rather than merely not
// crash. The RMS fast path must still short-circuit before VAD is ever touched.
//
// The whisper/VAD contexts, provider service, DB and cloud transcribers are
// mocked; the real dispatch loop (RMS check, concurrency, progress) runs.

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
vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));
vi.mock('../../db/schema', () => ({
  settings: { __table: 'settings', key: 'key', value: 'value' },
  aiUsage: { __table: 'aiUsage' },
}));
vi.mock('drizzle-orm', () => ({ eq: (...a: unknown[]) => ({ eq: a }) }));

import * as transcriptionService from '../transcriptionService';
import * as providerService from '../transcriptionProviderService';
import * as whisperModelManager from '../whisperModelManager';

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

// RMS 3000 clears the SILENCE_RMS_THRESHOLD of 50; RMS 0 does not.
const SPEECH_WINDOW = makeWindow(3000);
const SILENT_WINDOW = makeWindow(0);

// Declared with the native signature so `mock.calls[0][0]` stays typed as the
// ArrayBuffer the skip-only assertion inspects.
type TranscribeData = (
  audio: ArrayBuffer,
  options?: Record<string, unknown>,
) => { promise: Promise<unknown>; stop: () => void };

function makeWhisperContext() {
  return {
    transcribeData: vi.fn<TranscribeData>(() => ({
      promise: Promise.resolve({ result: '', segments: [], isAborted: false }),
      stop: vi.fn(),
    })),
    release: vi.fn().mockResolvedValue(undefined),
  };
}

function makeVadContext(segments: Array<{ t0: number; t1: number }>) {
  return {
    detectSpeechData: vi.fn().mockResolvedValue(segments),
    release: vi.fn().mockResolvedValue(undefined),
  };
}

function makeWindowStub() {
  return { webContents: { send: vi.fn() }, isDestroyed: () => false };
}

/** Warnings emitted by the VAD gate's single-shot disable path. */
function vadWarnings(): unknown[][] {
  return logMock.warn.mock.calls.filter((call) => String(call[0]).includes('RMS-only'));
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
  vi.mocked(whisperModelManager.ensureVadModel).mockResolvedValue('/models/ggml-silero-v5.1.2.bin');
});

afterEach(async () => {
  await transcriptionService.stop();
});

describe('transcriptionService — VAD gate', () => {
  it('(a) skips a window that passes RMS but has no detected speech, still counting progress', async () => {
    const vadCtx = makeVadContext([]);
    vi.mocked(whisperModelManager.createVadContext).mockResolvedValue({ context: vadCtx, backend: 'cpu' } as never);

    await transcriptionService.start('meeting-a', 'en');
    transcriptionService.addChunk(SPEECH_WINDOW);

    // Progress advances for the skipped window exactly as the RMS skip does…
    await vi.waitFor(() => expect(transcriptionService.getProgress().currentSegment).toBe(1));
    expect(vadCtx.detectSpeechData).toHaveBeenCalledTimes(1);
    // …and nothing was transcribed, persisted or pushed.
    expect(whisperCtx.transcribeData).not.toHaveBeenCalled();
    expect(win.webContents.send).not.toHaveBeenCalledWith('recording:transcript-segment', expect.anything());
    expect(win.webContents.send).toHaveBeenCalledWith(
      'recording:processing-progress',
      expect.objectContaining({ phase: 'transcribing', currentSegment: 1, totalSegments: 1 }),
    );
  });

  it('(b) transcribes the FULL unmodified window when any speech is detected', async () => {
    const vadCtx = makeVadContext([{ t0: 120, t1: 480 }]);
    vi.mocked(whisperModelManager.createVadContext).mockResolvedValue({ context: vadCtx, backend: 'cpu' } as never);

    await transcriptionService.start('meeting-b', 'en');
    transcriptionService.addChunk(SPEECH_WINDOW);

    await vi.waitFor(() => expect(whisperCtx.transcribeData).toHaveBeenCalledTimes(1));

    // Skip-only: the detected 120–480 ms span must NOT have trimmed the audio.
    const audio = whisperCtx.transcribeData.mock.calls[0][0];
    expect(audio.byteLength).toBe(BYTES_PER_SEGMENT);
    expect(Buffer.from(new Uint8Array(audio)).equals(SPEECH_WINDOW)).toBe(true);
  });

  it('(c) falls back to RMS-only when VAD context creation rejects, warning once', async () => {
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown): void => void rejections.push(reason);
    process.on('unhandledRejection', onUnhandled);

    try {
      vi.mocked(whisperModelManager.createVadContext).mockRejectedValue(new Error('vad init boom'));

      await transcriptionService.start('meeting-c', 'en');
      transcriptionService.addChunk(SPEECH_WINDOW);
      transcriptionService.addChunk(SPEECH_WINDOW);

      // Both windows still transcribe — a VAD failure never drops audio.
      await vi.waitFor(() => expect(whisperCtx.transcribeData).toHaveBeenCalledTimes(2));
      // Init is not retried per window, and the fallback is announced once.
      expect(whisperModelManager.createVadContext).toHaveBeenCalledTimes(1);
      expect(vadWarnings()).toHaveLength(1);

      // Let Node surface any unhandled rejection before asserting there is none.
      await new Promise((resolve) => setImmediate(resolve));
      expect(rejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('(d) releases the VAD context on stop()', async () => {
    const vadCtx = makeVadContext([{ t0: 0, t1: 1000 }]);
    vi.mocked(whisperModelManager.createVadContext).mockResolvedValue({ context: vadCtx, backend: 'cpu' } as never);

    await transcriptionService.start('meeting-d', 'en');
    transcriptionService.addChunk(SPEECH_WINDOW);
    await vi.waitFor(() => expect(vadCtx.detectSpeechData).toHaveBeenCalled());

    await transcriptionService.stop();

    expect(vadCtx.release).toHaveBeenCalledTimes(1);
    expect(whisperCtx.release).toHaveBeenCalledTimes(1);
  });

  it('does not touch VAD at all when the model is unavailable', async () => {
    vi.mocked(whisperModelManager.ensureVadModel).mockResolvedValue(null);

    await transcriptionService.start('meeting-null-model', 'en');
    transcriptionService.addChunk(SPEECH_WINDOW);

    await vi.waitFor(() => expect(whisperCtx.transcribeData).toHaveBeenCalledTimes(1));
    // Presence is not execution: no context is created, and only one warning.
    expect(whisperModelManager.createVadContext).not.toHaveBeenCalled();
    expect(vadWarnings()).toHaveLength(1);
  });

  it('never reaches VAD for a window the RMS fast path already rejects', async () => {
    const vadCtx = makeVadContext([]);
    vi.mocked(whisperModelManager.createVadContext).mockResolvedValue({ context: vadCtx, backend: 'cpu' } as never);

    await transcriptionService.start('meeting-rms', 'en');
    transcriptionService.addChunk(SILENT_WINDOW);

    await vi.waitFor(() => expect(transcriptionService.getProgress().currentSegment).toBe(1));
    expect(whisperModelManager.ensureVadModel).not.toHaveBeenCalled();
    expect(vadCtx.detectSpeechData).not.toHaveBeenCalled();
    expect(whisperCtx.transcribeData).not.toHaveBeenCalled();
  });

  it('creates the VAD context once when two concurrent windows race on first use', async () => {
    let resolveModelPath: (value: string) => void = () => {};
    vi.mocked(whisperModelManager.ensureVadModel).mockReturnValue(
      new Promise<string>((resolve) => {
        resolveModelPath = resolve;
      }),
    );
    const vadCtx = makeVadContext([{ t0: 0, t1: 1000 }]);
    vi.mocked(whisperModelManager.createVadContext).mockResolvedValue({ context: vadCtx, backend: 'cpu' } as never);

    await transcriptionService.start('meeting-race', 'en');
    // MAX_CONCURRENT is 2, so both windows are in flight while init is pending.
    transcriptionService.addChunk(SPEECH_WINDOW);
    transcriptionService.addChunk(SPEECH_WINDOW);
    resolveModelPath('/models/ggml-silero-v5.1.2.bin');

    await vi.waitFor(() => expect(vadCtx.detectSpeechData).toHaveBeenCalledTimes(2));
    expect(whisperModelManager.createVadContext).toHaveBeenCalledTimes(1);
  });
});
