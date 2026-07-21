// === FILE PURPOSE ===
// Enforcement tests for the SECOND cloud-dispatch site: the voice:transcribe IPC
// handler reaches the Deepgram/AssemblyAI transcribers independently of
// transcriptionService (GUARD.1 Task 4). Proves that when local-only is on, voice
// input NEVER reaches a cloud transcriber — it falls back to local Whisper — while
// the control case (local-only off) still dispatches to the cloud transcriber.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
      registeredHandlers.set(channel, fn);
    }),
  },
}));
vi.mock('../../services/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../services/transcriptionProviderService', () => ({
  getConfig: vi.fn(),
  isLocalOnly: vi.fn(),
}));
vi.mock('../../services/whisperModelManager', () => ({
  getDefaultModelPath: vi.fn(),
  createWhisperContext: vi.fn(),
}));
vi.mock('../../services/deepgramTranscriber', () => ({ transcribeSegment: vi.fn() }));
vi.mock('../../services/assemblyaiTranscriber', () => ({ transcribeSegment: vi.fn() }));
vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));
vi.mock('../../db/schema', () => ({ settings: { __table: 'settings', key: 'key', value: 'value' } }));
vi.mock('drizzle-orm', () => ({ eq: (...a: unknown[]) => ({ eq: a }) }));

import { registerVoiceInputHandlers } from '../voice-input';
import * as providerService from '../../services/transcriptionProviderService';
import * as whisperModelManager from '../../services/whisperModelManager';
import * as deepgramTranscriber from '../../services/deepgramTranscriber';
import { getDb } from '../../db/connection';

// A DB that resolves [] for the language read (→ default 'en').
function makeEmptyDb() {
  const q: Record<string, unknown> = {
    where: () => q,
    then: (res: (v: unknown[]) => unknown, rej: (e: unknown) => unknown) => Promise.resolve([]).then(res, rej),
  };
  return { select: () => ({ from: () => q }) };
}

beforeAll(() => {
  registerVoiceInputHandlers();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDb).mockReturnValue(makeEmptyDb() as never);
});

function invoke(buffer: Buffer) {
  const handler = registeredHandlers.get('voice:transcribe')!;
  return handler({}, buffer);
}

describe('voice:transcribe — local-only enforcement (second dispatch site)', () => {
  it('never reaches the cloud transcriber when local-only is on — uses local Whisper', async () => {
    vi.mocked(providerService.getConfig).mockResolvedValue({ type: 'deepgram' } as never);
    vi.mocked(providerService.isLocalOnly).mockResolvedValue(true);
    vi.mocked(whisperModelManager.getDefaultModelPath).mockResolvedValue('/models/whisper.bin');
    vi.mocked(whisperModelManager.createWhisperContext).mockResolvedValue({
      context: {
        transcribeData: vi.fn(() => ({ promise: Promise.resolve({ result: 'local hello' }) })),
        release: vi.fn().mockResolvedValue(undefined),
      },
      backend: 'cpu',
    } as never);

    const result = (await invoke(Buffer.alloc(2000))) as { text: string };

    expect(deepgramTranscriber.transcribeSegment).not.toHaveBeenCalled();
    expect(whisperModelManager.createWhisperContext).toHaveBeenCalled();
    expect(result.text).toBe('local hello');
  });

  it('still dispatches to the cloud transcriber when local-only is OFF', async () => {
    vi.mocked(providerService.getConfig).mockResolvedValue({ type: 'deepgram' } as never);
    vi.mocked(providerService.isLocalOnly).mockResolvedValue(false);
    vi.mocked(deepgramTranscriber.transcribeSegment).mockResolvedValue({
      text: 'cloud hello',
      segments: [],
    } as never);

    const result = (await invoke(Buffer.alloc(2000))) as { text: string };

    expect(deepgramTranscriber.transcribeSegment).toHaveBeenCalledTimes(1);
    expect(whisperModelManager.createWhisperContext).not.toHaveBeenCalled();
    expect(result.text).toBe('cloud hello');
  });
});
