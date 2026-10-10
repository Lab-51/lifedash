// === FILE PURPOSE ===
// Downloads an update installer and proves it is the file GitHub published
// (UPDATER-SAFE.1): bytes are hashed as they stream, the size and sha256 must match
// the release record, and only then does the partial file get its final name.
// installUpdate re-hashes that file right before running it, so the bytes executed
// are the bytes verified.

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, type WriteStream } from 'node:fs';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';

/**
 * The host a download may START at. Redirect hops are not checked: Electron's net.fetch
 * follows them without exposing the final URL (response.url is empty), so a hop check
 * would be decoration. The sha256 binds the bytes wherever they came from.
 */
export function isAllowedDownloadHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      (parsed.hostname === 'github.com' || parsed.hostname.endsWith('.githubusercontent.com'))
    );
  } catch {
    return false;
  }
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export interface VerifiedDownloadRequest {
  url: string;
  sha256: string;
  size: number;
  destDir: string;
  fileName: string;
  onProgress?: (percent: number) => void;
}

type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

async function writeChunk(stream: WriteStream, chunk: Uint8Array): Promise<void> {
  if (!stream.write(chunk)) await once(stream, 'drain');
}

/**
 * Streams `url` into `<destDir>/<fileName>.partial`, then renames it to `fileName` only
 * if the byte count and sha256 match. Any failure removes the partial and throws.
 * `allowHost` (default: GitHub's hosts) gates the starting URL.
 */
export async function downloadVerified(
  request: VerifiedDownloadRequest,
  fetchFn: FetchLike,
  allowHost: (url: string) => boolean = isAllowedDownloadHost,
): Promise<string> {
  if (!allowHost(request.url)) throw new Error(`Refusing to download from ${request.url}`);
  await fsp.mkdir(request.destDir, { recursive: true });
  const finalPath = path.join(request.destDir, request.fileName);
  const partialPath = `${finalPath}.partial`;

  const response = await fetchFn(request.url, { headers: { Accept: 'application/octet-stream' } });
  if (!response.ok || !response.body) throw new Error(`Download failed with status ${response.status}`);

  const hash = createHash('sha256');
  const file = createWriteStream(partialPath);
  let received = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > request.size) throw new Error('Download is larger than the published installer');
      hash.update(value);
      await writeChunk(file, value);
      request.onProgress?.(Math.round((received / request.size) * 100));
    }
    file.end();
    await once(file, 'close');

    if (received !== request.size) {
      throw new Error(`Download incomplete: ${received} of ${request.size} bytes`);
    }
    const actual = hash.digest('hex');
    if (actual !== request.sha256) {
      throw new Error(`Downloaded installer does not match GitHub's sha256 (${actual} != ${request.sha256})`);
    }
    await fsp.rename(partialPath, finalPath);
    return finalPath;
  } catch (err) {
    await reader.cancel().catch(() => undefined); // release the connection
    // Wait for the handle to close: on Windows an open file cannot be removed.
    if (!file.closed) {
      file.destroy();
      await once(file, 'close');
    }
    await fsp.rm(partialPath, { force: true });
    throw err;
  }
}

/** Removes every file in `dir` except `keep` (older installers, abandoned partials). */
export async function removeOtherDownloads(dir: string, keep: string): Promise<void> {
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isFile() && path.join(dir, entry.name) !== keep) {
      await fsp.rm(path.join(dir, entry.name), { force: true });
    }
  }
}
