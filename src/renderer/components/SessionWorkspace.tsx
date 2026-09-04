// === FILE PURPOSE ===
// SessionWorkspace — the routed session page (/session/:id). V3.1 session-centric
// pivot: post-hoc sessions are FULL PAGES, not a modal. Re-homes the retired
// meeting detail layout as a routed page: header + a center canvas with
// Transcript | Board | Brain tabs + a right rail of intelligence sections
// (Brief, Action items, Live proposals, Live Assistant, Session activity). One
// SessionWorkspace concept serves live + post-hoc; the tab strip (LiveCanvasTabs)
// and the Brain placeholder (BrainTabPanel) are shared with LiveModeOverlay
// (Task 4). "Session activity" (Task 5) is a best-effort POST-HOC reconstruction
// of the ActivityFeed from persisted data only (agent messages' tool_calls +
// this meeting's live-suggestions) — it does not read the live activityFeedStore,
// which is session-scoped to the current recording and long gone by the time
// this page is viewed. POST-FLOW.1: a COMPLETED session gains a first "Summary"
// tab (SessionSummaryTab) holding Brief + Action items, selected by default when
// the session opens — those moved out of the rail for that case; live/processing
// sessions keep the rail and never see the tab.
//
// === DEPENDENCIES ===
// react-router-dom (useParams/useNavigate/useSearchParams), meetingStore,
// projectStore, settingsStore, meeting-detail/* sections, Brief/ActionItem sections,
// LiveCanvasTabs, BrainTabPanel, ActivityFeed, activityFeedStore helpers, toolCallLabels.

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { AlertCircle, LayoutGrid } from 'lucide-react';
import { useMeetingStore } from '../stores/meetingStore';
import { useProjectStore } from '../stores/projectStore';
import { useRecordingStore } from '../stores/recordingStore';
import { useBoardStore } from '../stores/boardStore';
import { toast } from '../hooks/useToast';
import EmbeddedBoard from './EmbeddedBoard';
import ViewingProjectBanner from './ViewingProjectBanner';
import LiveCanvasTabs, { type CanvasTabId, type CanvasTabDef } from './LiveCanvasTabs';
import BrainTabPanel, { resolveBrainOpenTarget } from './BrainTabPanel';
import SessionSummaryTab, { SessionIntelligence } from './SessionSummaryTab';
import ConvertActionModal from './ConvertActionModal';
import MeetingAnalyticsSection from './MeetingAnalyticsSection';
import SessionRail from './SessionRail';
import LoadingSpinner from './LoadingSpinner';
import ActivityFeed from './ActivityFeed';
import { describeToolCall } from '../utils/toolCallLabels';
import {
  type ActivityFeedEntry,
  toolTargetTab,
  suggestionTargetTab,
  describeSuggestionEvent,
} from '../stores/activityFeedStore';
import type {
  ActionItem,
  BrainNodeType,
  LiveSuggestion,
  MeetingAgentMessage,
  MeetingWithTranscript,
  Project,
} from '../../shared/types';
import {
  MeetingHeader,
  MeetingPrepSection,
  TranscriptSection,
  LiveAssistantSection,
  LiveProposalsSection,
  DeleteMeetingButton,
  formatMeetingAsMarkdown,
  slugify,
} from './meeting-detail';

// ---------------------------------------------------------------------------
// Board tab — mounts the interactive EmbeddedBoard for the session's linked
// project (Task 3). When the session has no project, keeps the Task-2 empty
// state prompting the user to link one. The board tab is now the review surface
// for auto-pushed cards: KanbanCardModern's Reject/Keep menu renders here via
// EmbeddedBoard's unchanged columns.
//
// Viewed-project override (STORY-PROJECTS-IN-SESSION): a `viewProject` search param
// temporarily points this board at a FOREIGN project (e.g. a Brain "Everything"
// card, or a caught /projects deep link) WITHOUT navigating away — a back-banner
// lets the user return to the session's own project. `boardProjectId` is the only
// thing that changes; the `active` guard (two coexisting boards under the overlay)
// is untouched.
// ---------------------------------------------------------------------------
function BoardTabPanel({
  meeting,
  viewProjectId,
  projects,
  onClearViewProject,
}: {
  meeting: MeetingWithTranscript;
  viewProjectId: string | null;
  projects: Project[];
  onClearViewProject: () => void;
}) {
  // While the full-screen LiveModeOverlay covers this route, its own EmbeddedBoard
  // is the foreground; this covered instance goes inert (no load/stomp, no second
  // drag monitor) and self-heals when the overlay is dismissed.
  const overlayFullScreen = useRecordingStore((s) => s.isRecording && !s.liveModeMinimized);

  const boardProjectId = viewProjectId ?? meeting.projectId;
  const isForeign = viewProjectId !== null && viewProjectId !== meeting.projectId;

  if (!boardProjectId) {
    return (
      <div
        role="tabpanel"
        id="panel-board"
        aria-labelledby="tab-board"
        className="flex flex-col items-center justify-center text-center py-16 px-6"
      >
        <div className="w-16 h-16 rounded-2xl bg-[var(--color-accent-subtle)] border border-[var(--color-border-accent)] flex items-center justify-center mb-5">
          <LayoutGrid size={28} className="text-[var(--color-accent-dim)]" />
        </div>
        <h3 className="text-lg font-medium text-[var(--color-text-primary)] mb-1.5">
          The board arrives with this project
        </h3>
        <p className="text-sm text-[var(--color-text-secondary)] max-w-sm">
          Link this session to a project (in the header) and its board will live right here.
        </p>
      </div>
    );
  }

  const viewedName = projects.find((p) => p.id === viewProjectId)?.name ?? 'another project';

  return (
    <div role="tabpanel" id="panel-board" aria-labelledby="tab-board" className="flex-1 flex flex-col min-h-0">
      {isForeign && <ViewingProjectBanner projectName={viewedName} onBack={onClearViewProject} />}
      <div className="flex-1 flex min-h-0">
        <EmbeddedBoard projectId={boardProjectId} active={!overlayFullScreen} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unassigned-reassignment pill — surfaces Inbox review on the session page when
// auto-pushed cards landed in "Unassigned". Reuses the meetingStore reassign
// action (same flow as the meeting card's pill).
// ---------------------------------------------------------------------------
function UnassignedReassignPill({ meetingId }: { meetingId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const projects = useProjectStore((s) => s.projects);
  const reassign = useMeetingStore((s) => s.reassignFromUnassigned);
  const refreshUnreviewed = useMeetingStore((s) => s.refreshUnreviewedCount);
  const eligible = projects.filter((p) => !p.archived);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const pick = async (projectId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await reassign(meetingId, projectId);
      await refreshUnreviewed();
      setOpen(false);
      toast('Cards moved to chosen project', 'success');
    } catch {
      toast('Failed to reassign cards', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        data-testid="session-unassigned-pill"
        onClick={() => setOpen((prev) => !prev)}
        disabled={busy}
        className="flex items-center gap-1.5 text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30 px-2.5 py-1 rounded-md hover:bg-amber-500/20 transition-colors disabled:opacity-60"
      >
        <AlertCircle size={12} />
        Unassigned — set project?
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-30 min-w-[200px] max-h-64 overflow-y-auto bg-white dark:bg-surface-900 border border-[var(--color-border)] rounded-lg shadow-lg py-1">
          {eligible.length === 0 ? (
            <div className="px-3 py-2 text-xs text-[var(--color-text-muted)]">No projects available</div>
          ) : (
            eligible.map((p) => (
              <button
                key={p.id}
                onClick={() => void pick(p.id)}
                disabled={busy}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-surface-100 dark:hover:bg-surface-800 hover:text-[var(--color-text-primary)] transition-colors text-left disabled:opacity-50"
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: p.color || '#6366f1' }} />
                <span className="truncate">{p.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session activity (Task 5) — post-hoc, BEST-EFFORT reconstruction from
// PERSISTED data only: the meeting-agent thread's tool_calls/tool_results and
// this meeting's live-suggestions (accepted/dismissed). No new persistence or
// IPC — reuses meetingAgentLoad + listLiveSuggestions, the same two IPC calls
// LiveAssistantSection/LiveProposalsSection already make independently.
// ---------------------------------------------------------------------------
function buildSessionActivity(messages: MeetingAgentMessage[], suggestions: LiveSuggestion[]): ActivityFeedEntry[] {
  const toolEntries: ActivityFeedEntry[] = [];
  messages.forEach((message) => {
    message.toolCalls?.forEach((call, i) => {
      const result = message.toolResults?.find((r) => r.toolCallId === call.id);
      const failed = result && (result.result as Record<string, unknown> | undefined)?.success === false;
      toolEntries.push({
        id: call.id || `${message.id}-${i}`,
        icon: failed ? 'tool-error' : 'tool-ok',
        label: describeToolCall(call),
        timestamp: message.createdAt,
        targetTab: toolTargetTab(call.name),
      });
    });
  });

  const suggestionEntries: ActivityFeedEntry[] = suggestions
    .filter((s) => s.status !== 'proposed')
    .map((s) => ({
      id: s.id,
      icon: s.status === 'dismissed' ? 'dismissed' : s.type === 'project' ? 'project' : 'accepted',
      label: describeSuggestionEvent(s, s.status === 'accepted' ? 'accepted' : 'dismissed'),
      timestamp: s.updatedAt,
      targetTab: suggestionTargetTab(s.type),
    }));

  return [...toolEntries, ...suggestionEntries].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}

function SessionActivityFeed({
  meetingId,
  onSelectTab,
}: {
  meetingId: string;
  onSelectTab: (tab: CanvasTabId) => void;
}) {
  const [messages, setMessages] = useState<MeetingAgentMessage[]>([]);
  const [suggestions, setSuggestions] = useState<LiveSuggestion[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([window.electronAPI.meetingAgentLoad(meetingId), window.electronAPI.listLiveSuggestions(meetingId)])
      .then(([loadedMessages, loadedSuggestions]) => {
        if (cancelled) return;
        setMessages(loadedMessages);
        setSuggestions(loadedSuggestions);
      })
      .catch(() => {
        // Best-effort — mirrors LiveAssistantSection/LiveProposalsSection's own posture.
      });
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  const entries = buildSessionActivity(messages, suggestions);

  // Never used during this meeting — render nothing rather than an empty section.
  if (entries.length === 0) return null;

  return (
    <ActivityFeed entries={entries} onSelectTab={onSelectTab} title="Session activity" maxHeightClassName="max-h-64" />
  );
}

const TABS: CanvasTabDef[] = [
  { id: 'transcript', label: 'Transcript' },
  { id: 'board', label: 'Board' },
  { id: 'brain', label: 'Brain' },
];

// Completed meetings get an extra FIRST tab: the brief (POST-FLOW.1's follow-up
// — it shipped as a hero stacked above the strip, which pushed these tabs down
// and cost them their visibility; as a peer tab it leads without burying).
// The second tab hosts prep + collapsed transcript + the Meeting Assistant chat,
// so "Transcript" would under-sell it. Same ids — routing state is unaffected.
const COMPLETED_TABS: CanvasTabDef[] = [
  { id: 'summary', label: 'Summary' },
  { id: 'transcript', label: 'Meeting' },
  ...TABS.slice(1),
];

type SessionLoadState = 'loading' | 'ready' | 'missing';

// ---------------------------------------------------------------------------
// Not-found / loading gate (Task 2) -- rendered whenever the routed meeting
// doesn't (yet) match the routed id. A resolved-but-missing meeting (e.g. "View
// source meeting" pointing at a since-deleted id) shows a way back instead of
// spinning forever; a still-loading one just shows the spinner.
// ---------------------------------------------------------------------------
function SessionLoadGate({ loadState }: { loadState: SessionLoadState }) {
  if (loadState === 'missing') {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center py-16 px-6">
        <div className="w-16 h-16 rounded-2xl bg-[var(--color-accent-subtle)] border border-[var(--color-border-accent)] flex items-center justify-center mb-5">
          <AlertCircle size={28} className="text-[var(--color-accent-dim)]" />
        </div>
        <h3 className="text-lg font-medium text-[var(--color-text-primary)] mb-1.5">Meeting not found</h3>
        <p className="text-sm text-[var(--color-text-secondary)] max-w-sm mb-5">
          This session may have been deleted, or the link is no longer valid.
        </p>
        <Link to="/" className="btn-primary px-4 py-2 text-sm font-hud">
          Back to Sessions
        </Link>
      </div>
    );
  }
  return (
    <div className="h-full flex items-center justify-center">
      <LoadingSpinner />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loads the routed meeting and tracks tab + load state together (Tasks #2/#7
// from the V3.1 review): switching sessions resets both in the same place, so
// a freshly-opened session always lands on its transcript (honoring a
// transcriptSearch deep link) and never gets stuck showing a stale tab or an
// infinite spinner for a since-deleted meeting.
//
// The reset happens DURING RENDER (React's documented pattern for adjusting
// state when a prop/id changes -- https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes),
// not inside the load effect, so switching ids can't leave stale state visible
// for even one frame.
// ---------------------------------------------------------------------------
function useSessionLoad(id: string | undefined, initialTab: CanvasTabId) {
  const loadMeeting = useMeetingStore((s) => s.loadMeeting);
  const [activeTab, setActiveTab] = useState<CanvasTabId>(initialTab);
  const [loadState, setLoadState] = useState<SessionLoadState>('loading');
  const [prevId, setPrevId] = useState(id);
  const [defaultedId, setDefaultedId] = useState<string | undefined>(undefined);
  const selectedMeeting = useMeetingStore((s) => s.selectedMeeting);

  // A freshly-routed session lands on its transcript UNLESS the URL asks for the
  // board (a viewProject/openCard deep link — e.g. a caught /projects redirect or a
  // CommandPalette/SessionSearch jump-to-board). `initialTab` is captured at the
  // moment the id changes so param edits made later never re-reset the tab.
  if (id !== prevId) {
    setPrevId(id);
    setActiveTab(initialTab);
    setLoadState('loading');
    setDefaultedId(undefined);
  }

  // A FINISHED session opens ON its Summary tab — the brief is the reason for
  // coming back, and this is what makes it "the first thing" now that it is a
  // peer tab rather than a hero stacked above the strip. Status is unknown until
  // the meeting resolves, so this runs as the SAME render-time adjustment the id
  // reset above uses — not in the load effect, where the update would land in a
  // microtask (one frame of the wrong tab, and an act()-less update under test).
  // Skipped when the URL named a tab (a deep link outranks a default) and for
  // live/processing sessions, which have no Summary tab at all. `defaultedId`
  // makes it once-per-session, so a later manual tab click is never overridden.
  const resolved = id && selectedMeeting?.id === id ? selectedMeeting : null;
  if (resolved && defaultedId !== id) {
    setDefaultedId(id);
    if (resolved.status === 'completed' && initialTab === 'transcript') setActiveTab('summary');
  }

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void loadMeeting(id).then(() => {
      if (cancelled) return;
      const loaded = useMeetingStore.getState().selectedMeeting;
      setLoadState(loaded?.id === id ? 'ready' : 'missing');
    });
    return () => {
      cancelled = true;
    };
  }, [id, loadMeeting]);

  return { activeTab, setActiveTab, loadState };
}

// ---------------------------------------------------------------------------
// Search-param helpers for the viewed-project override (module-level so their
// branching stays out of SessionWorkspace's own complexity budget).
// ---------------------------------------------------------------------------
/** A viewProject/openCard deep link lands straight on the Board tab. */
function initialBoardTab(params: URLSearchParams): CanvasTabId {
  return params.get('viewProject') || params.get('openCard') ? 'board' : 'transcript';
}

/** Next params pointing the Board tab at a project — own project drops viewProject
 *  (banner hidden); a foreign one sets it. openCard opens a specific card on load. */
function boardSearchParams(
  current: URLSearchParams,
  projectId: string,
  ownProjectId: string | null,
  cardId?: string,
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (projectId === ownProjectId) next.delete('viewProject');
  else next.set('viewProject', projectId);
  if (cardId) next.set('openCard', cardId);
  else next.delete('openCard');
  return next;
}

/** Next params with the viewed-project override removed (back to the own board). */
function clearedBoardParams(current: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(current);
  next.delete('viewProject');
  next.delete('openCard');
  return next;
}

// ---------------------------------------------------------------------------
// SessionWorkspace page shell
// ---------------------------------------------------------------------------
export default function SessionWorkspace() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const autoGenerate = searchParams.get('autoGenerate') === '1';
  const initialTranscriptSearch = searchParams.get('transcriptSearch') ?? undefined;
  const viewProjectParam = searchParams.get('viewProject');
  const initialTab = initialBoardTab(searchParams);

  const selectedMeeting = useMeetingStore((s) => s.selectedMeeting);
  const clearSelectedMeeting = useMeetingStore((s) => s.clearSelectedMeeting);
  const clearAnalytics = useMeetingStore((s) => s.clearAnalytics);
  const updateMeeting = useMeetingStore((s) => s.updateMeeting);
  const deleteMeeting = useMeetingStore((s) => s.deleteMeeting);
  const convertActionToCard = useMeetingStore((s) => s.convertActionToCard);
  const renameSpeaker = useMeetingStore((s) => s.renameSpeaker);
  const projects = useProjectStore((s) => s.projects);
  const loadProjects = useProjectStore((s) => s.loadProjects);
  const allCards = useBoardStore((s) => s.allCards);

  const { activeTab, setActiveTab, loadState } = useSessionLoad(id, initialTab);
  const [convertingAction, setConvertingAction] = useState<ActionItem | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const prevSegmentCount = useRef(0);

  // Load projects (for the header dropdown / links).
  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  // Clear detail state on unmount so a stale meeting never flashes on the next open.
  useEffect(() => {
    return () => {
      clearSelectedMeeting();
      clearAnalytics();
    };
  }, [clearSelectedMeeting, clearAnalytics]);

  // Only trust the loaded meeting once it matches the routed id.
  const meeting = selectedMeeting?.id === id ? selectedMeeting : null;

  // Auto-scroll transcript to bottom as new segments arrive while recording.
  useEffect(() => {
    if (!meeting) return;
    const count = meeting.segments.length;
    if (count > prevSegmentCount.current && meeting.status === 'recording' && activeTab === 'transcript') {
      transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevSegmentCount.current = count;
  }, [meeting, activeTab]);

  const handleBack = useCallback(() => {
    // A routed page has no overlay to close — return to where the user came from.
    if (window.history.length > 1) void navigate(-1);
    else void navigate('/');
  }, [navigate]);

  if (!id) return null;

  if (!meeting) {
    return <SessionLoadGate loadState={loadState} />;
  }

  const linkedProject = meeting.projectId ? projects.find((p) => p.id === meeting.projectId) : undefined;
  const linkedProjectName = linkedProject?.name;

  const handleExport = () => {
    const markdown = formatMeetingAsMarkdown(meeting, linkedProjectName);
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meeting-${slugify(meeting.title)}-${new Date(meeting.startedAt).toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Meeting exported as Markdown', 'success');
  };

  const handleDelete = async () => {
    await deleteMeeting(meeting.id);
    handleBack();
  };

  const handleCopy = (field: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  };

  const copySummary = () => {
    if (meeting.brief) handleCopy('summary', meeting.brief.summary);
  };

  const copyActionItems = () => {
    const text = meeting.actionItems
      .map((item) => {
        const checkbox = item.status === 'approved' ? '[x]' : '[ ]';
        // "Owner — task (due)" — owner prefix only when known, due suffix only when said (BRIEF-QUAL.1).
        const body = item.owner ? `${item.owner} — ${item.description}` : item.description;
        const due = item.dueText ? ` (${item.dueText})` : '';
        return `- ${checkbox} ${body}${due}`;
      })
      .join('\n');
    handleCopy('actions', text);
  };

  // Point the in-session Board tab at a project (STORY-PROJECTS-IN-SESSION). The
  // session's OWN project needs no viewProject (the banner stays hidden); a FOREIGN
  // project rides the `viewProject` override so it shows here with the back-banner,
  // never navigating to a retired /projects destination. Reuses the existing
  // ?openCard= board-load mechanism to open a specific card once its board loads.
  const openProjectInBoard = (projectId: string, cardId?: string) => {
    setActiveTab('board');
    setSearchParams(boardSearchParams(searchParams, projectId, meeting.projectId, cardId), { replace: true });
  };

  // Clear the viewed-project override → the board returns to the session's own
  // project. Also the header "Open Board" action (with a Board-tab switch).
  const returnToOwnBoard = (switchTab: boolean) => {
    if (switchTab) setActiveTab('board');
    setSearchParams(clearedBoardParams(searchParams), { replace: true });
  };

  // Brain node click routing — the inspector's explicit "Open full page →" action
  // (a node CLICK opens the in-canvas inspector via BrainTabPanel). A session node
  // is a real place → navigate. A card/column resolves to a project (via
  // boardStore.allCards): shown IN this session's Board tab — own project inline,
  // foreign project via the viewProject override — never /projects. decision/question
  // nodes resolve to { kind: 'none' } (no standalone destination) → no-op.
  const handleBrainOpenEntity = (arg: { type: BrainNodeType; entityId: string }) => {
    const target = resolveBrainOpenTarget(arg, allCards);
    if (target.kind === 'session') void navigate(`/session/${target.meetingId}`);
    else if (target.kind === 'board') openProjectInBoard(target.projectId, target.cardId);
  };

  const renderPanel = () => {
    // Summary tab — completed sessions only (the tab is not offered otherwise,
    // and the component self-gates besides).
    if (activeTab === 'summary')
      return <SessionSummaryTab meeting={meeting} autoGenerate={autoGenerate} onConvert={setConvertingAction} />;
    if (activeTab === 'board')
      return (
        <BoardTabPanel
          meeting={meeting}
          viewProjectId={viewProjectParam}
          projects={projects}
          onClearViewProject={() => returnToOwnBoard(false)}
        />
      );
    if (activeTab === 'brain') {
      return (
        <BrainTabPanel meetingId={meeting.id} projectId={meeting.projectId} onOpenEntity={handleBrainOpenEntity} />
      );
    }
    // Completed meetings: this tab is the meeting's primary surface — prep +
    // collapsed transcript (reference material, one click away) with the
    // Meeting Assistant chat filling the remaining canvas height (BRAIN-UX.1
    // follow-up: the chat was buried in the 380px rail while this canvas sat
    // nearly empty once the transcript collapsed by default).
    const completed = meeting.status === 'completed';
    return (
      <div
        role="tabpanel"
        id="panel-transcript"
        aria-labelledby="tab-transcript"
        className={completed ? 'p-6 flex-1 min-h-0 flex flex-col' : 'p-6'}
      >
        {meeting.prepBriefing && <MeetingPrepSection prepBriefing={meeting.prepBriefing} />}
        <TranscriptSection
          meeting={meeting}
          transcriptEndRef={transcriptEndRef}
          initialSearch={initialTranscriptSearch}
          onCopySummary={copySummary}
          onCopyActions={copyActionItems}
          copiedField={copiedField}
          onCopy={handleCopy}
          onRenameSpeaker={(label, name) => renameSpeaker(meeting.id, label, name)}
        />
        {completed && <LiveAssistantSection meetingId={meeting.id} variant="canvas" />}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-surface-50/50 dark:bg-surface-950">
      {/* Header */}
      <div className="shrink-0 px-8 pt-6 pb-2 border-b border-[var(--color-border)]">
        <MeetingHeader
          meeting={meeting}
          projects={projects}
          onUpdateMeeting={updateMeeting}
          onExport={handleExport}
          onClose={handleBack}
          onOpenBoard={() => returnToOwnBoard(true)}
        />
        {meeting.unassignedPending && (
          <div className="-mt-4 mb-2">
            <UnassignedReassignPill meetingId={meeting.id} />
          </div>
        )}
      </div>

      {/* Canvas + rail */}
      <div className="flex-1 flex min-h-0">
        {/* Center canvas */}
        <section className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          <div className="px-6 pt-4 shrink-0">
            <LiveCanvasTabs
              tabs={meeting.status === 'completed' ? COMPLETED_TABS : TABS}
              active={activeTab}
              onSelect={setActiveTab}
            />
          </div>
          {renderPanel()}
        </section>

        {/* Right rail — intelligence + review affordances. Resizable/collapsible
            (SessionRail): one fixed width could not serve both a laptop and an
            ultrawide, and 380px squeezed every section inside it. */}
        <SessionRail>
          <MeetingAnalyticsSection
            meetingId={meeting.id}
            isCompleted={meeting.status === 'completed'}
            speakerNames={meeting.speakerNames}
          />
          {/* Live/processing sessions keep the rail block; a completed one moved it
              into the Summary tab, so this self-gating placement renders nothing. */}
          <SessionIntelligence meeting={meeting} autoGenerate={autoGenerate} onConvert={setConvertingAction} />
          {meeting.status === 'completed' && (
            <LiveProposalsSection meetingId={meeting.id} projectName={linkedProjectName ?? 'Unassigned'} />
          )}
          {meeting.status === 'completed' && <SessionActivityFeed meetingId={meeting.id} onSelectTab={setActiveTab} />}
          <DeleteMeetingButton onDelete={handleDelete} />
        </SessionRail>
      </div>

      {convertingAction && (
        <ConvertActionModal
          actionItem={convertingAction}
          preselectedProjectId={meeting.projectId ?? undefined}
          preselectedProjectName={linkedProjectName}
          onConvert={convertActionToCard}
          onClose={() => setConvertingAction(null)}
        />
      )}
    </div>
  );
}
