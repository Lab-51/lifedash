// === FILE PURPOSE ===
// The two transcript time coordinates, and the ONLY place their relationship is
// encoded (TRANS-COV.1).
//
// A live window is STAMPED 10,000 ms after the previous one, but the audio only
// ADVANCES 9,000 ms per window, because each window keeps a 1-second overlap with
// the one before it (transcriptionService: BYTES_PER_SEGMENT - OVERLAP_BYTES). So
// a transcript timestamp runs exactly 1.000 s fast per window against the real
// recording — ISSUES #40, measured on the real dispatch loop, not estimated.
//
// STAMPED is what the user sees: it is what `transcripts.start_time` holds, and
// every gap and span in a coverage record is expressed in it. AUDIO is the real
// offset into <meetingId>.wav — what a retranscription has to seek to.
//
// When #40 is fixed, WINDOW_ADVANCE_MS becomes 10,000 and both functions collapse
// to the identity. The test that pins the hour-long divergence as a NUMBER fails
// on purpose at that moment, which is how this pair gets updated along with it.
//
// Pure — no I/O, no main-process imports — so it is importable everywhere.

/** Milliseconds added to the stamp between one window and the next. */
export const WINDOW_STAMP_MS = 10_000;

/** Milliseconds of real audio consumed between one window and the next. */
export const WINDOW_ADVANCE_MS = 9_000;

/** Reject a value that could only produce a nonsense offset (negative seek, NaN). */
function sanitize(ms: number): number {
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

/**
 * Stamped transcript milliseconds -> real offset into the recorded audio.
 *
 * Window N is stamped at N x 10,000 and its audio begins at N x 9,000, so the
 * within-window offset carries over unchanged. Not injective by construction: a
 * stamped offset of 9,000..10,000 lies in the 1-second overlap and names the same
 * audio as the start of the next window — that overlap is real, and this
 * function reports where the audio actually is rather than hiding it.
 */
export function stampedMsToAudioMs(stampedMs: number): number {
  const ms = sanitize(stampedMs);
  return Math.floor(ms / WINDOW_STAMP_MS) * WINDOW_ADVANCE_MS + (ms % WINDOW_STAMP_MS);
}

/**
 * Real audio offset -> the stamped coordinate that names it.
 *
 * The inverse on the canonical branch: an audio position covered by two windows
 * (the overlap) is named by the LATER of them, the one whose own 9,000 ms
 * advance step contains it, so the returned within-window offset is always
 * below 9,000. `stampedMsToAudioMs(audioMsToStampedMs(x)) === x` for every x;
 * the other direction round-trips only for stamps outside the overlap tail.
 */
export function audioMsToStampedMs(audioMs: number): number {
  const ms = sanitize(audioMs);
  return Math.floor(ms / WINDOW_ADVANCE_MS) * WINDOW_STAMP_MS + (ms % WINDOW_ADVANCE_MS);
}
