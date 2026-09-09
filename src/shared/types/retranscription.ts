// === FILE PURPOSE ===
// The contract for redoing ONE span of a finished recording's transcript from
// its WAV with a chosen local whisper model (TRANS-COV.1 Task 4).
//
// This operation DELETES transcript rows and writes new ones in their place, so
// its result type is deliberately a TYPED UNION rather than a throw: every way
// it can decline is a named reason the renderer can print, and `ok: false`
// always means nothing was deleted. The main-side service that implements it
// (main/services/retranscriptionService.ts) never rejects across IPC.
//
// Pure types, no zod — this module is re-exported from the shared types barrel
// the renderer bundles. Input validation lives with the IPC handler
// (shared/validation/schemas.ts: retranscribeSpanSchema).

import type { TranscriptSegment } from './meetings';

/** The span to redo, in the STAMPED coordinate the transcript rows are written
 *  in (shared/transcription/timeCoordinates.ts), plus the whisper model file to
 *  redo it with. `modelFileName` must be one the manager reports as downloaded. */
export interface RetranscribeSpanInput {
  meetingId: string;
  /** Inclusive start, STAMPED ms. */
  startMs: number;
  /** Exclusive end, STAMPED ms. Must be greater than `startMs`. */
  endMs: number;
  /** e.g. 'ggml-large-v3-turbo-q5_0.bin'. */
  modelFileName: string;
}

/**
 * Why a retranscription declined to run. Each value means NOTHING was changed.
 *
 * `recording-active` — a live recording is in progress, or another
 *   retranscription already is. Both are "busy, try again", both leave the
 *   transcript untouched, and `detail` says which one it was.
 * `no-audio` — no WAV could be resolved or read for this session, or the span
 *   lies past the end of the audio that exists.
 * `span-too-long` — the reader refused the span (wavSpanReader.InvalidSpanError).
 * `model-missing` — `modelFileName` is not a downloaded whisper model.
 * `transcription-failed` — whisper (or the write that follows it) failed; the
 *   old rows are still there.
 */
export type RetranscribeFailureReason =
  | 'recording-active'
  | 'no-audio'
  | 'span-too-long'
  | 'model-missing'
  | 'transcription-failed';

export type RetranscribeResult =
  | {
      ok: true;
      /** Existing rows removed because they overlapped the span. */
      replaced: number;
      /** Rows written in their place — may be 0 when the model heard nothing. */
      inserted: number;
      /** The rows actually written, in insertion order. */
      segments: TranscriptSegment[];
      /** The STAMPED end actually covered: `endMs`, or less when the recording
       *  ends inside the requested span. This — not `endMs` — is the end of the
       *  range whose old rows were deleted. */
      clampedEndMs: number;
    }
  | { ok: false; reason: RetranscribeFailureReason; detail?: string };
