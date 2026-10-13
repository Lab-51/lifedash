// === FILE PURPOSE ===
// Fire-and-forget bridge from the capture graph to the main-process log
// (AUDIO-DEVICE.1). The renderer console never reaches %APPDATA%\LifeDash\logs,
// so a device dropout was undiagnosable; these events make it readable there.
//
// === DEPENDENCIES ===
// window.electronAPI.logAudioEvent (one-way IPC `audio:capture-event`)
//
// === LIMITATIONS ===
// - Device labels, channel and error names only. Never pass audio, transcript
//   or meeting content as `detail`.
// - Never throws: the audio path must not depend on diagnostics.

import type { AudioCaptureChannel, AudioCaptureEventKind } from '../../shared/types';

/** Main rejects a `detail` longer than this, so the sender clamps instead of losing the event. */
const MAX_DETAIL_LENGTH = 200;
/** Long enough to identify a device, short enough that two labels fit in one `detail`. */
const MAX_LABEL_LENGTH = 60;

/** Report one capture event to the main log. Swallows every failure. */
export function emitAudioEvent(
  kind: AudioCaptureEventKind,
  channel: AudioCaptureChannel | null,
  detail?: string,
): void {
  try {
    window.electronAPI.logAudioEvent({
      kind,
      channel,
      ...(detail ? { detail: detail.slice(0, MAX_DETAIL_LENGTH) } : {}),
    });
  } catch {
    // Missing bridge (old preload across a hot reload) or a throwing log call:
    // capture carries on exactly as it would without diagnostics.
  }
}

/** A track's device label, bounded for logging; 'unknown' when the browser gives none. */
export function trackLabel(track: { label?: string } | null | undefined): string {
  return track?.label ? track.label.slice(0, MAX_LABEL_LENGTH) : 'unknown';
}
