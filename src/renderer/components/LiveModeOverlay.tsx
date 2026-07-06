// === FILE PURPOSE ===
// Full-screen Live Mode takeover shown while a meeting is recording (LIVE.2).
// Recording = the app becomes the meeting. AUTO-ENTERS when recordingStore.isRecording
// becomes true and UNMOUNTS when recording stops (the existing post-recording flow —
// meeting saved → detail modal / brief generation — then takes over unchanged).
// Minimize collapses the overlay to the recording pill (RecordingIndicator) via
// recordingStore.liveModeMinimized; Esc minimizes but never stops (destructive actions
// stay behind the explicit Stop/Cancel buttons). Mirrors FocusOverlay's full-screen
// shell (fixed inset-0, opacity fade-in) and portals to document.body to escape the
// dashboard's known stacking-context trap (drawer/standup-picker precedent).
//
// Layout: header (title/project, elapsed timer, audio level, Stop + Cancel + Minimize),
// center LiveTranscriptFeed, right column reserving the Task 5 proposals mount point
// above the reused LiveAssistantChat.
//
// === DEPENDENCIES ===
// react-dom (createPortal), lucide-react, recordingStore, meetingStore, projectStore,
// LiveTranscriptFeed, LiveAssistantChat, AudioLevelMeter, ConfirmDialog

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, Square, X, Minus } from 'lucide-react';
import { useRecordingStore } from '../stores/recordingStore';
import { useMeetingStore } from '../stores/meetingStore';
import { useProjectStore } from '../stores/projectStore';
import LiveTranscriptFeed from './LiveTranscriptFeed';
import LiveProposalsFeed from './LiveProposalsFeed';
import LiveAssistantChat from './LiveAssistantChat';
import AudioLevelMeter from './AudioLevelMeter';
import { ConfirmDialog } from './ConfirmDialog';

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function LiveModeOverlay() {
  const isRecording = useRecordingStore((s) => s.isRecording);
  const minimized = useRecordingStore((s) => s.liveModeMinimized);
  const meetingId = useRecordingStore((s) => s.meetingId);
  const elapsed = useRecordingStore((s) => s.elapsed);
  const minimizeLiveMode = useRecordingStore((s) => s.minimizeLiveMode);
  const stopRecording = useRecordingStore((s) => s.stopRecording);
  const cancelRecording = useRecordingStore((s) => s.cancelRecording);
  const meetings = useMeetingStore((s) => s.meetings);
  const projects = useProjectStore((s) => s.projects);

  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [visible, setVisible] = useState(false);

  // AUTO-ENTER: render whenever recording is live and Live Mode is not minimized.
  const active = isRecording && !minimized;

  // Fade-in when the overlay appears; reset when it hides so re-entry re-animates.
  // Both updates are deferred into rAF (never a synchronous setState in the effect
  // body) — mirrors FocusOverlay's fade pattern.
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(active));
    return () => cancelAnimationFrame(id);
  }, [active]);

  // Esc minimizes (NEVER stops — destructive actions stay behind explicit buttons only).
  // Skip while the cancel-confirm dialog is open so Esc only dismisses that dialog.
  useEffect(() => {
    if (!active || cancelConfirmOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        minimizeLiveMode();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [active, cancelConfirmOpen, minimizeLiveMode]);

  if (!active) return null;

  const meeting = meetingId ? meetings.find((m) => m.id === meetingId) : undefined;
  const title = meeting?.title ?? 'Live Meeting';
  const project = meeting?.projectId ? projects.find((p) => p.id === meeting.projectId) : undefined;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Live Mode"
      // z-[110] raises the overlay above AppLayout's z-[100] HUD beam and FeatureTour
      // (z-[100]) so nothing app-chrome sits over it. Inline style is the load-bearing
      // click fix + hardening (all individually justified; see the field-test bug):
      //  - pointerEvents:'auto' OVERRIDES the `.scanlines` class's `pointer-events:none`
      //    (globals.css) which, applied to this interactive root, was inherited by every
      //    child and swallowed ALL clicks (header buttons, chat, ConfirmDialog). Inline
      //    wins over the class rule and keeps the scanline background intact.
      //  - isolation:'isolate' pins the internal ConfirmDialog (z-[70]) inside this root's
      //    own stacking context so raising the overlay can't leak it over app chrome.
      //  - WebkitAppRegion:'no-drag' stops the frameless-window drag strip (TitleBar) from
      //    swallowing mouse input at the compositor level where the header overlaps it.
      className={`fixed inset-0 z-[110] flex flex-col bg-surface-50 dark:bg-[#06080df2] scanlines transition-opacity duration-300 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ isolation: 'isolate', pointerEvents: 'auto', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {/* HEADER */}
      <header className="shrink-0 flex items-center justify-between gap-4 px-6 py-4 border-b border-[var(--color-border)]">
        {/* Left: live badge + meeting title/project */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            <Sparkles size={15} className="text-[var(--color-accent)]" />
            <span className="text-xs font-hud text-[var(--color-accent)] text-glow">LIVE</span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">{title}</p>
            {project && <p className="text-xs text-[var(--color-text-muted)] truncate">{project.name}</p>}
          </div>
        </div>

        {/* Right: elapsed timer, audio level, controls */}
        <div className="flex items-center gap-4 shrink-0">
          <span
            className="font-data text-lg text-[var(--color-accent)] text-glow tabular-nums"
            aria-label="Elapsed time"
          >
            {formatElapsed(elapsed)}
          </span>
          <div className="w-40 hidden sm:block">
            <AudioLevelMeter />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void stopRecording()}
              aria-label="Stop and save recording"
              title="Stop & Save"
              className="flex items-center gap-1.5 bg-surface-700 hover:bg-surface-600 text-surface-800 dark:text-surface-200 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
            >
              <Square size={14} />
              Stop
            </button>
            <button
              onClick={() => setCancelConfirmOpen(true)}
              aria-label="Cancel recording without saving"
              title="Cancel (discard)"
              className="flex items-center gap-1.5 bg-transparent border border-surface-600 hover:border-red-500 hover:text-red-400 text-surface-400 rounded-lg px-3 py-2 text-sm transition-colors"
            >
              <X size={14} />
              Cancel
            </button>
            <button
              onClick={minimizeLiveMode}
              aria-label="Minimize Live Mode"
              title="Minimize (Esc)"
              className="flex items-center justify-center w-9 h-9 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-accent-subtle)] transition-colors"
            >
              <Minus size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* BODY: transcript spine (center) + proposals/chat (right) */}
      <div className="flex-1 min-h-0 flex">
        {/* Center: live transcript */}
        <div className="flex-1 min-w-0 flex flex-col">
          <LiveTranscriptFeed />
        </div>

        {/* Right column */}
        <aside className="w-96 max-w-[40vw] shrink-0 flex flex-col border-l border-[var(--color-border)] bg-[var(--color-chrome)]">
          {/* Ambient proposals feed (LIVE.2 Task 5) — above the chat. Chips are
              ambient (never modal); the feed and RecordingIndicator's pending badge
              both read liveSuggestionsStore, which stays live even while minimized. */}
          <div data-testid="live-proposals-mount" className="shrink-0">
            <LiveProposalsFeed />
          </div>

          {/* Reused Live Assistant chat (LIVE.1) */}
          <div
            data-testid="live-assistant-chat"
            className="flex-1 min-h-0 border-t border-[var(--color-border)] flex flex-col"
          >
            {meetingId && <LiveAssistantChat meetingId={meetingId} />}
          </div>
        </aside>
      </div>

      {/* Keyboard hint */}
      <span className="shrink-0 px-6 py-2 font-data text-xs text-[var(--color-text-muted)] border-t border-[var(--color-border)]">
        Esc to minimize · recording continues in the pill
      </span>

      <ConfirmDialog
        open={cancelConfirmOpen}
        title="Cancel Recording"
        message="Cancel this recording? It will not be saved or processed."
        confirmLabel="Cancel Recording"
        variant="danger"
        onConfirm={async () => {
          setCancelConfirmOpen(false);
          await cancelRecording();
        }}
        onCancel={() => setCancelConfirmOpen(false)}
      />
    </div>,
    document.body,
  );
}
