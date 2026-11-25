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
//
// Since 2026-11-25 stopRecording resolves once the WAV is saved and the
// transcript finishes in the background: coverage, the 'completed' flip (main
// now owns it) and `recording:transcript-finished` all come after the return,
// and waitForStopToFinish is what waits for them.

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
  abort: vi.fn().mockResolvedValue(undefined),
  dropQueued: vi.fn(),
  addChunk: vi.fn(),
  getProgress: vi.fn(() => ({})),
  getLastTranscript: vi.fn(() => ''),
  getCoverageTally: vi.fn(() => tally),
  getActiveProvider: vi.fn(() => 'local'),
  getActiveModelName: vi.fn(() => 'whisper-large.bin'),
}));
vi.mock('../meetingService', () => ({
  setTranscriptionCoverage: vi.fn().mockResolvedValue(undefined),
  updateMeeting: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../transcriptResumeService', () => ({
  cancelTranscriptResume: vi.fn().mockResolvedValue(undefined),
  enqueueTranscriptResume: vi.fn(),
  resumePendingTranscripts: vi.fn().mockResolvedValue(undefined),
  setTranscriptFinishedNotifier: vi.fn(),
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
import * as meetingService from '../meetingService';
import * as transcriptResumeService from '../transcriptResumeService';

/** 32,000 bytes of 16 kHz mono Int16 audio = exactly 1,000 ms. */
const ONE_SECOND = Buffer.alloc(32_000);

const MIXED = Buffer.from([1, 2, 3, 4]);
const MIC = Buffer.from([5, 6, 7, 8]);
const SYSTEM = Buffer.from([9, 10, 11, 12]);

/** Let the background transcription start (it waits on a previous finish) settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('audioProcessor.addChunk', () => {
  it('writes ONLY the mixed sum to the WAV while handing every channel to transcription', async () => {
    await audioProcessor.startRecording('meeting-1');
    await settle();
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
    await audioProcessor.waitForStopToFinish();

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
    await audioProcessor.waitForStopToFinish();

    const [, coverage] = vi.mocked(meetingService.setTranscriptionCoverage).mock.calls[0];
    expect(coverage).toMatchObject({ provider: 'deepgram', model: null });
  });

  it('still returns the recording when the coverage write fails', async () => {
    vi.mocked(meetingService.setTranscriptionCoverage).mockRejectedValue(new Error('db is gone'));

    await audioProcessor.startRecording('meeting-writefail');
    audioProcessor.addChunk({ mixed: ONE_SECOND, mic: null, system: ONE_SECOND });

    const audioPath = await audioProcessor.stopRecording();
    await audioProcessor.waitForStopToFinish();

    expect(meetingService.setTranscriptionCoverage).toHaveBeenCalledTimes(1);
    expect(audioPath).toContain('meeting-writefail.wav');
    // The meeting is still completed: its transcript is saved either way.
    expect(meetingService.updateMeeting).toHaveBeenCalledWith('meeting-writefail', { status: 'completed' });
  });
});

describe('audioProcessor.stopRecording — transcript finishes in the background (2026-11-25)', () => {
  const win = { isDestroyed: () => false, webContents: { send: vi.fn() } };

  beforeEach(() => {
    audioProcessor.setMainWindow(win as never);
  });

  it('returns once the audio is saved and completes the meeting only after the transcript', async () => {
    await audioProcessor.startRecording('meeting-bg');
    await settle();
    let releaseFlush!: () => void;
    vi.mocked(transcriptionService.stop).mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseFlush = resolve)),
    );

    const audioPath = await audioProcessor.stopRecording();

    // Stop is back while whisper is still working: nothing is final yet.
    expect(audioPath).toContain('meeting-bg.wav');
    expect(audioProcessor.isStopInFlight()).toBe(true);
    expect(meetingService.updateMeeting).not.toHaveBeenCalled();
    expect(win.webContents.send).not.toHaveBeenCalledWith('recording:transcript-finished', expect.anything());

    releaseFlush();
    await audioProcessor.waitForStopToFinish();

    expect(meetingService.setTranscriptionCoverage).toHaveBeenCalledTimes(1);
    expect(meetingService.updateMeeting).toHaveBeenCalledWith('meeting-bg', { status: 'completed' });
    // Coverage lands BEFORE the completed flip, so the brief hooks read it.
    expect(vi.mocked(meetingService.setTranscriptionCoverage).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(meetingService.updateMeeting).mock.invocationCallOrder[0],
    );
    expect(win.webContents.send).toHaveBeenCalledWith('recording:transcript-finished', { meetingId: 'meeting-bg' });
    expect(audioProcessor.isStopInFlight()).toBe(false);
  });

  it('discard drops the queue, never completes the meeting, and resolves after the pipeline is free', async () => {
    await audioProcessor.startRecording('meeting-cancel');
    await settle();
    let releaseAbort!: () => void;
    vi.mocked(transcriptionService.abort).mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseAbort = resolve)),
    );

    let returned = false;
    const stopping = audioProcessor.stopRecording({ discard: true }).then(() => (returned = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(returned).toBe(false); // the caller deletes the meeting next: wait for the pipeline

    releaseAbort();
    await stopping;
    expect(transcriptionService.stop).not.toHaveBeenCalled();
    expect(meetingService.setTranscriptionCoverage).not.toHaveBeenCalled();
    expect(meetingService.updateMeeting).not.toHaveBeenCalled();
  });

  it('a new recording makes a long finish step aside, and that meeting is resumed after it', async () => {
    // Real use (2026-11-25): an hour-long call's catch-up ran during the next call
    // and the next call's transcript queued behind it.
    await audioProcessor.startRecording('meeting-long');
    await settle();
    audioProcessor.addChunk({ mixed: ONE_SECOND, mic: null, system: ONE_SECOND });
    let releaseFlush!: () => void;
    vi.mocked(transcriptionService.stop).mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseFlush = resolve)),
    );
    await audioProcessor.stopRecording();

    await audioProcessor.startRecording('meeting-next');
    expect(transcriptionService.dropQueued).toHaveBeenCalledTimes(1);
    releaseFlush(); // the window in flight finishes

    await vi.waitFor(() => expect(transcriptionService.start).toHaveBeenLastCalledWith('meeting-next', undefined));
    // Not completed and no coverage now: the rest is queued for after this call.
    expect(meetingService.updateMeeting).not.toHaveBeenCalledWith('meeting-long', expect.anything());
    expect(meetingService.setTranscriptionCoverage).not.toHaveBeenCalledWith('meeting-long', expect.anything());
    expect(transcriptResumeService.enqueueTranscriptResume).toHaveBeenCalledWith([
      {
        meetingId: 'meeting-long',
        wavPath: expect.stringContaining('meeting-long.wav'),
        lastSegmentEndMs: 0,
        audioMs: 1_000,
        markCompleted: true,
      },
    ]);
    expect(transcriptResumeService.resumePendingTranscripts).not.toHaveBeenCalled();

    // The new call ends and finishes: now the paused meeting continues.
    await audioProcessor.stopRecording();
    await audioProcessor.waitForStopToFinish();
    expect(meetingService.updateMeeting).toHaveBeenCalledWith('meeting-next', { status: 'completed' });
    expect(transcriptResumeService.resumePendingTranscripts).toHaveBeenCalledTimes(1);
  });

  it('a new recording waits for the window still in flight and loses none of its own audio', async () => {
    await audioProcessor.startRecording('meeting-old');
    await settle();
    let releaseFlush!: () => void;
    vi.mocked(transcriptionService.stop).mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseFlush = resolve)),
    );
    await audioProcessor.stopRecording();
    vi.mocked(transcriptionService.start).mockClear();
    vi.mocked(transcriptionService.addChunk).mockClear();

    await audioProcessor.startRecording('meeting-new');
    const first = { mixed: Buffer.from([1, 1]), mic: null, system: Buffer.from([1, 1]) };
    const second = { mixed: Buffer.from([2, 2]), mic: null, system: Buffer.from([2, 2]) };
    audioProcessor.addChunk(first);
    audioProcessor.addChunk(second);
    await settle();

    // The pipeline still belongs to the old meeting: the new one has not started on it.
    expect(transcriptionService.start).not.toHaveBeenCalled();
    expect(transcriptionService.addChunk).not.toHaveBeenCalled();

    releaseFlush();
    await audioProcessor.waitForStopToFinish();
    await settle();

    expect(transcriptionService.start).toHaveBeenCalledWith('meeting-new', undefined);
    expect(vi.mocked(transcriptionService.addChunk).mock.calls.map((c) => c[0])).toEqual([first, second]);

    await audioProcessor.stopRecording();
    await audioProcessor.waitForStopToFinish();
  });
});

describe('audioProcessor.waitForStopToFinish (UPDATER-SAFE.1)', () => {
  it('resolves only after an in-flight stop has finished flushing, so shutdown closes the DB after it', async () => {
    await audioProcessor.startRecording('meeting-flush');
    let releaseFlush!: () => void;
    vi.mocked(transcriptionService.stop).mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseFlush = resolve)),
    );

    const stopping = audioProcessor.stopRecording();
    let waited = false;
    const waiting = audioProcessor.waitForStopToFinish().then(() => (waited = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(audioProcessor.isRecording()).toBe(false); // the stop has begun...
    expect(waited).toBe(false); // ...but the flush is still running

    releaseFlush();
    await stopping;
    await waiting;
    expect(waited).toBe(true);
  });

  it('resolves at once when nothing is stopping', async () => {
    await expect(audioProcessor.waitForStopToFinish()).resolves.toBeUndefined();
  });
});

describe('audioProcessor during shutdown (UPDATER-SAFE.1 review round 2)', () => {
  it('a rejected second stop does not hide the first, still-flushing stop', async () => {
    await audioProcessor.startRecording('meeting-double-stop');
    let releaseFlush!: () => void;
    vi.mocked(transcriptionService.stop).mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseFlush = resolve)),
    );
    const first = audioProcessor.stopRecording();
    await expect(audioProcessor.stopRecording()).rejects.toThrow(/Not currently recording/);

    let waited = false;
    const waiting = audioProcessor.waitForStopToFinish().then(() => (waited = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(waited).toBe(false); // still waiting on the FIRST stop

    releaseFlush();
    await first;
    await waiting;
    expect(waited).toBe(true);
  });

  it('refuses to start a recording once shutdown has begun', async () => {
    audioProcessor.blockNewRecordings();
    await expect(audioProcessor.startRecording('meeting-too-late')).rejects.toThrow(/shutting down/);
    expect(audioProcessor.isRecording()).toBe(false);
  });
});
