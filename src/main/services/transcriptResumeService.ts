// === FILE PURPOSE ===
// Finishes a transcript the previous process did not finish, from the saved WAV
// (2026-11-25). Stop now finishes the transcript in the background; when the app
// is closed or killed before that is done, stale-recording recovery hands the
// meeting here on the next launch and the rest is transcribed through the SAME
// live pipeline (RMS + VAD gates, hallucination filters, original timestamps).
//
// === HOW IT PICKS UP ===
// Windows finish in recording order, so everything before the window holding the
// last saved row is done. The run starts at the NEXT window: `firstSegmentIndex`
// keeps the stamped timestamps, and the WAV is read from that window's audio
// offset (index x WINDOW_ADVANCE_MS). A window that held only silence before is
// simply gated again. With two windows in flight at normal load, one window just
// before the last saved row may be skipped; that is the accepted cost of never
// writing a window twice.
//
// === IT ALWAYS YIELDS, AND COMES BACK ===
// The same queue holds a meeting whose background finish stepped aside for a new
// call (audioProcessor): it is resumed once that call's own transcript is done.
// One window at a time (batch mode), started after a delay so the launch stays
// light, and cancelled the moment a live recording needs the pipeline: the
// meeting is then left as it was and the next launch tries again. Cancelling
// waits for at most the window in flight (~10 s on a slow GPU); the recording's
// audio is buffered meanwhile (audioProcessor), so nothing is lost.

import * as fsp from 'node:fs/promises';
import { WINDOW_ADVANCE_MS, WINDOW_STAMP_MS } from '../../shared/transcription/timeCoordinates';
import { dominantLanguage } from '../../shared/types/transcriptionCoverage';
import type { TranscriptionCoverage } from '../../shared/types';
import * as transcriptionService from './transcriptionService';
import * as meetingService from './meetingService';
import { createLogger } from './logger';

const log = createLogger('TranscriptResume');

export interface ResumeJob {
  meetingId: string;
  wavPath: string;
  /** Stamped end of the last transcript row already saved; 0 when there is none. */
  lastSegmentEndMs: number;
  /** Length of the recorded audio. */
  audioMs: number;
  /**
   * True for a meeting the user stopped (its background finish was interrupted):
   * it is marked 'completed' once the transcript is whole, which starts its brief.
   */
  markCompleted: boolean;
}

const WAV_HEADER_BYTES = 44;
const PCM_BYTES_PER_MS = 32; // 16 kHz mono Int16
const FEED_CHUNK_MS = 1000;
/** Keep at most this many windows queued, so a 1-hour WAV never sits in memory. */
const MAX_BACKLOG = 2;
const START_DELAY_MS = 30_000;

let running: Promise<void> | null = null;
let cancelled = false;
/** Wakes the start delay early when the run is cancelled. */
let wakeDelay: (() => void) | null = null;
/** Jobs not finished yet, oldest first. A cancelled job stays here for the next run. */
let pending: ResumeJob[] = [];
let notifyFinished: ((meetingId: string) => void) | null = null;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Told when a resumed meeting is complete, so the renderer can refresh it. */
export function setTranscriptFinishedNotifier(fn: ((meetingId: string) => void) | null): void {
  notifyFinished = fn;
}

/** First window not yet transcribed, from the stamped end of the last saved row. */
export function firstUnfinishedWindow(lastSegmentEndMs: number): number {
  return lastSegmentEndMs > 0 ? Math.floor((lastSegmentEndMs - 1) / WINDOW_STAMP_MS) + 1 : 0;
}

/** Queue jobs without starting them (a recording owns the pipeline right now). */
export function enqueueTranscriptResume(jobs: ResumeJob[]): void {
  for (const job of jobs) {
    if (!pending.some((p) => p.meetingId === job.meetingId)) pending.push(job);
  }
}

/** Queue the jobs and run everything queued in the background. Never rejects. */
export function scheduleTranscriptResume(jobs: ResumeJob[], delayMs = START_DELAY_MS): Promise<void> {
  enqueueTranscriptResume(jobs);
  return resumePendingTranscripts(delayMs);
}

/** Run what is queued (after `delayMs`), unless a run is already going. Never rejects. */
export function resumePendingTranscripts(delayMs = 0): Promise<void> {
  if (running) return running;
  if (pending.length === 0) return Promise.resolve();
  cancelled = false;
  const run = (async () => {
    if (delayMs > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delayMs);
        wakeDelay = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      wakeDelay = null;
    }
    while (pending.length > 0 && !cancelled) {
      const job = pending[0];
      try {
        if (!(await resumeOne(job))) break; // interrupted: keep it queued
      } catch (err) {
        log.warn(`Resume of meeting ${job.meetingId} failed:`, err);
        // A stopped meeting must not stay at 'recording' forever because its WAV
        // cannot be read: complete it with the transcript it has.
        if (job.markCompleted) {
          await meetingService.updateMeeting(job.meetingId, { status: 'completed' }).catch(() => undefined);
          notifyFinished?.(job.meetingId);
        }
      }
      pending = pending.filter((p) => p !== job);
    }
  })();
  running = run;
  void run.finally(() => {
    if (running === run) running = null;
  });
  return run;
}

/**
 * Stop any resume now and wait until the pipeline is free. Only the window in
 * flight finishes; the job stays queued and continues from its last saved row on
 * the next resumePendingTranscripts (after the recording) or the next launch.
 */
export async function cancelTranscriptResume(): Promise<void> {
  if (!running) return;
  cancelled = true;
  wakeDelay?.();
  await running.catch(() => undefined);
}

/** True when the job is done; false when it was interrupted and stays queued. */
async function resumeOne(job: ResumeJob): Promise<boolean> {
  const startedAt = Date.now();
  const meeting = await meetingService.getMeeting(job.meetingId);
  if (!meeting) return true; // deleted since
  // Pick up after the newest saved row: a run cut short earlier may have added some.
  const savedEnd = Math.max(job.lastSegmentEndMs, ...(meeting.segments ?? []).map((seg) => seg.endTime));
  const firstIndex = firstUnfinishedWindow(savedEnd);
  const audioStartMs = firstIndex * WINDOW_ADVANCE_MS;

  if (audioStartMs < job.audioMs - FEED_CHUNK_MS) {
    if (cancelled || transcriptionService.isActive()) return false;
    log.info(
      `Resuming transcript of meeting ${job.meetingId} from window ${firstIndex} (${Math.round((job.audioMs - audioStartMs) / 1000)} s of audio)`,
    );

    await transcriptionService.start(job.meetingId, meeting.transcriptionLanguage ?? undefined, {
      firstSegmentIndex: firstIndex,
      batch: true,
    });
    let completedRun = false;
    try {
      completedRun = await feedWav(job.wavPath, audioStartMs);
    } finally {
      // Cancelled or failed: drop what is queued; only the window in flight finishes.
      if (!completedRun) await transcriptionService.abort();
    }
    if (!completedRun) return false;
    const provider = transcriptionService.getActiveProvider();
    const model = transcriptionService.getActiveModelName();
    await transcriptionService.stop();
    await writeCoverage(job, provider, model);
  }

  if (job.markCompleted) {
    // Through meetingService so the completed hooks start the brief, as a Stop would.
    await meetingService.updateMeeting(job.meetingId, { status: 'completed' });
    notifyFinished?.(job.meetingId);
  }
  log.info(`Transcript of meeting ${job.meetingId} resumed and finished in ${Date.now() - startedAt} ms`);
  return true;
}

/** Feed the WAV from `audioStartMs` in 1 s chunks. False when cancelled part-way. */
async function feedWav(wavPath: string, audioStartMs: number): Promise<boolean> {
  const fd = await fsp.open(wavPath, 'r');
  try {
    const chunkBytes = FEED_CHUNK_MS * PCM_BYTES_PER_MS;
    let position = WAV_HEADER_BYTES + audioStartMs * PCM_BYTES_PER_MS;
    for (;;) {
      if (cancelled) return false;
      while (transcriptionService.getBacklog() > MAX_BACKLOG) {
        if (cancelled) return false;
        await sleep(250);
      }
      const buf = Buffer.alloc(chunkBytes);
      const { bytesRead } = await fd.read(buf, 0, chunkBytes, position);
      if (bytesRead <= 0) return true;
      position += bytesRead;
      const chunk = buf.subarray(0, bytesRead - (bytesRead % 2));
      transcriptionService.addChunk({ mixed: chunk, mic: null, system: chunk });
    }
  } finally {
    await fd.close();
  }
}

/**
 * Replaces recovery's record (an 'unknown' gap over the untranscribed tail) with
 * what this run actually did. Never throws: the transcript is saved either way.
 */
async function writeCoverage(job: ResumeJob, provider: string, model: string | null): Promise<void> {
  try {
    const tally = transcriptionService.getCoverageTally();
    const coverage: TranscriptionCoverage = {
      version: 1,
      endedBy: 'recovered',
      audioMs: job.audioMs,
      provider,
      model,
      windowStampMs: WINDOW_STAMP_MS,
      windowAdvanceMs: WINDOW_ADVANCE_MS,
      channels: tally.channels,
      gaps: tally.gaps,
      retranscribed: [],
      languages: tally.languages,
      detectedLanguage: dominantLanguage(tally.languages),
    };
    await meetingService.setTranscriptionCoverage(job.meetingId, coverage);
  } catch (err) {
    log.error(`Failed to write coverage after resuming meeting ${job.meetingId}:`, err);
  }
}
