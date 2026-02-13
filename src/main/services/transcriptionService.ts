// === FILE PURPOSE ===
// Transcription service — accumulates PCM chunks into 10-second segments,
// dispatches them to the whisper worker thread, saves results to DB,
// and pushes segments to the renderer.
//
// === DEPENDENCIES ===
// worker_threads (Worker), whisperModelManager, meetingService, electron (BrowserWindow)
//
// === LIMITATIONS ===
// - Sequential transcription (one segment at a time in the worker)
// - Fixed 10-second segments (no VAD-based splitting)
// - English-only for v1 (language is hardcoded in worker)

import { Worker } from 'worker_threads';
import { BrowserWindow } from 'electron';
import path from 'node:path';
import * as meetingService from './meetingService';
import * as whisperModelManager from './whisperModelManager';

const SAMPLE_RATE = 16000;
const SEGMENT_DURATION_SEC = 10;
const SAMPLES_PER_SEGMENT = SAMPLE_RATE * SEGMENT_DURATION_SEC; // 160,000
const BYTES_PER_SEGMENT = SAMPLES_PER_SEGMENT * 2; // 320,000 (Int16 = 2 bytes)

let worker: Worker | null = null;
let mainWindow: BrowserWindow | null = null;
let currentMeetingId: string | null = null;
let accumulatorBuffer: Buffer = Buffer.alloc(0);
let segmentIndex = 0;
let lastTranscriptText = '';
let pendingSegments: Buffer[] = []; // Queue of segments waiting to be transcribed
let transcribing = false;

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win;
}

export function getLastTranscript(): string {
  return lastTranscriptText;
}

/**
 * Start the transcription pipeline for a recording session.
 * Spawns a worker, loads the whisper model, and prepares for chunk ingestion.
 */
export async function start(meetingId: string): Promise<void> {
  const modelPath = whisperModelManager.getDefaultModelPath();
  if (!modelPath) {
    console.log('[Transcription] No whisper model available. Skipping transcription.');
    return;
  }

  currentMeetingId = meetingId;
  accumulatorBuffer = Buffer.alloc(0);
  segmentIndex = 0;
  lastTranscriptText = '';
  pendingSegments = [];
  transcribing = false;

  // Spawn worker — the transcriptionWorker.ts is built as a separate entry
  // by Electron Forge/Vite and placed alongside the main process bundle.
  const workerPath = path.join(__dirname, 'transcriptionWorker.js');
  worker = new Worker(workerPath);

  // Handle worker errors
  worker.on('error', (err) => {
    console.error('[Transcription] Worker error:', err);
  });

  // Initialize whisper in the worker
  await new Promise<void>((resolve, reject) => {
    const onMessage = (msg: any) => {
      if (msg.type === 'ready') {
        worker?.off('message', onMessage);
        resolve();
      } else if (msg.type === 'error') {
        worker?.off('message', onMessage);
        reject(new Error(msg.message));
      }
    };
    worker!.on('message', onMessage);
    worker!.postMessage({ type: 'init', modelPath });
  });

  // Attach the main message handler for transcription results
  worker.on('message', handleWorkerMessage);
  console.log(`[Transcription] Started with model: ${path.basename(modelPath)}`);
}

/**
 * Feed a PCM chunk into the transcription pipeline.
 * Accumulates chunks and dispatches 10-second segments to the worker.
 */
export function addChunk(chunk: Buffer): void {
  if (!worker || !currentMeetingId) return;

  accumulatorBuffer = Buffer.concat([accumulatorBuffer, chunk]);

  // When we have enough for a full segment, queue it
  while (accumulatorBuffer.byteLength >= BYTES_PER_SEGMENT) {
    const segment = accumulatorBuffer.subarray(0, BYTES_PER_SEGMENT);
    pendingSegments.push(Buffer.from(segment)); // Copy to avoid reference issues
    accumulatorBuffer = accumulatorBuffer.subarray(BYTES_PER_SEGMENT);
    dispatchNext();
  }
}

/**
 * Stop the transcription pipeline. Transcribes any remaining audio, then terminates.
 */
export async function stop(): Promise<void> {
  if (!worker) return;

  // Transcribe remaining accumulated audio (partial segment)
  if (accumulatorBuffer.byteLength > 0 && currentMeetingId) {
    pendingSegments.push(Buffer.from(accumulatorBuffer));
    accumulatorBuffer = Buffer.alloc(0);
    dispatchNext();
  }

  // Wait for pending transcriptions to finish
  await waitForPending();

  // Terminate worker
  worker.postMessage({ type: 'stop' });
  await worker.terminate();
  worker = null;
  currentMeetingId = null;
  console.log('[Transcription] Stopped');
}

/** Dispatch the next pending segment to the worker if not already transcribing */
function dispatchNext(): void {
  if (transcribing || pendingSegments.length === 0 || !worker) return;

  transcribing = true;
  const segment = pendingSegments.shift()!;
  const startTimeMs = segmentIndex * SEGMENT_DURATION_SEC * 1000;

  // Convert Buffer to ArrayBuffer for transfer.
  // Buffer.from() always creates ArrayBuffer-backed buffers (not SharedArrayBuffer),
  // so the cast is safe here.
  const arrayBuffer = segment.buffer.slice(
    segment.byteOffset,
    segment.byteOffset + segment.byteLength,
  ) as ArrayBuffer;

  worker.postMessage(
    {
      type: 'transcribe',
      audioData: arrayBuffer,
      segmentIndex,
      startTimeMs,
    },
    [arrayBuffer], // Transfer ownership (zero-copy)
  );
  segmentIndex++;
}

/** Handle messages from the transcription worker */
async function handleWorkerMessage(msg: any): Promise<void> {
  if (msg.type === 'result') {
    transcribing = false;

    if (msg.text && msg.text.trim() && currentMeetingId) {
      const text = msg.text.trim();
      lastTranscriptText = text;

      // Save each segment to the database
      for (const seg of msg.segments) {
        if (!seg.text.trim()) continue;
        const segStartMs = msg.startTimeMs + seg.t0;
        const segEndMs = msg.startTimeMs + seg.t1;

        try {
          const saved = await meetingService.addTranscriptSegment(
            currentMeetingId,
            seg.text.trim(),
            segStartMs,
            segEndMs,
          );

          // Push segment to renderer
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('recording:transcript-segment', saved);
          }
        } catch (err) {
          console.error('[Transcription] Failed to save segment:', err);
        }
      }
    }

    // Process next pending segment
    dispatchNext();
  } else if (msg.type === 'error') {
    console.error('[Transcription] Worker error:', msg.message);
    transcribing = false;
    dispatchNext(); // Try next segment
  }
}

/** Wait for all pending transcriptions to complete */
function waitForPending(): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (!transcribing && pendingSegments.length === 0) {
        resolve();
      } else {
        setTimeout(check, 200);
      }
    };
    check();
  });
}
