// === FILE PURPOSE ===
// Shared constants for the recording inactivity auto-stop guard (GUARD.1).
// These settings are string-valued entries in the main-process key-value store,
// read via window.electronAPI.getSetting. Kept here so the renderer detector
// service, the recordingStore, and any settings UI share one source of truth.
//
// === DEPENDENCIES ===
// None (pure constants + one clamp helper).

/**
 * Settings key: whether the inactivity auto-stop guard is enabled.
 * Stored as the string 'true' | 'false'. Default is TRUE when unset — read as
 * `raw !== 'false'`, mirroring meetings:autoPushEnabled.
 */
export const SETTING_AUTO_STOP_ENABLED = 'recording:autoStopEnabled';

/**
 * Settings key: minutes of sustained audio silence before the auto-stop warning.
 * Stored as a stringified integer; parsed with parseInt, defaulted and clamped
 * (see DEFAULT_AUTO_STOP_MINUTES / AUTO_STOP_MINUTES_MIN / AUTO_STOP_MINUTES_MAX).
 */
export const SETTING_AUTO_STOP_MINUTES = 'recording:autoStopMinutes';

/** Default silence threshold in minutes when the setting is unset or invalid. */
export const DEFAULT_AUTO_STOP_MINUTES = 10;

/** Lower clamp for the silence threshold (minutes). */
export const AUTO_STOP_MINUTES_MIN = 2;

/** Upper clamp for the silence threshold (minutes). */
export const AUTO_STOP_MINUTES_MAX = 120;

/**
 * Fixed countdown (seconds) shown after the silence warning before the recording
 * is auto-stopped. Not user-configurable — the threshold is configurable, the
 * countdown window is fixed.
 */
export const INACTIVITY_COUNTDOWN_SECONDS = 120;

/**
 * Clamp a parsed minutes value into the sane range, falling back to the default
 * for NaN / non-finite input. Truncates fractional minutes.
 */
export function clampAutoStopMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return DEFAULT_AUTO_STOP_MINUTES;
  return Math.min(AUTO_STOP_MINUTES_MAX, Math.max(AUTO_STOP_MINUTES_MIN, Math.trunc(minutes)));
}
