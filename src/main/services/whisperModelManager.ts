// === FILE PURPOSE ===
// Whisper model management — download, locate, and check availability of GGML models.
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
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { settings } from '../db/schema';

const HF_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

export interface WhisperModelInfo {
  name: string;         // e.g., 'base.en'
  fileName: string;     // e.g., 'ggml-base.en.bin'
  size: string;         // Human-readable size
  description: string;
  recommended: boolean; // Show in UI model picker
}

/** Available models for download */
export const AVAILABLE_MODELS: WhisperModelInfo[] = [
  { name: 'tiny.en', fileName: 'ggml-tiny.en.bin', size: '39 MB', description: 'Fastest, English-only', recommended: false },
  { name: 'base.en', fileName: 'ggml-base.en.bin', size: '74 MB', description: 'Good speed, English-only', recommended: true },
  { name: 'small.en', fileName: 'ggml-small.en.bin', size: '244 MB', description: 'Best accuracy, English-only', recommended: true },
  { name: 'tiny', fileName: 'ggml-tiny.bin', size: '39 MB', description: 'Fastest, multilingual (99 languages)', recommended: false },
  { name: 'base', fileName: 'ggml-base.bin', size: '74 MB', description: 'Good speed, multilingual (99 languages)', recommended: true },
  { name: 'small', fileName: 'ggml-small.bin', size: '244 MB', description: 'Best accuracy, multilingual (99 languages)', recommended: true },
];

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
  const rows = await db
    .select()
    .from(settings)
    .where(eq(settings.key, PREFERRED_MODEL_KEY));
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

/** Download a model from HuggingFace with progress callback */
export function downloadModel(
  fileName: string,
  onProgress?: (downloaded: number, total: number) => void,
): { promise: Promise<string>; abort: () => void } {
  const url = `${HF_BASE_URL}/${fileName}`;
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
