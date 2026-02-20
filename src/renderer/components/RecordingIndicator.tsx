// === FILE PURPOSE ===
// Compact recording indicator for sidebar -- pulsing dot + elapsed time.
// Clickable popover with Stop action. Shows processing state after stop.
// Only renders when recording or processing; returns null otherwise.
//
// === DEPENDENCIES ===
// recordingStore, react-router-dom

import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Square, Loader2 } from 'lucide-react';
import { useRecordingStore } from '../stores/recordingStore';

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function RecordingIndicator() {
  const isRecording = useRecordingStore(s => s.isRecording);
  const isProcessing = useRecordingStore(s => s.isProcessing);
  const elapsed = useRecordingStore(s => s.elapsed);
  const stopRecording = useRecordingStore(s => s.stopRecording);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Navigate to meetings when processing finishes (after sidebar-initiated stop)
  const pendingNavigateRef = useRef(false);
  useEffect(() => {
    if (pendingNavigateRef.current && !isProcessing) {
      pendingNavigateRef.current = false;
      navigate('/meetings');
    }
  }, [isProcessing, navigate]);

  if (!isRecording && !isProcessing) return null;

  // Processing state — amber indicator
  if (isProcessing) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-amber-500/20
                      border border-amber-500/30">
        <Loader2 size={12} className="text-amber-400 animate-spin" />
        <span className="text-[10px] font-medium text-amber-400">Saving</span>
      </div>
    );
  }

  // Recording state — red indicator with stop popover
  return (
    <div ref={popoverRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-red-500/20
                   border border-red-500/30 hover:bg-red-500/30 transition-colors cursor-pointer"
      >
        <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-xs font-mono text-red-400">
          {formatElapsed(elapsed)}
        </span>
      </button>

      {open && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-white dark:bg-surface-800 rounded-xl shadow-xl border border-surface-200 dark:border-surface-700 p-1.5 z-50">
          <button
            onClick={() => {
              pendingNavigateRef.current = true;
              stopRecording();
              setOpen(false);
            }}
            title="Stop Recording"
            className="w-9 h-9 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <Square size={16} fill="currentColor" />
          </button>
        </div>
      )}
    </div>
  );
}
