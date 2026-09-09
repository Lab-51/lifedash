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
}

export function isRecording(): boolean {
  return currentMeetingId !== null;
}

export async function startRecording(meetingId: string, language?: string): Promise<void> {
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

  // Start transcription pipeline (non-blocking, may skip if no model)
  transcriptionService.start(meetingId, language).catch((err) => {
    log.error('Transcription start failed:', err);
  });

  // Start the proactive triage loop for this recording session. Symmetric with
  // stopTriage in stopRecording so its watermark/state is always cleared.
  liveTriageService.startTriage(meetingId);

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

  transcriptionService.addChunk(payload);
}

/**
 * Stop the recording. The chat-model pin is released on EVERY exit path — the
 * not-recording guard, a transcription flush failure, a WAV failure — because a leaked
 * pin would starve every other local AI task for the rest of the session, which is
 * worse than the model thrash the pin exists to prevent.
 */
export async function stopRecording(): Promise<string> {
  try {
    return await stopRecordingInner();
  } finally {
    releaseChatModelPin();
  }
}

async function stopRecordingInner(): Promise<string> {
  if (!currentMeetingId) {
    throw new Error('Not currently recording.');
  }

  // Capture before clearing so we can tear down the triage loop symmetrically.
  const stoppedMeetingId = currentMeetingId;

  // Stop timer
  if (stateTimer) {
    clearInterval(stateTimer);
    stateTimer = null;
  }

  currentMeetingId = null;
  setActiveMeetingId(null);

  // Stop the proactive triage loop for this session (clears its watermark/state).
  liveTriageService.stopTriage(stoppedMeetingId);

  // Emit saving-audio phase before flushing
  if (mainWindow && !mainWindow.isDestroyed()) {
    const progress = transcriptionService.getProgress();
    mainWindow.webContents.send('recording:processing-progress', {
      phase: 'saving-audio',
      currentSegment: progress.currentSegment,
      totalSegments: progress.totalSegments,
      percentComplete: 0,
      backendUsed: progress.backendUsed,
    } satisfies TranscriptionProgress);
  }

  // Read the session's provider/model BEFORE the flush: stop() resets them for
  // the next recording, and the coverage record has to name the one that ran.
  const provider = transcriptionService.getActiveProvider();
  const model = transcriptionService.getActiveModelName();

  // Flush transcription and finalize WAV in parallel
  const [, audioPath] = await Promise.all([transcriptionService.stop(), finalizeWav()]);

  // After the flush, so the windows stop() itself dispatched are counted.
  await persistCoverage(stoppedMeetingId, provider, model, audioPath);

  // Emit finalizing at 100% before returning
  if (mainWindow && !mainWindow.isDestroyed()) {
    const progress = transcriptionService.getProgress();
    mainWindow.webContents.send('recording:processing-progress', {
      phase: 'finalizing',
      currentSegment: progress.totalSegments,
      totalSegments: progress.totalSegments,
      percentComplete: 100,
      backendUsed: progress.backendUsed,
    } satisfies TranscriptionProgress);
  }

  // Push stopped state
  pushState();

  return audioPath;
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
): Promise<void> {
  try {
    const tally = transcriptionService.getCoverageTally();
    const coverage: TranscriptionCoverage = {
      version: 1,
      endedBy: 'stop',
      audioMs: audioPath ? Math.round(dataBytes / WAV_BYTES_PER_MS) : null,
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

async function finalizeWav(): Promise<string> {
  if (!wavFd) return '';
  try {
    const header = createWavHeader(dataBytes);
    await wavFd.write(header, 0, 44, 0); // overwrite placeholder at position 0
    await wavFd.close();
    log.debug(`Saved WAV: ${wavPath} (${(dataBytes / 1024).toFixed(0)} KB)`);
    return wavPath;
  } catch (err) {
    log.error('Failed to finalize WAV:', err);
    try {
      await wavFd.close();
    } catch {
      /* ignore */
    }
    return '';
  } finally {
    wavFd = null;
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
