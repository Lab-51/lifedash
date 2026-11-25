// === FILE PURPOSE ===
// Audio processing service — streams PCM chunks to a WAV file on disk
// during recording, manages recording state, and pushes updates.
//
// === DEPENDENCIES ===
// electron (app, BrowserWindow), node:fs, node:fs/promises, node:path, wavUtils
//
// === LIMITATIONS ===
// - No audio level metering
// - Single recording at a time

import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type {
  AudioChunkBuffers,
  RecordingState,
  TranscriptionCoverage,
  TranscriptionProgress,
} from '../../shared/types';
import { WINDOW_ADVANCE_MS, WINDOW_STAMP_MS } from '../../shared/transcription/timeCoordinates';
import { dominantLanguage } from '../../shared/types/transcriptionCoverage';
import * as transcriptionService from './transcriptionService';
import * as meetingService from './meetingService';
import * as liveTriageService from './liveTriageService';
import { getDb } from '../db/connection';
import { settings } from '../db/schema';
import { createLogger } from './logger';
import { createWavHeader } from './wavUtils';
import { setActiveMeetingId } from './recordingState';
import { pinChatModelForRecording, releaseChatModelPin } from './recordingModelPin';
import {
  cancelTranscriptResume,
  enqueueTranscriptResume,
  resumePendingTranscripts,
  setTranscriptFinishedNotifier,
} from './transcriptResumeService';
import { LIVE_PROPOSALS_ENABLED } from '../../shared/features';

const log = createLogger('Audio');

/** WAV bytes per millisecond: 16 kHz mono Int16 = 32,000 bytes/s. */
const WAV_BYTES_PER_MS = 32;

let wavFd: FileHandle | null = null;
let wavPath = '';
let dataBytes = 0;
let currentMeetingId: string | null = null;
let startTime = 0;
let stateTimer: ReturnType<typeof setInterval> | null = null;
let mainWindow: BrowserWindow | null = null;

function getDefaultRecordingsDir(): string {
  return path.join(app.getPath('userData'), 'recordings');
}

async function getRecordingsDir(): Promise<string> {
  try {
    const db = getDb();
    const rows = await db.select().from(settings).where(eq(settings.key, 'recordings:savePath'));
    if (rows.length > 0 && rows[0].value) {
      return rows[0].value;
    }
  } catch (err) {
    log.error('Failed to read recordings:savePath from settings, using default:', err);
  }
  return getDefaultRecordingsDir();
}

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win;
  transcriptionService.setMainWindow(win);
  liveTriageService.setMainWindow(win);
  setTranscriptFinishedNotifier((meetingId) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recording:transcript-finished', { meetingId });
    }
  });
}

export function isRecording(): boolean {
  return currentMeetingId !== null;
}

let shuttingDown = false;

/**
 * Settles once the transcription pipeline owns the current session. A new
 * recording can start while the previous Stop is still finishing its transcript
 * (or a resume runs after a restart); the pipeline is single-session, so it waits
 * for those, and the audio of those first seconds is buffered meanwhile.
 */
let transcriptionReady: Promise<void> = Promise.resolve();
/** Chunks received before the pipeline was ready; null once they were handed over. */
let bufferedChunks: AudioChunkBuffers[] | null = null;

/** Called by app shutdown: no recording may start once services are being stopped. */
export function blockNewRecordings(): void {
  shuttingDown = true;
}

export async function startRecording(meetingId: string, language?: string): Promise<void> {
  if (shuttingDown) {
    throw new Error('LifeDash is shutting down — the recording was not started.');
  }
  if (currentMeetingId) {
    throw new Error('Already recording. Stop current recording first.');
  }
  currentMeetingId = meetingId;
  setActiveMeetingId(meetingId);
  startTime = Date.now();

  // Check if audio saving is enabled (default: true) and open WAV file
  let saveEnabled = true;
  try {
    const db = getDb();
    const rows = await db.select().from(settings).where(eq(settings.key, 'audio:saveRecordings'));
    if (rows.length > 0 && rows[0].value === 'false') {
      saveEnabled = false;
    }
  } catch (err) {
    log.error('Failed to read audio:saveRecordings setting, defaulting to save:', err);
  }

  if (saveEnabled) {
    const dir = await getRecordingsDir();
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${meetingId}.wav`);
    wavFd = await fsp.open(filePath, 'w');
    await wavFd.write(createWavHeader(0));
    dataBytes = 0;
    wavPath = filePath;
  } else {
    log.debug('Audio saving disabled — skipping WAV file');
    wavFd = null;
    wavPath = '';
    dataBytes = 0;
  }

  // Push state updates to renderer every second
  stateTimer = setInterval(() => {
    pushState();
  }, 1000);

  // Push initial state immediately
  pushState();

  // Start transcription pipeline (non-blocking, may skip if no model). It waits for a
  // previous Stop's background finish and cancels a post-restart resume first.
  const waitStartedAt = Date.now();
  const buffer: AudioChunkBuffers[] = [];
  bufferedChunks = buffer;
  transcriptionReady = (async () => {
    try {
      await cancelTranscriptResume();
      yieldPreviousFinish();
      await waitForStopToFinish();
      const waitedMs = Date.now() - waitStartedAt;
      if (waitedMs > 1000) log.info(`Transcription waited ${waitedMs} ms for the previous transcript to finish`);
      await transcriptionService.start(meetingId, language);
    } catch (err) {
      log.error('Transcription start failed:', err);
    } finally {
      // Hand over what arrived meanwhile (also when this recording already
      // stopped: stopRecording waits for this before it flushes the pipeline).
      if (bufferedChunks === buffer) bufferedChunks = null;
      for (const chunk of buffer) transcriptionService.addChunk(chunk);
    }
  })();

  // Start the proactive triage loop for this recording session. Symmetric with
  // stopTriage in stopRecording so its watermark/state is always cleared.
  // Archived (src/shared/features.ts): without startTriage, onSegment is a no-op.
  if (LIVE_PROPOSALS_ENABLED) liveTriageService.startTriage(meetingId);

  // Hold the built-in chat role on this session's model for the whole recording
  // (AI-RESIL.2): triage and the live assistant fire on cadence, and BETWEEN two calls
  // another task's model can take the role and make the next call pay a multi-GB cold
  // reload. Deliberately LAST and non-throwing, so nothing that fails earlier in this
  // function can leave a pin behind, and an AI-config problem can never fail a recording.
  await pinChatModelForRecording();
}

/**
 * Fan one audio callback out to the WAV writer and the transcription pipeline.
 *
 * The file on disk is written from `mixed` ONLY — the mono sum, byte-identical
 * to pre-SPEAKER.1 recordings — because the cloud diarize path and the
 * `audio:saveRecordings` export both read it. Only transcription sees the
 * per-channel split.
 */
export function addChunk(payload: AudioChunkBuffers): void {
  if (!currentMeetingId) return; // Ignore chunks when not recording

  if (wavFd) {
    wavFd.write(payload.mixed).catch((err) => {
      log.error('WAV write failed, disabling audio save:', err);
      wavFd = null;
    });
    dataBytes += payload.mixed.byteLength;
  }

  if (bufferedChunks) bufferedChunks.push(payload);
  else transcriptionService.addChunk(payload);
}

/**
 * Stop the recording. Resolves as soon as the WAV is saved; the transcript then
 * FINISHES IN THE BACKGROUND (2026-11-25: the UI used to wait for every queued
 * window, which on a slow machine held the screen for minutes and lost the tail
 * when the app was closed meanwhile). When it is done the meeting is marked
 * 'completed' here in main (which starts the brief through the completed hooks)
 * and the renderer gets `recording:transcript-finished`.
 *
 * `discard` (Cancel recording): queued windows are dropped instead of
 * transcribed, the meeting is never marked completed, and the call resolves only
 * once nothing can write to the meeting any more, so the caller may delete it.
 *
 * The chat-model pin is released on EVERY exit path, because a leaked pin would
 * starve every other local AI task for the rest of the session.
 */
export async function stopRecording(opts: { discard?: boolean } = {}): Promise<string> {
  if (!currentMeetingId) {
    releaseChatModelPin(); // the not-recording guard still releases the pin
    throw new Error('Not currently recording.');
  }
  const stoppedMeetingId = currentMeetingId;
  const stopStartedAt = Date.now();

  if (stateTimer) {
    clearInterval(stateTimer);
    stateTimer = null;
  }
  currentMeetingId = null;
  setActiveMeetingId(null);
  bufferedChunks = null;

  // Stop the proactive triage loop for this session (clears its watermark/state).
  liveTriageService.stopTriage(stoppedMeetingId);

  sendProgress('saving-audio', 0);

  // Read the session's provider/model BEFORE the flush: stop() resets them for
  // the next recording, and the coverage record has to name the one that ran.
  const provider = transcriptionService.getActiveProvider();
  const model = transcriptionService.getActiveModelName();

  // The pipeline may still be starting (it waits for a previous finish); stop it
  // only once it owns the session, or stop() would see no session and return early.
  // Caught HERE, not where it is awaited: it can fail while the WAV is still being
  // saved, which would otherwise surface as an unhandled rejection.
  const flushed = transcriptionReady
    .then(() => (opts.discard ? transcriptionService.abort() : transcriptionService.stop()))
    .catch((err: unknown) => {
      log.error('Transcription flush failed:', err);
    });

  // This session's file, by value (see finalizeWav).
  const audioBytes = dataBytes;
  const fd = wavFd;
  wavFd = null;
  const finishState: FinishState = { meetingId: stoppedMeetingId, yielded: false, resumable: fd !== null };
  currentFinish = finishState;
  const wavSaved = finalizeWav(fd, wavPath, audioBytes).catch((err: unknown) => {
    log.error('Failed to finalize WAV:', err);
    return '';
  });

  // Registered SYNCHRONOUSLY, before the first await: shutdown checks isRecording()
  // (already false) and then waits on this, so it must exist from this line on.
  const finish = (async () => {
    try {
      const audioPath = await wavSaved;
      await flushed;
      if (opts.discard) return;
      if (finishState.yielded && audioPath) {
        // A new call needed the pipeline: the rest is transcribed from the WAV once
        // that call's own transcript is done (resumePendingTranscripts below).
        enqueueTranscriptResume([
          {
            meetingId: stoppedMeetingId,
            wavPath: audioPath,
            lastSegmentEndMs: 0, // the resume reads the newest saved row itself
            audioMs: Math.round(audioBytes / WAV_BYTES_PER_MS),
            markCompleted: true,
          },
        ]);
        log.info(`Recording ${stoppedMeetingId}: transcript paused for a new recording, resumes after it`);
        return;
      }
      // After the flush, so the windows stop() itself dispatched are counted.
      await persistCoverage(stoppedMeetingId, provider, model, audioPath, audioBytes);
      await markCompleted(stoppedMeetingId);
      sendProgress('finalizing', 100);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('recording:transcript-finished', { meetingId: stoppedMeetingId });
      }
      log.info(`Recording ${stoppedMeetingId}: transcript finished ${Date.now() - stopStartedAt} ms after Stop`);
      // Meetings whose finish stepped aside for this one continue now, unless
      // another recording is already running.
      if (!currentMeetingId) void resumePendingTranscripts();
    } finally {
      if (currentFinish === finishState) currentFinish = null;
      releaseChatModelPin();
    }
  })();
  stopInFlight = finish;
  void finish.finally(() => {
    if (stopInFlight === finish) stopInFlight = null;
  });

  pushState();
  const audioPath = await wavSaved;
  log.info(`Recording ${stoppedMeetingId} stopped: audio saved in ${Date.now() - stopStartedAt} ms`);
  if (opts.discard) await finish;
  return audioPath;
}

/**
 * The meeting's one transition to 'completed' after a Stop. Through meetingService,
 * so the completed hooks (brief + action items) run exactly as when the renderer
 * wrote it. Never throws: the transcript is saved either way, and a row left at
 * 'recording' is closed by stale-recording recovery on the next launch.
 */
async function markCompleted(meetingId: string): Promise<void> {
  try {
    await meetingService.updateMeeting(meetingId, { status: 'completed' });
  } catch (err) {
    log.error(`Failed to mark meeting ${meetingId} completed:`, err);
  }
}

function sendProgress(phase: TranscriptionProgress['phase'], percentComplete: number): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const progress = transcriptionService.getProgress();
  mainWindow.webContents.send('recording:processing-progress', {
    phase,
    currentSegment: percentComplete === 100 ? progress.totalSegments : progress.currentSegment,
    totalSegments: progress.totalSegments,
    percentComplete,
    backendUsed: progress.backendUsed,
  } satisfies TranscriptionProgress);
}

interface FinishState {
  meetingId: string;
  /** Set when a new recording took the pipeline: the rest is resumed from the WAV later. */
  yielded: boolean;
  /** Without a WAV there is nothing to resume from, so such a finish never yields. */
  resumable: boolean;
}
/** The background finish still running, if any. */
let currentFinish: FinishState | null = null;

/**
 * A new recording starts while the last Stop is still finishing its transcript:
 * drop that finish's queue so the new call's live transcription is not stuck
 * behind it (and the GPU is not busy with it during the call). Only the window
 * in flight completes; the rest is resumed from the WAV after the new call.
 */
function yieldPreviousFinish(): void {
  const finish = currentFinish;
  if (!finish || !finish.resumable || finish.yielded) return;
  finish.yielded = true;
  transcriptionService.dropQueued();
  log.info(`New recording: the transcript of ${finish.meetingId} steps aside and resumes after it`);
}

/** The background transcript finish of the last Stop; null once it settled. */
let stopInFlight: Promise<void> | null = null;

/** True while a Stop is still finishing the transcript in the background. */
export function isStopInFlight(): boolean {
  return stopInFlight !== null;
}

/**
 * Resolves once no stop is finishing. App shutdown awaits this before closing the
 * database, and the next recording before it takes the transcription pipeline.
 */
export async function waitForStopToFinish(): Promise<void> {
  await stopInFlight?.catch(() => undefined);
}

/**
 * Store what the transcription pipeline did with every window of this session
 * (TRANS-COV.1), while the meeting is still `recording` -- the renderer flips it
 * to `completed` only after stopRecording returns, so the record is on the row
 * BEFORE the completed hooks (brief generation) can read it.
 *
 * `audioMs` is the REAL recorded length, arithmetic on the finalized WAV's data
 * bytes, never the transcript's own timeline (which runs 1 s per window fast --
 * ISSUES #40). With no WAV to measure it is null rather than a guess.
 *
 * NEVER fails the stop: a recording that was made and saved must not be
 * reported as failed because its bookkeeping could not be written.
 */
async function persistCoverage(
  meetingId: string,
  provider: string,
  model: string | null,
  audioPath: string,
  audioBytes: number,
): Promise<void> {
  try {
    const tally = transcriptionService.getCoverageTally();
    const coverage: TranscriptionCoverage = {
      version: 1,
      endedBy: 'stop',
      audioMs: audioPath ? Math.round(audioBytes / WAV_BYTES_PER_MS) : null,
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
    await meetingService.setTranscriptionCoverage(meetingId, coverage);
  } catch (err) {
    log.error('Failed to persist transcription coverage:', err);
  }
}

/**
 * Write the real header and close the file. Takes the session's handle, path and
 * byte count by value: with Stop no longer blocking, the next recording may open
 * its own file while this one is still being closed.
 */
async function finalizeWav(fd: FileHandle | null, filePath: string, bytes: number): Promise<string> {
  if (!fd) return '';
  try {
    const header = createWavHeader(bytes);
    await fd.write(header, 0, 44, 0); // overwrite placeholder at position 0
    await fd.close();
    log.debug(`Saved WAV: ${filePath} (${(bytes / 1024).toFixed(0)} KB)`);
    return filePath;
  } catch (err) {
    log.error('Failed to finalize WAV:', err);
    try {
      await fd.close();
    } catch {
      /* ignore */
    }
    return '';
  }
}

function pushState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const state: RecordingState = {
    isRecording: currentMeetingId !== null,
    meetingId: currentMeetingId,
    elapsed: currentMeetingId ? Math.floor((Date.now() - startTime) / 1000) : 0,
    lastTranscript: transcriptionService.getLastTranscript(),
  };

  mainWindow.webContents.send('recording:state-update', state);
}
