// === FILE PURPOSE ===
// Renderer-side inactivity detector for the recording auto-stop guard (GUARD.1).
// Polls the capture service's audio RMS level and, after a configurable window
// of sustained silence, fires a warning + fixed countdown; if the countdown
// expires unattended it fires onAutoStop so the store can stop the recording via
// the normal path. Audio activity (system audio, screen-share, or the user's own
// mic — all mixed into the same level) resets the silence clock and cancels the
// countdown.
//
// Module-scoped state + exported functions (mirrors audioCaptureService), because
// recording orchestration lives in the renderer and the main process has no
// audio-level signal.
//
// === DEPENDENCIES ===
// audioCaptureService.getAudioLevel() (pull-based; the onAudioLevel push slot is
// single-subscriber and owned by AudioLevelMeter — this service must NOT touch it),
// SILENCE_EPSILON + INACTIVITY_COUNTDOWN_SECONDS (shared, no duplicated literals).
//
// === LIMITATIONS ===
// - Single detector at a time (single recording at a time).
// - Activity is sampled on the 5s poll, so cancelling the countdown has up to 5s
//   latency — acceptable against a 120s countdown.

import { getAudioLevel } from './audioCaptureService';
import { SILENCE_EPSILON } from '../components/AudioLevelMeter';
import { INACTIVITY_COUNTDOWN_SECONDS } from '../../shared/types/recording';

/** How often (ms) the audio level is sampled while monitoring. */
const POLL_INTERVAL_MS = 5000;

/** Countdown tick interval (ms) — drives onCountdownTick once per second. */
const COUNTDOWN_TICK_MS = 1000;

export interface InactivityDetectorOptions {
  /** Minutes of sustained audio silence before the warning + countdown begins. */
  thresholdMinutes: number;
  /** Fired exactly once when silence reaches the threshold and the countdown starts. */
  onWarn(): void;
  /**
   * Fired each second during the countdown with the remaining seconds. The first
   * call happens synchronously when the countdown starts (with
   * INACTIVITY_COUNTDOWN_SECONDS), then once per second down to 1.
   */
  onCountdownTick(secondsLeft: number): void;
  /** Fired exactly once when the countdown expires unattended; the detector then stops itself. */
  onAutoStop(): void;
  /** Fired when audio activity resumes during the countdown, cancelling it and returning to monitoring. */
  onActivityResume(): void;
}

// --- Module-scoped state (null options == detector inactive) ---
let options: InactivityDetectorOptions | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let countdownTimer: ReturnType<typeof setInterval> | null = null;
let phase: 'monitoring' | 'countdown' = 'monitoring';
let thresholdMs = 0;
let silenceMs = 0;
let secondsLeft = 0;

function clearPollTimer(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function clearCountdownTimer(): void {
  if (countdownTimer !== null) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

/** True when the most recent audio level counts as activity (>= silence epsilon). */
function isAudioActive(): boolean {
  return getAudioLevel() >= SILENCE_EPSILON;
}

/** Begin the fixed countdown; emits the initial tick synchronously. */
function startCountdown(): void {
  if (!options) return;
  secondsLeft = INACTIVITY_COUNTDOWN_SECONDS;
  options.onCountdownTick(secondsLeft);
  countdownTimer = setInterval(() => {
    if (!options) {
      clearCountdownTimer();
      return;
    }
    secondsLeft -= 1;
    if (secondsLeft <= 0) {
      // Expiry: stop the detector cleanly first (no orphaned timers), then fire
      // onAutoStop exactly once.
      const onAutoStop = options.onAutoStop;
      stopInactivityDetector();
      onAutoStop();
    } else {
      options.onCountdownTick(secondsLeft);
    }
  }, COUNTDOWN_TICK_MS);
}

/** 5s poll: sample audio, accumulate silence, drive warn / cancel transitions. */
function pollTick(): void {
  if (!options) return;

  if (isAudioActive()) {
    silenceMs = 0;
    if (phase === 'countdown') {
      clearCountdownTimer();
      phase = 'monitoring';
      secondsLeft = 0;
      options.onActivityResume();
    }
    return;
  }

  // Silent. During the countdown, expiry is owned by the countdown timer.
  if (phase === 'countdown') return;

  silenceMs += POLL_INTERVAL_MS;
  if (silenceMs >= thresholdMs) {
    phase = 'countdown';
    options.onWarn();
    startCountdown();
  }
}

/**
 * Start (or cleanly restart) the inactivity detector. Idempotent-safe: a second
 * call tears down any prior state first.
 */
export function startInactivityDetector(opts: InactivityDetectorOptions): void {
  stopInactivityDetector();
  options = opts;
  phase = 'monitoring';
  thresholdMs = Math.max(0, opts.thresholdMinutes) * 60_000;
  silenceMs = 0;
  secondsLeft = 0;
  pollTimer = setInterval(pollTick, POLL_INTERVAL_MS);
}

/** Stop the detector and clear all timers. Safe to call repeatedly. */
export function stopInactivityDetector(): void {
  clearPollTimer();
  clearCountdownTimer();
  options = null;
  phase = 'monitoring';
  thresholdMs = 0;
  silenceMs = 0;
  secondsLeft = 0;
}

/**
 * User chose "Keep recording": cancel the countdown, return to monitoring, and
 * reset the silence clock so re-warning is suppressed until either activity
 * resumes or another full threshold window of silence elapses (the banner does
 * not instantly reappear).
 */
export function keepRecording(): void {
  if (!options) return;
  clearCountdownTimer();
  phase = 'monitoring';
  secondsLeft = 0;
  silenceMs = 0;
}
