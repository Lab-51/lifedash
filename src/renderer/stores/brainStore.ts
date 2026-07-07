// === FILE PURPOSE ===
// Zustand store for the "living brain" mind map (V3.2 Task 2). Holds, PER SCOPE
// (workspace or a single session), the loaded BrainTree plus the two pieces of
// interaction state the renderer drives off:
//   - `expanded`  — the set of node ids whose children are currently shown. On a
//                   fresh tree this is seeded to "default expansion depth 1"
//                   (root + its direct children), so grandchildren are visible
//                   but collapsed. Keyed by node id (a card that appears twice in
//                   session scope shares one expansion flag — intentional).
//   - `selection` — the currently hovered/selected node id (nullable). Drives the
//                   on-demand dashed crossLink overlays; never a permanent edge.
//
// SCOPE SEAM: state is bucketed by a plain scopeKey string (`scopeKeyFor`). Task 2
// only held/set state (tests fed a tree via `setTree`). Task 3 layered IPC
// `load`/`refresh` + per-scope caching on top:
//   - `load`   — cache-or-fetch. No-op (instant) if that scope already has a tree;
//                otherwise fetches via IPC and seeds default expansion via `setTree`.
//   - `refresh` — always refetches, but PRESERVES the caller's current expansion/
//                selection for that scope (raw `setTree` would reset both) by
//                intersecting the old expanded-id set with the new tree's ids.
//
// TASK 4 (live growth, refetch-and-diff): `refresh` additionally diffs the old
// tree's node-id set against the new one to find ENTERING ids, then classifies
// each by its ancestor path — a fully-expanded path marks it `entering` (one-shot
// CSS bloom, see BrainMindMap), a collapsed ancestor instead gets its `newCounts`
// chevron badge bumped. Entering ids are NEVER auto-expanded (a brand-new branch
// still starts collapsed, matching default-expansion behaviour). `activeScopeKey`
// (set by BrainTabPanel, NOT cleared on its unmount so background growth still
// badges the Brain tab while another tab is being viewed) gates the two live
// triggers — see useBrainLiveSync / services/brainLiveSync — so nothing refetches
// before the Brain tab has loaded at least once this session.
//
// === DEPENDENCIES ===
// zustand, BrainScope/BrainTree/BrainNode (shared brain types), window.electronAPI.buildBrainTree,
// activityFeedStore (viewedTab — the SAME "is Brain currently viewed" signal V3.1's
// ActivityFeed uses), canvasBadgeStore (off-canvas 'brain' badge)

import { create } from 'zustand';
import { useActivityFeedStore } from './activityFeedStore';
import { useCanvasBadgeStore } from './canvasBadgeStore';
import type { BrainNode, BrainScope, BrainTree } from '../../shared/types';

/** Default expansion depth: root (0) + direct children (1) are expanded, so
 *  grandchildren render but start collapsed. */
export const DEFAULT_EXPANSION_DEPTH = 1;

/** Stable per-scope bucket key. `'workspace'` or `'session:<meetingId>'`. */
export function scopeKeyFor(scope: BrainScope): string {
  return scope === 'workspace' ? 'workspace' : `session:${scope.meetingId}`;
}

/**
 * Compute the default expansion set for a freshly-set tree: every node at depth
 * <= maxDepth that actually has children is expanded. With the default depth of
 * 1 that means root + its direct children — revealing grandchildren collapsed.
 * Pure + exported so Task 4's diff can reuse it and tests can assert it directly.
 */
export function computeDefaultExpansion(root: BrainNode, maxDepth = DEFAULT_EXPANSION_DEPTH): Set<string> {
  const expanded = new Set<string>();
  const walk = (node: BrainNode, depth: number): void => {
    if (depth <= maxDepth && node.children.length > 0) expanded.add(node.id);
    if (depth < maxDepth) {
      for (const child of node.children) walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return expanded;
}

/** Every node id present in a tree (root + all descendants), depth-first. Used
 *  by `refresh` to drop expanded/selected ids that no longer exist after a
 *  refetch, and (Task 4) to detect newly-entering ids. */
function collectNodeIds(root: BrainNode): Set<string> {
  const ids = new Set<string>();
  const stack: BrainNode[] = [root];
  while (stack.length > 0) {
    const current = stack.pop() as BrainNode;
    ids.add(current.id);
    for (const child of current.children) stack.push(child);
  }
  return ids;
}

/** For every node id, its ancestor id chain from root to (not including) itself
 *  — root first, immediate parent last. A node appearing at multiple positions
 *  (shares one expansion flag, per Task 3) keeps only its FIRST-encountered path;
 *  good enough for deciding entrance treatment (personal-scale, keep it simple). */
function collectAncestorPaths(root: BrainNode): Map<string, string[]> {
  const paths = new Map<string, string[]>();
  const stack: { node: BrainNode; ancestors: string[] }[] = [{ node: root, ancestors: [] }];
  while (stack.length > 0) {
    const { node, ancestors } = stack.pop() as { node: BrainNode; ancestors: string[] };
    if (!paths.has(node.id)) paths.set(node.id, ancestors);
    const childAncestors = [...ancestors, node.id];
    for (const child of node.children) stack.push({ node: child, ancestors: childAncestors });
  }
  return paths;
}

/** Classify this refresh's entering ids by ancestor path (Task 4 diff): a fully-
 *  expanded path -> one-shot entrance bloom; a collapsed ancestor -> bump that
 *  ancestor's "N new" chevron badge instead. `priorCounts` (still-valid ids only)
 *  carries forward accumulation while an ancestor stays collapsed across refreshes. */
function classifyEnteringNodes(
  root: BrainNode,
  enteringIds: Set<string>,
  expanded: Set<string>,
  priorCounts: Record<string, number>,
  newIds: Set<string>,
): { entering: Set<string>; newCounts: Record<string, number> } {
  const ancestorPaths = collectAncestorPaths(root);
  const newCounts: Record<string, number> = {};
  for (const [id, count] of Object.entries(priorCounts)) {
    if (newIds.has(id)) newCounts[id] = count;
  }

  const entering = new Set<string>();
  for (const id of enteringIds) {
    const ancestors = ancestorPaths.get(id) ?? [];
    const collapsedAncestor = [...ancestors].reverse().find((ancestorId) => !expanded.has(ancestorId));
    if (collapsedAncestor) {
      newCounts[collapsedAncestor] = (newCounts[collapsedAncestor] ?? 0) + 1;
    } else {
      entering.add(id);
    }
  }
  return { entering, newCounts };
}

/** A refetch that changed nothing at all — same id-set, nothing entered — is a
 *  genuine no-op (Task 4 idempotency: no setState, no badge, no churn). */
function isGenuineNoOp(hadPrior: boolean, enteringCount: number, newSize: number, prevSize: number): boolean {
  return hadPrior && enteringCount === 0 && newSize === prevSize;
}

/** Bump the off-canvas 'brain' badge for genuine incremental growth (never for a
 *  scope's very first population) — gated on the SAME "is Brain currently
 *  viewed" signal V3.1's ActivityFeed uses (activityFeedStore.viewedTab). */
function maybeNotifyBrainGrowth(hadPrior: boolean, enteringCount: number): void {
  if (!hadPrior || enteringCount === 0) return;
  if (useActivityFeedStore.getState().viewedTab === 'brain') return;
  useCanvasBadgeStore.getState().increment('brain');
}

export interface BrainScopeState {
  /** Loaded tree for this scope, or null until `setTree` runs (Task 3 IPC load). */
  tree: BrainTree | null;
  /** Node ids whose children are currently shown. */
  expanded: Set<string>;
  /** Hovered/selected node id — drives dashed crossLink overlays. */
  selection: string | null;
  /** Node ids in a one-shot CSS entrance animation as of the LAST refresh (Task 4
   *  live growth). Replaced (not accumulated) every refresh — old entries simply
   *  aren't re-marked once they're no longer "new". Also cleared for one id the
   *  moment that node's own expansion is toggled (BrainMindMap's entrance CSS
   *  never needs a timer to turn itself off). */
  entering: Set<string>;
  /** Per-node "N new since collapsed" chevron badge count (Task 4), keyed by the
   *  collapsed ancestor id under which entering descendants appeared. Accumulates
   *  across refreshes while that ancestor stays collapsed; cleared when it's expanded. */
  newCounts: Record<string, number>;
}

interface BrainStore {
  /** Per-scope state, keyed by `scopeKeyFor(scope)`. */
  scopes: Record<string, BrainScopeState>;
  /** The scopeKey BrainTabPanel currently has mounted, or null if the Brain tab
   *  hasn't been opened yet this session. Set by BrainTabPanel's own mount/scope
   *  effect — deliberately NOT cleared on its unmount, so useBrainLiveSync keeps
   *  refreshing (and off-canvas-badging) that scope while the user is on another
   *  canvas tab. Doubles as the "no refetch before the first Brain load" gate. */
  activeScopeKey: string | null;

  /** Replace the tree for a scope and seed default depth-1 expansion + clear
   *  selection. The single seam Task 3 (post-IPC) and Task 4 (diff) build on. */
  setTree: (scopeKey: string, tree: BrainTree) => void;
  /** Toggle a node's expansion within a scope (no-op if the scope is unset). */
  toggleExpansion: (scopeKey: string, nodeId: string) => void;
  /** Set (or clear) the hovered/selected node for a scope. */
  setSelection: (scopeKey: string, nodeId: string | null) => void;
  /** Record which scope BrainTabPanel currently has mounted (Task 4 live sync). */
  setActiveScope: (scopeKey: string | null) => void;

  /** Whether the in-canvas Brain inspector drawer is currently open. Global UI
   *  flag read by LiveModeOverlay so its Esc-to-minimize yields while the inspector
   *  is open — otherwise a single Esc would both close the drawer AND minimize the
   *  whole live overlay (two independent document keydown listeners). */
  inspectorOpen: boolean;
  setInspectorOpen: (open: boolean) => void;

  /** Cache-or-fetch: no-op if this scope already has a tree; otherwise fetches
   *  via IPC and seeds default expansion (via `setTree`). Never throws — a
   *  failed fetch is swallowed so the tab never goes blank (BrainMindMap's own
   *  "No graph to show yet." placeholder covers the still-unloaded state). */
  load: (scope: BrainScope) => Promise<void>;
  /** Always refetches this scope, but PRESERVES the caller's current expansion
   *  (and selection, if the selected node still exists) instead of resetting it
   *  the way raw `setTree` would. Also never throws. Diffs entering ids (Task 4)
   *  and bumps the off-canvas 'brain' badge for genuine growth. */
  refresh: (scope: BrainScope) => Promise<void>;
}

/** In-flight fetches per scopeKey (module-level, not store state — purely an
 *  internal de-dupe guard, not something the UI reads) so a rapid double-call
 *  (e.g. React effect re-fire) never issues two overlapping IPC requests. */
const pendingLoads = new Map<string, Promise<void>>();

export const useBrainStore = create<BrainStore>((set, get) => ({
  scopes: {},
  activeScopeKey: null,
  inspectorOpen: false,
  setInspectorOpen: (open) => set({ inspectorOpen: open }),

  setTree: (scopeKey, tree) =>
    set((state) => ({
      scopes: {
        ...state.scopes,
        [scopeKey]: {
          tree,
          expanded: computeDefaultExpansion(tree.root),
          selection: null,
          entering: new Set<string>(),
          newCounts: {},
        },
      },
    })),

  toggleExpansion: (scopeKey, nodeId) =>
    set((state) => {
      const scope = state.scopes[scopeKey];
      if (!scope) return state;
      const wasExpanded = scope.expanded.has(nodeId);
      const expanded = new Set(scope.expanded);
      if (wasExpanded) expanded.delete(nodeId);
      else expanded.add(nodeId);

      // Task 4: touching a node's own expansion is "the next user interaction"
      // that clears its one-shot entrance mark, and expanding it clears its
      // "N new" chevron badge (collapsing it does not — nothing to clear).
      const entering = scope.entering.has(nodeId) ? new Set(scope.entering) : scope.entering;
      if (entering !== scope.entering) entering.delete(nodeId);
      let newCounts = scope.newCounts;
      if (!wasExpanded && newCounts[nodeId]) {
        newCounts = { ...newCounts };
        delete newCounts[nodeId];
      }

      return { scopes: { ...state.scopes, [scopeKey]: { ...scope, expanded, entering, newCounts } } };
    }),

  setSelection: (scopeKey, nodeId) =>
    set((state) => {
      const scope = state.scopes[scopeKey];
      if (!scope || scope.selection === nodeId) return state;
      return { scopes: { ...state.scopes, [scopeKey]: { ...scope, selection: nodeId } } };
    }),

  setActiveScope: (scopeKey) =>
    set((state) => (state.activeScopeKey === scopeKey ? state : { activeScopeKey: scopeKey })),

  load: (scope) => {
    const scopeKey = scopeKeyFor(scope);
    if (get().scopes[scopeKey]?.tree) return Promise.resolve(); // cache-or-fetch: already loaded

    const pending = pendingLoads.get(scopeKey);
    if (pending) return pending;

    const promise = (async () => {
      try {
        const tree = await window.electronAPI.buildBrainTree(scope);
        get().setTree(scopeKey, tree);
      } catch {
        // Non-fatal — leave the scope unset; BrainMindMap's own "No graph to
        // show yet." placeholder covers it, never a blank/crashed tab.
      } finally {
        pendingLoads.delete(scopeKey);
      }
    })();
    pendingLoads.set(scopeKey, promise);
    return promise;
  },

  refresh: async (scope) => {
    const scopeKey = scopeKeyFor(scope);
    try {
      const tree = await window.electronAPI.buildBrainTree(scope);
      const prev = get().scopes[scopeKey];
      const hadPrior = prev?.tree != null;
      const newIds = collectNodeIds(tree.root);
      const prevIds = hadPrior ? collectNodeIds(prev.tree!.root) : new Set<string>();
      const enteringIds = new Set([...newIds].filter((id) => !prevIds.has(id)));

      // Genuine no-op (Task 4 idempotency): the id set is unchanged — nothing
      // entered AND nothing left — so skip the write entirely. No churn, no badge.
      if (isGenuineNoOp(hadPrior, enteringIds.size, newIds.size, prevIds.size)) return;

      const preservedExpanded = hadPrior
        ? new Set([...prev.expanded].filter((id) => newIds.has(id)))
        : computeDefaultExpansion(tree.root);
      const preservedSelection = hadPrior && prev.selection && newIds.has(prev.selection) ? prev.selection : null;

      // Task 4 diff: classify this refresh's entering ids by ancestor path. Skipped
      // for a scope's very first population (no prior tree) — that's a fresh load,
      // not "growth", so nothing should bloom in or bump a badge.
      const { entering, newCounts } = hadPrior
        ? classifyEnteringNodes(tree.root, enteringIds, preservedExpanded, prev.newCounts, newIds)
        : { entering: new Set<string>(), newCounts: {} };

      set((state) => ({
        scopes: {
          ...state.scopes,
          [scopeKey]: { tree, expanded: preservedExpanded, selection: preservedSelection, entering, newCounts },
        },
      }));

      maybeNotifyBrainGrowth(hadPrior, enteringIds.size);
    } catch {
      // Non-fatal — keep whatever was already loaded rather than blanking it out.
    }
  },
}));
