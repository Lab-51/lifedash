// === FILE PURPOSE ===
// transcriptResumeService finishes, on the next launch, a transcript the previous
// process did not finish (2026-11-25). Pinned here: where it picks up (the window
// after the last saved row, read from that window's AUDIO offset in the WAV, with
// the original stamped index), that a stopped meeting is completed only once its
// transcript is whole, and that a cancel (a live recording needs the pipeline)
// leaves the meeting untouched for the next launch.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const wav = vi.hoisted(() => ({ bytes: Buffer.alloc(0), reads: [] as number[] }));

vi.mock('node:fs/promises', () => ({
  open: vi.fn(async () => ({
    read: vi.fn(async (buf: Buffer, offset: number, length: number, position: number) => {
      wav.reads.push(position);
      const bytesRead = Math.max(0, Math.min(length, wav.bytes.length - position));
      wav.bytes.copy(buf, offset, position, position + bytesRead);
      return { bytesRead };
    }),
    close: vi.fn(async () => undefined),
  })),
}));
vi.mock('../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../transcriptionService', () => ({
  isActive: vi.fn(() => false),
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  abort: vi.fn().mockResolvedValue(undefined),
  addChunk: vi.fn(),
  getBacklog: vi.fn(() => 0),
  getActiveProvider: vi.fn(() => 'local'),
  getActiveModelName: vi.fn(() => 'ggml-large-v3-turbo-q5_0.bin'),
  getCoverageTally: vi.fn(() => ({
    channels: {
      mic: { windows: 0, saved: 0, silentRms: 0, silentVad: 0, droppedHallucination: 0, failed: 0 },
      system: { windows: 0, saved: 0, silentRms: 0, silentVad: 0, droppedHallucination: 0, failed: 0 },
      mixed: { windows: 4, saved: 3, silentRms: 1, silentVad: 0, droppedHallucination: 0, failed: 0 },
    },
    gaps: [],
    languages: { cs: 3 },
  })),
}));
vi.mock('../meetingService', () => ({
  getMeeting: vi.fn(async () => ({ id: 'm1', transcriptionLanguage: 'cs' })),
  updateMeeting: vi.fn().mockResolvedValue(undefined),
  setTranscriptionCoverage: vi.fn().mockResolvedValue(undefined),
}));

import * as transcriptionService from '../transcriptionService';
import * as meetingService from '../meetingService';
import {
  cancelTranscriptResume,
  enqueueTranscriptResume,
  firstUnfinishedWindow,
  resumePendingTranscripts,
  scheduleTranscriptResume,
  setTranscriptFinishedNotifier,
} from '../transcriptResumeService';

const HEADER = 44;
const BYTES_PER_MS = 32;

/** A WAV of `seconds` of audio whose every byte says which second it belongs to. */
function wavOfSeconds(seconds: number): void {
  const bytes = Buffer.alloc(HEADER + seconds * 1000 * BYTES_PER_MS);
  for (let s = 0; s < seconds; s++) bytes.fill(s % 256, HEADER + s * 32_000, HEADER + (s + 1) * 32_000);
  wav.bytes = bytes;
  wav.reads = [];
}

const job = (over: Partial<Parameters<typeof scheduleTranscriptResume>[0][number]> = {}) => ({
  meetingId: 'm1',
  wavPath: 'C:\\rec\\m1.wav',
  lastSegmentEndMs: 0,
  audioMs: 60_000,
  markCompleted: true,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('firstUnfinishedWindow', () => {
  it('starts at the window after the one holding the last saved row', () => {
    expect(firstUnfinishedWindow(0)).toBe(0);
    expect(firstUnfinishedWindow(9_500)).toBe(1); // row inside window 0
    expect(firstUnfinishedWindow(10_000)).toBe(1); // row ending exactly at window 0's end
    expect(firstUnfinishedWindow(24_000)).toBe(3); // row inside window 2
  });
});

describe('scheduleTranscriptResume', () => {
  it('feeds the WAV from the next window audio offset and keeps the stamped index', async () => {
    wavOfSeconds(60);

    await scheduleTranscriptResume([job({ lastSegmentEndMs: 24_000 })], 0);

    // Window 3 is stamped 30 s but its audio starts at 3 x 9 s = 27 s.
    expect(transcriptionService.start).toHaveBeenCalledWith('m1', 'cs', { firstSegmentIndex: 3, batch: true });
    expect(wav.reads[0]).toBe(HEADER + 27_000 * BYTES_PER_MS);
    const fed = vi.mocked(transcriptionService.addChunk).mock.calls.map((c) => c[0]);
    expect(fed).toHaveLength(33); // seconds 27..59
    expect(fed[0].mixed[0]).toBe(27);
    expect(fed[0].mic).toBeNull();
    expect(transcriptionService.stop).toHaveBeenCalledTimes(1);
  });

  it('completes a stopped meeting only after the transcript, with honest coverage', async () => {
    wavOfSeconds(30);

    await scheduleTranscriptResume([job({ audioMs: 30_000 })], 0);

    expect(meetingService.setTranscriptionCoverage).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ endedBy: 'recovered', audioMs: 30_000, provider: 'local', detectedLanguage: 'cs' }),
    );
    expect(meetingService.updateMeeting).toHaveBeenCalledWith('m1', { status: 'completed' });
    expect(vi.mocked(transcriptionService.stop).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(meetingService.updateMeeting).mock.invocationCallOrder[0],
    );
  });

  it('does not complete a crashed meeting (recovery already closed it, without a brief)', async () => {
    wavOfSeconds(30);

    await scheduleTranscriptResume([job({ audioMs: 30_000, markCompleted: false })], 0);

    expect(transcriptionService.stop).toHaveBeenCalledTimes(1);
    expect(meetingService.updateMeeting).not.toHaveBeenCalled();
  });

  it('skips transcription when nothing is left but still completes a stopped meeting', async () => {
    wavOfSeconds(30);

    await scheduleTranscriptResume([job({ lastSegmentEndMs: 39_000, audioMs: 30_000 })], 0);

    expect(transcriptionService.start).not.toHaveBeenCalled();
    expect(meetingService.updateMeeting).toHaveBeenCalledWith('m1', { status: 'completed' });
  });

  it('picks up after the newest saved row, even past what the job was created with', async () => {
    wavOfSeconds(60);
    vi.mocked(meetingService.getMeeting).mockResolvedValueOnce({
      id: 'm1',
      transcriptionLanguage: 'cs',
      segments: [{ endTime: 9_000 }, { endTime: 34_000 }],
    } as never);

    await scheduleTranscriptResume([job({ lastSegmentEndMs: 0 })], 0);

    expect(transcriptionService.start).toHaveBeenCalledWith('m1', 'cs', { firstSegmentIndex: 4, batch: true });
  });

  it('a queued job waits for resumePendingTranscripts and then tells the renderer', async () => {
    wavOfSeconds(30);
    const notify = vi.fn();
    setTranscriptFinishedNotifier(notify);

    enqueueTranscriptResume([job({ audioMs: 30_000 })]);
    expect(transcriptionService.start).not.toHaveBeenCalled(); // a recording owns the pipeline

    await resumePendingTranscripts();
    expect(meetingService.updateMeeting).toHaveBeenCalledWith('m1', { status: 'completed' });
    expect(notify).toHaveBeenCalledWith('m1');
    setTranscriptFinishedNotifier(null);
  });

  it('a cancelled job stays queued and finishes on the next run', async () => {
    wavOfSeconds(60);
    vi.mocked(transcriptionService.getBacklog).mockReturnValueOnce(0).mockReturnValue(5);
    const run = scheduleTranscriptResume([job()], 0);
    await vi.waitFor(() => expect(transcriptionService.addChunk).toHaveBeenCalledTimes(1));
    await cancelTranscriptResume();
    await run;
    expect(meetingService.updateMeeting).not.toHaveBeenCalled();

    vi.mocked(transcriptionService.getBacklog).mockReturnValue(0);
    await resumePendingTranscripts();
    expect(meetingService.updateMeeting).toHaveBeenCalledWith('m1', { status: 'completed' });
  });

  it('a cancel aborts the pipeline and leaves the meeting for the next launch', async () => {
    wavOfSeconds(60);
    // One chunk goes in, then whisper is "busy": the feeder waits, so the cancel lands mid-run.
    vi.mocked(transcriptionService.getBacklog).mockReturnValueOnce(0).mockReturnValue(5);

    const run = scheduleTranscriptResume([job()], 0);
    await vi.waitFor(() => expect(transcriptionService.addChunk).toHaveBeenCalledTimes(1));
    await cancelTranscriptResume();
    await run;

    expect(transcriptionService.abort).toHaveBeenCalledTimes(1);
    expect(transcriptionService.stop).not.toHaveBeenCalled();
    expect(meetingService.updateMeeting).not.toHaveBeenCalled();
    vi.mocked(transcriptionService.getBacklog).mockReturnValue(0);
    await resumePendingTranscripts(); // drain the kept job so later tests start empty
  });

  it('a cancel during the start delay returns at once and runs nothing', async () => {
    wavOfSeconds(30);
    const run = scheduleTranscriptResume([job()], 60_000);

    await cancelTranscriptResume();
    await run;

    expect(transcriptionService.start).not.toHaveBeenCalled();
    expect(meetingService.updateMeeting).not.toHaveBeenCalled();
    await resumePendingTranscripts(); // drain the kept job so later tests start empty
  });

  it('completes a stopped meeting with what it has when the WAV cannot be read', async () => {
    wavOfSeconds(30);
    vi.mocked(transcriptionService.start).mockRejectedValueOnce(new Error('whisper exploded'));

    await scheduleTranscriptResume([job({ audioMs: 30_000 })], 0);

    expect(meetingService.updateMeeting).toHaveBeenCalledWith('m1', { status: 'completed' });
  });
});
