// === FILE PURPOSE ===
// LIVE proof that HTTP Range resume works against the REAL Hugging Face CDN using a
// REAL entry from the shipped catalog/models.json (LOCAL-RT.1 Task 3). Nothing is
// simulated: the URL, the 318 MiB payload, the 206 response and the sha256 are the
// ones users will hit.
//
// SKIPPED BY DEFAULT so `npm test` needs no network. Run as two phases in two
// separate OS processes, with the second one resuming what the first left behind:
//
//   # phase 1 — start downloading, then hard-kill the process mid-transfer
//   LOCAL_MODEL_LIVE=1 LOCAL_MODEL_LIVE_PHASE=download \
//   LIFEDASH_LLAMA_MODELS_DIR=<scratch>/live-resume-models \
//   npx vitest run modelDownloadService.live
//
//   # phase 2 — fresh process, only the .part file on disk carries over
//   LOCAL_MODEL_LIVE=1 LOCAL_MODEL_LIVE_PHASE=resume \
//   LIFEDASH_LLAMA_MODELS_DIR=<scratch>/live-resume-models \
//   npx vitest run modelDownloadService.live
//
// Phase 2 asserts the request actually carried `Range: bytes=<partial>-`, that the
// CDN answered 206 with only the remainder, and that the completed file matches the
// sha256 recorded in the catalog.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import realCatalogJson from '../../../../catalog/models.json';
import { modelCatalogSchema } from '../../../shared/validation/localModelSchemas';
import { fileNameForUrl } from '../../../shared/types/localModels';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => process.cwd() },
}));

const LIVE = process.env.LOCAL_MODEL_LIVE === '1';
const PHASE = process.env.LOCAL_MODEL_LIVE_PHASE ?? 'resume';

/** Smallest shipped entry — the natural candidate for a repeatable live test. */
const catalog = modelCatalogSchema.parse(realCatalogJson);
const entry = catalog.models
  .flatMap((m) => m.files.map((f) => ({ model: m, file: f })))
  .sort((a, b) => a.file.sizeBytes - b.file.sizeBytes)[0];

const FILE_NAME = fileNameForUrl(entry.file.url);
const KEY = `${entry.model.id}:${entry.file.quant}`;
/** Phase 1 is killed once the partial passes this mark, so the resume is substantial. */
const INTERRUPT_AFTER_BYTES = 40 * 1024 * 1024;

interface SeenRequest {
  range?: string;
  status: number;
  contentRange: string | null;
  contentLength: string | null;
}

const seen: SeenRequest[] = [];

/** Observe the real fetch without replacing it — headers in, response metadata out. */
function instrumentFetch(): void {
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await realFetch(input, init);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    seen.push({
      range: headers.Range,
      status: res.status,
      contentRange: res.headers.get('content-range'),
      contentLength: res.headers.get('content-length'),
    });
    return res;
  });
}

describe.skipIf(!LIVE)(`modelDownloadService LIVE — ${PHASE}`, () => {
  let dl: typeof import('../modelDownloadService');
  let modelsDir: string;
  let partPath: string;
  let destPath: string;

  beforeAll(async () => {
    modelsDir = process.env.LIFEDASH_LLAMA_MODELS_DIR!;
    expect(modelsDir, 'LIFEDASH_LLAMA_MODELS_DIR must be set for the live test').toBeTruthy();
    fs.mkdirSync(modelsDir, { recursive: true });
    destPath = path.join(modelsDir, FILE_NAME);
    partPath = `${destPath}.part`;
    instrumentFetch();
    dl = await import('../modelDownloadService');
  });

  it.runIf(PHASE === 'download')(
    'starts the real download and keeps growing until the process is killed',
    async () => {
      // No .part must exist yet or this is not a clean phase-1 run.
      fs.rmSync(partPath, { force: true });
      fs.rmSync(`${partPath}.json`, { force: true });
      fs.rmSync(destPath, { force: true });

      dl.enqueue({
        key: KEY,
        url: entry.file.url,
        fileName: FILE_NAME,
        sha256: entry.file.sha256,
        sizeBytes: entry.file.sizeBytes,
      });

      // The harness SIGKILLs this process once the .part passes the threshold; this
      // loop just keeps the test alive until then.
      const deadline = Date.now() + 10 * 60 * 1000;
      while (Date.now() < deadline) {
        const received = dl.listDownloads().find((d) => d.key === KEY)?.receivedBytes ?? 0;
        if (received > INTERRUPT_AFTER_BYTES * 2) break; // harness failed to kill us — stop anyway
        await new Promise((r) => setTimeout(r, 200));
      }
      expect(fs.statSync(partPath).size).toBeGreaterThan(0);
    },
    11 * 60 * 1000,
  );

  it.runIf(PHASE === 'resume')(
    'resumes the killed download with a Range request and completes with a verified sha256',
    async () => {
      const partialSize = fs.statSync(partPath).size;
      expect(partialSize, 'phase 1 must have left a partial file').toBeGreaterThan(0);
      expect(partialSize).toBeLessThan(entry.file.sizeBytes);
      expect(fs.existsSync(destPath), 'the model must not already be fully downloaded').toBe(false);

      dl.enqueue({
        key: KEY,
        url: entry.file.url,
        fileName: FILE_NAME,
        sha256: entry.file.sha256,
        sizeBytes: entry.file.sizeBytes,
      });

      const deadline = Date.now() + 10 * 60 * 1000;
      while (Date.now() < deadline) {
        const state = dl.listDownloads().find((d) => d.key === KEY)?.state;
        if (state === 'ready' || state === 'error') break;
        await new Promise((r) => setTimeout(r, 250));
      }

      const job = dl.listDownloads().find((d) => d.key === KEY)!;
      expect(job.error).toBeUndefined();
      expect(job.state).toBe('ready');

      // The transport really resumed: Range header out, 206 + partial length back.
      const first = seen[0];
      expect(first.range).toBe(`bytes=${partialSize}-`);
      expect(first.status).toBe(206);
      expect(first.contentRange).toBe(`bytes ${partialSize}-${entry.file.sizeBytes - 1}/${entry.file.sizeBytes}`);
      expect(Number(first.contentLength)).toBe(entry.file.sizeBytes - partialSize);

      // The finished file is byte-exact against the sha256 shipped in the catalog.
      expect(fs.statSync(destPath).size).toBe(entry.file.sizeBytes);
      expect(await dl.hashFile(destPath)).toBe(entry.file.sha256);
      expect(job.sha256).toBe(entry.file.sha256);
      expect(fs.existsSync(partPath)).toBe(false);
      expect(fs.existsSync(`${partPath}.json`)).toBe(false);
    },
    11 * 60 * 1000,
  );
});
