// === FILE PURPOSE ===
// Compact recording indicator for sidebar -- pulsing dot + elapsed time.
// Only renders when a recording is active; returns null otherwise.
//
// === DEPENDENCIES ===
// recordingStore

import { useRecordingStore } from '../stores/recordingStore';

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function RecordingIndicator() {
  const isRecording = useRecordingStore(s => s.isRecording);
  const elapsed = useRecordingStore(s => s.elapsed);

  if (!isRecording) return null;

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-red-500/20
                    border border-red-500/30">
      <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
      <span className="text-xs font-mono text-red-400">
        {formatElapsed(elapsed)}
      </span>
    </div>
  );
}
