// === FILE PURPOSE ===
// Zustand store for the twin's TIERED MEMORY GRAPH (TWIN-GRAPH.2 Task 3) — the
// data behind TwinPage's Memory tab, which now renders TwinMemoryGraph instead of
// TwinMemoryPanel's flat list.
//
// Modelled on stores/memoryGraphStore.ts (module-level in-flight de-dupe,
// cache-or-fetch `load` + always-refetch `refresh` that DIFFS the entering ids,
// optimistic `forgetNode` with rollback). TWO deliberate simplifications, because
// this graph's channel is different:
//   * NO per-scope buckets. `twin:build-memory-graph` takes no scope — it is
//     "always the full ledger" — so a scopeKey here would be a constant, and a
//     constant key is ceremony, not structure.
//   * NO canvas-badge plumbing. That badge belongs to the off-canvas session
//     Brain tab; this store's host is a page the user is already looking at.
//
// >>> REFRESH TRIGGER (the gap memoryGraphStore left open, answered here) <<<
// memoryGraphStore's refresh is ORPHANED — brainLiveSync drives brainStore only.
// This store does NOT inherit that gap. Its refresh is driven by its host,
// TwinMemoryGraph, on exactly three occasions:
//   1. mount -> load()                     (cache-or-fetch, first population)
//   2. the Memory tab becoming ACTIVE -> refresh()  (the `active` prop flipping
//      false->true; facts learned while the user was elsewhere appear on return)
//   3. a successful UNDO -> refresh()      (the restored fact must come back with
//      its real hub membership and degree, not a client-side guess)
// A forget needs no refresh: `forgetNode` removes the node optimistically and
// rolls back if the IPC commit fails. There is no polling and no interval — the
// zero-timers-at-idle rule covers the data layer too, not just the canvas.
//
// >>> PROGRESSIVE DISCLOSURE STATE (TWIN-READ.1 Task 2) <<<
// `expandedLanes` holds the category lanes the user has opened. It lives HERE,
// not in the canvas, for one reason: it must survive a refresh and a live update
// — both of which replace `graph` — and neither `setGraph` nor `refresh` ever
// touches it, so that survival is structural rather than a thing to remember.
// MULTIPLE LANES MAY BE OPEN AT ONCE (see TwinMemoryRiverCanvas's header —
// TwinMemoryGraphCanvas is retained-unreferenced since TWIN-READ.2 Task 2, so
// pointing there would send the next reader to dead code). A key for a
// category that no longer has a hub is kept rather than
// pruned: it is the user's stated interest in that lane, so if the category is
// ever repopulated it opens where they left it.
//
// === DEPENDENCIES ===
// zustand, window.electronAPI.twinBuildMemoryGraph (Task 1's
// twin:build-memory-graph channel), shared TwinMemoryGraph types

import { create } from 'zustand';
import type { TwinMemoryGraph } from '../../shared/types';

/** Shared empty set for "nothing entered" — a module const so the canvas's
 *  zustand selector returns a STABLE reference and never re-renders in a loop. */
export const NO_ENTERING_NODES: ReadonlySet<string> = new Set<string>();

/** Shared empty set for "every lane collapsed" — the graph's opening state, and
 *  a module const for the same stable-reference reason as NO_ENTERING_NODES. */
export const NO_EXPANDED_LANES: ReadonlySet<string> = new Set<string>();

interface TwinMemoryGraphStore {
  /** The loaded ledger graph, or null until the first fetch lands. */
  graph: TwinMemoryGraph | null;
  /** Node ids that ARRIVED in the last `refresh`. Replaced — never accumulated —
   *  on every write, and always empty for the first population (a fresh load is
   *  not growth). The canvas reads it to bloom those nodes in exactly once. */
  entering: ReadonlySet<string>;
  /** Category lanes the user has OPENED. Empty = the graph's default, collapsed
   *  state: twin core + hubs only. Deliberately untouched by every graph write,
   *  which is what makes disclosure survive a refresh and a live update. */
  expandedLanes: ReadonlySet<string>;

  /** Replace the graph, clearing any entering marks. The single write seam —
   *  tests drive the canvas through this, and it is also the forget rollback.
   *  Never touches `expandedLanes`. */
  setGraph: (graph: TwinMemoryGraph) => void;

  /** Open a collapsed lane, or collapse an open one. Any number may be open at
   *  once — lanes are spatially separate, so this is navigation, not an
   *  accordion. */
  toggleLane: (category: string) => void;

  /** Drop a node AND every edge touching it. UI-only — the DB is never touched
   *  here. No-op if the node is unknown. */
  removeNode: (nodeId: string) => void;
  /**
   * Optimistic forget: remove the node immediately, then run `commit` (the real
   * IPC call). If `commit` throws, the previous graph is RESTORED and `false` is
   * returned so the caller can say so — never a silent failure. Rollback is
   * skipped if a refresh replaced the graph meanwhile (that payload is already
   * the truth).
   */
  forgetNode: (nodeId: string, commit: () => Promise<void>) => Promise<boolean>;

  /** Cache-or-fetch: no-op once a graph is loaded. Never throws — a failed fetch
   *  leaves the graph null and the canvas's own placeholder covers it. */
  load: () => Promise<void>;
  /**
   * Always refetches, diffing the entering ids. Never throws — on failure
   * whatever was already loaded is kept rather than blanked out.
   *
   * `force` skips only the "nothing changed" bail below. It exists for the label
   * BACKFILL (TWIN-READ.1 Task 1), which rewrites fact LABELS while every node
   * id stays identical — a change the id diff genuinely cannot see, so without
   * this the user would be told labels improved and watch nothing change.
   */
  refresh: (force?: boolean) => Promise<void>;
}

/** In-flight fetch (module-level, not store state — purely an internal de-dupe
 *  guard) so a React effect re-fire never issues two overlapping IPC requests. */
let pendingLoad: Promise<void> | null = null;

/** Count of ACTIVE fact nodes — what the Memory tab badge shows. Hubs and the
 *  twin core are structure, not memories, so they never count. */
export function factCountOf(graph: TwinMemoryGraph | null): number {
  if (!graph) return 0;
  return graph.nodes.reduce((total, node) => (node.type === 'fact' ? total + 1 : total), 0);
}

export const useTwinMemoryGraphStore = create<TwinMemoryGraphStore>((set, get) => ({
  graph: null,
  entering: NO_ENTERING_NODES,
  expandedLanes: NO_EXPANDED_LANES,

  setGraph: (graph) => set({ graph, entering: NO_ENTERING_NODES }),

  toggleLane: (category) =>
    set((state) => {
      const next = new Set(state.expandedLanes);
      if (!next.delete(category)) next.add(category);
      return { expandedLanes: next.size === 0 ? NO_EXPANDED_LANES : next };
    }),

  removeNode: (nodeId) =>
    set((state) => {
      const current = state.graph;
      if (!current?.nodes.some((n) => n.id === nodeId)) return state; // unknown node
      return {
        graph: {
          ...current,
          nodes: current.nodes.filter((n) => n.id !== nodeId),
          edges: current.edges.filter((e) => e.fromId !== nodeId && e.toId !== nodeId),
        },
        entering: NO_ENTERING_NODES,
      };
    }),

  forgetNode: async (nodeId, commit) => {
    const previous = get().graph;
    get().removeNode(nodeId);
    const optimistic = get().graph;
    try {
      await commit();
      return true;
    } catch {
      if (previous && get().graph === optimistic) get().setGraph(previous);
      return false;
    }
  },

  load: () => {
    if (get().graph) return Promise.resolve(); // cache-or-fetch: already loaded
    if (pendingLoad) return pendingLoad;

    const promise = (async () => {
      try {
        get().setGraph(await window.electronAPI.twinBuildMemoryGraph());
      } catch {
        // Non-fatal — leave the graph unset; the canvas shows its own placeholder.
      } finally {
        pendingLoad = null;
      }
    })();
    pendingLoad = promise;
    return promise;
  },

  refresh: async (force = false) => {
    try {
      const graph = await window.electronAPI.twinBuildMemoryGraph();
      const prev = get().graph;
      const newIds = new Set(graph.nodes.map((n) => n.id));
      const prevIds = new Set(prev ? prev.nodes.map((n) => n.id) : []);
      // Skipped for the very first population: that's a fresh load, not growth,
      // so nothing blooms in.
      const entering: ReadonlySet<string> = prev
        ? new Set([...newIds].filter((id) => !prevIds.has(id)))
        : NO_ENTERING_NODES;

      // A refetch that changed nothing at all — nothing entered AND nothing left
      // — is a genuine no-op: no setState, no re-layout, no churn. `force` is
      // the one caller that knows better (see the interface doc).
      if (!force && prev && entering.size === 0 && newIds.size === prevIds.size) return;

      set({ graph, entering });
    } catch {
      // Non-fatal — keep whatever was already loaded rather than blanking it out.
    }
  },
}));
