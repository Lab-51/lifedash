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
// - Fixed 10-second segments (VAD gates whole windows, it never splits them)
// - API providers add network latency per segment
//
// === NOTES ===
// Whisper runs in-process (no Worker thread). The native module's
// transcribeData() is non-blocking — it queues work on a background
// C++ thread via Napi::AsyncWorker and returns a Promise.
// Silence detection is two-stage: a cheap RMS fast path, then a Silero VAD
// gate (local provider only) that SKIPS whole windows with no detected
// speech. See the VAD section below — it never trims or remaps audio.

import { BrowserWindow } from 'electron';
import * as meetingService from './meetingService';
import * as liveTriageService from './liveTriageService';
import * as whisperModelManager from './whisperModelManager';
import * as transcriptionProviderService from './transcriptionProviderService';
import * as deepgramTranscriber from './deepgramTranscriber';
import * as assemblyaiTranscriber from './assemblyaiTranscriber';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { aiUsage, settings } from '../db/schema';
import { createLogger } from './logger';
import { trackTiming } from './performanceTracker';
import type { TranscriptionProviderType, TranscriptionProgress } from '../../shared/types';
import { resolveLanguagePreset, DEFAULT_MIXED_PROMPTS } from '../../shared/types/transcription';
import { findMatchedHallucinationPhrase } from '../../shared/transcription/hallucinationFilter';

const log = createLogger('Transcription');

// Whisper context types — imported as type-only to avoid eager native module loading
import type { WhisperContext, WhisperVadContext } from '@fugood/whisper.node';

// Whisper speed presets — trade accuracy for speed via beam search parameters
const WHISPER_PRESETS = {
  fast: { beamSize: 1, bestOf: 1 },
  balanced: { beamSize: 3, bestOf: 3 },
  accurate: { beamSize: 5, bestOf: 5 },
} as const;
type WhisperPreset = keyof typeof WHISPER_PRESETS;

const SAMPLE_RATE = 16000;
const SEGMENT_DURATION_SEC = 10;
const OVERLAP_SEC = 1; // 1s overlap to avoid splitting words at segment boundaries
const SAMPLES_PER_SEGMENT = SAMPLE_RATE * SEGMENT_DURATION_SEC; // 160,000
const BYTES_PER_SEGMENT = SAMPLES_PER_SEGMENT * 2; // 320,000 (Int16 = 2 bytes)
const OVERLAP_BYTES = SAMPLE_RATE * OVERLAP_SEC * 2; // 32,000

// Silence detection: RMS threshold below which a segment is skipped.
// Int16 range is -32768 to 32767. An RMS of 50 corresponds to ~0.15% of max,
// which is effectively silence or very faint background noise.
const SILENCE_RMS_THRESHOLD = 50;

let whisperContext: WhisperContext | null = null;
let vadContext: WhisperVadContext | null = null;
// Single shared init promise: dispatchNext runs up to MAX_CONCURRENT segments,
// so two windows can race on first use. Awaiting the same promise makes context
// creation single-flight without a lock.
let vadInitPromise: Promise<WhisperVadContext | null> | null = null;
// Session-scoped kill switch: set on the first VAD failure of any kind, after
// which the session is RMS-only (today's exact pipeline).
let vadDisabled = false;
let mainWindow: BrowserWindow | null = null;
let currentMeetingId: string | null = null;
let accumulatorBuffer: Buffer = Buffer.alloc(0);
let segmentIndex = 0;
let lastTranscriptText = '';
let pendingSegments: Buffer[] = []; // Queue of segments waiting to be transcribed
let activeTranscriptions = 0;
const MAX_CONCURRENT = 2;
let activeProvider: TranscriptionProviderType = 'local';
let activeLanguage: string = 'en';
let activePreset: WhisperPreset = 'balanced';
let lastSegmentPrompt: string = ''; // Previous segment text for context carryover
let activeInitialPrompt: string = ''; // Trilingual glossary seed for mixed-language presets

// Progress tracking for the renderer
let totalSegmentsQueued = 0;
let segmentsCompleted = 0;
let whisperBackend = 'cpu';

// Yield the shared GPU to transcription: register a busy-probe the proactive
// triage loop reads to SKIP runs while whisper/cloud transcription is in flight.
// Injected one-way — this module already imports liveTriageService (onSegment);
// liveTriageService must NOT import back (CODE-Q.1 cycle), so it reads this
// closure instead. `activeTranscriptions` brackets the whisper/API await
// (incremented in dispatchNext before dispatch, decremented after the await);
// `pendingSegments` holds not-yet-dispatched segments. Registered once at module
// init; the closure reads live state, correct across recordings.
liveTriageService.setTranscriptionBusyProbe(() => activeTranscriptions > 0 || pendingSegments.length > 0);

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win;
}

export function getLastTranscript(): string {
  return lastTranscriptText;
}

/** Emit a progress event to the renderer */
function emitProgress(phase: TranscriptionProgress['phase']): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('recording:processing-progress', {
    phase,
    currentSegment: segmentsCompleted,
    totalSegments: totalSegmentsQueued,
    percentComplete: totalSegmentsQueued > 0 ? Math.round((segmentsCompleted / totalSegmentsQueued) * 100) : 0,
    backendUsed: activeProvider === 'local' ? whisperBackend : activeProvider,
  } satisfies TranscriptionProgress);
}

/** Return current progress state (for use by audioProcessor) */
export function getProgress(): TranscriptionProgress {
  return {
    phase: 'transcribing',
    currentSegment: segmentsCompleted,
    totalSegments: totalSegmentsQueued,
    percentComplete: totalSegmentsQueued > 0 ? Math.round((segmentsCompleted / totalSegmentsQueued) * 100) : 0,
    backendUsed: activeProvider === 'local' ? whisperBackend : activeProvider,
  };
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

  // LOCAL-ONLY ENFORCEMENT (read ONCE at recording start, not per-chunk):
  // if the privacy control is on and a cloud provider is configured, never issue
  // a network request — force the local Whisper path for this whole session and
  // surface one renderer toast. Lives in main because a control the UI alone
  // enforces is not a control.
  if (activeProvider !== 'local' && (await transcriptionProviderService.isLocalOnly())) {
    log.warn(`Local-only mode is on — cloud provider '${activeProvider}' blocked; falling back to local Whisper`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Reuse the existing 'fallback' status → renderer shows an info toast.
      mainWindow.webContents.send('transcription:status-changed', {
        status: 'fallback',
        reason: 'Local-only mode is on — cloud transcription blocked, using local Whisper',
      });
    }
    activeProvider = 'local';
  }

  // Use per-recording language if provided, otherwise fall back to DB setting
  if (language) {
    activeLanguage = language;
  } else {
    const db = getDb();
    const langRows = await db.select().from(settings).where(eq(settings.key, 'transcription:language'));
    activeLanguage = langRows.length > 0 ? langRows[0].value : 'en';

    const presetRows = await db.select().from(settings).where(eq(settings.key, 'transcription:speed-preset'));
    const preset = presetRows.length > 0 ? presetRows[0].value : 'balanced';
    activePreset = (preset in WHISPER_PRESETS ? preset : 'balanced') as WhisperPreset;
  }

  // Resolve mixed-language preset: extract base language and seed the initial prompt
  {
    const preset = resolveLanguagePreset(activeLanguage);
    activeLanguage = preset.baseLanguage;
    activeInitialPrompt = '';
    if (preset.mixedCode) {
      const db = getDb();
      const promptKey = `transcription:initial-prompt:${preset.mixedCode}`;
      const promptRows = await db.select().from(settings).where(eq(settings.key, promptKey));
      activeInitialPrompt =
        promptRows.length > 0 && promptRows[0].value ? promptRows[0].value : DEFAULT_MIXED_PROMPTS[preset.mixedCode];
    }
  }

  // Common state reset
  currentMeetingId = meetingId;
  accumulatorBuffer = Buffer.alloc(0);
  segmentIndex = 0;
  lastTranscriptText = '';
  lastSegmentPrompt = '';
  pendingSegments = [];
  activeTranscriptions = 0;
  totalSegmentsQueued = 0;
  segmentsCompleted = 0;
  whisperBackend = 'cpu';

  // Fresh VAD gate per session: a previous session's failure must not disable
  // this one, and a leaked context must not outlive it.
  await releaseVadContext();
  vadDisabled = false;

  if (activeProvider === 'local') {
    // Local Whisper path — need a model
    const modelPath = await whisperModelManager.getDefaultModelPath();
    if (!modelPath) {
      log.info('No whisper model available. Skipping transcription.');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('transcription:status-changed', {
          status: 'failed',
          reason: 'Whisper model not available',
        });
      }
      currentMeetingId = null;
      return;
    }

    // Initialize whisper context directly in the main process.
    // transcribeData() is non-blocking — the native module runs heavy
    // computation on a background C++ thread via Napi::AsyncWorker.
    try {
      // Release any existing context before creating a new one
      if (whisperContext) {
        try {
          await whisperContext.release();
        } catch {
          /* ignore */
        }
        whisperContext = null;
      }

      const { context, backend } = await whisperModelManager.createWhisperContext(modelPath);
      whisperContext = context;
      whisperBackend = backend;
      const modelName = modelPath.split(/[\\/]/).pop() ?? modelPath;
      log.info(`Started (local) with model: ${modelName} [${backend}], speed preset: ${activePreset}`);
    } catch (err) {
      log.error('Failed to initialize Whisper:', err);
      currentMeetingId = null;
      return;
    }
  } else {
    // Cloud API provider — verify key is configured
    const key = await transcriptionProviderService.getDecryptedKey(activeProvider as 'deepgram' | 'assemblyai');
    if (!key) {
      log.info(`No API key configured for ${activeProvider}. Skipping transcription.`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('transcription:status-changed', {
          status: 'failed',
          reason: `No API key configured for ${activeProvider}`,
        });
      }
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

  // When we have enough for a full segment, queue it.
  // Keep 1s overlap so words at segment boundaries aren't lost.
  while (accumulatorBuffer.byteLength >= BYTES_PER_SEGMENT) {
    const segment = accumulatorBuffer.subarray(0, BYTES_PER_SEGMENT);
    pendingSegments.push(Buffer.from(segment)); // Copy to avoid reference issues
    totalSegmentsQueued++;
    // Advance by (segment - overlap) so the next segment starts 1s earlier
    const advance = BYTES_PER_SEGMENT - OVERLAP_BYTES;
    accumulatorBuffer = accumulatorBuffer.subarray(advance);
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
    totalSegmentsQueued++;
    accumulatorBuffer = Buffer.alloc(0);
    emitProgress('finalizing');
    dispatchNext();
  }

  // Wait for pending transcriptions to finish
  await waitForPending();

  // Release whisper context
  if (whisperContext) {
    try {
      await whisperContext.release();
    } catch {
      /* ignore */
    }
    whisperContext = null;
  }

  // Release the VAD context alongside it (same lifecycle, same owner).
  await releaseVadContext();

  currentMeetingId = null;
  activeProvider = 'local';
  activeInitialPrompt = '';
  log.info('Stopped');
}

/**
 * Calculate RMS (root-mean-square) of Int16 PCM samples.
 * Returns a value in Int16 amplitude range (0 to ~32768).
 */
function calculateInt16RMS(buffer: Buffer): number {
  const samples = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2);
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

// === VAD gate (TRANS-HALL.1) ==============================================
// Second silence stage, after the cheap RMS fast path. SKIP-ONLY: a window with
// any detected speech is transcribed in FULL, byte-identically to before — the
// detected spans are never used to trim or remap audio, so timestamp and
// 1s-overlap bookkeeping is untouched. Only zero-speech windows are skipped,
// with the same bookkeeping as the RMS skip.
//
// Every failure mode (model unavailable, context init, inference) degrades to
// RMS-only for the rest of the session, logged once. VAD must never block or
// break a recording.

/** Disable VAD for the rest of the session, logging the reason exactly once. */
function disableVad(reason: string): void {
  if (vadDisabled) return;
  vadDisabled = true;
  log.warn(`${reason} — using RMS-only silence detection for the rest of this session`);
}

/** Create the VAD context. Never rejects — resolves null and disables VAD instead. */
async function initVadContext(): Promise<WhisperVadContext | null> {
  try {
    const modelPath = await whisperModelManager.ensureVadModel();
    if (!modelPath) {
      disableVad('VAD model unavailable');
      return null;
    }
    const { context, backend } = await whisperModelManager.createVadContext(modelPath);
    vadContext = context;
    log.info(`VAD gate active [${backend}]`);
    return context;
  } catch (err) {
    disableVad(`VAD init failed (${(err as Error)?.message ?? String(err)})`);
    return null;
  }
}

/** Single-flight accessor — concurrent first-use windows share one init. */
function getVadContext(): Promise<WhisperVadContext | null> {
  vadInitPromise ??= initVadContext();
  return vadInitPromise;
}

/** Release the VAD context and reset the per-session gate state. */
async function releaseVadContext(): Promise<void> {
  // Settle any in-flight init first so its context can't outlive the session.
  const pendingInit = vadInitPromise;
  vadInitPromise = null;
  if (pendingInit) await pendingInit; // never rejects (initVadContext catches)

  const context = vadContext;
  vadContext = null;
  if (!context) return;
  try {
    await context.release();
  } catch {
    /* ignore */
  }
}

/**
 * True when the window contains no detected speech and may be skipped whole.
 * Never throws: on any failure VAD is disabled for the session and this returns
 * false, so the window is transcribed exactly as it is today.
 */
async function isWindowSilentByVad(segment: Buffer): Promise<boolean> {
  // Cloud providers keep today's pipeline untouched — VAD is part of the local
  // Whisper hallucination fix and must not gate network transcription.
  if (vadDisabled || activeProvider !== 'local') return false;

  const context = await getVadContext();
  if (!context) return false;

  try {
    // Copy into a standalone ArrayBuffer — `segment` itself is passed on to
    // transcription untouched.
    const pcm = segment.buffer.slice(segment.byteOffset, segment.byteOffset + segment.byteLength) as ArrayBuffer;
    const speech = await context.detectSpeechData(pcm);
    return speech.length === 0;
  } catch (err) {
    disableVad(`VAD detection failed (${(err as Error)?.message ?? String(err)})`);
    return false;
  }
}

/** Dispatch the next pending segment to Whisper or cloud API */
function dispatchNext(): void {
  if (activeTranscriptions >= MAX_CONCURRENT || pendingSegments.length === 0) return;

  // For local mode, need whisper context to be available
  if (activeProvider === 'local' && !whisperContext) return;

  const segment = pendingSegments.shift()!;
  const startTimeMs = segmentIndex * SEGMENT_DURATION_SEC * 1000;
  const segmentNumber = segmentIndex;
  segmentIndex++;

  // Skip silent segments to avoid Whisper hallucinations and save CPU
  const rms = calculateInt16RMS(segment);
  if (rms < SILENCE_RMS_THRESHOLD) {
    log.debug(`Skipping silent segment #${segmentNumber} (RMS: ${rms.toFixed(0)})`);
    segmentsCompleted++;
    emitProgress('transcribing');
    dispatchNext(); // Try next segment
    return;
  }

  // Claim the concurrency slot before the (async) VAD check, so an in-flight
  // check keeps stop() waiting instead of releasing contexts underneath it.
  activeTranscriptions++;
  void gateAndDispatch(segment, startTimeMs, segmentNumber);

  // Try to fill the next concurrent slot
  dispatchNext();
}

/**
 * Run the VAD gate for a window that passed RMS, then dispatch it unchanged.
 * A skipped window gets the same bookkeeping as the RMS skip: progress
 * increments, nothing persisted, no triage.
 */
async function gateAndDispatch(segment: Buffer, startTimeMs: number, segmentNumber: number): Promise<void> {
  if (await isWindowSilentByVad(segment)) {
    log.debug(`Skipping segment #${segmentNumber} — no speech detected (VAD)`);
    activeTranscriptions--;
    segmentsCompleted++;
    emitProgress('transcribing');
    dispatchNext(); // Try next segment
    return;
  }

  if (activeProvider === 'local') {
    // Local Whisper: transcribe directly (non-blocking via native async worker)
    await dispatchToWhisper(segment, startTimeMs, segmentNumber);
  } else {
    // Cloud API: dispatch async
    await dispatchToApi(segment, startTimeMs, segmentNumber);
  }
}

/** Dispatch a segment to the local Whisper context for transcription */
async function dispatchToWhisper(segment: Buffer, startTimeMs: number, segmentNumber: number): Promise<void> {
  try {
    // Convert Buffer to ArrayBuffer for the native module
    const arrayBuffer = segment.buffer.slice(
      segment.byteOffset,
      segment.byteOffset + segment.byteLength,
    ) as ArrayBuffer;

    // transcribeData returns { promise, stop }. The promise resolves when
    // the native Napi::AsyncWorker finishes on its background thread.
    const presetOpts = WHISPER_PRESETS[activePreset];
    const whisperOpts: Record<string, unknown> = {
      beamSize: presetOpts.beamSize,
      bestOf: presetOpts.bestOf,
      temperature: 0, // Deterministic, less hallucination
      temperatureInc: 0.2, // Fallback temperature if decoding fails
    };
    if (activeLanguage !== 'auto') {
      whisperOpts.language = activeLanguage;
    }
    // Build prompt: glossary (initial prompt) takes priority; recent context fills remaining budget
    {
      let finalPrompt = '';
      if (activeInitialPrompt && lastSegmentPrompt) {
        const budget = 250;
        const glossary = activeInitialPrompt.slice(0, budget);
        const remaining = Math.max(0, budget - glossary.length - 1);
        finalPrompt = remaining > 0 ? `${glossary} ${lastSegmentPrompt.slice(-remaining)}` : glossary;
      } else {
        finalPrompt = activeInitialPrompt || lastSegmentPrompt;
      }
      if (finalPrompt) whisperOpts.prompt = finalPrompt;
    }
    // When activeLanguage is 'auto', omit language so Whisper auto-detects per segment
    const { promise } = whisperContext!.transcribeData(arrayBuffer, whisperOpts);

    const result = await trackTiming(`Whisper: segment #${segmentNumber}`, () => promise);

    activeTranscriptions--;
    segmentsCompleted++;
    emitProgress('transcribing');

    if (result.result && result.result.trim() && currentMeetingId) {
      lastTranscriptText = result.result.trim();

      // Save each segment to the database. Track only the text that survives
      // the hallucination filter — a dropped hallucination must never feed
      // back into the next window's Whisper prompt (self-reinforcement loop).
      const survivingTexts: string[] = [];

      for (const seg of result.segments) {
        const segText = seg.text.trim();
        if (!segText) continue;

        const matchedPhrase = findMatchedHallucinationPhrase(segText);
        if (matchedPhrase) {
          log.debug(`Dropping hallucinated segment #${segmentNumber} (matched: "${matchedPhrase}")`);
          continue;
        }

        survivingTexts.push(segText);

        // Sanitize timestamps — whisper.cpp may return denormalized floats
        const t0 = Number.isFinite(seg.t0) ? Math.round(seg.t0) : 0;
        const t1 = Number.isFinite(seg.t1) ? Math.round(seg.t1) : 0;
        const segStartMs = Math.max(0, Math.round(startTimeMs + t0));
        const segEndMs = Math.max(0, Math.round(startTimeMs + t1));

        try {
          const saved = await meetingService.addTranscriptSegment(currentMeetingId, segText, segStartMs, segEndMs);

          // Push segment to renderer
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('recording:transcript-segment', saved);
          }

          // Feed the proactive triage loop (non-throwing; fires on its own cadence).
          liveTriageService.onSegment(currentMeetingId);
        } catch (err) {
          log.error('Failed to save segment:', err);
        }
      }

      // Keep last ~200 chars of surviving text as context prompt for the next
      // segment. If everything in this window was filtered, leave the prior
      // prompt in place rather than feeding a hallucination forward.
      if (survivingTexts.length > 0) {
        lastSegmentPrompt = survivingTexts.join(' ').slice(-200);
      }
    }
  } catch (err) {
    log.error('Whisper transcription failed:', err);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('transcription:status-changed', {
        status: 'error',
        reason: 'Transcription failed for audio chunk',
      });
    }
    activeTranscriptions--;
  }

  // Process next pending segment
  dispatchNext();
}

/** Dispatch a segment to the configured cloud API (Deepgram or AssemblyAI) */
async function dispatchToApi(segment: Buffer, startTimeMs: number, segmentNumber: number): Promise<void> {
  try {
    const result = await trackTiming(`Transcription API: ${activeProvider}`, async () => {
      if (activeProvider === 'deepgram') {
        return deepgramTranscriber.transcribeSegment(segment, startTimeMs, activeLanguage);
      }
      return assemblyaiTranscriber.transcribeSegment(segment, startTimeMs, activeLanguage);
    });

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

          // Feed the proactive triage loop (non-throwing; fires on its own cadence).
          liveTriageService.onSegment(currentMeetingId);
        } catch (err) {
          log.error('Failed to save segment:', err);
        }
      }

      // Log API usage (fire-and-forget)
      try {
        const durationSec = segment.byteLength / (SAMPLE_RATE * 2);
        await getDb()
          .insert(aiUsage)
          .values({
            providerId: null,
            model: activeProvider,
            taskType: 'transcription',
            promptTokens: Math.round(durationSec),
            completionTokens: 0,
            totalTokens: Math.round(durationSec),
          });
      } catch {
        /* non-fatal */
      }
    }
  } catch (err) {
    log.error(`API (${activeProvider}) failed:`, err);

    // FALLBACK: try local Whisper if context exists
    if (whisperContext) {
      log.debug('Falling back to local Whisper');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('transcription:status-changed', {
          status: 'fallback',
          reason: 'API transcription failed, using local Whisper',
        });
      }
      await dispatchToWhisper(segment, startTimeMs, segmentNumber);
      return; // dispatchToWhisper handles activeTranscriptions and dispatchNext
    }

    log.error('No fallback available. Skipping segment.');
  }

  activeTranscriptions--;
  segmentsCompleted++;
  emitProgress('transcribing');
  dispatchNext();
}

/** Wait for all pending transcriptions to complete */
function waitForPending(): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (activeTranscriptions === 0 && pendingSegments.length === 0) {
        resolve();
      } else {
        setTimeout(check, 200);
      }
    };
    check();
  });
}
