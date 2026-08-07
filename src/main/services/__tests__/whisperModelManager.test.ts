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

// Every test runs in its OWN fresh root instead of deleting the previous test's
// files. Deleting between tests is unwinnable on Windows CI runners: Defender
// scans the freshly written *.downloading file, production's unlink leaves the
// entry in delete-pending state under the scanner's handle, and from then on ANY
// touch of that entry — including the recursive walk's classifying lstat — throws
// EPERM until the handle closes. rmSync's maxRetries did not survive this on real
// runners (CI run 31210212639), so the hook that "cleaned up" kept failing
// whichever test ran next. Never revisiting a used dir sidesteps the whole class;
// the single best-effort delete happens in afterAll and is swallowed if Defender
// still holds on (residue under os.tmpdir; CI runners are ephemeral anyway).
let caseRoot = tmpRoot;
let caseN = 0;

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => caseRoot, getPath: () => caseRoot },
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

const modelsDir = (): string => path.join(caseRoot, 'whisper-models');

beforeEach(async () => {
  vi.resetModules();
  caseN += 1;
  caseRoot = path.join(tmpRoot, `case-${caseN}`);
  fs.mkdirSync(caseRoot, { recursive: true });
  mgr = await import('../whisperModelManager');
});

afterAll(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    // Best-effort only — see the caseRoot comment above.
  }
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
