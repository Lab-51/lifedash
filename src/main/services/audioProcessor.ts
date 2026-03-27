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
import type { RecordingState, TranscriptionProgress } from '../../shared/types';
import * as transcriptionService from './transcriptionService';
import { getDb } from '../db/connection';
import { settings } from '../db/schema';
import { createLogger } from './logger';
import { createWavHeader } from './wavUtils';

const log = createLogger('Audio');

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
}

export function isRecording(): boolean {
  return currentMeetingId !== null;
}

export async function startRecording(meetingId: string, language?: string): Promise<void> {
  if (currentMeetingId) {
    throw new Error('Already recording. Stop current recording first.');
  }
  currentMeetingId = meetingId;
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
}

export function addChunk(chunk: Buffer): void {
  if (!currentMeetingId) return; // Ignore chunks when not recording

  if (wavFd) {
    wavFd.write(chunk).catch((err) => {
      log.error('WAV write failed, disabling audio save:', err);
      wavFd = null;
    });
    dataBytes += chunk.byteLength;
  }

  transcriptionService.addChunk(chunk);
}

export async function stopRecording(): Promise<string> {
  if (!currentMeetingId) {
    throw new Error('Not currently recording.');
  }

  // Stop timer
  if (stateTimer) {
    clearInterval(stateTimer);
    stateTimer = null;
  }

  currentMeetingId = null;

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

  // Flush transcription and finalize WAV in parallel
  const [, audioPath] = await Promise.all([transcriptionService.stop(), finalizeWav()]);

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
