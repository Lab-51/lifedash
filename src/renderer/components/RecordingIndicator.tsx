// === FILE PURPOSE ===
// Compact recording indicator for sidebar -- pulsing dot + elapsed time.
// Clickable popover with Stop Recording and Go to Meeting actions.
// Only renders when a recording is active; returns null otherwise.
//
// === DEPENDENCIES ===
// recordingStore, react-router-dom

import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Square, Mic } from 'lucide-react';
import { useRecordingStore } from '../stores/recordingStore';

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function RecordingIndicator() {
  const isRecording = useRecordingStore(s => s.isRecording);
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

  if (!isRecording) return null;

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
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-44 bg-white dark:bg-surface-800 rounded-xl shadow-xl border border-surface-200 dark:border-surface-700 py-1.5 z-50">
          <button
            onClick={() => {
              stopRecording();
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <Square size={13} fill="currentColor" />
            Stop Recording
          </button>
          <button
            onClick={() => {
              navigate('/meetings');
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
          >
            <Mic size={13} />
            Go to Recording
          </button>
        </div>
      )}
    </div>
  );
}
