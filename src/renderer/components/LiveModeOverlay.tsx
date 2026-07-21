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
// center switchable canvas (Task 4 — Transcript | Board | Brain, via the shared
// LiveCanvasTabs also used by SessionWorkspace), right column with the proposals
// feed, the Task 5 ActivityFeed (collapsible, so it never crowds the chat below
// it), then the reused LiveAssistantChat.
//
// Canvas tab position is local component state, reset to Transcript whenever a NEW
// recording starts (meetingId changes) but preserved across minimize/restore — this
// component is mounted once at the app root (AppLayout) and just returns null while
// inactive, so its state survives that round trip. Panels mount only while active;
// this is safe for Transcript too because its data (recordingStore.liveSegments) is
// populated by the ONE app-wide IPC subscription registered once in App.tsx
// (recordingStore.initListener) — not by LiveTranscriptFeed itself — so flipping
// tabs can never drop segments or duplicate the subscription.
//
// Brain tab (V3.2 Task 3): BrainTabPanel is shared with SessionWorkspace, but node
// clicks here prefer IN-CANVAS moves (switch to the Board tab, same project only)
// over navigating the underlying route out from under this full-screen overlay —
// see handleBrainOpenEntity, which mirrors ActivityFeed's own click-through pattern.
//
// === DEPENDENCIES ===
// react-dom (createPortal), react-router-dom (useNavigate), lucide-react,
// recordingStore, meetingStore, projectStore, boardStore, canvasBadgeStore, LiveCanvasTabs,
// LiveTranscriptFeed, EmbeddedBoard, BrainTabPanel, LiveAssistantChat, AudioLevelMeter,
// ConfirmDialog

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Square, X, Minus, LayoutGrid } from 'lucide-react';
import { useRecordingStore } from '../stores/recordingStore';
import { useMeetingStore } from '../stores/meetingStore';
import { useProjectStore } from '../stores/projectStore';
import { useBoardStore } from '../stores/boardStore';
import { useCanvasBadgeStore } from '../stores/canvasBadgeStore';
import { useActivityFeedStore } from '../stores/activityFeedStore';
import { useBrainStore } from '../stores/brainStore';
import LiveCanvasTabs, { type CanvasTabId, type CanvasTabDef } from './LiveCanvasTabs';
import LiveTranscriptFeed from './LiveTranscriptFeed';
import EmbeddedBoard from './EmbeddedBoard';
import ViewingProjectBanner from './ViewingProjectBanner';
import InactivityBanner from './InactivityBanner';
import BrainTabPanel, { resolveBrainOpenTarget } from './BrainTabPanel';
import LiveProposalsFeed from './LiveProposalsFeed';
import ActivityFeed from './ActivityFeed';
import LiveAssistantChat from './LiveAssistantChat';
import AudioLevelMeter from './AudioLevelMeter';
import { ConfirmDialog } from './ConfirmDialog';
import type { BrainNodeType, Project } from '../../shared/types';

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ---------------------------------------------------------------------------
// Board tab — mounts EmbeddedBoard (Task 3) for the session's linked project.
// With no project yet, points the user at the existing propose→accept project
// chip in the right-column proposals feed instead of building a second
// create-project path.
//
// Viewed-project override (STORY-PROJECTS-IN-SESSION): a `viewProjectId` points this
// board at a FOREIGN project in-canvas — a back-banner returns to the session's own
// project. Only `boardProjectId` changes; this is always the foreground board (no
// active-guard needed inside the full-screen overlay). Both `viewProjectId` and
// `openCardId` are the overlay's LOCAL state (never the shared URL), and the card is
// opened via EmbeddedBoard's `cardOpen` override — see the overlay's header note.
// ---------------------------------------------------------------------------
function LiveBoardTabPanel({
  projectId,
  viewProjectId,
  openCardId,
  onOpenCardConsumed,
  projects,
  onClearViewProject,
}: {
  projectId?: string;
  viewProjectId: string | null;
  openCardId: string | null;
  onOpenCardConsumed: () => void;
  projects: Project[];
  onClearViewProject: () => void;
}) {
  const boardProjectId = viewProjectId ?? projectId;
  const isForeign = viewProjectId !== null && viewProjectId !== (projectId ?? null);

  if (!boardProjectId) {
    return (
      <div
        role="tabpanel"
        id="panel-board"
        aria-labelledby="tab-board"
        className="flex-1 flex flex-col items-center justify-center text-center py-16 px-6"
      >
        <div className="w-16 h-16 rounded-2xl bg-[var(--color-accent-subtle)] border border-[var(--color-border-accent)] flex items-center justify-center mb-5">
          <LayoutGrid size={28} className="text-[var(--color-accent-dim)]" />
        </div>
        <h3 className="text-lg font-medium text-[var(--color-text-primary)] mb-1.5">
          The board arrives with this project
        </h3>
        <p className="text-sm text-[var(--color-text-secondary)] max-w-sm">
          Accept a project suggestion in the feed on the right to link one — its board will live right here.
        </p>
      </div>
    );
  }

  const viewedName = projects.find((p) => p.id === viewProjectId)?.name ?? 'another project';

  return (
    <div role="tabpanel" id="panel-board" aria-labelledby="tab-board" className="flex-1 flex flex-col min-h-0">
      {isForeign && <ViewingProjectBanner projectName={viewedName} onBack={onClearViewProject} />}
      <div className="flex-1 flex min-h-0">
        <EmbeddedBoard projectId={boardProjectId} cardOpen={{ openCardId, onConsumed: onOpenCardConsumed }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Canvas body — picks the active panel. Pulled out of the main component so its
// branching doesn't add to LiveModeOverlay's own complexity budget.
// ---------------------------------------------------------------------------
function LiveCanvasBody({
  activeTab,
  projectId,
  viewProjectId,
  openCardId,
  onOpenCardConsumed,
  projects,
  onClearViewProject,
  meetingId,
  onOpenEntity,
}: {
  activeTab: CanvasTabId;
  projectId?: string;
  viewProjectId: string | null;
  openCardId: string | null;
  onOpenCardConsumed: () => void;
  projects: Project[];
  onClearViewProject: () => void;
  meetingId?: string;
  onOpenEntity: (arg: { type: BrainNodeType; entityId: string }) => void;
}) {
  if (activeTab === 'transcript') {
    return (
      <div
        role="tabpanel"
        id="panel-transcript"
        aria-labelledby="tab-transcript"
        className="flex-1 min-h-0 flex flex-col"
      >
        <LiveTranscriptFeed />
      </div>
    );
  }
  if (activeTab === 'board')
    return (
      <LiveBoardTabPanel
        projectId={projectId}
        viewProjectId={viewProjectId}
        openCardId={openCardId}
        onOpenCardConsumed={onOpenCardConsumed}
        projects={projects}
        onClearViewProject={onClearViewProject}
      />
    );
  return <BrainTabPanel meetingId={meetingId} projectId={projectId} onOpenEntity={onOpenEntity} />;
}

export default function LiveModeOverlay() {
  const isRecording = useRecordingStore((s) => s.isRecording);
  const minimized = useRecordingStore((s) => s.liveModeMinimized);
  const meetingId = useRecordingStore((s) => s.meetingId);
  const elapsed = useRecordingStore((s) => s.elapsed);
  const minimizeLiveMode = useRecordingStore((s) => s.minimizeLiveMode);
  const brainInspectorOpen = useBrainStore((s) => s.inspectorOpen);
  const stopRecording = useRecordingStore((s) => s.stopRecording);
  const cancelRecording = useRecordingStore((s) => s.cancelRecording);
  const meetings = useMeetingStore((s) => s.meetings);
  const projects = useProjectStore((s) => s.projects);
  const allCards = useBoardStore((s) => s.allCards);
  const badgeCounts = useCanvasBadgeStore((s) => s.counts);
  const clearBadge = useCanvasBadgeStore((s) => s.clear);
  const activityEntries = useActivityFeedStore((s) => s.entries);
  const navigate = useNavigate();

  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [activeTab, setActiveTab] = useState<CanvasTabId>('transcript');
  // Board-tab view state is LOCAL to this overlay (like activeTab), NOT the shared
  // router URL: the URL belongs to whatever route sits UNDER this full-screen portal,
  // usually a DIFFERENT session than the one recording. Writing viewProject/openCard
  // there would surface a foreign project on that unrelated session when minimized.
  const [viewProjectId, setViewProjectId] = useState<string | null>(null);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const prevMeetingIdRef = useRef<string | null>(null);

  // AUTO-ENTER: render whenever recording is live and Live Mode is not minimized.
  const active = isRecording && !minimized;

  // Fade-in when the overlay appears; reset when it hides so re-entry re-animates.
  // Both updates are deferred into rAF (never a synchronous setState in the effect
  // body) — mirrors FocusOverlay's fade pattern.
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(active));
    return () => cancelAnimationFrame(id);
  }, [active]);

  // Tab state is per-recording: a NEW meetingId (a fresh recording) resets the
  // canvas to Transcript and zeroes stale badges from the previous session. This
  // component never unmounts on minimize/restore, so without this the tab picked
  // during a prior recording would otherwise leak into the next one. Deferred into
  // rAF (never a synchronous setState in the effect body) — mirrors the fade effect.
  useEffect(() => {
    const isNewRecording = meetingId && meetingId !== prevMeetingIdRef.current;
    prevMeetingIdRef.current = meetingId;
    if (!isNewRecording) return;
    const id = requestAnimationFrame(() => {
      setActiveTab('transcript');
      // Drop any foreign-project view from the previous recording too (local state,
      // like the tab) so it can't leak into the next session's Board tab.
      setViewProjectId(null);
      setOpenCardId(null);
      useCanvasBadgeStore.getState().reset();
    });
    return () => cancelAnimationFrame(id);
  }, [meetingId]);

  const handleSelectTab = (tab: CanvasTabId) => {
    setActiveTab(tab);
    clearBadge(tab);
    useActivityFeedStore.getState().setViewedTab(tab);
  };

  // Esc minimizes (NEVER stops — destructive actions stay behind explicit buttons only).
  // Skip while the cancel-confirm dialog OR the in-canvas Brain inspector is open, so
  // Esc dismisses the topmost transient layer first (the dialog / the inspector drawer)
  // instead of minimizing the whole live session out from under it.
  useEffect(() => {
    if (!active || cancelConfirmOpen || brainInspectorOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        minimizeLiveMode();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [active, cancelConfirmOpen, brainInspectorOpen, minimizeLiveMode]);

  if (!active) return null;

  const meeting = meetingId ? meetings.find((m) => m.id === meetingId) : undefined;
  const title = meeting?.title ?? 'Live Meeting';
  const project = meeting?.projectId ? projects.find((p) => p.id === meeting.projectId) : undefined;

  // Clear the viewed-project override → the Board tab returns to the session's own
  // project (the back-banner action). Local state only — never the shared URL.
  const returnToOwnBoard = () => {
    setViewProjectId(null);
    setOpenCardId(null);
  };

  // Brain node click routing (Task 3) — prefers IN-CANVAS moves over navigating
  // underneath the full-screen overlay (mirrors ActivityFeed's handleSelectTab
  // click-through). A session node is a real place → minimize + navigate (else it
  // loads invisibly under the still-covering z-[110] overlay). A card/column
  // resolves to a project and is shown IN this overlay's Board tab — the session's
  // OWN project inline, a FOREIGN project via the viewProject override (with the
  // back-banner) — never a retired /projects navigation. The view is held in LOCAL
  // state (not the shared URL — see the state declarations above); the specific card
  // opens via EmbeddedBoard's `cardOpen` override once its board finishes loading.
  const handleBrainOpenEntity = (arg: { type: BrainNodeType; entityId: string }) => {
    const target = resolveBrainOpenTarget(arg, allCards);
    if (target.kind === 'none') return;
    if (target.kind === 'session') {
      minimizeLiveMode();
      void navigate(`/session/${target.meetingId}`);
      return;
    }
    handleSelectTab('board');
    setViewProjectId(target.projectId === meeting?.projectId ? null : target.projectId);
    setOpenCardId(target.cardId ?? null);
  };

  const canvasTabs: CanvasTabDef[] = [
    { id: 'transcript', label: 'Transcript', badge: badgeCounts.transcript },
    { id: 'board', label: 'Board', badge: badgeCounts.board },
    { id: 'brain', label: 'Brain', badge: badgeCounts.brain },
  ];

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

      {/* GUARD.1 Task 2: inactivity auto-stop countdown warning — self-gates on
          recordingStore.inactivityState, so mounting it unconditionally here is
          equivalent to only rendering it during the countdown. */}
      <InactivityBanner />

      {/* BODY: switchable canvas (center) + proposals/chat (right) */}
      <div className="flex-1 min-h-0 flex">
        {/* Center: Transcript | Board | Brain canvas (Task 4) */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="px-4 pt-3 shrink-0">
            <LiveCanvasTabs tabs={canvasTabs} active={activeTab} onSelect={handleSelectTab} />
          </div>
          <LiveCanvasBody
            activeTab={activeTab}
            projectId={meeting?.projectId ?? undefined}
            viewProjectId={viewProjectId}
            openCardId={openCardId}
            onOpenCardConsumed={() => setOpenCardId(null)}
            projects={projects}
            onClearViewProject={returnToOwnBoard}
            meetingId={meetingId ?? undefined}
            onOpenEntity={handleBrainOpenEntity}
          />
        </div>

        {/* Right column */}
        <aside className="w-96 max-w-[40vw] shrink-0 flex flex-col border-l border-[var(--color-border)] bg-[var(--color-chrome)]">
          {/* Ambient proposals feed (LIVE.2 Task 5) — above the chat. Chips are
              ambient (never modal); the feed and RecordingIndicator's pending badge
              both read liveSuggestionsStore, which stays live even while minimized. */}
          <div data-testid="live-proposals-mount" className="shrink-0">
            <LiveProposalsFeed />
          </div>

          {/* Activity feed (Task 5) — labeled log of what the assistant/triage has
              done this recording; off-canvas entries pulse the tab badge above.
              Collapsible so a long log never crowds the chat below it. */}
          <div data-testid="activity-feed-mount" className="shrink-0 border-t border-[var(--color-border)]">
            <ActivityFeed entries={activityEntries} onSelectTab={handleSelectTab} collapsible />
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
