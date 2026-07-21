// === FILE PURPOSE ===
// Unit tests for the local-only ENFORCEMENT in transcriptionService.start()
// (GUARD.1 Task 4). Proves that when local-only is on and a cloud provider is
// configured, start() forces the local Whisper path for the whole session:
//   - it NEVER reaches the cloud key/dispatch path (getDecryptedKey is not called),
//   - it initializes the local Whisper context instead,
//   - it emits one renderer-visible 'fallback' status (→ info toast).
// The control case (local-only OFF + cloud provider) proves the cloud path is still
// taken. The provider service, whisper manager, DB and cloud transcribers are mocked.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../transcriptionProviderService', () => ({
  getConfig: vi.fn(),
  isLocalOnly: vi.fn(),
  getDecryptedKey: vi.fn(),
}));
vi.mock('../whisperModelManager', () => ({
  getDefaultModelPath: vi.fn(),
  createWhisperContext: vi.fn(),
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
import { getDb } from '../../db/connection';

// A DB that resolves [] for every settings read (→ language/preset defaults).
function makeEmptyDb() {
  const q: Record<string, unknown> = {
    where: () => q,
    limit: () => q,
    then: (res: (v: unknown[]) => unknown, rej: (e: unknown) => unknown) => Promise.resolve([]).then(res, rej),
  };
  return { select: () => ({ from: () => q }) };
}

function makeWindow() {
  return {
    webContents: { send: vi.fn() },
    isDestroyed: () => false,
  };
}

let win: ReturnType<typeof makeWindow>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDb).mockReturnValue(makeEmptyDb() as never);
  win = makeWindow();
  transcriptionService.setMainWindow(win as never);
  // A fake whisper context so the local init path succeeds.
  vi.mocked(whisperModelManager.getDefaultModelPath).mockResolvedValue('/models/whisper.bin');
  vi.mocked(whisperModelManager.createWhisperContext).mockResolvedValue({
    context: { release: vi.fn().mockResolvedValue(undefined), transcribeData: vi.fn() },
    backend: 'cpu',
  } as never);
});

afterEach(async () => {
  // Release any context + reset module state between tests.
  await transcriptionService.stop();
});

describe('transcriptionService.start — local-only enforcement', () => {
  it('forces the local Whisper path and never touches the cloud key path when local-only is on', async () => {
    vi.mocked(providerService.getConfig).mockResolvedValue({ type: 'deepgram' } as never);
    vi.mocked(providerService.isLocalOnly).mockResolvedValue(true);

    await transcriptionService.start('meeting-1');

    // Cloud key/dispatch path was NOT taken…
    expect(providerService.getDecryptedKey).not.toHaveBeenCalled();
    // …the local Whisper context was initialized instead…
    expect(whisperModelManager.getDefaultModelPath).toHaveBeenCalled();
    expect(whisperModelManager.createWhisperContext).toHaveBeenCalled();
    // …and one renderer-visible fallback status was emitted.
    expect(win.webContents.send).toHaveBeenCalledWith(
      'transcription:status-changed',
      expect.objectContaining({
        status: 'fallback',
        reason: expect.stringContaining('Local-only mode is on'),
      }),
    );
  });

  it('still takes the cloud path when local-only is OFF (existing users unaffected)', async () => {
    vi.mocked(providerService.getConfig).mockResolvedValue({ type: 'deepgram' } as never);
    vi.mocked(providerService.isLocalOnly).mockResolvedValue(false);
    vi.mocked(providerService.getDecryptedKey).mockResolvedValue('dg-key');

    await transcriptionService.start('meeting-2');

    // Cloud path taken: the key was read, no local context, no fallback toast.
    expect(providerService.getDecryptedKey).toHaveBeenCalledWith('deepgram');
    expect(whisperModelManager.createWhisperContext).not.toHaveBeenCalled();
    expect(win.webContents.send).not.toHaveBeenCalledWith(
      'transcription:status-changed',
      expect.objectContaining({ status: 'fallback' }),
    );
  });
});
