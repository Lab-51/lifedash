// === FILE PURPOSE ===
// Locates a recording's WAV file and reads a byte-exact span of its PCM data,
// tolerating a header that was never finalized (TRANS-COV.1).
//
// === WHY BYTE ARITHMETIC, NEVER THE HEADER ===
// A recording abandoned by a crash or a forced quit never reaches
// audioProcessor.finalizeWav, so its RIFF ChunkSize and data Subchunk2Size stay
// at the placeholder value written when the file was opened: 0. A reader that
// trusts those fields would see a WAV that appears to hold no audio at all,
// even though the file on disk may be many minutes long. This module never
// reads them — duration and every seek offset come only from the file's real
// byte size, exactly as staleRecordingRecovery already derives ended_at
// (8cd1434).
//
// 16 kHz, mono, 16-bit PCM: 32 bytes of audio per millisecond, after the fixed
// 44-byte RIFF/WAVE header audioProcessor writes (wavUtils.createWavHeader).

import { app } from 'electron';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { settings } from '../db/schema';
import { createLogger } from './logger';

const log = createLogger('WavSpanReader');

/** 16 kHz, mono, Int16 — the format audioProcessor writes. */
const PCM_BYTES_PER_MS = 32;
/** Canonical RIFF/WAVE header length written by audioProcessor. */
const WAV_HEADER_BYTES = 44;
/** Longest span a single read will serve — beyond this is almost certainly a coordinate bug, not a real request. */
const MAX_SPAN_MS = 10 * 60 * 1000;

/** Thrown by readPcmSpan for a span that cannot be a genuine request. */
export class InvalidSpanError extends Error {
  readonly code = 'INVALID_SPAN';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSpanError';
  }
}

export interface PcmSpan {
  pcm: Buffer;
  /** The span actually served, in AUDIO ms, after clamping to the file's real length. */
  audioStartMs: number;
  audioEndMs: number;
}

/**
 * Mirrors audioProcessor/recordingSweepService: the user-configurable
 * `recordings:savePath` when set, else <userData>/recordings. This is the ONE
 * definition — staleRecordingRecovery imports it rather than keeping its own
 * copy.
 */
export async function getRecordingsDir(): Promise<string> {
  try {
    const db = getDb();
    const rows = await db.select().from(settings).where(eq(settings.key, 'recordings:savePath')).limit(1);
    if (rows.length > 0 && rows[0].value) return rows[0].value;
  } catch (err) {
    log.error('Failed to read recordings:savePath, using default:', err);
  }
  return path.join(app.getPath('userData'), 'recordings');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsp.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * The WAV backing a recording: `audioPath` when it is set and present on disk,
 * else the `<recordingsDir>/<id>.wav` convention recordingSweepService
 * protects (a recovered session has `audio_path` NULL), else null.
 */
export async function resolveRecordingWav(meeting: {
  id: string;
  audioPath: string | null | undefined;
}): Promise<string | null> {
  if (meeting.audioPath && (await fileExists(meeting.audioPath))) return meeting.audioPath;
  const conventionPath = path.join(await getRecordingsDir(), `${meeting.id}.wav`);
  if (await fileExists(conventionPath)) return conventionPath;
  return null;
}

/**
 * Duration in ms derived purely from the file's byte size — see the header
 * note above. Null when the file cannot be read or holds no audio bytes.
 */
export async function durationFromFileMs(filePath: string): Promise<number | null> {
  try {
    const st = await fsp.stat(filePath);
    const audioBytes = st.size - WAV_HEADER_BYTES;
    if (audioBytes <= 0) return null;
    return Math.round(audioBytes / PCM_BYTES_PER_MS);
  } catch {
    return null;
  }
}

/**
 * Reads the PCM bytes for [audioStartMs, audioEndMs) of a WAV file. Inputs and
 * the returned bounds are the AUDIO coordinate (shared/transcription/
 * timeCoordinates.ts) — a caller holding a STAMPED span must convert the START
 * only and add the span's own length (`audioStart + (endMs - startMs)`), never
 * convert the end pointwise: stampedMsToAudioMs is not monotonic across a
 * window boundary (Task 1 review finding).
 *
 * Byte arithmetic ONLY: offset = 44 + ms x 32. The header's declared sizes are
 * never consulted, because an abandoned recording leaves them at 0 — that is
 * precisely the case this function exists for. The request is clamped to the
 * file's real length and the CLAMPED bounds are returned, so a caller asking
 * past the end of the file learns what it actually got rather than silently
 * receiving a short buffer with no explanation.
 */
export async function readPcmSpan(filePath: string, audioStartMs: number, audioEndMs: number): Promise<PcmSpan> {
  if (audioEndMs <= audioStartMs) {
    throw new InvalidSpanError(`Span end (${audioEndMs}ms) must be after its start (${audioStartMs}ms).`);
  }
  if (audioEndMs - audioStartMs > MAX_SPAN_MS) {
    throw new InvalidSpanError(`Span of ${audioEndMs - audioStartMs}ms exceeds the ${MAX_SPAN_MS}ms limit.`);
  }

  const st = await fsp.stat(filePath);
  const fileAudioBytes = Math.max(0, st.size - WAV_HEADER_BYTES);
  const fileEndByte = WAV_HEADER_BYTES + fileAudioBytes;

  const startByte = Math.min(WAV_HEADER_BYTES + Math.max(0, audioStartMs) * PCM_BYTES_PER_MS, fileEndByte);
  const endByte = Math.min(WAV_HEADER_BYTES + Math.max(0, audioEndMs) * PCM_BYTES_PER_MS, fileEndByte);
  const length = Math.max(0, endByte - startByte);

  const pcm = Buffer.alloc(length);
  if (length > 0) {
    const handle = await fsp.open(filePath, 'r');
    try {
      await handle.read(pcm, 0, length, startByte);
    } finally {
      await handle.close();
    }
  }

  return {
    pcm,
    audioStartMs: Math.floor((startByte - WAV_HEADER_BYTES) / PCM_BYTES_PER_MS),
    audioEndMs: Math.floor((endByte - WAV_HEADER_BYTES) / PCM_BYTES_PER_MS),
  };
}
