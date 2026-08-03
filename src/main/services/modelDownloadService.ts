// === FILE PURPOSE ===
// Generic resumable file downloader for local GGUF models. Downloads to a `.part`
// sibling, resumes across app restarts with an HTTP Range request, verifies sha256,
// then atomically renames into place. One active transfer at a time with a queue.
//
// === DEPENDENCIES ===
// node:fs, node:path, node:crypto, node:stream, node:events, global fetch (undici),
// ./llamaRuntimeConfig (getModelsDir — Task 2's helper, deliberately not duplicated)
//
// === WHY RESUME IS NON-NEGOTIABLE ===
// Catalog entries run to 14 GB. whisperModelManager restarts from zero on any
// interruption, which is survivable for a 74 MB whisper model and not for these.
// Resume is proven against a real interrupted transfer, not a simulated one.
//
// === DESTRUCTIVE-OPERATION POLICY ===
// Cleanup only ever unlinks the two exact files this service created for a job
// (`<name>.part` and `<name>.part.json`), after confirming each is a regular file.
// Never a directory, never a recursive walk, never a glob — a bug here would delete
// a user's multi-GB model collection.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { getModelsDir } from './llamaRuntimeConfig';
import { activateBuiltinAfterDownload } from './builtinProviderSetup';
import { emitRuntimeStatus } from './runtimeTelemetry';
import { inferredRoleForFileName, runtimeModelIdForUrl } from '../../shared/types/localModels';
import type { LocalModelDownloadProgress, LocalModelDownloadState } from '../../shared/types/localModels';

/** Refuse to start unless free space covers the remaining bytes with 10% headroom. */
const DISK_HEADROOM = 1.1;
/** Progress events are chatty; one per quarter second is plenty for a progress bar. */
const PROGRESS_INTERVAL_MS = 250;

export interface DownloadRequest {
  /** Stable job identity, e.g. `qwen3-14b:Q4_K_M`. Re-enqueuing the same key resumes it. */
  key: string;
  url: string;
  /** Final name inside the models dir; also decides the runtime model id. */
  fileName: string;
  /** Expected content hash. Empty/omitted = unknown (custom URL): computed and reported, not enforced. */
  sha256?: string;
  /** Expected size, when the catalog knows it. Enables an exact preflight and a size check. */
  sizeBytes?: number;
}

interface Job extends DownloadRequest {
  state: LocalModelDownloadState;
  received: number;
  total: number;
  error?: string;
  verifiedSha256?: string;
  controller: AbortController | null;
  pauseRequested: boolean;
  cancelRequested: boolean;
  lastEmitAt: number;
  lastEmitBytes: number;
  bytesPerSecond: number;
}

/** `progress` fires with a LocalModelDownloadProgress on every state/byte update. */
export const downloadEvents = new EventEmitter();

const jobs = new Map<string, Job>();
const queue: string[] = [];
let activeKey: string | null = null;

// --- Paths --------------------------------------------------------------------

/** Resolve a filename to its destination, rejecting anything that escapes the models dir. */
function destPathFor(fileName: string): string {
  const dir = getModelsDir();
  const dest = path.join(dir, path.basename(fileName));
  if (path.dirname(path.resolve(dest)) !== path.resolve(dir)) {
    throw new Error(`Refusing to write outside the models directory: ${fileName}`);
  }
  return dest;
}

const partPathFor = (dest: string): string => `${dest}.part`;
const metaPathFor = (dest: string): string => `${dest}.part.json`;

/**
 * Unlink exactly the two sidecar files for one job. Each is stat-checked as a
 * regular file first, so a symlink/junction planted at the path is left alone.
 */
function removePartFiles(dest: string): void {
  for (const p of [partPathFor(dest), metaPathFor(dest)]) {
    try {
      if (fs.lstatSync(p).isFile()) fs.unlinkSync(p);
    } catch {
      // Absent or not a regular file — nothing this service owns, leave it.
    }
  }
}

function sizeOf(file: string): number {
  try {
    const st = fs.statSync(file);
    return st.isFile() ? st.size : 0;
  } catch {
    return 0;
  }
}

// --- Preflight ----------------------------------------------------------------

/** Free bytes on the volume holding `dir`. Returns null when the platform won't say. */
export function freeSpaceBytes(dir: string): number | null {
  try {
    const st = fs.statfsSync(dir);
    return Number(st.bavail) * Number(st.bsize);
  } catch {
    return null;
  }
}

/** Throw before a single byte is written if the volume can't hold what's left. */
function assertDiskSpace(dir: string, remainingBytes: number): void {
  if (remainingBytes <= 0) return;
  const free = freeSpaceBytes(dir);
  if (free === null) return; // Unknown — don't block the user on a probe we can't trust.
  const required = Math.ceil(remainingBytes * DISK_HEADROOM);
  if (free < required) {
    const gb = (n: number) => (n / 1024 ** 3).toFixed(1);
    throw new Error(`Not enough disk space: ${gb(required)} GB needed, ${gb(free)} GB free on ${dir}.`);
  }
}

// --- Progress -----------------------------------------------------------------

function snapshot(job: Job): LocalModelDownloadProgress {
  return {
    key: job.key,
    fileName: job.fileName,
    state: job.state,
    receivedBytes: job.received,
    totalBytes: job.total,
    percent: job.total > 0 ? Math.min(100, Math.round((job.received / job.total) * 100)) : 0,
    bytesPerSecond: job.bytesPerSecond,
    sha256: job.verifiedSha256,
    error: job.error,
  };
}

function emit(job: Job, force = false): void {
  const now = Date.now();
  if (!force && now - job.lastEmitAt < PROGRESS_INTERVAL_MS) return;
  const elapsed = (now - job.lastEmitAt) / 1000;
  if (elapsed > 0) job.bytesPerSecond = Math.max(0, Math.round((job.received - job.lastEmitBytes) / elapsed));
  job.lastEmitAt = now;
  job.lastEmitBytes = job.received;
  downloadEvents.emit('progress', snapshot(job));
}

function setState(job: Job, state: LocalModelDownloadState, error?: string): void {
  job.state = state;
  job.error = error;
  emit(job, true);
}

// --- Resume bookkeeping -------------------------------------------------------

interface PartMeta {
  url: string;
  sha256: string;
  sizeBytes: number;
}

/**
 * Bytes already on disk that we're allowed to keep. A `.part` whose sidecar names a
 * different URL/hash belongs to a superseded catalog entry — resuming onto it would
 * splice two different files together, so it is discarded first.
 */
function readPartMeta(dest: string): PartMeta | null {
  try {
    return JSON.parse(fs.readFileSync(metaPathFor(dest), 'utf-8')) as PartMeta;
  } catch {
    return null; // absent or corrupt — treated the same as "no resume available"
  }
}

function usableExistingBytes(dest: string, job: Job): number {
  const existing = sizeOf(partPathFor(dest));
  if (existing === 0) return 0;
  const meta = readPartMeta(dest);
  const matches = meta !== null && meta.url === job.url && meta.sha256 === (job.sha256 ?? '');
  if (!matches) {
    removePartFiles(dest);
    return 0;
  }
  return existing;
}

function writePartMeta(dest: string, job: Job): void {
  const meta: PartMeta = { url: job.url, sha256: job.sha256 ?? '', sizeBytes: job.sizeBytes ?? 0 };
  fs.writeFileSync(metaPathFor(dest), JSON.stringify(meta), 'utf-8');
}

// --- Verification -------------------------------------------------------------

/** Stream a file through sha256. Re-reads the whole `.part`, which is what makes a
 *  resumed download verifiable at all — hash state can't survive a process exit. */
export async function hashFile(file: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

// --- Transfer -----------------------------------------------------------------

interface OpenedRange {
  body: NodeJS.ReadableStream;
  startAt: number;
  total: number;
}

/**
 * Reconcile what the server actually did with what we asked for. A 206 must start at
 * exactly the byte we requested; a 200 means the server ignored the Range header, so
 * the write has to restart from zero rather than append a second copy onto the partial.
 */
function resolveOffsets(res: Response, existing: number, fallbackTotal: number): { startAt: number; total: number } {
  const contentLength = Number(res.headers.get('content-length') ?? 0);
  if (res.status !== 206) {
    return { startAt: 0, total: contentLength || fallbackTotal };
  }
  const match = /bytes\s+(\d+)-\d+\/(\d+)/i.exec(res.headers.get('content-range') ?? '');
  if (!match || Number(match[1]) !== existing) {
    throw new Error('Download failed: server returned an unexpected byte range');
  }
  return { startAt: existing, total: Number(match[2]) || existing + contentLength || fallbackTotal };
}

/** Issue the (possibly ranged) request and hand back a Node stream plus the offsets. */
async function openRange(job: Job, existing: number, signal: AbortSignal): Promise<OpenedRange> {
  const headers: Record<string, string> = {};
  if (existing > 0) headers.Range = `bytes=${existing}-`;
  const res = await fetch(job.url, { headers, signal, redirect: 'follow' });

  if (res.status === 416 && job.sizeBytes && existing >= job.sizeBytes) {
    // Partial is already full length; nothing left to fetch, go straight to verify.
    return { body: Readable.from([]), startAt: existing, total: job.sizeBytes };
  }
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} ${res.statusText}`);
  if (!res.body) throw new Error('Download failed: empty response body');

  const { startAt, total } = resolveOffsets(res, existing, job.sizeBytes ?? 0);
  const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  return { body, startAt, total };
}

/** Stream the response into `.part` with backpressure, reporting progress as it goes. */
async function writeBody(job: Job, partPath: string, opened: OpenedRange): Promise<void> {
  const out = fs.createWriteStream(partPath, { flags: opened.startAt > 0 ? 'a' : 'w' });
  try {
    for await (const chunk of opened.body) {
      const buf = chunk as Buffer;
      if (!out.write(buf)) {
        // Both listeners are removed on settle; leaving the loser attached would
        // accumulate one dead handler per backpressure pause over a multi-GB file.
        await new Promise<void>((resolve, reject) => {
          const onDrain = (): void => {
            out.off('error', onError);
            resolve();
          };
          const onError = (err: Error): void => {
            out.off('drain', onDrain);
            reject(err);
          };
          out.once('drain', onDrain);
          out.once('error', onError);
        });
      }
      job.received += buf.length;
      emit(job);
    }
  } finally {
    await new Promise<void>((resolve) => out.close(() => resolve()));
  }
}

async function runJob(job: Job): Promise<void> {
  const dir = getModelsDir();
  await fsp.mkdir(dir, { recursive: true });
  const dest = destPathFor(job.fileName);
  const partPath = partPathFor(dest);

  const existing = usableExistingBytes(dest, job);
  job.received = existing;
  job.total = job.sizeBytes ?? 0;

  assertDiskSpace(dir, (job.sizeBytes ?? 0) - existing);
  writePartMeta(dest, job);

  const controller = new AbortController();
  job.controller = controller;
  setState(job, 'downloading');

  const opened = await openRange(job, existing, controller.signal);
  job.total = opened.total;
  if (opened.startAt === 0) job.received = 0;
  // Second preflight for entries whose size the catalog didn't know (custom URLs):
  // the server has now told us, and still nothing has been written.
  assertDiskSpace(dir, opened.total - job.received);
  await writeBody(job, partPath, opened);
  job.controller = null;

  // --- Verify ---------------------------------------------------------------
  setState(job, 'verifying');
  const actualSize = sizeOf(partPath);
  if (job.sizeBytes && actualSize !== job.sizeBytes) {
    removePartFiles(dest);
    throw new Error(`Download incomplete: expected ${job.sizeBytes} bytes, got ${actualSize}.`);
  }
  const digest = await hashFile(partPath);
  if (job.sha256 && digest !== job.sha256) {
    removePartFiles(dest); // Surgical: exactly this job's .part and .part.json.
    throw new Error(`Checksum mismatch for ${job.fileName} — the download was discarded. Please retry.`);
  }
  job.verifiedSha256 = digest;

  // Atomic within the models dir (same filesystem), so the runtime never sees a torn file.
  await fsp.rename(partPath, dest);
  removePartFiles(dest); // drops the now-orphaned .part.json only
  job.received = actualSize;
  job.total = actualSize;
  setState(job, 'ready');

  // The file is on disk and verified — make it usable. Fire-and-forget on
  // purpose: the download SUCCEEDED, and a provider/settings write failing must
  // never turn that into a reported failure. Spawns nothing.
  void activateAfterDownload(job);
}

/** Ensure the built-in provider exists so the new file is routable, then push a
 *  fresh snapshot so the status indicator and Settings update without a
 *  restart. Never throws into the download path. */
async function activateAfterDownload(job: Job): Promise<void> {
  try {
    const changed = await activateBuiltinAfterDownload(
      runtimeModelIdForUrl(job.url),
      inferredRoleForFileName(job.fileName),
    );
    if (changed) await emitRuntimeStatus();
  } catch {
    // Activation is a convenience on top of a completed download; the user can
    // still switch it on from Settings → Local AI.
  }
}

// --- Queue --------------------------------------------------------------------

function pump(): void {
  if (activeKey !== null) return;
  const next = queue.shift();
  if (next === undefined) return;
  const job = jobs.get(next);
  if (!job || job.cancelRequested) {
    pump();
    return;
  }
  activeKey = next;
  runJob(job)
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      if (job.cancelRequested) {
        removePartFiles(destPathFor(job.fileName));
        jobs.delete(job.key);
        downloadEvents.emit('progress', { ...snapshot(job), state: 'error' as const, error: 'Cancelled' });
      } else if (job.pauseRequested) {
        job.pauseRequested = false;
        setState(job, 'paused');
      } else {
        setState(job, 'error', message);
      }
    })
    .finally(() => {
      job.controller = null;
      activeKey = null;
      pump();
    });
}

/** Queue a download (or resume a paused/failed one). Returns the current snapshot. */
export function enqueue(req: DownloadRequest): LocalModelDownloadProgress {
  const existing = jobs.get(req.key);
  if (existing && (existing.state === 'downloading' || existing.state === 'queued' || existing.state === 'verifying')) {
    return snapshot(existing);
  }
  const job: Job = {
    ...req,
    sha256: req.sha256 ? req.sha256.toLowerCase() : undefined,
    state: 'queued',
    received: 0,
    total: req.sizeBytes ?? 0,
    controller: null,
    pauseRequested: false,
    cancelRequested: false,
    lastEmitAt: Date.now(),
    lastEmitBytes: 0,
    bytesPerSecond: 0,
  };
  jobs.set(req.key, job);
  queue.push(req.key);
  emit(job, true);
  pump();
  return snapshot(job);
}

/** Stop transferring but keep the `.part` so the next enqueue resumes it. */
export function pause(key: string): boolean {
  const job = jobs.get(key);
  if (!job) return false;
  if (job.state === 'queued') {
    const i = queue.indexOf(key);
    if (i >= 0) queue.splice(i, 1);
    setState(job, 'paused');
    return true;
  }
  if (job.state !== 'downloading') return false;
  job.pauseRequested = true;
  job.controller?.abort();
  return true;
}

/** Abandon a download and delete its partial data. */
export function cancel(key: string): boolean {
  const job = jobs.get(key);
  if (!job) return false;
  job.cancelRequested = true;
  const i = queue.indexOf(key);
  if (i >= 0) queue.splice(i, 1);
  if (job.state === 'downloading') {
    job.controller?.abort();
    return true;
  }
  removePartFiles(destPathFor(job.fileName));
  jobs.delete(key);
  downloadEvents.emit('progress', { ...snapshot(job), state: 'error' as const, error: 'Cancelled' });
  return true;
}

/** Snapshots of every tracked job (queued, running, paused, finished, failed). */
export function listDownloads(): LocalModelDownloadProgress[] {
  return [...jobs.values()].map(snapshot);
}

/** Forget finished/failed jobs so the UI list doesn't grow forever. */
export function clearFinished(): void {
  for (const [key, job] of jobs) {
    if (job.state === 'ready' || job.state === 'error') jobs.delete(key);
  }
}

/**
 * Delete one downloaded model file and reclaim its space. Accepts a bare filename
 * only (schema-enforced upstream); resolves inside the models dir and refuses
 * anything that isn't a regular .gguf sitting directly in it.
 */
export async function deleteModelFile(fileName: string): Promise<{ freedBytes: number }> {
  const dest = destPathFor(fileName);
  if (!dest.toLowerCase().endsWith('.gguf')) throw new Error('Only .gguf model files can be deleted.');
  const st = await fsp.lstat(dest);
  if (!st.isFile()) throw new Error('Refusing to delete a non-file path.');
  await fsp.unlink(dest);
  return { freedBytes: st.size };
}

/** Test seam: drop all queue state between cases. */
export function __resetForTests(): void {
  jobs.clear();
  queue.length = 0;
  activeKey = null;
}
