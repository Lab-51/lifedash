// === FILE PURPOSE ===
// brainStore IPC loading (V3.2 Task 3): `load` (cache-or-fetch, de-duped,
// rejection-safe) and `refresh` (always refetches but preserves expansion/
// selection). Task 2's pure setTree/toggleExpansion/setSelection/scopeKeyFor
// behavior is already covered by BrainMindMap.test.tsx — this file is scoped to
// the new IPC-backed actions only.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { BrainNode, BrainTree } from '../../../shared/types';

vi.stubGlobal('electronAPI', {
  buildBrainTree: vi.fn(),
});
vi.stubGlobal('window', globalThis);

const { useBrainStore, scopeKeyFor, computeDefaultExpansion } = await import('../brainStore');
const { useActivityFeedStore } = await import('../activityFeedStore');
const { useCanvasBadgeStore } = await import('../canvasBadgeStore');

function n(id: string, entityId: string | null, children: BrainNode[] = []): BrainNode {
  return {
    id,
    type: children.length > 0 ? 'project' : 'card',
    label: id,
    entityId,
    childCount: children.length,
    children,
  };
}

function tree(children: BrainNode[]): BrainTree {
  return { root: n('workspace', null, children), crossLinks: [] };
}

const KEY = 'workspace';
const SCOPE = 'workspace' as const;

describe('brainStore — load/refresh (Task 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBrainStore.setState({ scopes: {} });
  });

  describe('load', () => {
    it('fetches via IPC and seeds default expansion when the scope is not cached', async () => {
      const fetched = tree([n('project:p1', 'p1', [n('column:c1', 'c1', [n('card:card1', 'card1')])])]);
      vi.mocked(window.electronAPI.buildBrainTree).mockResolvedValueOnce(fetched);

      await useBrainStore.getState().load(SCOPE);

      expect(window.electronAPI.buildBrainTree).toHaveBeenCalledWith(SCOPE);
      const scope = useBrainStore.getState().scopes[KEY];
      expect(scope.tree).toEqual(fetched);
      expect(scope.expanded).toEqual(computeDefaultExpansion(fetched.root));
    });

    it('is a no-op (does not refetch) once the scope already has a tree', async () => {
      const fetched = tree([n('project:p1', 'p1')]);
      vi.mocked(window.electronAPI.buildBrainTree).mockResolvedValue(fetched);

      await useBrainStore.getState().load(SCOPE);
      await useBrainStore.getState().load(SCOPE);

      expect(window.electronAPI.buildBrainTree).toHaveBeenCalledTimes(1);
    });

    it('de-dupes overlapping concurrent calls into a single IPC request', async () => {
      let resolveFetch: (t: BrainTree) => void = () => {};
      vi.mocked(window.electronAPI.buildBrainTree).mockImplementationOnce(
        () => new Promise((resolve) => (resolveFetch = resolve)),
      );

      const first = useBrainStore.getState().load(SCOPE);
      const second = useBrainStore.getState().load(SCOPE);

      resolveFetch(tree([n('project:p1', 'p1')]));
      await Promise.all([first, second]);

      expect(window.electronAPI.buildBrainTree).toHaveBeenCalledTimes(1);
    });

    it('swallows an IPC rejection — never throws, leaves the scope unset', async () => {
      vi.mocked(window.electronAPI.buildBrainTree).mockRejectedValueOnce(new Error('ipc failed'));

      await expect(useBrainStore.getState().load(SCOPE)).resolves.toBeUndefined();
      expect(useBrainStore.getState().scopes[KEY]).toBeUndefined();
    });

    it('keeps different scopes independent (session scope vs workspace scope)', async () => {
      const wsTree = tree([n('project:p1', 'p1')]);
      const sessionScope = { meetingId: 'm1' };
      const sessionTree: BrainTree = { root: n('session:m1', 'm1'), crossLinks: [] };
      vi.mocked(window.electronAPI.buildBrainTree).mockImplementation((scope) =>
        Promise.resolve(scope === 'workspace' ? wsTree : sessionTree),
      );

      await useBrainStore.getState().load(SCOPE);
      await useBrainStore.getState().load(sessionScope);

      expect(useBrainStore.getState().scopes[KEY].tree).toEqual(wsTree);
      expect(useBrainStore.getState().scopes[scopeKeyFor(sessionScope)].tree).toEqual(sessionTree);
    });
  });

  describe('refresh', () => {
    it('always refetches even when a tree is already cached', async () => {
      const first = tree([n('project:p1', 'p1')]);
      const second = tree([n('project:p1', 'p1'), n('project:p2', 'p2')]);
      vi.mocked(window.electronAPI.buildBrainTree).mockResolvedValueOnce(first).mockResolvedValueOnce(second);

      await useBrainStore.getState().load(SCOPE);
      await useBrainStore.getState().refresh(SCOPE);

      expect(window.electronAPI.buildBrainTree).toHaveBeenCalledTimes(2);
      expect(useBrainStore.getState().scopes[KEY].tree).toEqual(second);
    });

    it('preserves expansion for ids that still exist, and drops ids that vanished', async () => {
      const before = tree([n('project:p1', 'p1', [n('column:c1', 'c1', [n('card:card1', 'card1')])])]);
      // After refetch: column:c1 is gone (its card was moved/archived), a new project:p2 appears.
      const after = tree([n('project:p1', 'p1'), n('project:p2', 'p2')]);
      vi.mocked(window.electronAPI.buildBrainTree).mockResolvedValueOnce(before).mockResolvedValueOnce(after);

      await useBrainStore.getState().load(SCOPE);
      // Expand column:c1 in addition to the default-seeded set.
      useBrainStore.getState().toggleExpansion(KEY, 'column:c1');
      expect(useBrainStore.getState().scopes[KEY].expanded.has('column:c1')).toBe(true);

      await useBrainStore.getState().refresh(SCOPE);

      const expanded = useBrainStore.getState().scopes[KEY].expanded;
      expect(expanded.has('workspace')).toBe(true); // still present -> preserved
      expect(expanded.has('project:p1')).toBe(true); // still present -> preserved
      expect(expanded.has('column:c1')).toBe(false); // vanished -> dropped
      // A brand new node is never force-expanded by refresh alone (Task 4's
      // entering-node diff is what will decide to auto-expand it).
      expect(expanded.has('project:p2')).toBe(false);
    });

    it('preserves the current selection when the selected node still exists, clears it otherwise', async () => {
      const before = tree([n('project:p1', 'p1'), n('project:p2', 'p2')]);
      const after = tree([n('project:p1', 'p1')]); // project:p2 vanished
      vi.mocked(window.electronAPI.buildBrainTree).mockResolvedValueOnce(before).mockResolvedValueOnce(after);

      await useBrainStore.getState().load(SCOPE);
      useBrainStore.getState().setSelection(KEY, 'project:p2');

      await useBrainStore.getState().refresh(SCOPE);

      expect(useBrainStore.getState().scopes[KEY].selection).toBeNull();
    });

    it('seeds default expansion via computeDefaultExpansion on a first-ever refresh (no prior scope state)', async () => {
      const fetched = tree([n('project:p1', 'p1', [n('column:c1', 'c1', [n('card:card1', 'card1')])])]);
      vi.mocked(window.electronAPI.buildBrainTree).mockResolvedValueOnce(fetched);

      await useBrainStore.getState().refresh(SCOPE);

      expect(useBrainStore.getState().scopes[KEY].expanded).toEqual(computeDefaultExpansion(fetched.root));
    });

    it('swallows an IPC rejection — keeps whatever was already loaded, never throws', async () => {
      const loaded = tree([n('project:p1', 'p1')]);
      vi.mocked(window.electronAPI.buildBrainTree)
        .mockResolvedValueOnce(loaded)
        .mockRejectedValueOnce(new Error('ipc failed'));

      await useBrainStore.getState().load(SCOPE);
      await expect(useBrainStore.getState().refresh(SCOPE)).resolves.toBeUndefined();

      expect(useBrainStore.getState().scopes[KEY].tree).toEqual(loaded);
    });
  });
});

// ---------------------------------------------------------------------------
// Task 4 — live growth: entering-node diff, collapsed-ancestor badges, the
// off-canvas 'brain' badge, and idempotency (identical refetch = true no-op).
// ---------------------------------------------------------------------------
describe('brainStore — refresh live-growth diff (Task 4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBrainStore.setState({ scopes: {}, activeScopeKey: null });
    useActivityFeedStore.setState({ viewedTab: 'transcript' });
    useCanvasBadgeStore.setState({ counts: { transcript: 0, board: 0, brain: 0 } });
  });

  it('marks a newly-entering node "entering" when its whole ancestor path is expanded', async () => {
    // project:p1 already has a child in `before` so computeDefaultExpansion seeds
    // BOTH workspace (depth 0) and project:p1 (depth 1) as expanded.
    const before = tree([n('project:p1', 'p1', [n('column:c0', 'c0')])]);
    const after = tree([n('project:p1', 'p1', [n('column:c0', 'c0'), n('column:c1', 'c1')])]);
    vi.mocked(window.electronAPI.buildBrainTree).mockResolvedValueOnce(before).mockResolvedValueOnce(after);

    await useBrainStore.getState().load(SCOPE); // workspace + project:p1 both expanded by default
    await useBrainStore.getState().refresh(SCOPE);

    const scope = useBrainStore.getState().scopes[KEY];
    expect(scope.entering.has('column:c1')).toBe(true);
    expect(scope.newCounts['column:c1']).toBeUndefined();
  });

  it("bumps the nearest COLLAPSED ancestor's newCounts instead of marking entering", async () => {
    const before = tree([n('project:p1', 'p1', [n('column:c1', 'c1', [n('card:card1', 'card1')])])]);
    const after = tree([
      n('project:p1', 'p1', [n('column:c1', 'c1', [n('card:card1', 'card1'), n('card:card2', 'card2')])]),
    ]);
    vi.mocked(window.electronAPI.buildBrainTree).mockResolvedValueOnce(before).mockResolvedValueOnce(after);

    await useBrainStore.getState().load(SCOPE); // column:c1 is depth 2 — collapsed by default
    await useBrainStore.getState().refresh(SCOPE);

    const scope = useBrainStore.getState().scopes[KEY];
    expect(scope.entering.has('card:card2')).toBe(false);
    expect(scope.newCounts['column:c1']).toBe(1);
  });

  it('accumulates newCounts across refreshes while the ancestor stays collapsed', async () => {
    const v1 = tree([n('project:p1', 'p1', [n('column:c1', 'c1', [n('card:card1', 'card1')])])]);
    const v2 = tree([
      n('project:p1', 'p1', [n('column:c1', 'c1', [n('card:card1', 'card1'), n('card:card2', 'card2')])]),
    ]);
    const v3 = tree([
      n('project:p1', 'p1', [
        n('column:c1', 'c1', [n('card:card1', 'card1'), n('card:card2', 'card2'), n('card:card3', 'card3')]),
      ]),
    ]);
    vi.mocked(window.electronAPI.buildBrainTree)
      .mockResolvedValueOnce(v1)
      .mockResolvedValueOnce(v2)
      .mockResolvedValueOnce(v3);

    await useBrainStore.getState().load(SCOPE);
    await useBrainStore.getState().refresh(SCOPE);
    await useBrainStore.getState().refresh(SCOPE);

    expect(useBrainStore.getState().scopes[KEY].newCounts['column:c1']).toBe(2);

    // Expanding the ancestor clears its accumulated "N new" count.
    useBrainStore.getState().toggleExpansion(KEY, 'column:c1');
    expect(useBrainStore.getState().scopes[KEY].newCounts['column:c1']).toBeUndefined();
  });

  it("toggling a node's own expansion clears its entering mark", async () => {
    const before = tree([n('project:p1', 'p1', [n('column:c0', 'c0')])]);
    const after = tree([n('project:p1', 'p1', [n('column:c0', 'c0'), n('column:c1', 'c1')])]);
    vi.mocked(window.electronAPI.buildBrainTree).mockResolvedValueOnce(before).mockResolvedValueOnce(after);

    await useBrainStore.getState().load(SCOPE);
    await useBrainStore.getState().refresh(SCOPE);
    expect(useBrainStore.getState().scopes[KEY].entering.has('column:c1')).toBe(true);

    useBrainStore.getState().toggleExpansion(KEY, 'column:c1');
    expect(useBrainStore.getState().scopes[KEY].entering.has('column:c1')).toBe(false);
  });

  it('bumps the off-canvas brain badge when Brain is NOT the viewed tab', async () => {
    const before = tree([n('project:p1', 'p1')]);
    const after = tree([n('project:p1', 'p1', [n('column:c1', 'c1')])]);
    vi.mocked(window.electronAPI.buildBrainTree).mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    useActivityFeedStore.setState({ viewedTab: 'board' });

    await useBrainStore.getState().load(SCOPE);
    await useBrainStore.getState().refresh(SCOPE);

    expect(useCanvasBadgeStore.getState().counts.brain).toBe(1);
  });

  it('does NOT bump the brain badge when Brain IS the viewed tab', async () => {
    const before = tree([n('project:p1', 'p1')]);
    const after = tree([n('project:p1', 'p1', [n('column:c1', 'c1')])]);
    vi.mocked(window.electronAPI.buildBrainTree).mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    useActivityFeedStore.setState({ viewedTab: 'brain' });

    await useBrainStore.getState().load(SCOPE);
    await useBrainStore.getState().refresh(SCOPE);

    expect(useCanvasBadgeStore.getState().counts.brain).toBe(0);
  });

  it("does not bump the badge (or mark anything entering) on a scope's very first population via refresh", async () => {
    const fetched = tree([n('project:p1', 'p1', [n('column:c1', 'c1')])]);
    vi.mocked(window.electronAPI.buildBrainTree).mockResolvedValueOnce(fetched);
    useActivityFeedStore.setState({ viewedTab: 'board' });

    await useBrainStore.getState().refresh(SCOPE); // no prior load() — first-ever population

    expect(useBrainStore.getState().scopes[KEY].entering.size).toBe(0);
    expect(useCanvasBadgeStore.getState().counts.brain).toBe(0);
  });

  it('an identical refetch is a genuine no-op — no entering ids, no state churn, no badge', async () => {
    const same = tree([n('project:p1', 'p1', [n('column:c1', 'c1')])]);
    vi.mocked(window.electronAPI.buildBrainTree).mockResolvedValue(same);
    useActivityFeedStore.setState({ viewedTab: 'board' });

    await useBrainStore.getState().load(SCOPE);
    const before = useBrainStore.getState().scopes[KEY];

    await useBrainStore.getState().refresh(SCOPE); // same tree shape, same id set back again

    const after = useBrainStore.getState().scopes[KEY];
    expect(after).toBe(before); // referential equality — no setState occurred
    expect(useCanvasBadgeStore.getState().counts.brain).toBe(0);
  });
});
