// === FILE PURPOSE ===
// Transcription service — accumulates PCM chunks into 10-second segments,
// dispatches them to local Whisper (in-process) or cloud API
// (Deepgram/AssemblyAI), saves results to DB, and pushes segments to the renderer.
//
// === DEPENDENCIES ===
// @fugood/whisper.node (initWhisper), whisperModelManager, meetingService,
// electron (BrowserWindow), transcriptionProviderService,
// deepgramTranscriber, assemblyaiTranscriber
//
// === LIMITATIONS ===
// - Sequential transcription (one segment at a time)
// - Fixed 10-second segments (no VAD-based splitting)
// - API providers add network latency per segment
//
// === NOTES ===
// Whisper runs in-process (no Worker thread). The native module's
// transcribeData() is non-blocking — it queues work on a background
// C++ thread via Napi::AsyncWorker and returns a Promise.

import { BrowserWindow } from 'electron';
import * as meetingService from './meetingService';
import * as whisperModelManager from './whisperModelManager';
import * as transcriptionProviderService from './transcriptionProviderService';
import * as deepgramTranscriber from './deepgramTranscriber';
import * as assemblyaiTranscriber from './assemblyaiTranscriber';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { aiUsage, settings } from '../db/schema';
import { createLogger } from './logger';
import type { TranscriptionProviderType } from '../../shared/types';

const log = createLogger('Transcription');

// Whisper context type — imported as type-only to avoid eager native module loading
import type { WhisperContext } from '@fugood/whisper.node';

const SAMPLE_RATE = 16000;
const SEGMENT_DURATION_SEC = 10;
const SAMPLES_PER_SEGMENT = SAMPLE_RATE * SEGMENT_DURATION_SEC; // 160,000
const BYTES_PER_SEGMENT = SAMPLES_PER_SEGMENT * 2; // 320,000 (Int16 = 2 bytes)

// Silence detection: RMS threshold below which a segment is skipped.
// Int16 range is -32768 to 32767. An RMS of 50 corresponds to ~0.15% of max,
// which is effectively silence or very faint background noise.
const SILENCE_RMS_THRESHOLD = 50;

let whisperContext: WhisperContext | null = null;
let mainWindow: BrowserWindow | null = null;
let currentMeetingId: string | null = null;
let accumulatorBuffer: Buffer = Buffer.alloc(0);
let segmentIndex = 0;
let lastTranscriptText = '';
let pendingSegments: Buffer[] = []; // Queue of segments waiting to be transcribed
let transcribing = false;
let activeProvider: TranscriptionProviderType = 'local';
let activeLanguage: string = 'en';

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win;
}

export function getLastTranscript(): string {
  return lastTranscriptText;
}

/**
 * Start the transcription pipeline for a recording session.
 * Resolves the configured provider, then either initializes local Whisper
 * or prepares for cloud API dispatching.
 */
export async function start(meetingId: string, language?: string): Promise<void> {
  // Resolve which provider to use from saved config
  const config = await transcriptionProviderService.getConfig();
  activeProvider = config.type;

  // Use per-recording language if provided, otherwise fall back to DB setting
  if (language) {
    activeLanguage = language;
  } else {
    const db = getDb();
    const langRows = await db.select().from(settings).where(eq(settings.key, 'transcription:language'));
    activeLanguage = langRows.length > 0 ? langRows[0].value : 'en';
  }

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

    // Initialize whisper context directly in the main process.
    // transcribeData() is non-blocking — the native module runs heavy
    // computation on a background C++ thread via Napi::AsyncWorker.
    try {
      const { initWhisper } = await import('@fugood/whisper.node');

      // Release any existing context before creating a new one
      if (whisperContext) {
        try { await whisperContext.release(); } catch { /* ignore */ }
        whisperContext = null;
      }

      whisperContext = await initWhisper({ filePath: modelPath });
      log.info(`Started (local) with model: ${require('path').basename(modelPath)}`);
    } catch (err) {
      log.error('Failed to initialize Whisper:', err);
      currentMeetingId = null;
      return;
    }
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
 * Accumulates chunks and dispatches 10-second segments to Whisper or API.
 */
export function addChunk(chunk: Buffer): void {
  if (!currentMeetingId) return;
  if (activeProvider === 'local' && !whisperContext) return;

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
  // Allow stop for both local and API modes
  if (activeProvider === 'local' && !whisperContext) return;
  if (activeProvider !== 'local' && !currentMeetingId) return;

  // Transcribe remaining accumulated audio (partial segment)
  if (accumulatorBuffer.byteLength > 0 && currentMeetingId) {
    pendingSegments.push(Buffer.from(accumulatorBuffer));
    accumulatorBuffer = Buffer.alloc(0);
    dispatchNext();
  }

  // Wait for pending transcriptions to finish
  await waitForPending();

  // Release whisper context
  if (whisperContext) {
    try { await whisperContext.release(); } catch { /* ignore */ }
    whisperContext = null;
  }

  currentMeetingId = null;
  activeProvider = 'local';
  log.info('Stopped');
}

/**
 * Calculate RMS (root-mean-square) of Int16 PCM samples.
 * Returns a value in Int16 amplitude range (0 to ~32768).
 */
function calculateInt16RMS(buffer: Buffer): number {
  const samples = new Int16Array(
    buffer.buffer, buffer.byteOffset, buffer.byteLength / 2,
  );
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

/** Dispatch the next pending segment to Whisper or cloud API */
function dispatchNext(): void {
  if (transcribing || pendingSegments.length === 0) return;

  // For local mode, need whisper context to be available
  if (activeProvider === 'local' && !whisperContext) return;

  const segment = pendingSegments.shift()!;
  const startTimeMs = segmentIndex * SEGMENT_DURATION_SEC * 1000;
  segmentIndex++;

  // Skip silent segments to avoid Whisper hallucinations and save CPU
  const rms = calculateInt16RMS(segment);
  if (rms < SILENCE_RMS_THRESHOLD) {
    log.debug(`Skipping silent segment #${segmentIndex - 1} (RMS: ${rms.toFixed(0)})`);
    dispatchNext(); // Try next segment
    return;
  }

  transcribing = true;

  if (activeProvider === 'local') {
    // Local Whisper: transcribe directly (non-blocking via native async worker)
    dispatchToWhisper(segment, startTimeMs);
  } else {
    // Cloud API: dispatch async
    dispatchToApi(segment, startTimeMs);
  }
}

/** Dispatch a segment to the local Whisper context for transcription */
async function dispatchToWhisper(segment: Buffer, startTimeMs: number): Promise<void> {
  try {
    // Convert Buffer to ArrayBuffer for the native module
    const arrayBuffer = segment.buffer.slice(
      segment.byteOffset,
      segment.byteOffset + segment.byteLength,
    ) as ArrayBuffer;

    // transcribeData returns { promise, stop }. The promise resolves when
    // the native Napi::AsyncWorker finishes on its background thread.
    const whisperOpts: Record<string, unknown> = {};
    if (activeLanguage !== 'auto') {
      whisperOpts.language = activeLanguage;
    }
    // When activeLanguage is 'auto', omit language so Whisper auto-detects per segment
    const { promise } = whisperContext!.transcribeData(arrayBuffer, whisperOpts);

    const result = await promise;

    transcribing = false;

    if (result.result && result.result.trim() && currentMeetingId) {
      lastTranscriptText = result.result.trim();

      // Save each segment to the database
      for (const seg of result.segments) {
        if (!seg.text.trim()) continue;
        // Sanitize timestamps — whisper.cpp may return denormalized floats
        const t0 = Number.isFinite(seg.t0) ? Math.round(seg.t0) : 0;
        const t1 = Number.isFinite(seg.t1) ? Math.round(seg.t1) : 0;
        const segStartMs = Math.max(0, Math.round(startTimeMs + t0));
        const segEndMs = Math.max(0, Math.round(startTimeMs + t1));

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
  } catch (err) {
    log.error('Whisper transcription failed:', err);
    transcribing = false;
  }

  // Process next pending segment
  dispatchNext();
}

/** Dispatch a segment to the configured cloud API (Deepgram or AssemblyAI) */
async function dispatchToApi(segment: Buffer, startTimeMs: number): Promise<void> {
  try {
    let result;
    if (activeProvider === 'deepgram') {
      result = await deepgramTranscriber.transcribeSegment(segment, startTimeMs, activeLanguage);
    } else {
      result = await assemblyaiTranscriber.transcribeSegment(segment, startTimeMs, activeLanguage);
    }

    // Process result — save to DB and push to renderer
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

    // FALLBACK: try local Whisper if context exists
    if (whisperContext) {
      log.debug('Falling back to local Whisper');
      await dispatchToWhisper(segment, startTimeMs);
      return; // dispatchToWhisper handles transcribing flag and dispatchNext
    }

    log.error('No fallback available. Skipping segment.');
  }

  transcribing = false;
  dispatchNext();
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
