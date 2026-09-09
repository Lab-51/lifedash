// === What the transcription pipeline did with every window it was given ===
//
// The transcript only holds what SURVIVED: a window skipped as silent, dropped
// as a hallucination or lost to a whisper failure leaves no row at all, and is
// therefore indistinguishable from a stretch where nobody spoke. This record is
// the missing half — one tally per capture channel, plus the spans that are
// known to have produced nothing — persisted on the meeting (TRANS-COV.1).
//
// Pure types, no zod: this module is re-exported from the shared types barrel
// the renderer bundles. If the read path ever needs runtime validation it gets
// its own main-side schema module, the way briefStructure.ts is split.

/** The three capture channels (SPEAKER.1). `mixed` is the pre-split mono sum. */
export type CoverageChannel = 'mic' | 'system' | 'mixed';

/**
 * Per-channel window outcomes for one session.
 *
 * `windows` counts every window that was dispatched, and is the denominator.
 * The rest are not a partition of it, deliberately:
 *  - a window whose whisper result was empty is counted ONLY in `windows` —
 *    it reached the model and the model returned nothing,
 *  - a window can be both `saved` and `droppedHallucination` when some of its
 *    segments survived the filter and others did not.
 * Each of `saved` / `silentRms` / `silentVad` / `droppedHallucination` / `failed`
 * counts WINDOWS, never the whisper sub-segments inside one.
 */
export interface ChannelCoverage {
  /** Windows dispatched on this channel (10 s each, 1 s of overlap). */
  windows: number;
  /** Windows that persisted at least one transcript row. */
  saved: number;
  /** Windows skipped by the RMS fast path (below the silence threshold). */
  silentRms: number;
  /** Windows skipped by the VAD gate (no speech detected in the whole window). */
  silentVad: number;
  /** Windows where at least one segment matched the hallucination filter. */
  droppedHallucination: number;
  /** Windows whose transcription threw — see the matching entry in `gaps`. */
  failed: number;
}

/**
 * A span of the session that is known to hold no transcript.
 *
 * STAMPED coordinate (see shared/transcription/timeCoordinates.ts): it is the
 * transcript's own timeline, which runs 1 s per window ahead of the recorded
 * audio. Convert with `stampedMsToAudioMs` before seeking into the WAV.
 *
 * `failed` — transcription of that window threw.
 * `unknown` — the span has no transcript and no recorded reason (reserved for
 * the readers that reconstruct coverage for sessions this record never saw).
 */
export interface CoverageGap {
  startMs: number;
  endMs: number;
  channel: CoverageChannel;
  reason: 'failed' | 'unknown';
}

/** One completed retranscription of a span, in the STAMPED coordinate. */
export interface RetranscribedSpan {
  startMs: number;
  endMs: number;
  /** The whisper model the span was redone with. */
  model: string;
  /** ISO timestamp of the run. */
  at: string;
  /** Transcript rows removed / written by it. */
  replaced: number;
  inserted: number;
}

/** The live half of the record: what the dispatch loop itself accumulates. */
export interface CoverageTally {
  channels: Record<CoverageChannel, ChannelCoverage>;
  gaps: CoverageGap[];
  /**
   * Whisper language code -> number of saved windows decoded in it. Whisper
   * reports the language it decoded each window in (`whisper_full_lang_id`);
   * on the "auto" preset that is a real detection, on a fixed preset it is the
   * forced language — either way it is the language the transcript IS in,
   * which is what the brief needs. Empty for a cloud provider and for records
   * written before this field existed (readers treat absence as empty).
   */
  languages: Record<string, number>;
}

/**
 * The single language a transcript was decoded in, by window majority, or
 * null when nothing was tallied. Ties go to the code that reached the count
 * first in insertion order — deterministic, and a tie on a real meeting means
 * the setting's own fallback is the honest answer anyway.
 */
export function dominantLanguage(languages: Record<string, number> | undefined): string | null {
  if (!languages) return null;
  let best: string | null = null;
  let bestCount = 0;
  for (const [code, count] of Object.entries(languages)) {
    if (count > bestCount) {
      best = code;
      bestCount = count;
    }
  }
  return best;
}

/**
 * The full record as persisted on `meetings.transcription_coverage`.
 *
 * Nullable on the row: every meeting predating TRANS-COV.1, and any session
 * whose coverage write failed, has none — readers must treat its absence as
 * "not recorded", never as "nothing was missed".
 */
export interface TranscriptionCoverage extends Omit<CoverageTally, 'languages'> {
  /** Schema version of this record. Bump when a field's meaning changes. */
  version: 1;
  /** See CoverageTally.languages. OPTIONAL here because records persisted
   *  before 2026-09-09 carry no such field — absence means "not tallied". */
  languages?: Record<string, number>;
  /**
   * How the session ended: the normal stop, or startup recovery of a crash.
   * A `recovered` record's `channels` counters are always zero — the live
   * tally lived in the process that crashed and died with it — so its only
   * signal is whatever `gaps` it was able to reconstruct after the fact.
   */
  endedBy: 'stop' | 'recovered';
  /**
   * REAL recorded length in ms, from the WAV's data byte count (16 kHz mono
   * Int16 = 32 bytes/ms) — not the transcript's own drifting timeline. Null
   * when there is no finalized WAV to measure (audio saving off, write failed).
   */
  audioMs: number | null;
  /** Transcription provider in force for the session (`local`, `deepgram`, ...). */
  provider: string;
  /** Whisper model file for the local provider; null for a cloud provider. */
  model: string | null;
  /**
   * The window constants in force WHEN THIS RECORD WAS WRITTEN — stored rather
   * than assumed, so a record survives ISSUES #40 being fixed underneath it
   * (which changes `windowAdvanceMs` to 10,000). Typed `number` for that reason.
   */
  windowStampMs: number;
  windowAdvanceMs: number;
  /** Spans redone from the WAV since the recording ended. */
  retranscribed: RetranscribedSpan[];
  /**
   * `dominantLanguage(languages)` at write time — the language the transcript
   * was decoded in. The brief's "Same as transcript" setting reads THIS first,
   * so a meeting recorded on the "auto" preset gets a brief in the language
   * that was actually spoken. Null for cloud providers, recovered sessions and
   * records written before this field existed (readers treat absence as null).
   */
  detectedLanguage?: string | null;
}

/** A zeroed tally — one entry per channel, no gaps. */
export function emptyCoverageTally(): CoverageTally {
  const channel = (): ChannelCoverage => ({
    windows: 0,
    saved: 0,
    silentRms: 0,
    silentVad: 0,
    droppedHallucination: 0,
    failed: 0,
  });
  return { channels: { mic: channel(), system: channel(), mixed: channel() }, gaps: [], languages: {} };
}
