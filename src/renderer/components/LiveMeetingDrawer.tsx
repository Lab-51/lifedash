// === FILE PURPOSE ===
// Global right-side drawer showing the live meeting transcript while recording.
// Portaled to document.body (mirrors the standup picker's stacking-context fix
// in DashboardModern) so it renders correctly above any route's content. Top
// half streams live transcript segments from recordingStore; bottom half hosts
// the Live Assistant chat (LiveAssistantChat, LIVE.1 Task 4).
//
// === DEPENDENCIES ===
// react-dom (createPortal), lucide-react, recordingStore, LiveAssistantChat

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, X, Mic } from 'lucide-react';
import { useRecordingStore } from '../stores/recordingStore';
import LiveAssistantChat from './LiveAssistantChat';

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

export default function LiveMeetingDrawer() {
  const isRecording = useRecordingStore((s) => s.isRecording);
  const liveDrawerOpen = useRecordingStore((s) => s.liveDrawerOpen);
  const liveSegments = useRecordingStore((s) => s.liveSegments);
  const closeLiveDrawer = useRecordingStore((s) => s.closeLiveDrawer);
  const meetingId = useRecordingStore((s) => s.meetingId);

  const isOpen = isRecording && liveDrawerOpen;

  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Ref (not state) — tracks scroll-pin without triggering re-renders on scroll.
  const pinnedRef = useRef(true);

  // Focus management: move focus into the drawer when it opens.
  useEffect(() => {
    if (isOpen) closeBtnRef.current?.focus();
  }, [isOpen]);

  // Escape closes the drawer.
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLiveDrawer();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeLiveDrawer]);

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

  if (!isOpen) return null;

  return createPortal(
    <div
      role="dialog"
      aria-label="Live Assistant"
      className="fixed inset-y-0 right-0 z-[75] w-96 max-w-[90vw] flex flex-col bg-[var(--color-chrome)] border-l border-[var(--color-border)] shadow-2xl shadow-black/30 animate-in slide-in-from-right duration-300"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-[var(--color-accent)]" />
          <span className="text-sm font-hud text-[var(--color-accent)] text-glow">Live Assistant</span>
        </div>
        <button
          ref={closeBtnRef}
          onClick={closeLiveDrawer}
          aria-label="Close Live Assistant"
          title="Close"
          className="p-1 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-accent-subtle)] transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Top half — live transcript feed */}
      <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
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

      {/* Bottom half — Live Assistant chat */}
      <div
        data-testid="live-assistant-chat-placeholder"
        className="flex-1 min-h-0 border-t border-[var(--color-border)] flex flex-col"
      >
        {meetingId && <LiveAssistantChat meetingId={meetingId} />}
      </div>
    </div>,
    document.body,
  );
}
