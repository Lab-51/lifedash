// === FILE PURPOSE ===
// Unit tests for wavSpanReader (TRANS-COV.1 Task 2) — resolving a recording's
// WAV file and reading a byte-exact PCM span from it.
//
// Runs against a REAL temp directory on disk (same convention as
// recordingSweepService.test.ts / whisperModelManager.test.ts), because the
// whole point of this module is BYTE ARITHMETIC on a real file: a mocked `fs`
// could not prove that readPcmSpan ignores the header's declared sizes, and
// that is the one thing this module exists to get right. `getDb` is mocked to
// throw so getRecordingsDir falls straight through to the electron fallback,
// which is itself mocked to the temp directory — no database needed here.
//
// Every test WAV is built with the SAME header writer production code uses
// (wavUtils.createWavHeader), so the "abandoned recording" fixture is exactly
// what audioProcessor's placeholder write actually leaves on disk — a
// legitimate RIFF/WAVE header whose declared data size is 0 — not a
// hand-rolled stand-in for it.

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWavHeader } from '../wavUtils';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lifedash-wav-span-'));
const recordingsDir = path.join(tmpRoot, 'recordings');

vi.mock('electron', () => ({ app: { getPath: () => tmpRoot } }));
vi.mock('../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
// No `recordings:savePath` row available -- forces getRecordingsDir onto the
// app.getPath('userData')/recordings fallback above, exactly as it would for
// a fresh install with no override configured.
vi.mock('../../db/connection', () => ({
  getDb: () => {
    throw new Error('no database in this unit test');
  },
}));

import { resolveRecordingWav, durationFromFileMs, readPcmSpan, InvalidSpanError } from '../wavSpanReader';

/** 16 kHz, mono, Int16 -- the format audioProcessor writes. */
const PCM_BYTES_PER_MS = 32;

/** A deterministic, non-silent waveform -- any mis-seek shows up as wrong bytes. */
function sineWavePcm(durationMs: number): Buffer {
  const byteLength = durationMs * PCM_BYTES_PER_MS;
  const buf = Buffer.alloc(byteLength);
  for (let i = 0; i < byteLength / 2; i++) {
    buf.writeInt16LE(Math.round(Math.sin(i / 37) * 8000), i * 2);
  }
  return buf;
}

function writeWav(dir: string, name: string, pcm: Buffer, header: Buffer): string {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, Buffer.concat([header, pcm]));
  return filePath;
}

/** A normal, finalized-looking WAV -- header sizes match the real content. */
function writeFinalizedWav(dir: string, name: string, durationMs: number): { filePath: string; pcm: Buffer } {
  const pcm = sineWavePcm(durationMs);
  return { filePath: writeWav(dir, name, pcm, createWavHeader(pcm.byteLength)), pcm };
}

/** The abandoned-recording fixture: a real placeholder header (declared size 0) with real trailing audio. */
function writeAbandonedWav(dir: string, name: string, durationMs: number): { filePath: string; pcm: Buffer } {
  const pcm = sineWavePcm(durationMs);
  return { filePath: writeWav(dir, name, pcm, createWavHeader(0)), pcm };
}

beforeEach(() => {
  vi.clearAllMocks();
  fs.rmSync(recordingsDir, { recursive: true, force: true });
  fs.mkdirSync(recordingsDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('resolveRecordingWav', () => {
  it('prefers audioPath over the id convention when it is set and the file exists', async () => {
    const customDir = fs.mkdtempSync(path.join(tmpRoot, 'custom-'));
    const { filePath: customPath } = writeFinalizedWav(customDir, 'somewhere-else.wav', 500);
    // A DIFFERENT file also sits at the id convention path -- proves audioPath
    // genuinely wins rather than merely being the only file that exists.
    writeFinalizedWav(recordingsDir, 'meeting-x.wav', 200);

    const resolved = await resolveRecordingWav({ id: 'meeting-x', audioPath: customPath });

    expect(resolved).toBe(customPath);
  });

  it('falls back to the <id>.wav convention when audioPath is not set', async () => {
    const { filePath } = writeFinalizedWav(recordingsDir, 'meeting-y.wav', 200);

    const resolved = await resolveRecordingWav({ id: 'meeting-y', audioPath: null });

    expect(resolved).toBe(filePath);
  });

  it('falls back to the convention when audioPath is set but that file no longer exists', async () => {
    const { filePath } = writeFinalizedWav(recordingsDir, 'meeting-z.wav', 200);

    const resolved = await resolveRecordingWav({
      id: 'meeting-z',
      audioPath: path.join(tmpRoot, 'deleted-elsewhere.wav'),
    });

    expect(resolved).toBe(filePath);
  });

  it('returns null when neither audioPath nor the convention file exists', async () => {
    const resolved = await resolveRecordingWav({ id: 'meeting-nowhere', audioPath: null });

    expect(resolved).toBeNull();
  });
});

describe('durationFromFileMs', () => {
  it('computes duration from the real byte count, ignoring the header entirely', async () => {
    const { filePath } = writeFinalizedWav(recordingsDir, 'dur.wav', 5_000);

    await expect(durationFromFileMs(filePath)).resolves.toBe(5_000);
  });

  it('returns null for a header-only file with no audio bytes', async () => {
    const filePath = path.join(recordingsDir, 'empty.wav');
    fs.writeFileSync(filePath, createWavHeader(0));

    await expect(durationFromFileMs(filePath)).resolves.toBeNull();
  });

  it('returns null when the file does not exist', async () => {
    await expect(durationFromFileMs(path.join(recordingsDir, 'nope.wav'))).resolves.toBeNull();
  });
});

describe('readPcmSpan', () => {
  it('returns exactly the requested bytes for an interior span', async () => {
    const { filePath, pcm } = writeFinalizedWav(recordingsDir, 'interior.wav', 3_000);

    const result = await readPcmSpan(filePath, 500, 1_500);

    expect(result.audioStartMs).toBe(500);
    expect(result.audioEndMs).toBe(1_500);
    expect(result.pcm).toEqual(pcm.subarray(500 * PCM_BYTES_PER_MS, 1_500 * PCM_BYTES_PER_MS));
  });

  it('clamps an overrunning span to the real file length and reports the clamped end', async () => {
    const { filePath, pcm } = writeFinalizedWav(recordingsDir, 'overrun.wav', 1_000);

    const result = await readPcmSpan(filePath, 200, 5_000);

    expect(result.audioStartMs).toBe(200);
    expect(result.audioEndMs).toBe(1_000); // clamped from the requested 5,000
    expect(result.pcm).toEqual(pcm.subarray(200 * PCM_BYTES_PER_MS, 1_000 * PCM_BYTES_PER_MS));
  });

  it('reads correctly when the header declares 0 bytes -- the abandoned-recording case', async () => {
    const { filePath, pcm } = writeAbandonedWav(recordingsDir, 'abandoned.wav', 800);

    const result = await readPcmSpan(filePath, 100, 700);

    expect(result.audioStartMs).toBe(100);
    expect(result.audioEndMs).toBe(700);
    expect(result.pcm).toEqual(pcm.subarray(100 * PCM_BYTES_PER_MS, 700 * PCM_BYTES_PER_MS));
  });

  it('rejects a span longer than 10 minutes with the typed error', async () => {
    const { filePath } = writeFinalizedWav(recordingsDir, 'toolong.wav', 100);

    await expect(readPcmSpan(filePath, 0, 10 * 60 * 1000 + 1)).rejects.toThrow(InvalidSpanError);
  });

  it('rejects an inverted span (end <= start) with the typed error', async () => {
    const { filePath } = writeFinalizedWav(recordingsDir, 'inverted.wav', 100);

    await expect(readPcmSpan(filePath, 5_000, 5_000)).rejects.toThrow(InvalidSpanError);
    await expect(readPcmSpan(filePath, 5_000, 4_000)).rejects.toThrow(InvalidSpanError);
  });
});
