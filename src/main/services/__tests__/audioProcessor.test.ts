// === FILE PURPOSE ===
// Unit test for the audio fan-out in audioProcessor (SPEAKER.1 Task 1). The
// phase's first hard contract is that the WAV at <recordingsDir>/<meetingId>.wav
// stays BYTE-IDENTICAL to pre-SPEAKER.1 recordings — the cloud diarize path,
// audio:saveRecordings and any future local diarization all read that file — so
// only the mono `mixed` sum may ever be written to it, no matter how many
// channels transcription is given.
//
// Since TRANS-COV.1 the stop also persists the session's transcription coverage
// onto the meeting row, BEFORE the renderer flips the meeting to `completed`.
// Two contracts are pinned below: the record says what actually ran (the live
// tally, the provider/model of this session, and the REAL audio length from the
// WAV byte count), and a coverage write that fails can never fail the stop --
// a recording that was made and saved is not reported as failed because its
// bookkeeping could not be written.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const wavHandle = vi.hoisted(() => ({
  write: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
}));

/** A live tally with something in every shape the record has to carry through. */
const tally = vi.hoisted(() => {
  const zero = { windows: 0, saved: 0, silentRms: 0, silentVad: 0, droppedHallucination: 0, failed: 0 };
  return {
    channels: {
      mic: { windows: 3, saved: 1, silentRms: 1, silentVad: 0, droppedHallucination: 0, failed: 1 },
      system: { ...zero },
      mixed: { ...zero },
    },
    gaps: [{ startMs: 10_000, endMs: 20_000, channel: 'mic', reason: 'failed' }],
    // Whisper decoded three saved windows as Czech and one as English: the
    // record must name Czech as the language the transcript is in.
    languages: { cs: 3, en: 1 },
  };
});

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
  getCoverageTally: vi.fn(() => tally),
  getActiveProvider: vi.fn(() => 'local'),
  getActiveModelName: vi.fn(() => 'whisper-large.bin'),
}));
vi.mock('../meetingService', () => ({ setTranscriptionCoverage: vi.fn().mockResolvedValue(undefined) }));
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
import * as meetingService from '../meetingService';

/** 32,000 bytes of 16 kHz mono Int16 audio = exactly 1,000 ms. */
const ONE_SECOND = Buffer.alloc(32_000);

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

describe('audioProcessor.stopRecording — transcription coverage', () => {
  it('persists what the session actually did, with the audio length taken from the WAV', async () => {
    await audioProcessor.startRecording('meeting-cov');
    audioProcessor.addChunk({ mixed: ONE_SECOND, mic: null, system: ONE_SECOND });
    audioProcessor.addChunk({ mixed: ONE_SECOND, mic: null, system: ONE_SECOND });

    await audioProcessor.stopRecording();

    expect(meetingService.setTranscriptionCoverage).toHaveBeenCalledTimes(1);
    const [meetingId, coverage] = vi.mocked(meetingService.setTranscriptionCoverage).mock.calls[0];
    expect(meetingId).toBe('meeting-cov');
    expect(coverage).toEqual({
      version: 1,
      endedBy: 'stop',
      // 64,000 bytes of audio at 32 bytes/ms — the REAL length, not the
      // transcript's own timeline, which runs 1 s per window fast (ISSUES #40).
      audioMs: 2_000,
      provider: 'local',
      model: 'whisper-large.bin',
      windowStampMs: 10_000,
      windowAdvanceMs: 9_000,
      channels: tally.channels,
      gaps: tally.gaps,
      retranscribed: [],
      languages: { cs: 3, en: 1 },
      detectedLanguage: 'cs',
    });
  });

  it('reads the provider BEFORE the flush, because stop() resets it', async () => {
    // stop() puts the service back to its defaults for the next recording, so a
    // record built afterwards would name the wrong provider on every cloud session.
    vi.mocked(transcriptionService.stop).mockImplementation(async () => {
      vi.mocked(transcriptionService.getActiveProvider).mockReturnValue('local' as never);
      vi.mocked(transcriptionService.getActiveModelName).mockReturnValue(null);
    });
    vi.mocked(transcriptionService.getActiveProvider).mockReturnValue('deepgram' as never);
    vi.mocked(transcriptionService.getActiveModelName).mockReturnValue(null);

    await audioProcessor.startRecording('meeting-cloud');
    await audioProcessor.stopRecording();

    const [, coverage] = vi.mocked(meetingService.setTranscriptionCoverage).mock.calls[0];
    expect(coverage).toMatchObject({ provider: 'deepgram', model: null });
  });

  it('still returns the recording when the coverage write fails', async () => {
    vi.mocked(meetingService.setTranscriptionCoverage).mockRejectedValue(new Error('db is gone'));

    await audioProcessor.startRecording('meeting-writefail');
    audioProcessor.addChunk({ mixed: ONE_SECOND, mic: null, system: ONE_SECOND });

    const audioPath = await audioProcessor.stopRecording();

    expect(meetingService.setTranscriptionCoverage).toHaveBeenCalledTimes(1);
    expect(audioPath).toContain('meeting-writefail.wav');
  });
});
