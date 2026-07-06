// === FILE PURPOSE ===
// Live transcript feed — streams the active recording's transcript segments from
// recordingStore (liveSegments) with auto-scroll that stays pinned to the newest
// segment but releases when the user scrolls up to read earlier segments. Extracted
// from the retired LIVE.1 live drawer so it can be the spine of the full-screen
// LiveModeOverlay (LIVE.2). Consumes the app-wide single transcript subscription in
// recordingStore — it does NOT add its own IPC listener.
//
// === DEPENDENCIES ===
// react, lucide-react, recordingStore

import { useEffect, useRef } from 'react';
import { Mic } from 'lucide-react';
import { useRecordingStore } from '../stores/recordingStore';

/** Distance (px) from the bottom of the scroll container within which auto-scroll stays pinned. */
const SCROLL_PIN_THRESHOLD = 80;

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const s = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
}

export default function LiveTranscriptFeed() {
  const liveSegments = useRecordingStore((s) => s.liveSegments);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Ref (not state) — tracks scroll-pin without triggering re-renders on scroll.
  const pinnedRef = useRef(true);

  // Track whether the user has scrolled up — release the auto-scroll pin so we
  // don't yank them back to the bottom while they're reading earlier segments.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      pinnedRef.current = scrollHeight - scrollTop - clientHeight <= SCROLL_PIN_THRESHOLD;
    };
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // Auto-scroll to the newest segment, unless the user has scrolled up to read back.
  useEffect(() => {
    if (pinnedRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [liveSegments.length]);

  return (
    <div
      ref={scrollContainerRef}
      data-testid="live-transcript-feed"
      className="flex-1 min-h-0 overflow-y-auto px-4 py-3"
    >
      {liveSegments.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center gap-2 text-center">
          <Mic size={20} className="text-[var(--color-text-muted)] animate-pulse" />
          <p className="text-sm text-[var(--color-text-secondary)]">Waiting for speech…</p>
          <p className="text-xs text-[var(--color-text-muted)] max-w-[220px]">
            The first transcript segment can take 10-15 seconds to arrive.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {liveSegments.map((segment) => (
            <div key={segment.id} className="text-sm leading-relaxed">
              <span className="font-data text-[0.6875rem] text-[var(--color-text-muted)] mr-2">
                {formatElapsed(Math.floor(segment.startTime / 1000))}
              </span>
              {segment.speaker && (
                <span className="font-medium text-[var(--color-accent)] mr-1">{segment.speaker}:</span>
              )}
              <span className="text-[var(--color-text-primary)]">{segment.content}</span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
