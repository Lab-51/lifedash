// === FILE PURPOSE ===
// The Twin Memory tab (TWIN-GRAPH.2 Task 3) — the tiered memory GRAPH that
// replaces TwinMemoryPanel's flat list, and the new home of the twin's LOCKED
// safety triad. TwinMemoryPanel and its parts are retained unreferenced (except
// TwinMemoryUndoSnackbar, reused here verbatim) so reversing this is cheap.
//
// THE SAFETY TRIAD, all three carried over and all three KEYBOARD-REACHABLE —
// a hover-only affordance would be a regression, not a redesign:
//   1. PROVENANCE — every fact node's inspector says "learned in <session>",
//      from the title Task 1 joined onto the payload, and "a past session" when
//      the source is gone. Never a raw id, never fabricated. Reached by focusing
//      a node (they are real tabbable controls) and pressing Enter/Space.
//   2. ONE-TAP FORGET + ~5s UNDO — a real <button> inside that inspector.
//      twinMemoryForget resolving NULL means "no such fact": a resolved promise
//      that forgot NOTHING, so it is treated as a FAILURE and rolls the
//      optimistic removal back, exactly like a thrown IPC error. Undo reuses
//      TwinMemoryUndoSnackbar (which focuses itself on mount and expires in ~5s).
//   3. PAUSE LEARNING — a native button in this header, always visible, never
//      behind the canvas. It only REFLECTS and FLIPS twin.learningPaused; the
//      gate itself stays main-side (twinMemoryService) and is not re-implemented.
//
// Counting: `onCountChange` reports the live ACTIVE-fact count (fact nodes only —
// hubs and the core are structure) so TwinPage's Memory tab badge keeps working
// exactly as it did with the list. It counts the FULL payload, so progressive
// disclosure (TWIN-READ.1 Task 2) never changes the badge — collapsing a lane
// hides facts from the canvas, never from the count.
//
// Disclosure state (which lanes are open) is read from the store and passed down
// rather than owned here: it must survive a refresh, and the canvas is rebuilt
// from its props. See TwinMemoryRiverCanvas's header for the design.
//
// THE CANVAS IS THE RIVERBANK since TWIN-READ.2 Task 2 — twin left, category
// hubs mid, one row per fact right. TwinMemoryGraphCanvas (the tiered force
// layout it replaced) is RETAINED UNREFERENCED, exactly as TwinMemoryPanel and
// BrainMindMap are: nothing about this host changed but the import, which is
// what makes reversing the swap a one-line question.
//
// Refresh triggers live in twinMemoryGraphStore's header: mount, tab activation,
// and a successful undo. No polling, no interval.
//
// === DEPENDENCIES ===
// react, react-router-dom, lucide-react, twinMemoryGraphStore, settingsStore,
// LoadingSpinner, TwinMemoryRiverCanvas, TwinMemoryInspector,
// TwinMemoryUndoSnackbar, TwinMemoryBackfillButton

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Brain, Pause, Play } from 'lucide-react';
import LoadingSpinner from '../LoadingSpinner';
import { useSettingsStore } from '../../stores/settingsStore';
import { factCountOf, useTwinMemoryGraphStore } from '../../stores/twinMemoryGraphStore';
import { TWIN_LEARNING_PAUSED_SETTING_KEY } from '../../../shared/types/twin';
import type { TwinGraphNode } from '../../../shared/types';
import TwinMemoryBackfillButton from './TwinMemoryBackfillButton';
import TwinMemoryRiverCanvas from './TwinMemoryRiverCanvas';
import TwinMemoryInspector from './TwinMemoryInspector';
import TwinMemoryUndoSnackbar from './TwinMemoryUndoSnackbar';

const FORGET_MISSING_ERROR = 'Could not forget that fact — it may have already been removed.';
const FORGET_FAILED_ERROR = 'Failed to forget that fact — please try again.';
const RESTORE_MISSING_ERROR = 'Could not restore that fact.';
const RESTORE_FAILED_ERROR = 'Failed to restore that fact — please try again.';

/** The node the inspector is open on, plus how it was opened — a keyboard
 *  activation moves focus into the card, a click deliberately does not. */
interface PinnedState {
  node: TwinGraphNode;
  viaKeyboard: boolean;
}

/** The fact currently inside the undo window. `id` is the DB row id (the graph
 *  node id is prefixed and is NOT what the restore channel takes). */
interface ForgottenState {
  id: string;
  text: string;
}

export interface TwinMemoryGraphProps {
  /** Reports the live ACTIVE-fact count so the parent can badge the Memory tab. */
  onCountChange?: (count: number) => void;
  /** Whether the Memory tab is the one on screen. Flipping false -> true is a
   *  refresh trigger; the component stays mounted either way so the badge keeps
   *  counting from the Profile tab. */
  active?: boolean;
}

export default function TwinMemoryGraph({ onCountChange, active = true }: TwinMemoryGraphProps) {
  const navigate = useNavigate();
  const settings = useSettingsStore((s) => s.settings);
  const setSetting = useSettingsStore((s) => s.setSetting);
  const paused = settings[TWIN_LEARNING_PAUSED_SETTING_KEY] === 'true';

  const graph = useTwinMemoryGraphStore((s) => s.graph);
  const entering = useTwinMemoryGraphStore((s) => s.entering);
  const expandedLanes = useTwinMemoryGraphStore((s) => s.expandedLanes);
  const toggleLane = useTwinMemoryGraphStore((s) => s.toggleLane);
  const load = useTwinMemoryGraphStore((s) => s.load);
  const refresh = useTwinMemoryGraphStore((s) => s.refresh);
  const forgetNode = useTwinMemoryGraphStore((s) => s.forgetNode);

  const [error, setError] = useState<string | null>(null);
  const [pinned, setPinned] = useState<PinnedState | null>(null);
  const [forgotten, setForgotten] = useState<ForgottenState | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const wasActiveRef = useRef(active);

  useEffect(() => {
    void load();
  }, [load]);

  // Returning to the tab refetches — facts learned while the user was elsewhere
  // arrive here, and the store's diff blooms them in.
  useEffect(() => {
    if (active && !wasActiveRef.current) void refresh();
    wasActiveRef.current = active;
  }, [active, refresh]);

  // Report the live active-fact count to the parent (Memory tab badge). Held back
  // until the first payload lands, so the badge never flashes a wrong number.
  useEffect(() => {
    if (graph) onCountChange?.(factCountOf(graph));
  }, [graph, onCountChange]);

  const togglePause = (): void => {
    void setSetting(TWIN_LEARNING_PAUSED_SETTING_KEY, paused ? 'false' : 'true');
  };

  const handleInspect = useCallback((node: TwinGraphNode, viaKeyboard: boolean) => {
    setPinned({ node, viaKeyboard });
  }, []);

  const handleForget = useCallback(async () => {
    const node = pinned?.node;
    if (!node) return;
    setPinned(null);
    const ok = await forgetNode(node.id, async () => {
      const result = await window.electronAPI.twinMemoryForget(node.recordId).catch((cause: unknown) => {
        setError(FORGET_FAILED_ERROR);
        throw cause instanceof Error ? cause : new Error(FORGET_FAILED_ERROR);
      });
      // A resolved null is "no such fact" — it forgot NOTHING. Treating it as
      // success would leave a phantom undo for a fact that never went anywhere.
      if (!result) {
        setError(FORGET_MISSING_ERROR);
        throw new Error(FORGET_MISSING_ERROR);
      }
    });
    if (!ok) return; // the store already rolled the node back; the message is set
    setError(null);
    setForgotten({ id: node.recordId, text: node.label });
  }, [pinned, forgetNode]);

  // Shared close path for undo and auto-expiry alike — focus always lands on a
  // stable anchor, because the node that triggered this may no longer exist.
  const closeSnackbar = useCallback(() => {
    setForgotten(null);
    headingRef.current?.focus();
  }, []);

  const handleUndo = useCallback(async () => {
    if (!forgotten) return;
    try {
      const result = await window.electronAPI.twinMemoryRestore(forgotten.id);
      if (!result) setError(RESTORE_MISSING_ERROR);
      else {
        setError(null);
        await refresh(); // the fact comes back with its real hub + degree
      }
    } catch {
      setError(RESTORE_FAILED_ERROR);
    } finally {
      closeSnackbar();
    }
  }, [forgotten, refresh, closeSnackbar]);

  return (
    <div className="flex flex-col min-h-0 flex-1 gap-4">
      <div className="flex items-center justify-between gap-4 shrink-0">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-sm font-hud tracking-wide text-[var(--color-text-primary)] outline-none"
        >
          Learned facts
        </h2>
        {/* The kill-switch stays FIRST in this row: a secondary action must never
            push a safety control further along the tab sequence. */}
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={togglePause}
            aria-pressed={paused}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              paused
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                : 'border-[var(--color-accent-dim)] bg-[var(--color-accent-subtle)] text-[var(--color-accent)] hover:bg-[var(--color-accent-dim)]'
            }`}
          >
            {paused ? <Play size={13} /> : <Pause size={13} />}
            {paused ? 'Resume learning' : 'Pause learning'}
          </button>
          <TwinMemoryBackfillButton />
        </div>
      </div>

      {paused && (
        <div
          role="status"
          className="shrink-0 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-300"
        >
          Learning is paused — no new facts are being learned or applied.
        </div>
      )}

      {error && (
        <p role="alert" className="shrink-0 text-sm text-red-400 break-words">
          {error}
        </p>
      )}

      {forgotten && (
        <div className="shrink-0">
          <TwinMemoryUndoSnackbar
            key={forgotten.id}
            factText={forgotten.text}
            onUndo={() => void handleUndo()}
            onExpire={closeSnackbar}
          />
        </div>
      )}

      <MemoryBody
        graph={graph}
        entering={entering}
        expandedLanes={expandedLanes}
        onToggleLane={toggleLane}
        pinned={pinned}
        active={active}
        onInspect={handleInspect}
        onForget={() => void handleForget()}
        onOpenSession={(meetingId) => navigate(`/session/${meetingId}`)}
        onClosePinned={() => setPinned(null)}
      />
    </div>
  );
}

/** Loading / empty / graph — split out so the host above stays about the triad. */
function MemoryBody({
  graph,
  entering,
  expandedLanes,
  onToggleLane,
  pinned,
  active,
  onInspect,
  onForget,
  onOpenSession,
  onClosePinned,
}: {
  graph: ReturnType<typeof useTwinMemoryGraphStore.getState>['graph'];
  entering: ReadonlySet<string>;
  expandedLanes: ReadonlySet<string>;
  onToggleLane: (category: string) => void;
  pinned: PinnedState | null;
  /** This tab is the one on screen. Passed straight through to the canvas: the
   *  component stays mounted while the Profile tab is showing, so this is the
   *  only thing that can stop the core shimmer (TWIN-READ.1 Task 4). */
  active: boolean;
  onInspect: (node: TwinGraphNode, viaKeyboard: boolean) => void;
  onForget: () => void;
  onOpenSession: (meetingId: string) => void;
  onClosePinned: () => void;
}) {
  if (!graph) {
    return (
      <div className="flex items-center justify-center py-16">
        <LoadingSpinner />
      </div>
    );
  }

  if (factCountOf(graph) === 0) return <MemoryEmptyState />;

  return (
    <TwinMemoryRiverCanvas
      graph={graph}
      entering={entering}
      expandedLanes={expandedLanes}
      onToggleLane={onToggleLane}
      onInspect={onInspect}
      active={active}
      pinnedId={pinned?.node.id ?? null}
      onUnpin={onClosePinned}
      pinnedPanel={
        pinned && (
          <TwinMemoryInspector
            key={pinned.node.id}
            node={pinned.node}
            scopeFactCount={scopeFactCountFor(graph.nodes, pinned.node)}
            autoFocus={pinned.viaKeyboard}
            onForget={onForget}
            onOpenSession={onOpenSession}
            onClose={onClosePinned}
          />
        )
      }
    />
  );
}

/** Facts inside an inspected node's scope: its own category for a hub, the whole
 *  ledger for the twin core, nothing meaningful for a fact. */
function scopeFactCountFor(nodes: readonly TwinGraphNode[], node: TwinGraphNode): number {
  if (node.type === 'fact') return 0;
  return nodes.reduce((total, candidate) => {
    if (candidate.type !== 'fact') return total;
    if (node.type === 'category' && candidate.category !== node.category) return total;
    return total + 1;
  }, 0);
}

/** Same explainer the list showed — the twin has genuinely learned nothing yet,
 *  and an empty canvas would say that far less kindly. */
function MemoryEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6 hud-panel clip-corner-cut-sm">
      <Brain size={28} className="text-[var(--color-accent-dim)] mb-3" />
      <h3 className="text-sm font-medium text-[var(--color-text-primary)] mb-1.5">No facts learned yet</h3>
      <p className="text-sm text-[var(--color-text-secondary)] max-w-sm">
        After your sessions, the twin quietly learns durable facts about the people, projects, and preferences you
        mention — like names, ongoing work, and how you like things done — so briefs, chat, and triage get more personal
        over time. Every fact stays visible here, sourced to the session it came from, and is one-tap forgettable.
      </p>
    </div>
  );
}
