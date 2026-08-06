// Tests for ensureVadModel() (TRANS-HALL.1 Task 2) — the never-throw degradation
// contract that Layer 2 (VAD-gated hallucination suppression) depends on. Only the
// offline-verifiable failure path is committed here (no live network in unit tests,
// matching modelDownloadService.test.ts / modelCatalogService.test.ts convention).
//
// The happy path (real download + sha256-verified idempotent no-op on a second call)
// was verified once against the live network during TRANS-HALL.1 Task 2 — see
// DECISIONS.md — and is exercised end-to-end by the URL/hash pinned as constants in
// whisperModelManager.ts, which the live spike (initWhisperVad + detectSpeechData)
// also proved actually run on this project's shipped Windows binaries.
//
// createVadContext() is deliberately CPU-only (GPU VAD init natively aborts —
// see the comment in whisperModelManager.ts) and, like createWhisperContext, has
// no direct unit test here (callers mock it wholesale — see
// transcriptionService.localOnly.test.ts) — same convention followed here.

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lifedash-vad-'));

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => tmpRoot, getPath: () => tmpRoot },
}));

// Force every https.get() call to fail immediately, simulating "network blocked".
vi.mock('node:https', () => ({
  default: {
    get: (_url: string, cb?: unknown) => {
      const req = {
        on: (event: string, handler: (err: Error) => void) => {
          if (event === 'error') setImmediate(() => handler(new Error('simulated network failure')));
          return req;
        },
        destroy: () => {},
      };
      void cb;
      return req;
    },
  },
}));

type Manager = typeof import('../whisperModelManager');
let mgr: Manager;

const modelsDir = (): string => path.join(tmpRoot, 'whisper-models');

beforeEach(async () => {
  vi.resetModules();
  mgr = await import('../whisperModelManager');
  fs.rmSync(modelsDir(), { recursive: true, force: true });
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('ensureVadModel — never-throw degradation', () => {
  it('resolves null (never throws) when the download fails, e.g. network blocked', async () => {
    await expect(mgr.ensureVadModel()).resolves.toBeNull();
  });

  it('logs the failure only once across repeated calls', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await mgr.ensureVadModel();
      await mgr.ensureVadModel();
      const vadWarnings = warnSpy.mock.calls.filter((call) => String(call[0]).includes('[whisper-vad]'));
      expect(vadWarnings.length).toBe(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('removes a stale/corrupted local file and still resolves null rather than throwing', async () => {
    fs.mkdirSync(modelsDir(), { recursive: true });
    const dest = path.join(modelsDir(), 'ggml-silero-v5.1.2.bin');
    fs.writeFileSync(dest, 'not the real model');

    await expect(mgr.ensureVadModel()).resolves.toBeNull();
    // Corrupted file was removed before the (failed) re-download attempt.
    expect(fs.existsSync(dest)).toBe(false);
  });
});

describe('VAD model catalog isolation', () => {
  it('does not appear in the user-facing AVAILABLE_MODELS list', () => {
    const fileNames = mgr.AVAILABLE_MODELS.map((m) => m.fileName);
    expect(fileNames).not.toContain('ggml-silero-v5.1.2.bin');
  });
});
