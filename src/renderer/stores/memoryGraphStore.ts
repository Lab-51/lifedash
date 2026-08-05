// === FILE PURPOSE ===
// Zustand store for the twin's MEMORY GRAPH (TWIN-GRAPH.1 Task 3) — the flat,
// force-directed replacement for the tidy tree. It deliberately mirrors
// brainStore's proven shape (per-scope buckets keyed by a plain string, a
// module-level in-flight map that de-dupes overlapping IPC calls, cache-or-fetch
// `load` + always-refetch `refresh`, and an `activeScopeKey` the live-sync layer
// reads) so there is one store pattern in this feature area, not two.
//
// brainStore itself is UNTOUCHED and still serves the session/project Brain tab's
// tidy tree (BrainMindMap inside BrainTabPanel). This store has NO mounted host
// yet: the graph was briefly wired into that Brain tab, which was the wrong
// surface, and that wiring was reverted. It is retained for TwinPage's Memory tab.
// Consequently the live-sync layer (brainLiveSync) drives brainStore ONLY —
// whichever host adopts this store must arrange its own refresh trigger.
//
// TASK 4 (live growth) layered three things on top of Task 3's shape:
//   - `refresh` now DIFFS the old node-id set against the new one, storing the
//     ENTERING ids on the scope. BrainMemoryGraph reads that set to spawn each
//     newcomer at its strongest neighbour and reheat locally (then re-freeze).
//   - a genuinely unchanged refetch is a no-op (no setState, no badge, no churn),
//     and genuine growth bumps the off-canvas 'brain' badge — gated on the SAME
//     "is Brain currently viewed" signal brainStore uses (activityFeedStore).
//   - `removeNode` / `forgetNode`: the OPTIMISTIC forget path. `forgetNode` drops
//     the node + its edges, runs the caller's real IPC commit, and RESTORES the
//     previous graph if that commit throws — a forget that silently failed would
//     look like data loss. The DB delete only ever happens via the real channel.
//
// Interaction state (hover, drag, pin) lives in the COMPONENT, not here: unlike
// the tree's expansion/selection it is per-view ephemera that nothing else reads,
// and keeping it out of the store keeps per-frame work off the store subscription.
//
// === DEPENDENCIES ===
// zustand, BrainGraph/BrainGraphScope (shared brain types),
// window.electronAPI.buildBrainGraph (Task 1's brain:build-graph channel),
// activityFeedStore (viewedTab) + canvasBadgeStore (off-canvas 'brain' badge)

import { create } from 'zustand';
import { useActivityFeedStore } from './activityFeedStore';
import { useCanvasBadgeStore } from './canvasBadgeStore';
import type { BrainGraph, BrainGraphScope } from '../../shared/types';

/** Stable per-scope bucket key. `'everything'` or `'session:<meetingId>'`.
 *  Mirrors brainStore.scopeKeyFor; separate function because the scope UNION is
 *  different ('everything' vs 'workspace') and the two must not be interchanged. */
export function graphScopeKeyFor(scope: BrainGraphScope): string {
  return scope === 'everything' ? 'everything' : `session:${scope.meetingId}`;
}

/** Shared empty set for scopes with nothing entering — a module const so the
 *  component's zustand selector returns a STABLE reference and never re-renders
 *  itself in a loop. */
export const NO_ENTERING_NODES: ReadonlySet<string> = new Set<string>();

export interface MemoryGraphScopeState {
  /** Loaded graph for this scope, or null until a fetch lands. */
  graph: BrainGraph | null;
  /** Node ids that ARRIVED in the last `refresh` (Task 4 live growth). Replaced
   *  — never accumulated — on every write, and always empty for a scope's first
   *  population (a fresh load is not growth). BrainMemoryGraph reads it to seed
   *  and reheat those nodes exactly once. */
  entering: ReadonlySet<string>;
}

interface MemoryGraphStore {
  /** Per-scope state, keyed by `graphScopeKeyFor(scope)`. */
  scopes: Record<string, MemoryGraphScopeState>;
  /** The scopeKey the graph's host currently has mounted, or null if the graph
   *  hasn't been opened yet this session. Deliberately NOT cleared on unmount
   *  (same rationale as brainStore's): a background refresh keeps working while
   *  the user is looking at something else. */
  activeScopeKey: string | null;

  /** Replace the graph for a scope, clearing any entering marks. The single write
   *  seam — tests drive the component through this, and it is also the rollback
   *  path for a failed forget. */
  setGraph: (scopeKey: string, graph: BrainGraph) => void;
  /** Record which scope the graph's host currently has mounted. */
  setActiveScope: (scopeKey: string | null) => void;

  /** Drop a node AND every edge touching it from a scope's graph. UI-only — the
   *  DB is never touched here. No-op if the scope or node is unknown. */
  removeNode: (scopeKey: string, nodeId: string) => void;
  /**
   * Optimistic forget: remove the node immediately, then run `commit` (the real
   * IPC call). If `commit` throws, the previous graph is RESTORED and `false` is
   * returned so the caller can say so — never a silent failure. Rollback is
   * skipped if a live refresh replaced the graph meanwhile (that payload is
   * already the truth).
   */
  forgetNode: (scopeKey: string, nodeId: string, commit: () => Promise<void>) => Promise<boolean>;

  /** Cache-or-fetch: no-op if this scope already has a graph; otherwise fetches
   *  over IPC. Never throws — a failed fetch leaves the scope unset and
   *  BrainMemoryGraph's own placeholder covers it, never a blank/crashed tab. */
  load: (scope: BrainGraphScope) => Promise<void>;
  /** Always refetches this scope, replacing the stored graph. Never throws — on
   *  failure whatever was already loaded is kept rather than blanked out. */
  refresh: (scope: BrainGraphScope) => Promise<void>;
}

/** In-flight fetches per scopeKey (module-level, not store state — purely an
 *  internal de-dupe guard) so a rapid double-call (e.g. a React effect re-fire)
 *  never issues two overlapping IPC requests. */
const pendingLoads = new Map<string, Promise<void>>();

/** Bump the off-canvas 'brain' badge for genuine incremental growth — gated on
 *  the SAME "is Brain currently viewed" signal brainStore's tree growth uses, so
 *  the two surfaces can never disagree about when a badge is warranted. */
function maybeNotifyGraphGrowth(enteringCount: number): void {
  if (enteringCount === 0) return;
  if (useActivityFeedStore.getState().viewedTab === 'brain') return;
  useCanvasBadgeStore.getState().increment('brain');
}

/** A refetch that changed nothing at all — nothing entered AND nothing left — is
 *  a genuine no-op. Mirrors brainStore.isGenuineNoOp. */
function isGenuineNoOp(hadPrior: boolean, enteringCount: number, newSize: number, prevSize: number): boolean {
  return hadPrior && enteringCount === 0 && newSize === prevSize;
}

export const useMemoryGraphStore = create<MemoryGraphStore>((set, get) => ({
  scopes: {},
  activeScopeKey: null,

  setGraph: (scopeKey, graph) =>
    set((state) => ({ scopes: { ...state.scopes, [scopeKey]: { graph, entering: NO_ENTERING_NODES } } })),

  setActiveScope: (scopeKey) =>
    set((state) => (state.activeScopeKey === scopeKey ? state : { activeScopeKey: scopeKey })),

  load: (scope) => {
    const scopeKey = graphScopeKeyFor(scope);
    if (get().scopes[scopeKey]?.graph) return Promise.resolve(); // cache-or-fetch: already loaded

    const pending = pendingLoads.get(scopeKey);
    if (pending) return pending;

    const promise = (async () => {
      try {
        const graph = await window.electronAPI.buildBrainGraph(scope);
        get().setGraph(scopeKey, graph);
      } catch {
        // Non-fatal — leave the scope unset; the canvas shows its own placeholder.
      } finally {
        pendingLoads.delete(scopeKey);
      }
    })();
    pendingLoads.set(scopeKey, promise);
    return promise;
  },

  refresh: async (scope) => {
    const scopeKey = graphScopeKeyFor(scope);
    try {
      const graph = await window.electronAPI.buildBrainGraph(scope);
      const prev = get().scopes[scopeKey];
      const hadPrior = prev?.graph != null;
      const newIds = new Set(graph.nodes.map((n) => n.id));
      const prevIds = hadPrior ? new Set(prev.graph!.nodes.map((n) => n.id)) : new Set<string>();
      // Skipped for a scope's very first population: that's a fresh load, not
      // growth, so nothing blooms in and nothing badges.
      const entering: ReadonlySet<string> = hadPrior
        ? new Set([...newIds].filter((id) => !prevIds.has(id)))
        : NO_ENTERING_NODES;

      if (isGenuineNoOp(hadPrior, entering.size, newIds.size, prevIds.size)) return;

      set((state) => ({ scopes: { ...state.scopes, [scopeKey]: { graph, entering } } }));
      maybeNotifyGraphGrowth(entering.size);
    } catch {
      // Non-fatal — keep whatever was already loaded rather than blanking it out.
    }
  },

  removeNode: (scopeKey, nodeId) =>
    set((state) => {
      const current = state.scopes[scopeKey]?.graph;
      if (!current?.nodes.some((n) => n.id === nodeId)) return state; // unknown scope/node
      const graph: BrainGraph = {
        ...current,
        nodes: current.nodes.filter((n) => n.id !== nodeId),
        edges: current.edges.filter((e) => e.fromId !== nodeId && e.toId !== nodeId),
      };
      return { scopes: { ...state.scopes, [scopeKey]: { graph, entering: NO_ENTERING_NODES } } };
    }),

  forgetNode: async (scopeKey, nodeId, commit) => {
    const previous = get().scopes[scopeKey]?.graph ?? null;
    get().removeNode(scopeKey, nodeId);
    const optimistic = get().scopes[scopeKey]?.graph ?? null;
    try {
      await commit();
      return true;
    } catch {
      if (previous && get().scopes[scopeKey]?.graph === optimistic) get().setGraph(scopeKey, previous);
      return false;
    }
  },
}));
