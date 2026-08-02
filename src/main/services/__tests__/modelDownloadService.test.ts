// Tests for the resumable GGUF downloader (LOCAL-RT.1 Task 3).
//
// These run against a REAL loopback HTTP server that implements Range/206/416 and
// can sever a response mid-stream, and against the REAL filesystem in a temp dir
// (LIFEDASH_LLAMA_MODELS_DIR, so nothing touches userData). Resume actually working
// over HTTP is the entire point of the task, so the transport is not mocked — only
// electron is.

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { LocalModelDownloadProgress } from '../../../shared/types/localModels';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lifedash-dl-'));

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => tmpRoot, getPath: () => tmpRoot },
}));

const modelsDir = path.join(tmpRoot, 'llm-models');
process.env.LIFEDASH_LLAMA_MODELS_DIR = modelsDir;

type DownloadService = typeof import('../modelDownloadService');
let dl: DownloadService;

// --- Test server --------------------------------------------------------------

interface ServerControl {
  url: (name: string) => string;
  close: () => Promise<void>;
  /** Sever the connection after this many body bytes; null = serve fully. */
  cutAfter: number | null;
  /** Answer 200 with the whole body even when a Range header is present. */
  ignoreRange: boolean;
  /** Delay between 16 KiB chunks, for tests that need a transfer still in flight. */
  chunkDelayMs: number;
  requests: string[];
}

async function startServer(payload: Buffer): Promise<ServerControl> {
  const ctl = { cutAfter: null, ignoreRange: false, chunkDelayMs: 0, requests: [] } as unknown as ServerControl;
  const server = http.createServer((req, res) => {
    ctl.requests.push(req.headers.range ?? 'no-range');
    if (req.url === '/missing.gguf') {
      res.writeHead(404);
      res.end();
      return;
    }
    const range = ctl.ignoreRange ? undefined : req.headers.range;
    let body = payload;
    if (range) {
      const start = Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0);
      if (start >= payload.length) {
        res.writeHead(416, { 'content-range': `bytes */${payload.length}` });
        res.end();
        return;
      }
      body = payload.subarray(start);
      res.writeHead(206, {
        'content-length': String(body.length),
        'content-range': `bytes ${start}-${payload.length - 1}/${payload.length}`,
        'accept-ranges': 'bytes',
      });
    } else {
      res.writeHead(200, { 'content-length': String(payload.length), 'accept-ranges': 'bytes' });
    }

    const limit = ctl.cutAfter === null ? body.length : Math.min(ctl.cutAfter, body.length);
    const step = 16 * 1024;
    let offset = 0;
    const pump = (): void => {
      if (offset >= limit) {
        if (ctl.cutAfter === null) res.end();
        else res.destroy(); // premature close === a real interrupted download
        return;
      }
      res.write(body.subarray(offset, Math.min(offset + step, limit)));
      offset += step;
      if (ctl.chunkDelayMs > 0) setTimeout(pump, ctl.chunkDelayMs);
      else setImmediate(pump);
    };
    pump();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  ctl.url = (name) => `http://127.0.0.1:${port}/${name}`;
  ctl.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return ctl;
}

// --- Helpers ------------------------------------------------------------------

const sha256 = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex');

async function waitFor(predicate: () => boolean, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 15));
  }
}

const stateOf = (key: string): string | undefined => dl.listDownloads().find((d) => d.key === key)?.state;
const settled = (key: string) => (): boolean => ['ready', 'error', 'paused'].includes(stateOf(key) ?? '');
const jobOf = (key: string): LocalModelDownloadProgress =>
  dl.listDownloads().find((d) => d.key === key) as LocalModelDownloadProgress;

const PAYLOAD = crypto.randomBytes(300 * 1024);
const PAYLOAD_SHA = sha256(PAYLOAD);

let server: ServerControl;

beforeEach(async () => {
  vi.resetModules();
  dl = await import('../modelDownloadService');
  fs.rmSync(modelsDir, { recursive: true, force: true });
  fs.mkdirSync(modelsDir, { recursive: true });
  server = await startServer(PAYLOAD);
});

afterEach(async () => {
  await server.close();
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// --- Tests --------------------------------------------------------------------

describe('modelDownloadService — happy path', () => {
  it('downloads, verifies sha256 and renames atomically into the models dir', async () => {
    const key = 'demo:Q4';
    dl.enqueue({
      key,
      url: server.url('demo.gguf'),
      fileName: 'demo.gguf',
      sha256: PAYLOAD_SHA,
      sizeBytes: PAYLOAD.length,
    });
    await waitFor(settled(key));

    expect(stateOf(key)).toBe('ready');
    const dest = path.join(modelsDir, 'demo.gguf');
    expect(fs.readFileSync(dest).equals(PAYLOAD)).toBe(true);
    expect(fs.existsSync(`${dest}.part`)).toBe(false);
    expect(fs.existsSync(`${dest}.part.json`)).toBe(false);
  });

  it('reports the computed hash when no expected sha256 is supplied (custom GGUF by URL)', async () => {
    const key = 'custom:any';
    dl.enqueue({ key, url: server.url('custom.gguf'), fileName: 'custom.gguf' });
    await waitFor(settled(key));

    expect(jobOf(key).state).toBe('ready');
    expect(jobOf(key).sha256).toBe(PAYLOAD_SHA);
  });
});

describe('modelDownloadService — HTTP Range resume', () => {
  it('resumes an interrupted transfer with a Range request instead of restarting', async () => {
    const key = 'resume:Q4';
    const url = server.url('resume.gguf');
    const dest = path.join(modelsDir, 'resume.gguf');

    // 1. First attempt is severed after 64 KiB.
    server.cutAfter = 64 * 1024;
    dl.enqueue({ key, url, fileName: 'resume.gguf', sha256: PAYLOAD_SHA, sizeBytes: PAYLOAD.length });
    await waitFor(settled(key));

    expect(stateOf(key)).toBe('error');
    const partialSize = fs.statSync(`${dest}.part`).size;
    expect(partialSize).toBeGreaterThan(0);
    expect(partialSize).toBeLessThan(PAYLOAD.length);
    expect(fs.existsSync(`${dest}.part.json`)).toBe(true); // resume metadata survives

    // 2. Second attempt must ask for the remainder, not the whole file.
    server.cutAfter = null;
    server.requests.length = 0;
    dl.__resetForTests();
    dl.enqueue({ key, url, fileName: 'resume.gguf', sha256: PAYLOAD_SHA, sizeBytes: PAYLOAD.length });
    await waitFor(settled(key));

    expect(stateOf(key)).toBe('ready');
    expect(server.requests[0]).toBe(`bytes=${partialSize}-`);
    expect(fs.readFileSync(dest).equals(PAYLOAD)).toBe(true);
  });

  it('restarts from zero when the server ignores the Range header', async () => {
    const key = 'norange:Q4';
    const url = server.url('norange.gguf');
    const dest = path.join(modelsDir, 'norange.gguf');

    server.cutAfter = 64 * 1024;
    dl.enqueue({ key, url, fileName: 'norange.gguf', sha256: PAYLOAD_SHA, sizeBytes: PAYLOAD.length });
    await waitFor(settled(key));
    expect(fs.statSync(`${dest}.part`).size).toBeGreaterThan(0);

    // The server now answers 200-with-everything despite the Range header. Appending
    // would corrupt the file, so the download must truncate and start over.
    server.cutAfter = null;
    server.ignoreRange = true;
    dl.__resetForTests();
    dl.enqueue({ key, url, fileName: 'norange.gguf', sha256: PAYLOAD_SHA, sizeBytes: PAYLOAD.length });
    await waitFor(settled(key));

    expect(stateOf(key)).toBe('ready');
    expect(fs.readFileSync(dest).equals(PAYLOAD)).toBe(true);
  });

  it('discards a partial belonging to a different URL rather than splicing onto it', async () => {
    const dest = path.join(modelsDir, 'stale.gguf');
    fs.writeFileSync(`${dest}.part`, Buffer.alloc(4096, 1));
    fs.writeFileSync(
      `${dest}.part.json`,
      JSON.stringify({ url: 'http://example.invalid/other', sha256: 'x', sizeBytes: 1 }),
    );

    const key = 'stale:Q4';
    server.requests.length = 0;
    dl.enqueue({
      key,
      url: server.url('stale.gguf'),
      fileName: 'stale.gguf',
      sha256: PAYLOAD_SHA,
      sizeBytes: PAYLOAD.length,
    });
    await waitFor(settled(key));

    expect(stateOf(key)).toBe('ready');
    expect(server.requests[0]).toBe('no-range'); // started clean, no resume attempted
    expect(fs.readFileSync(dest).equals(PAYLOAD)).toBe(true);
  });

  it('pauses without losing progress and resumes from the paused offset', async () => {
    const key = 'pause:Q4';
    const url = server.url('pause.gguf');
    const dest = path.join(modelsDir, 'pause.gguf');
    server.chunkDelayMs = 25;

    dl.enqueue({ key, url, fileName: 'pause.gguf', sha256: PAYLOAD_SHA, sizeBytes: PAYLOAD.length });
    await waitFor(() => (jobOf(key)?.receivedBytes ?? 0) > 0);
    expect(dl.pause(key)).toBe(true);
    await waitFor(settled(key));

    expect(stateOf(key)).toBe('paused');
    const partialSize = fs.statSync(`${dest}.part`).size;
    expect(partialSize).toBeGreaterThan(0);

    server.chunkDelayMs = 0;
    server.requests.length = 0;
    dl.enqueue({ key, url, fileName: 'pause.gguf', sha256: PAYLOAD_SHA, sizeBytes: PAYLOAD.length });
    await waitFor(settled(key));

    expect(stateOf(key)).toBe('ready');
    expect(server.requests[0]).toMatch(/^bytes=\d+-$/);
    expect(fs.readFileSync(dest).equals(PAYLOAD)).toBe(true);
  });
});

describe('modelDownloadService — failure handling', () => {
  it('deletes exactly its own partial files on a checksum mismatch, leaving siblings alone', async () => {
    // A neighbouring model the user already downloaded must survive untouched:
    // cleanup is surgical (two named files), never a directory and never a glob.
    const sibling = path.join(modelsDir, 'other-model.gguf');
    fs.writeFileSync(sibling, 'precious 9GB stand-in');

    const key = 'bad:Q4';
    const dest = path.join(modelsDir, 'bad.gguf');
    dl.enqueue({
      key,
      url: server.url('bad.gguf'),
      fileName: 'bad.gguf',
      sha256: 'f'.repeat(64),
      sizeBytes: PAYLOAD.length,
    });
    await waitFor(settled(key));

    expect(jobOf(key).state).toBe('error');
    expect(jobOf(key).error).toMatch(/Checksum mismatch/);
    expect(fs.existsSync(`${dest}.part`)).toBe(false);
    expect(fs.existsSync(`${dest}.part.json`)).toBe(false);
    expect(fs.existsSync(dest)).toBe(false);
    expect(fs.readFileSync(sibling, 'utf-8')).toBe('precious 9GB stand-in');
  });

  it('fails the disk preflight before writing anything', async () => {
    const key = 'huge:Q4';
    const dest = path.join(modelsDir, 'huge.gguf');
    dl.enqueue({
      key,
      url: server.url('huge.gguf'),
      fileName: 'huge.gguf',
      sha256: PAYLOAD_SHA,
      sizeBytes: Number.MAX_SAFE_INTEGER,
    });
    await waitFor(settled(key));

    expect(jobOf(key).state).toBe('error');
    expect(jobOf(key).error).toMatch(/Not enough disk space/);
    expect(fs.existsSync(`${dest}.part`)).toBe(false);
  });

  it('errors on a non-2xx response without leaving a partial', async () => {
    const key = 'missing:Q4';
    const dest = path.join(modelsDir, 'missing.gguf');
    dl.enqueue({ key, url: server.url('missing.gguf'), fileName: 'missing.gguf', sizeBytes: 10 });
    await waitFor(settled(key));

    expect(jobOf(key).state).toBe('error');
    expect(jobOf(key).error).toMatch(/HTTP 404/);
    expect(fs.existsSync(`${dest}.part`)).toBe(false);
  });

  it('cancel removes the partial files and forgets the job', async () => {
    const key = 'cancel:Q4';
    const dest = path.join(modelsDir, 'cancel.gguf');
    server.chunkDelayMs = 25;

    dl.enqueue({ key, url: server.url('cancel.gguf'), fileName: 'cancel.gguf', sizeBytes: PAYLOAD.length });
    await waitFor(() => (jobOf(key)?.receivedBytes ?? 0) > 0);
    expect(dl.cancel(key)).toBe(true);
    await waitFor(() => dl.listDownloads().every((d) => d.key !== key));

    expect(fs.existsSync(`${dest}.part`)).toBe(false);
    expect(fs.existsSync(`${dest}.part.json`)).toBe(false);
    expect(fs.existsSync(dest)).toBe(false);
  });
});

describe('modelDownloadService — queue and progress', () => {
  it('runs one download at a time and completes both', async () => {
    const seenDownloading = new Set<string>();
    const listener = (p: LocalModelDownloadProgress): void => {
      if (p.state === 'downloading') seenDownloading.add(p.key);
    };
    dl.downloadEvents.on('progress', listener);
    try {
      server.chunkDelayMs = 5;
      dl.enqueue({ key: 'a:Q4', url: server.url('a.gguf'), fileName: 'a.gguf', sizeBytes: PAYLOAD.length });
      const second = dl.enqueue({
        key: 'b:Q4',
        url: server.url('b.gguf'),
        fileName: 'b.gguf',
        sizeBytes: PAYLOAD.length,
      });
      expect(second.state).toBe('queued'); // does not start while the first is active

      await waitFor(() => settled('a:Q4')() && settled('b:Q4')(), 20000);
      expect(stateOf('a:Q4')).toBe('ready');
      expect(stateOf('b:Q4')).toBe('ready');
      expect(seenDownloading).toEqual(new Set(['a:Q4', 'b:Q4']));
    } finally {
      dl.downloadEvents.off('progress', listener);
    }
  }, 30000);

  it('emits monotonically increasing progress percentages', async () => {
    const percents: number[] = [];
    const listener = (p: LocalModelDownloadProgress): void => {
      if (p.key === 'prog:Q4' && p.state === 'downloading') percents.push(p.percent);
    };
    dl.downloadEvents.on('progress', listener);
    try {
      server.chunkDelayMs = 20;
      dl.enqueue({
        key: 'prog:Q4',
        url: server.url('prog.gguf'),
        fileName: 'prog.gguf',
        sha256: PAYLOAD_SHA,
        sizeBytes: PAYLOAD.length,
      });
      await waitFor(settled('prog:Q4'), 20000);
      expect(stateOf('prog:Q4')).toBe('ready');
      expect(percents.length).toBeGreaterThan(1);
      expect([...percents].sort((x, y) => x - y)).toEqual(percents);
    } finally {
      dl.downloadEvents.off('progress', listener);
    }
  }, 30000);
});

describe('modelDownloadService — deleteModelFile', () => {
  it('deletes a model and reports the reclaimed bytes', async () => {
    const target = path.join(modelsDir, 'deleteme.gguf');
    fs.writeFileSync(target, Buffer.alloc(2048));
    const { freedBytes } = await dl.deleteModelFile('deleteme.gguf');
    expect(freedBytes).toBe(2048);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('refuses non-gguf files and path traversal', async () => {
    const outside = path.join(tmpRoot, 'outside.gguf');
    fs.writeFileSync(outside, 'do not touch');
    fs.writeFileSync(path.join(modelsDir, 'notes.txt'), 'keep');

    await expect(dl.deleteModelFile('notes.txt')).rejects.toThrow();
    // basename() collapses the traversal, so this resolves inside the models dir and
    // simply does not exist — the file one level up is never reached.
    await expect(dl.deleteModelFile('../outside.gguf')).rejects.toThrow();
    expect(fs.readFileSync(outside, 'utf-8')).toBe('do not touch');
    expect(fs.existsSync(path.join(modelsDir, 'notes.txt'))).toBe(true);
  });
});

describe('modelDownloadService — disk probe', () => {
  it('reports free space for a real directory and null for a bogus one', () => {
    const free = dl.freeSpaceBytes(os.tmpdir());
    expect(free === null || free > 0).toBe(true);
    expect(dl.freeSpaceBytes(path.join(tmpRoot, 'no', 'such', 'dir'))).toBeNull();
  });
});
