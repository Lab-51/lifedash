// === FILE PURPOSE ===
// Unit test for the audio fan-out in audioProcessor (SPEAKER.1 Task 1). The
// phase's first hard contract is that the WAV at <recordingsDir>/<meetingId>.wav
// stays BYTE-IDENTICAL to pre-SPEAKER.1 recordings — the cloud diarize path,
// audio:saveRecordings and any future local diarization all read that file — so
// only the mono `mixed` sum may ever be written to it, no matter how many
// channels transcription is given.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const wavHandle = vi.hoisted(() => ({
  write: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('electron', () => ({
  app: { getPath: () => '/userData' },
  BrowserWindow: class {},
}));
vi.mock('node:fs', () => ({ default: { mkdirSync: vi.fn() } }));
vi.mock('node:fs/promises', () => ({ open: vi.fn().mockResolvedValue(wavHandle) }));
vi.mock('../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../wavUtils', () => ({ createWavHeader: () => Buffer.alloc(44) }));
vi.mock('../transcriptionService', () => ({
  setMainWindow: vi.fn(),
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  addChunk: vi.fn(),
  getProgress: vi.fn(() => ({})),
  getLastTranscript: vi.fn(() => ''),
}));
vi.mock('../liveTriageService', () => ({
  setMainWindow: vi.fn(),
  startTriage: vi.fn(),
  stopTriage: vi.fn(),
}));
vi.mock('../recordingState', () => ({ setActiveMeetingId: vi.fn() }));
vi.mock('../recordingModelPin', () => ({
  pinChatModelForRecording: vi.fn().mockResolvedValue(undefined),
  releaseChatModelPin: vi.fn(),
}));
vi.mock('../../db/connection', () => ({
  // No `audio:saveRecordings` row → the default (save enabled) applies.
  getDb: () => ({ select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) }),
}));
vi.mock('../../db/schema', () => ({ settings: { key: 'key', value: 'value' } }));
vi.mock('drizzle-orm', () => ({ eq: (...a: unknown[]) => ({ eq: a }) }));

import * as audioProcessor from '../audioProcessor';
import * as transcriptionService from '../transcriptionService';

const MIXED = Buffer.from([1, 2, 3, 4]);
const MIC = Buffer.from([5, 6, 7, 8]);
const SYSTEM = Buffer.from([9, 10, 11, 12]);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('audioProcessor.addChunk', () => {
  it('writes ONLY the mixed sum to the WAV while handing every channel to transcription', async () => {
    await audioProcessor.startRecording('meeting-1');
    wavHandle.write.mockClear(); // drop the placeholder header write

    audioProcessor.addChunk({ mixed: MIXED, mic: MIC, system: SYSTEM });

    // The file on disk sees the mono sum and nothing else.
    expect(wavHandle.write).toHaveBeenCalledTimes(1);
    expect(wavHandle.write.mock.calls[0][0]).toBe(MIXED);

    // Transcription sees all three channels.
    expect(transcriptionService.addChunk).toHaveBeenCalledWith({ mixed: MIXED, mic: MIC, system: SYSTEM });

    await audioProcessor.stopRecording();
  });
});
