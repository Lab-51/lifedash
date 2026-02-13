// === FILE PURPOSE ===
// Transcription service — accumulates PCM chunks into 10-second segments,
// dispatches them to the whisper worker thread (local) or cloud API
// (Deepgram/AssemblyAI), saves results to DB, and pushes segments to the renderer.
//
// === DEPENDENCIES ===
// worker_threads (Worker), whisperModelManager, meetingService, electron (BrowserWindow),
// transcriptionProviderService, deepgramTranscriber, assemblyaiTranscriber
//
// === LIMITATIONS ===
// - Sequential transcription (one segment at a time)
// - Fixed 10-second segments (no VAD-based splitting)
// - English-only for v1 (language is hardcoded)
// - API providers add network latency per segment

import { Worker } from 'worker_threads';
import { BrowserWindow } from 'electron';
import path from 'node:path';
import * as meetingService from './meetingService';
import * as whisperModelManager from './whisperModelManager';
import * as transcriptionProviderService from './transcriptionProviderService';
import * as deepgramTranscriber from './deepgramTranscriber';
import * as assemblyaiTranscriber from './assemblyaiTranscriber';
import { getDb } from '../db/connection';
import { aiUsage } from '../db/schema';
import { createLogger } from './logger';
import type { TranscriptionProviderType } from '../../shared/types';

const log = createLogger('Transcription');

// --- Worker message types ---

/** Messages sent from the transcription worker back to the main process */
interface WorkerReadyMessage {
  type: 'ready';
}

interface WorkerResultMessage {
  type: 'result';
  text: string;
  segments: Array<{ text: string; t0: number; t1: number }>;
  segmentIndex: number;
  startTimeMs: number;
}

interface WorkerErrorMessage {
  type: 'error';
  message: string;
}

interface WorkerStoppedMessage {
  type: 'stopped';
}

type WorkerMessage = WorkerReadyMessage | WorkerResultMessage | WorkerErrorMessage | WorkerStoppedMessage;

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
let activeProvider: TranscriptionProviderType = 'local';

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win;
}

export function getLastTranscript(): string {
  return lastTranscriptText;
}

/**
 * Start the transcription pipeline for a recording session.
 * Resolves the configured provider, then either spawns a local Whisper worker
 * or prepares for cloud API dispatching.
 */
export async function start(meetingId: string): Promise<void> {
  // Resolve which provider to use from saved config
  const config = await transcriptionProviderService.getConfig();
  activeProvider = config.type;

  // Common state reset
  currentMeetingId = meetingId;
  accumulatorBuffer = Buffer.alloc(0);
  segmentIndex = 0;
  lastTranscriptText = '';
  pendingSegments = [];
  transcribing = false;

  if (activeProvider === 'local') {
    // Local Whisper path — need a model
    const modelPath = whisperModelManager.getDefaultModelPath();
    if (!modelPath) {
      log.info('No whisper model available. Skipping transcription.');
      currentMeetingId = null;
      return;
    }

    // Spawn worker — the transcriptionWorker.ts is built as a separate entry
    // by Electron Forge/Vite and placed alongside the main process bundle.
    const workerPath = path.join(__dirname, 'transcriptionWorker.js');
    worker = new Worker(workerPath);

    // Handle worker errors
    worker.on('error', (err) => {
      log.error('Worker error:', err);
    });

    // Initialize whisper in the worker
    await new Promise<void>((resolve, reject) => {
      const onMessage = (msg: WorkerMessage) => {
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
    log.info(`Started (local) with model: ${path.basename(modelPath)}`);
  } else {
    // Cloud API provider — verify key is configured
    const key = await transcriptionProviderService.getDecryptedKey(
      activeProvider as 'deepgram' | 'assemblyai',
    );
    if (!key) {
      log.info(`No API key configured for ${activeProvider}. Skipping transcription.`);
      currentMeetingId = null;
      return;
    }

    log.info(`Started (${activeProvider}) — cloud API mode`);
  }
}

/**
 * Feed a PCM chunk into the transcription pipeline.
 * Accumulates chunks and dispatches 10-second segments to worker or API.
 */
export function addChunk(chunk: Buffer): void {
  if (!currentMeetingId) return;
  if (activeProvider === 'local' && !worker) return;

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
  // Allow stop for both local (worker) and API modes
  if (activeProvider === 'local' && !worker) return;
  if (activeProvider !== 'local' && !currentMeetingId) return;

  // Transcribe remaining accumulated audio (partial segment)
  if (accumulatorBuffer.byteLength > 0 && currentMeetingId) {
    pendingSegments.push(Buffer.from(accumulatorBuffer));
    accumulatorBuffer = Buffer.alloc(0);
    dispatchNext();
  }

  // Wait for pending transcriptions to finish
  await waitForPending();

  // Terminate local worker if it exists
  if (worker) {
    worker.postMessage({ type: 'stop' });
    await worker.terminate();
    worker = null;
  }

  currentMeetingId = null;
  activeProvider = 'local';
  log.info('Stopped');
}

/** Dispatch the next pending segment to the worker or cloud API */
function dispatchNext(): void {
  if (transcribing || pendingSegments.length === 0) return;

  // For local mode, need worker to be available
  if (activeProvider === 'local' && !worker) return;

  transcribing = true;
  const segment = pendingSegments.shift()!;
  const startTimeMs = segmentIndex * SEGMENT_DURATION_SEC * 1000;
  segmentIndex++;

  if (activeProvider === 'local') {
    // Local Whisper: dispatch to worker thread
    dispatchToWorker(segment, startTimeMs);
  } else {
    // Cloud API: dispatch async
    dispatchToApi(segment, startTimeMs);
  }
}

/** Dispatch a segment to the local Whisper worker thread */
function dispatchToWorker(segment: Buffer, startTimeMs: number): void {
  // Convert Buffer to ArrayBuffer for transfer.
  // Buffer.from() always creates ArrayBuffer-backed buffers (not SharedArrayBuffer),
  // so the cast is safe here.
  const arrayBuffer = segment.buffer.slice(
    segment.byteOffset,
    segment.byteOffset + segment.byteLength,
  ) as ArrayBuffer;

  worker!.postMessage(
    {
      type: 'transcribe',
      audioData: arrayBuffer,
      segmentIndex: segmentIndex - 1,
      startTimeMs,
    },
    [arrayBuffer], // Transfer ownership (zero-copy)
  );
}

/** Dispatch a segment to the configured cloud API (Deepgram or AssemblyAI) */
async function dispatchToApi(segment: Buffer, startTimeMs: number): Promise<void> {
  try {
    let result;
    if (activeProvider === 'deepgram') {
      result = await deepgramTranscriber.transcribeSegment(segment, startTimeMs);
    } else {
      result = await assemblyaiTranscriber.transcribeSegment(segment, startTimeMs);
    }

    // Process result — save to DB and push to renderer (same as worker result path)
    if (result.text && result.text.trim() && currentMeetingId) {
      lastTranscriptText = result.text.trim();

      for (const seg of result.segments) {
        if (!seg.text.trim()) continue;
        try {
          const saved = await meetingService.addTranscriptSegment(
            currentMeetingId,
            seg.text.trim(),
            seg.startMs,
            seg.endMs,
          );
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('recording:transcript-segment', saved);
          }
        } catch (err) {
          log.error('Failed to save segment:', err);
        }
      }

      // Log API usage (fire-and-forget)
      // Use direct DB insert since providerId is UUID-typed and we have no ai_providers row
      try {
        const durationSec = segment.byteLength / (SAMPLE_RATE * 2);
        await getDb().insert(aiUsage).values({
          providerId: null,
          model: activeProvider,
          taskType: 'transcription',
          promptTokens: Math.round(durationSec),
          completionTokens: 0,
          totalTokens: Math.round(durationSec),
        });
      } catch { /* non-fatal */ }
    }
  } catch (err) {
    log.error(`API (${activeProvider}) failed:`, err);

    // FALLBACK: try local Whisper if worker exists
    if (worker) {
      log.debug('Falling back to local Whisper');
      const arrayBuffer = segment.buffer.slice(
        segment.byteOffset,
        segment.byteOffset + segment.byteLength,
      ) as ArrayBuffer;
      worker.postMessage(
        {
          type: 'transcribe',
          audioData: arrayBuffer,
          segmentIndex: segmentIndex - 1,
          startTimeMs,
        },
        [arrayBuffer],
      );
      return; // Worker message handler will set transcribing = false
    }

    log.error('No fallback available. Skipping segment.');
  }

  transcribing = false;
  dispatchNext();
}

/** Handle messages from the transcription worker */
async function handleWorkerMessage(msg: WorkerMessage): Promise<void> {
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
          log.error('Failed to save segment:', err);
        }
      }
    }

    // Process next pending segment
    dispatchNext();
  } else if (msg.type === 'error') {
    log.error('Worker error:', msg.message);
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
