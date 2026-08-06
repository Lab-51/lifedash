// === FILE PURPOSE ===
// Whisper model management — download, locate, and check availability of GGML models.
// Catalog includes English-only models (tiny.en, base.en, small.en), multilingual models
// (tiny, base, small, medium-q5), and large-v3-turbo-q5 for best CS/SK/mixed accuracy.
//
// === DEPENDENCIES ===
// electron (app), node:fs, node:path, node:https
//
// === LIMITATIONS ===
// - Downloads from HuggingFace only (no mirror support yet)
// - No checksum verification (future enhancement)
// - Single download at a time

import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { settings } from '../db/schema';

const HF_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

export interface WhisperModelInfo {
  name: string; // e.g., 'base.en'
  fileName: string; // e.g., 'ggml-base.en.bin'
  size: string; // Human-readable size
  description: string;
  recommended: boolean; // Show in UI model picker
}

/** Available models for download */
export const AVAILABLE_MODELS: WhisperModelInfo[] = [
  {
    name: 'tiny.en',
    fileName: 'ggml-tiny.en.bin',
    size: '39 MB',
    description: 'Fastest, English-only',
    recommended: false,
  },
  {
    name: 'base.en',
    fileName: 'ggml-base.en.bin',
    size: '74 MB',
    description: 'Good speed, English-only',
    recommended: true,
  },
  {
    name: 'small.en',
    fileName: 'ggml-small.en.bin',
    size: '244 MB',
    description: 'Best accuracy, English-only',
    recommended: true,
  },
  {
    name: 'tiny',
    fileName: 'ggml-tiny.bin',
    size: '39 MB',
    description: 'Fastest, multilingual (99 languages)',
    recommended: false,
  },
  {
    name: 'base',
    fileName: 'ggml-base.bin',
    size: '74 MB',
    description: 'Good speed, multilingual (99 languages)',
    recommended: true,
  },
  {
    name: 'small',
    fileName: 'ggml-small.bin',
    size: '244 MB',
    description: 'Best accuracy, multilingual (99 languages)',
    recommended: true,
  },
  {
    name: 'medium-q5',
    fileName: 'ggml-medium-q5_0.bin',
    size: '~539 MB',
    description: 'Large, multilingual (99 languages), strong CS/SK accuracy',
    recommended: true,
  },
  {
    name: 'large-v3-turbo-q5',
    fileName: 'ggml-large-v3-turbo-q5_0.bin',
    size: '~874 MB',
    description: 'Best multilingual accuracy, near real-time on GPU — recommended for Czech/Slovak/mixed',
    recommended: true,
  },
];

/** Last detected Whisper backend (metal, vulkan, cuda, or cpu). Updated after createWhisperContext(). */
let lastBackend = 'unknown';

/** Return the last detected Whisper backend ('metal', 'vulkan', 'cuda', 'cpu', or 'unknown' before first use). */
export function getBackend(): string {
  return lastBackend;
}

export function getModelsDir(): string {
  return path.join(app.getPath('userData'), 'whisper-models');
}

export function getModelPath(fileName: string): string {
  return path.join(getModelsDir(), fileName);
}

export function isModelAvailable(fileName: string): boolean {
  return fs.existsSync(getModelPath(fileName));
}

/** Get list of locally available models */
export function getLocalModels(): WhisperModelInfo[] {
  return AVAILABLE_MODELS.filter((m) => isModelAvailable(m.fileName));
}

const PREFERRED_MODEL_KEY = 'whisper:preferredModel';

/** Save a preferred model to the settings DB */
export async function setPreferredModel(fileName: string): Promise<void> {
  const db = getDb();
  await db
    .insert(settings)
    .values({ key: PREFERRED_MODEL_KEY, value: fileName, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: fileName, updatedAt: new Date() },
    });
}

/** Get the preferred model fileName from settings, or null if not set */
async function getPreferredModelFileName(): Promise<string | null> {
  const db = getDb();
  const rows = await db.select().from(settings).where(eq(settings.key, PREFERRED_MODEL_KEY));
  return rows.length > 0 ? rows[0].value : null;
}

/** Get the default model. Returns path if available, null if needs download. */
export async function getDefaultModelPath(): Promise<string | null> {
  // Check user-preferred model first
  const preferredFileName = await getPreferredModelFileName();
  if (preferredFileName && isModelAvailable(preferredFileName)) {
    return getModelPath(preferredFileName);
  }

  // Fall back to hardcoded priority: base.en → tiny.en → any available model
  const fallback = ['ggml-base.en.bin', 'ggml-tiny.en.bin'];
  for (const fileName of fallback) {
    if (isModelAvailable(fileName)) return getModelPath(fileName);
  }
  const local = getLocalModels();
  if (local.length > 0) return getModelPath(local[0].fileName);
  return null;
}

/**
 * Initialize a Whisper context with automatic GPU detection.
 *
 * macOS (darwin):
 *   The default @fugood/whisper.node binary on macOS includes Metal support.
 *   There are no separate 'metal' or 'vulkan' variant packages for darwin.
 *   We call initWhisper with useGpu: true (no variant), which activates Metal
 *   on Apple Silicon (arm64). On x86_64 macOS, GPU is not supported and it
 *   falls back to CPU automatically.
 *
 * Windows / Linux:
 *   Tries Vulkan (broadest GPU support) → CUDA → CPU fallback, using the
 *   separate variant packages (@fugood/node-whisper-*-vulkan, *-cuda).
 */
export async function createWhisperContext(modelPath: string): Promise<{
  context: Awaited<ReturnType<typeof import('@fugood/whisper.node').initWhisper>>;
  backend: string;
}> {
  const { initWhisper } = await import('@fugood/whisper.node');

  if (process.platform === 'darwin') {
    // Metal GPU is built into the default darwin binary — no variant needed.
    // useGpu: true enables Metal on arm64; on x86_64 it's a no-op (CPU only).
    try {
      const context = await initWhisper({ filePath: modelPath, useGpu: true });
      const backend = process.arch === 'arm64' ? 'metal' : 'cpu';
      lastBackend = backend;
      return { context, backend };
    } catch (err) {
      // Metal/GPU init failed — fall back to CPU without useGpu
      console.warn('[whisper] Metal GPU init failed, falling back to CPU:', (err as Error).message ?? err);
      const context = await initWhisper({ filePath: modelPath });
      lastBackend = 'cpu';
      return { context, backend: 'cpu' };
    }
  }

  // Windows / Linux: try GPU variant packages (vulkan → cuda), then CPU
  const variants = ['vulkan', 'cuda'] as const;
  for (const variant of variants) {
    try {
      const context = await initWhisper({ filePath: modelPath, useGpu: true }, variant);
      lastBackend = variant;
      console.info(`[whisper] GPU backend initialized: ${variant}`);
      return { context, backend: variant };
    } catch (err) {
      console.warn(`[whisper] ${variant} GPU init failed:`, (err as Error).message ?? err);
    }
  }

  // Fallback to CPU (default variant)
  console.warn('[whisper] All GPU variants failed — falling back to CPU');
  const context = await initWhisper({ filePath: modelPath });
  lastBackend = 'cpu';
  return { context, backend: 'cpu' };
}

/**
 * Initialize a WhisperVadContext — CPU-only on Windows/Linux, refused on darwin
 * (native abort, see below) — callers own the returned context and must call
 * context.release() when done, same lifecycle as WhisperContext.
 *
 * VAD deliberately does NOT mirror createWhisperContext's GPU-variant chain:
 * initWhisperVad on a GPU-capable binary hits a ggml buffer-placement assert
 * that calls native abort(), which no JS catch can intercept.
 */
export async function createVadContext(modelPath: string): Promise<{
  context: Awaited<ReturnType<typeof import('@fugood/whisper.node').initWhisperVad>>;
  backend: string;
}> {
  const { initWhisperVad } = await import('@fugood/whisper.node');

  if (process.platform === 'darwin') {
    // whisper.node <=1.1.1 darwin-arm64: the VAD loader places model weights in
    // a Metal buffer while whisper's scheduler only gets CPU/BLAS ("no GPU
    // found"), so whisper_vad_init_with_params hits a ggml assert and calls
    // native abort() — killing the process before any JS catch can run, with
    // useGpu true OR false. Never construct a VAD context here; callers treat
    // this rejection as "disable VAD, RMS-only pipeline" (transcriptionService
    // initVadContext), which is the designed degradation path.
    throw new Error('VAD unsupported on macOS: whisper.node native VAD init aborts (Metal buffer/scheduler mismatch)');
  }

  // Windows / Linux: CPU only, and the useGpu:false MUST be explicit.
  // whisper.node keeps a GLOBAL module cache: the first init in the process
  // wins and every later init reuses that native module, silently ignoring
  // its variant argument. Main transcription loads the vulkan variant first,
  // so VAD always receives the vulkan binding — and with useGpu defaulting to
  // true, VAD graph init hits a ggml buffer-placement assert and calls native
  // abort(), which no JS catch can intercept ("pre-allocated tensor (leaf_0)
  // in a buffer (Vulkan0) that cannot run the operation (NONE)"; reproduced
  // on whisper.node 1.0.16 AND 1.1.1, and only when a vulkan main context
  // already exists in the process — a fresh process passes, which is why
  // standalone probes missed it). Explicit useGpu:false is honored by the
  // vulkan binding (init + detect verified on real speech audio) and is inert
  // on the CPU package. Silero VAD is tiny; CPU inference is effectively free.
  const context = await initWhisperVad({ filePath: modelPath, useGpu: false });
  return { context, backend: 'cpu' };
}

/**
 * Download a model with progress callback. Defaults to HuggingFace's
 * ggerganov/whisper.cpp repo; pass `sourceUrl` to fetch from elsewhere (used
 * by ensureVadModel() below, whose model lives in a different HF repo).
 */
export function downloadModel(
  fileName: string,
  onProgress?: (downloaded: number, total: number) => void,
  sourceUrl?: string,
): { promise: Promise<string>; abort: () => void } {
  const url = sourceUrl ?? `${HF_BASE_URL}/${fileName}`;
  const destPath = getModelPath(fileName);
  let aborted = false;
  let req: ReturnType<typeof https.get> | null = null;

  const promise = new Promise<string>((resolve, reject) => {
    fs.mkdirSync(getModelsDir(), { recursive: true });
    const tempPath = `${destPath}.downloading`;

    const file = fs.createWriteStream(tempPath);
    const makeRequest = (requestUrl: string) => {
      req = https.get(requestUrl, (response) => {
        // Handle redirects (HuggingFace uses 302)
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            makeRequest(redirectUrl);
            return;
          }
        }

        if (response.statusCode !== 200) {
          file.close();
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          reject(new Error(`Download failed: HTTP ${response.statusCode}`));
          return;
        }

        const total = parseInt(response.headers['content-length'] || '0', 10);
        let downloaded = 0;

        response.on('data', (chunk: Buffer) => {
          if (aborted) return;
          downloaded += chunk.length;
          onProgress?.(downloaded, total);
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close(() => {
            if (aborted) {
              if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
              reject(new Error('Download aborted'));
              return;
            }
            // Rename temp → final (atomic on same filesystem)
            fs.renameSync(tempPath, destPath);
            resolve(destPath);
          });
        });
      });

      req.on('error', (err) => {
        file.close();
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        reject(err);
      });
    };

    makeRequest(url);
  });

  const abort = () => {
    aborted = true;
    req?.destroy();
  };

  return { promise, abort };
}

// === VAD (Voice Activity Detection) model — infrastructure, not user-facing ===
//
// Deliberately kept OUT of AVAILABLE_MODELS: users never choose this model, it is
// an internal input to the hallucination-suppression pipeline (TRANS-HALL.1).
//
// URL + sha256 verified 2026-08-04 by:
//   1. Reading whisper.cpp's own models/download-vad-model.sh (the project's
//      canonical source), which resolves to src="https://huggingface.co/ggml-org/whisper-vad"
//      pfx="resolve/main/ggml" — NOT the ggerganov/whisper.cpp repo AVAILABLE_MODELS uses.
//   2. Confirming the file exists via the HuggingFace API's file listing for
//      ggml-org/whisper-vad (siblings: ggml-silero-v5.1.2.bin, ggml-silero-v6.2.0.bin).
//   3. Downloading the file and computing its sha256 locally, then cross-checking
//      against the response's X-Linked-ETag header (HF's own recorded content hash).
//   4. Running a live spike: initWhisperVad() + detectSpeechData() against this exact
//      file on Windows (win32-x64, default/CPU backend) — speech buffer -> 3 segments,
//      silence buffer -> 0 segments.
const VAD_MODEL_FILENAME = 'ggml-silero-v5.1.2.bin';
const VAD_MODEL_URL = 'https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin';
const VAD_MODEL_SHA256 = '29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf';

let vadModelWarned = false;

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Ensure the Silero VAD model is present in the userData models dir, downloading
 * it via the existing whisper model download path (downloadModel) if missing or
 * corrupted. Idempotent — a second call with the file already present and
 * hash-verified is a no-op (no network request).
 *
 * NEVER throws. Resolves the model path on success, or null on any failure
 * (network error, HTTP error, sha256 mismatch, disk error) — logged once via
 * console.warn. Callers MUST treat a null result as "VAD unavailable" and fall
 * back to RMS-only behavior; this must never block transcription.
 */
export async function ensureVadModel(): Promise<string | null> {
  const destPath = getModelPath(VAD_MODEL_FILENAME);
  try {
    if (fs.existsSync(destPath)) {
      const existingHash = await sha256File(destPath);
      if (existingHash === VAD_MODEL_SHA256) return destPath;
      // Present but corrupted/partial — remove and re-download below.
      fs.unlinkSync(destPath);
    }

    const { promise } = downloadModel(VAD_MODEL_FILENAME, undefined, VAD_MODEL_URL);
    await promise;

    const downloadedHash = await sha256File(destPath);
    if (downloadedHash !== VAD_MODEL_SHA256) {
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      throw new Error(`sha256 mismatch: expected ${VAD_MODEL_SHA256}, got ${downloadedHash}`);
    }

    return destPath;
  } catch (err) {
    if (!vadModelWarned) {
      vadModelWarned = true;
      console.warn('[whisper-vad] VAD model unavailable, falling back to RMS-only:', (err as Error).message ?? err);
    }
    return null;
  }
}
