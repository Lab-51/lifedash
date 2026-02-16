// === FILE PURPOSE ===
// Audio processing service — accumulates PCM chunks from renderer,
// saves WAV files, manages recording state, and pushes updates.
//
// === DEPENDENCIES ===
// electron (app, BrowserWindow), wavefile, node:fs, node:path
//
// === LIMITATIONS ===
// - No audio level metering
// - Single recording at a time
//
// === VERIFICATION STATUS ===
// - wavefile: named export { WaveFile } verified from source (export class WaveFile)
// - fromScratch / toBuffer API verified from index.d.ts
// - RecordingState shape verified from shared/types.ts

import { app, BrowserWindow } from 'electron';
import { WaveFile } from 'wavefile';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { RecordingState } from '../../shared/types';
import * as transcriptionService from './transcriptionService';
import { getDb } from '../db/connection';
import { settings } from '../db/schema';
import { createLogger } from './logger';

const log = createLogger('Audio');

let chunks: Buffer[] = [];
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
    const rows = await db
      .select()
      .from(settings)
      .where(eq(settings.key, 'recordings:savePath'));
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

export function startRecording(meetingId: string): void {
  if (currentMeetingId) {
    throw new Error('Already recording. Stop current recording first.');
  }
  currentMeetingId = meetingId;
  chunks = [];
  startTime = Date.now();

  // Push state updates to renderer every second
  stateTimer = setInterval(() => {
    pushState();
  }, 1000);

  // Push initial state immediately
  pushState();

  // Start transcription pipeline (non-blocking, may skip if no model)
  transcriptionService.start(meetingId).catch((err) => {
    log.error('Transcription start failed:', err);
  });
}

export function addChunk(chunk: Buffer): void {
  if (!currentMeetingId) return; // Ignore chunks when not recording
  chunks.push(chunk);
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

  // Stop transcription pipeline (flushes remaining audio)
  await transcriptionService.stop();

  const meetingId = currentMeetingId;
  currentMeetingId = null;

  // Combine all chunks into a single buffer
  const combined = Buffer.concat(chunks);
  chunks = []; // Free memory

  // Check if audio saving is enabled (default: true)
  let saveEnabled = true;
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(settings)
      .where(eq(settings.key, 'audio:saveRecordings'));
    if (rows.length > 0 && rows[0].value === 'false') {
      saveEnabled = false;
    }
  } catch (err) {
    log.error('Failed to read audio:saveRecordings setting, defaulting to save:', err);
  }

  // Save WAV file (or skip if disabled)
  let audioPath = '';
  if (saveEnabled) {
    audioPath = await saveWav(meetingId, combined);
  } else {
    log.debug('Audio saving disabled — skipping WAV file');
  }

  // Push stopped state
  pushState();

  return audioPath;
}

async function saveWav(meetingId: string, pcmBuffer: Buffer): Promise<string> {
  const dir = await getRecordingsDir();
  fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, `${meetingId}.wav`);

  // Convert Buffer to Int16Array for WAV encoding
  const int16 = new Int16Array(
    pcmBuffer.buffer,
    pcmBuffer.byteOffset,
    pcmBuffer.byteLength / 2,
  );

  // Create WAV: 1 channel (mono), 16kHz, 16-bit PCM
  const wav = new WaveFile();
  wav.fromScratch(1, 16000, '16', int16);

  fs.writeFileSync(filePath, wav.toBuffer());
  log.debug(
    `Saved WAV: ${filePath} (${(pcmBuffer.byteLength / 1024).toFixed(0)} KB)`,
  );

  return filePath;
}

function pushState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const state: RecordingState = {
    isRecording: currentMeetingId !== null,
    meetingId: currentMeetingId,
    elapsed: currentMeetingId
      ? Math.floor((Date.now() - startTime) / 1000)
      : 0,
    lastTranscript: transcriptionService.getLastTranscript(),
  };

  mainWindow.webContents.send('recording:state-update', state);
}
