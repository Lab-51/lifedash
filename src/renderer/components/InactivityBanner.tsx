// === FILE PURPOSE ===
// Full-width warning banner shown in Live Mode while the inactivity auto-stop
// guard (GUARD.1) is counting down after sustained audio silence. Styled as the
// amber/warning sibling of ViewingProjectBanner (same shrink-0 strip structure,
// warning accent colors instead of the accent-subtle theme). Self-gating: reads
// recordingStore directly and renders nothing outside the 'countdown' state, so
// callers (LiveModeOverlay) can mount it unconditionally.
//
// === DEPENDENCIES ===
// recordingStore — consumes ONLY the Task 1 contract: inactivityState,
// inactivitySecondsLeft, keepRecording(). Never touches anything else on the store.

import { useRecordingStore } from '../stores/recordingStore';

/** Formats seconds remaining as M:SS (no leading zero on minutes). */
function formatCountdown(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  const minutes = Math.floor(clamped / 60);
  const seconds = (clamped % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export default function InactivityBanner() {
  const inactivityState = useRecordingStore((s) => s.inactivityState);
  const secondsLeft = useRecordingStore((s) => s.inactivitySecondsLeft);
  const keepRecording = useRecordingStore((s) => s.keepRecording);

  if (inactivityState !== 'countdown') return null;

  return (
    <div className="shrink-0 flex items-center gap-3 px-4 py-1.5 text-xs bg-amber-500/10 border-b border-amber-500/30">
      {/* aria-live: this text ticks once per second while the countdown runs — always
          keep live regions on ticking countdown text (V3.3.5 accessibility precedent). */}
      <span aria-live="polite" className="min-w-0 truncate text-amber-300">
        No audio detected — still recording? Auto-stopping in{' '}
        <span className="font-medium tabular-nums">{formatCountdown(secondsLeft)}</span>
      </span>
      <button
        type="button"
        onClick={keepRecording}
        className="ml-auto shrink-0 font-medium text-amber-300 hover:underline"
      >
        Keep recording
      </button>
    </div>
  );
}
