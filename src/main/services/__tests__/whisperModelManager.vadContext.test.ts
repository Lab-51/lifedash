// Regression guards for createVadContext() — the two-attempt VAD crash fix.
//
// WHY THIS FILE EXISTS: v2.7.0 shipped a latent, uncatchable app-killer. VAD init
// on a GPU-capable whisper.node binding hits a ggml buffer-placement assert and
// calls native abort(), which no JS catch can intercept — it kills the process
// mid-recording. It took TWO fixes to close:
//
//   47b4dfb — selected the CPU-only package variant. Looked correct. Was a DEAD
//             PARAMETER in-app: whisper.node keeps a GLOBAL module cache, so the
//             first initWhisper in the process wins and every later init silently
//             ignores its variant argument. Main transcription loads vulkan first,
//             so VAD always got the vulkan binding anyway.
//   9ada54b — passes useGpu:false EXPLICITLY. This is the fix that actually holds.
//
// The standalone probes behind 47b4dfb passed because a fresh process has an empty
// module cache. Only the app's real in-process sequence (vulkan main context, then
// VAD init) reproduces it. That is exactly the kind of bug a unit test cannot catch
// by running the real code — so these tests pin the CONTRACT instead: the explicit
// useGpu:false argument, and the darwin refusal. If either disappears, these fail.
//
// Deleting or loosening a test here re-opens a crash that took a Windows Event Log
// and a bench agent on real Mac hardware to diagnose. See DECISIONS.md 2026-08-06
// (both the macOS entry and its ADDENDUM).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const initWhisperVad = vi.fn();

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/tmp', getPath: () => '/tmp' },
}));

vi.mock('@fugood/whisper.node', () => ({
  initWhisper: vi.fn(),
  initWhisperVad,
}));

const realPlatform = process.platform;

function setPlatform(value: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

describe('createVadContext — VAD crash regression guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initWhisperVad.mockResolvedValue({ release: vi.fn() });
  });

  afterEach(() => {
    setPlatform(realPlatform);
  });

  it('passes useGpu:false EXPLICITLY on win32 — the 9ada54b fix', async () => {
    setPlatform('win32');
    const { createVadContext } = await import('../whisperModelManager');

    await createVadContext('/models/silero.bin');

    expect(initWhisperVad).toHaveBeenCalledTimes(1);
    const arg = initWhisperVad.mock.calls[0][0];

    // Not just falsy — the property must be PRESENT and false. whisper.node
    // defaults useGpu to true, so an omitted key is the bug, and `undefined`
    // would pass a loose toBeFalsy() check while crashing in production.
    expect(Object.prototype.hasOwnProperty.call(arg, 'useGpu')).toBe(true);
    expect(arg.useGpu).toBe(false);
    expect(arg.filePath).toBe('/models/silero.bin');
  });

  it('passes useGpu:false EXPLICITLY on linux too', async () => {
    setPlatform('linux');
    const { createVadContext } = await import('../whisperModelManager');

    await createVadContext('/models/silero.bin');

    expect(initWhisperVad).toHaveBeenCalledTimes(1);
    expect(initWhisperVad.mock.calls[0][0].useGpu).toBe(false);
  });

  it('reports the CPU backend — VAD must never claim a GPU backend', async () => {
    setPlatform('win32');
    const { createVadContext } = await import('../whisperModelManager');

    const result = await createVadContext('/models/silero.bin');

    expect(result.backend).toBe('cpu');
  });

  it('REFUSES on darwin without ever touching native VAD init', async () => {
    setPlatform('darwin');
    const { createVadContext } = await import('../whisperModelManager');

    await expect(createVadContext('/models/silero.bin')).rejects.toThrow(/macOS/i);

    // The critical assertion: the refusal must happen BEFORE the native call.
    // On darwin the abort fires with useGpu true OR false, so "call it and catch"
    // is not an option — the process dies before any catch runs.
    expect(initWhisperVad).not.toHaveBeenCalled();
  });

  it('rejects on darwin with a message naming the cause, not a bare throw', async () => {
    setPlatform('darwin');
    const { createVadContext } = await import('../whisperModelManager');

    // transcriptionService logs this rejection once when falling back to
    // RMS-only; an opaque message there is a support ticket nobody can action.
    await expect(createVadContext('/models/silero.bin')).rejects.toThrow(/VAD unsupported on macOS/i);
  });
});
