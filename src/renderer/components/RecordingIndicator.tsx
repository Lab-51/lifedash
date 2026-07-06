// === FILE PURPOSE ===
// Compact recording indicator for sidebar -- pulsing dot + elapsed time.
// Clickable popover with Stop action. Shows processing state after stop.
// Only renders when recording or processing; returns null otherwise.
//
// === DEPENDENCIES ===
// recordingStore, react-router-dom

import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Square, Loader2, Maximize2 } from 'lucide-react';
import { useRecordingStore } from '../stores/recordingStore';
import { useLiveSuggestionsStore, selectPendingCount } from '../stores/liveSuggestionsStore';

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function RecordingIndicator() {
  const isRecording = useRecordingStore((s) => s.isRecording);
  const isProcessing = useRecordingStore((s) => s.isProcessing);
  const elapsed = useRecordingStore((s) => s.elapsed);
  const processingProgress = useRecordingStore((s) => s.processingProgress);
  const stopRecording = useRecordingStore((s) => s.stopRecording);
  const liveModeMinimized = useRecordingStore((s) => s.liveModeMinimized);
  const restoreLiveMode = useRecordingStore((s) => s.restoreLiveMode);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Pending live-triage proposals awaiting review (LIVE.2 Task 5). liveSuggestionsStore
  // stays live via its own initListener (registered once in App.tsx) regardless of
  // whether LiveProposalsFeed/LiveModeOverlay are mounted, so this count is accurate
  // even while Live Mode is minimized.
  const pendingProposals = useLiveSuggestionsStore(selectPendingCount);

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

  if (isProcessing) {
    let statusText = 'Processing...';
    if (processingProgress) {
      switch (processingProgress.phase) {
        case 'saving-audio':
          statusText = 'Saving...';
          break;
        case 'transcribing':
          statusText = `Processing ${processingProgress.currentSegment}/${processingProgress.totalSegments}...`;
          break;
        case 'finalizing':
          statusText = 'Finishing...';
          break;
      }
    }

    return (
      <div
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-amber-500/20
                      border border-amber-500/30"
      >
        <Loader2 size={12} className="text-amber-400 animate-spin" />
        <span className="text-[0.625rem] font-medium text-amber-400">{statusText}</span>
      </div>
    );
  }

  // Recording state — red indicator with a popover (Return to Live + Stop)
  return (
    <div ref={popoverRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Recording controls"
        className="relative flex items-center gap-1.5 px-2 py-1 rounded-lg bg-red-500/20
                   border border-red-500/30 hover:bg-red-500/30 transition-colors cursor-pointer"
      >
        <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-xs font-mono text-red-400">{formatElapsed(elapsed)}</span>
        {/* Pending-proposals badge — count wired in LIVE.2 Task 5; hidden while 0. */}
        {pendingProposals > 0 && (
          <span
            data-testid="pending-proposals-badge"
            aria-label={`${pendingProposals} pending suggestions`}
            className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 flex items-center justify-center
                       rounded-full bg-[var(--color-accent)] text-[0.625rem] font-semibold text-white"
          >
            {pendingProposals > 9 ? '9+' : pendingProposals}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-white dark:bg-surface-900 rounded-xl shadow-xl border border-[var(--color-border)] p-1.5 z-50 flex items-center gap-1">
          {liveModeMinimized && (
            <button
              onClick={() => {
                restoreLiveMode();
                setOpen(false);
              }}
              title="Return to Live"
              aria-label="Return to Live Mode"
              className="w-9 h-9 flex items-center justify-center rounded-lg text-[var(--color-text-secondary)]
                         hover:bg-[var(--color-accent-subtle)] hover:text-[var(--color-accent)] transition-colors"
            >
              <Maximize2 size={16} />
            </button>
          )}
          <button
            onClick={() => {
              pendingNavigateRef.current = true;
              stopRecording();
              setOpen(false);
            }}
            title="Stop Recording"
            aria-label="Stop Recording"
            className="w-9 h-9 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <Square size={16} fill="currentColor" />
          </button>
        </div>
      )}
    </div>
  );
}
