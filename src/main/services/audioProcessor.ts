// === FILE PURPOSE ===
// Audio processing service — accumulates PCM chunks from renderer,
// saves WAV files, manages recording state, and pushes updates.
//
// === DEPENDENCIES ===
// electron (app, BrowserWindow), wavefile, node:fs, node:path
//
// === LIMITATIONS ===
// - No transcription (Plan 4.3)
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
import type { RecordingState } from '../../shared/types';

let chunks: Buffer[] = [];
let currentMeetingId: string | null = null;
let startTime = 0;
let stateTimer: ReturnType<typeof setInterval> | null = null;
let mainWindow: BrowserWindow | null = null;

function getRecordingsDir(): string {
  return path.join(app.getPath('userData'), 'recordings');
}

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win;
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
}

export function addChunk(chunk: Buffer): void {
  if (!currentMeetingId) return; // Ignore chunks when not recording
  chunks.push(chunk);
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

  const meetingId = currentMeetingId;
  currentMeetingId = null;

  // Combine all chunks into a single buffer
  const combined = Buffer.concat(chunks);
  chunks = []; // Free memory

  // Save WAV file
  const audioPath = await saveWav(meetingId, combined);

  // Push stopped state
  pushState();

  return audioPath;
}

async function saveWav(meetingId: string, pcmBuffer: Buffer): Promise<string> {
  const dir = getRecordingsDir();
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
  console.log(
    `[Audio] Saved WAV: ${filePath} (${(pcmBuffer.byteLength / 1024).toFixed(0)} KB)`,
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
    lastTranscript: '', // Plan 4.3 will populate this
  };

  mainWindow.webContents.send('recording:state-update', state);
}
