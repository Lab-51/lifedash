// === FILE PURPOSE ===
// Board view page — Modern Design.
// Thin page wrapper (V3.1 Task 3): renders the page chrome (SYS.BOARD header,
// hourly rate, export, per-project auto-push, AI agent sidebar) around the
// extracted <EmbeddedBoard>, which owns the interactive Kanban core (columns,
// cards, drag-drop, quick-add, filters, card detail). The board body is now
// shared with SessionWorkspace's Board tab via EmbeddedBoard; this route stays
// alive for deep links and behaves identically.

import { Suspense, lazy, useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, X, Download, LayoutTemplate, DollarSign, Check, Bot, Loader2 } from 'lucide-react';
import { exportBoardAsCsv } from '../hooks/useBoardController';
import { useBoardStore } from '../stores/boardStore';
import { useProjectStore } from '../stores/projectStore';
import { useProjectAgentStore } from '../stores/projectAgentStore';
import { useRecordingStore } from '../stores/recordingStore';
import EmbeddedBoard from './EmbeddedBoard';
import FeatureTip from './FeatureTip';

const ProjectAgentPanel = lazy(() => import('./ProjectAgentPanel'));

export default function BoardPageModern() {
  const { projectId } = useParams<{ projectId: string }>();

  // Board data for the chrome (title + export) is read straight from the store —
  // the single useBoardController instance lives inside EmbeddedBoard.
  const project = useBoardStore((s) => s.project);
  const columns = useBoardStore((s) => s.columns);
  const allCards = useBoardStore((s) => s.cards);
  const labels = useBoardStore((s) => s.labels);
  const loadBoard = useBoardStore((s) => s.loadBoard);

  // The full-screen LiveModeOverlay (recording && !minimized) portals OVER this
  // route. While it's up, this covered board goes inert so it can't stomp the
  // shared store or register a duplicate drag monitor; it self-heals on dismissal.
  const overlayFullScreen = useRecordingStore((s) => s.isRecording && !s.liveModeMinimized);

  // Project Agent panel state
  const [showAgent, setShowAgent] = useState(false);
  const [agentEverOpened, setAgentEverOpened] = useState(false);
  const agentMessageCount = useProjectAgentStore((s) => s.messageCount);

  // Load agent message count on mount
  useEffect(() => {
    const loadAgentCount = useProjectAgentStore.getState().loadMessageCount;
    if (projectId) loadAgentCount(projectId);
  }, [projectId]);

  // Escape key closes agent panel before other handlers
  useEffect(() => {
    if (!showAgent) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setShowAgent(false);
      }
    };
    document.addEventListener('keydown', handleEscape, true); // capture phase
    return () => document.removeEventListener('keydown', handleEscape, true);
  }, [showAgent]);

  // Reset agent store on projectId change or unmount
  useEffect(() => {
    return () => useProjectAgentStore.getState().reset();
  }, [projectId]);

  // Hourly rate — read from projectStore so updates reflect immediately
  const updateProject = useProjectStore((s) => s.updateProject);
  const storeProjects = useProjectStore((s) => s.projects);
  const liveProject = storeProjects.find((p) => p.id === projectId) ?? project;
  const [editingRate, setEditingRate] = useState(false);
  const [editRate, setEditRate] = useState('');
  const handleSaveRate = async () => {
    if (!projectId) return;
    const val = editRate.trim();
    const rate = val ? parseFloat(val) : null;
    if (rate !== null && (isNaN(rate) || rate < 0)) {
      setEditingRate(false);
      return;
    }
    await updateProject(projectId, { hourlyRate: rate });
    setEditingRate(false);
  };

  // Per-project auto-push override
  const handleAutoPushChange = async (value: boolean | null) => {
    if (!projectId) return;
    await updateProject(projectId, { autoPushEnabled: value });
  };

  return (
    <div className="h-full flex flex-col bg-surface-50 dark:bg-surface-950">
      {/* Modern Header (page chrome) */}
      <div className="px-8 pt-8 pb-6 shrink-0 hud-chrome-bg border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to="/projects"
              className="p-2 -ml-2 rounded-xl text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] transition-colors"
            >
              <ArrowLeft size={24} />
            </Link>
            <div>
              <div className="flex items-center gap-3 mb-1">
                <span
                  className="font-data text-[0.6875rem] tracking-[0.3em] text-[var(--color-accent)] text-glow"
                  aria-hidden="true"
                >
                  SYS.BOARD
                </span>
                <div className="h-px w-10 bg-gradient-to-l from-transparent to-[var(--color-accent)] opacity-40" />
              </div>
              <h1 className="font-hud text-2xl tracking-wider text-[var(--color-text-primary)] flex items-center gap-2">
                {project?.name ?? 'Board'}
              </h1>
              <p className="font-data text-[var(--color-text-secondary)] mt-1 flex items-center gap-2 text-sm">
                <LayoutTemplate size={14} />
                Kanban View
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <FeatureTip.Button id="board" />
            {editingRate ? (
              <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl px-3 py-1.5 animate-in fade-in zoom-in-95 duration-150">
                <div className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
                  <DollarSign size={16} strokeWidth={2.5} />
                </div>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={editRate}
                  onChange={(e) => setEditRate(e.target.value)}
                  onBlur={handleSaveRate}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveRate();
                    if (e.key === 'Escape') setEditingRate(false);
                  }}
                  autoFocus
                  placeholder="0.00"
                  className="w-24 text-sm font-semibold bg-white dark:bg-surface-900 border border-green-300 dark:border-green-700 rounded-lg px-3 py-1.5 outline-none focus:outline-none focus:ring-0 focus:border-green-500 focus-visible:outline-none text-surface-900 dark:text-surface-100 placeholder-surface-400 shadow-sm transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="text-sm font-medium text-emerald-600/70 dark:text-emerald-400/70">/hr</span>
                <button
                  onClick={handleSaveRate}
                  className="ml-1 p-1 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white transition-colors shadow-sm"
                >
                  <Check size={14} />
                </button>
                <button
                  onClick={() => setEditingRate(false)}
                  className="p-1 rounded-lg text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 hover:bg-surface-200/50 dark:hover:bg-surface-700/50 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            ) : liveProject?.hourlyRate ? (
              <button
                onClick={() => {
                  setEditingRate(true);
                  setEditRate(String(liveProject.hourlyRate));
                }}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 rounded-xl transition-all"
              >
                <DollarSign size={16} />
                {liveProject.hourlyRate}/hr
              </button>
            ) : (
              <button
                onClick={() => {
                  setEditingRate(true);
                  setEditRate('');
                }}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-surface-500 dark:text-surface-400 border border-dashed border-surface-300 dark:border-surface-700 hover:border-emerald-400 hover:text-emerald-600 dark:hover:text-emerald-400 rounded-xl transition-all"
              >
                <DollarSign size={16} />
                Set rate
              </button>
            )}
            <button
              onClick={() => exportBoardAsCsv(columns, allCards, labels)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-surface-600 dark:text-surface-300 bg-surface-100 dark:bg-surface-800 hover:bg-surface-200 dark:hover:bg-surface-700 rounded-xl transition-all"
            >
              <Download size={16} />
              Export
            </button>

            {/* Per-project auto-push override — tri-state control */}
            {liveProject && !liveProject.system && (
              <div
                className="flex items-center gap-1 bg-surface-100 dark:bg-surface-800 rounded-xl px-1 py-1"
                title="Auto-push action items override for this project"
              >
                {(
                  [
                    { value: null, label: 'Global' },
                    { value: true, label: 'Always' },
                    { value: false, label: 'Never' },
                  ] as Array<{ value: boolean | null; label: string }>
                ).map(({ value, label }) => {
                  const isActive = liveProject.autoPushEnabled === value;
                  return (
                    <button
                      key={label}
                      onClick={() => handleAutoPushChange(value)}
                      title={
                        value === null
                          ? 'Use global auto-push setting'
                          : value
                            ? 'Always auto-push for this project'
                            : 'Never auto-push for this project'
                      }
                      className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-all ${
                        isActive
                          ? 'bg-white dark:bg-surface-700 text-[var(--color-text-primary)] shadow-sm'
                          : 'text-surface-500 hover:text-[var(--color-text-secondary)]'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <FeatureTip id="board" title="How the board works">
          Drag and drop cards between columns to update their status. Click any card to open details where you can add
          checklists, comments, and attachments. Use the card&apos;s AI agent to get help with planning and task
          breakdown. Set an hourly rate on the project to track billable time.
        </FeatureTip>
      </div>

      {/* Board Layout — extracted core + AI agent */}
      <div className="flex-1 flex overflow-hidden">
        <EmbeddedBoard projectId={projectId!} active={!overlayFullScreen} />

        {/* AI Agent FAB — hidden when panel is open */}
        {!showAgent && (
          <button
            onClick={() => {
              setShowAgent(true);
              if (!agentEverOpened) setAgentEverOpened(true);
            }}
            className="group/agent fixed bottom-[calc(2rem+15px)] right-6 z-30 flex items-center gap-2.5 pl-3 pr-4 py-2.5 rounded-full border border-[var(--color-border)] bg-white dark:bg-surface-900 hover:border-[var(--color-accent-dim)] shadow-lg shadow-black/20 hover:shadow-[var(--color-accent)]/15 transition-all"
          >
            <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 border border-[var(--color-border)] bg-surface-100 dark:bg-surface-950 group-hover/agent:border-[var(--color-accent-dim)] transition-colors">
              <Bot
                size={15}
                className="text-[var(--color-accent-dim)] group-hover/agent:text-[var(--color-accent)] transition-colors"
              />
            </div>
            <span className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
              AI Agent
            </span>
            {agentMessageCount > 0 && (
              <span className="text-[0.625rem] font-data bg-[var(--color-accent-muted)] text-[var(--color-accent)] rounded-full min-w-[22px] h-[22px] flex items-center justify-center px-1.5">
                {agentMessageCount}
              </span>
            )}
          </button>
        )}

        {/* Agent panel — slide from right */}
        <div
          className={`
                    border-l border-[var(--color-border)] bg-white dark:bg-surface-900
                    transition-all duration-300 ease-out overflow-hidden shrink-0
                    ${showAgent ? 'w-[380px] min-w-[380px]' : 'w-0 min-w-0'}
                `}
        >
          {agentEverOpened && (
            <div className="flex flex-col h-full">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border)] shrink-0">
                <div className="flex items-center gap-2">
                  <Bot size={14} className="text-[var(--color-accent)]" />
                  <span className="text-sm font-semibold text-[var(--color-text-primary)]">Project Agent</span>
                </div>
                <button
                  onClick={() => setShowAgent(false)}
                  className="p-1 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-accent-subtle)] transition-colors"
                  title="Close panel"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                <Suspense
                  fallback={
                    <div className="flex items-center justify-center h-full">
                      <Loader2 className="animate-spin text-[var(--color-accent)]" size={20} />
                    </div>
                  }
                >
                  <ProjectAgentPanel projectId={projectId!} onWriteAction={() => projectId && loadBoard(projectId)} />
                </Suspense>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
