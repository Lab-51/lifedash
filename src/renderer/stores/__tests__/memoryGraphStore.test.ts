// === FILE PURPOSE ===
// memoryGraphStore (TWIN-GRAPH.1 Task 3): scope keying, cache-or-fetch `load`
// (de-duped and rejection-safe) and always-refetch `refresh`. Node env — the
// store is DOM-free; `window` is stubbed to globalThis the same way
// brainStore.test.ts does it.
//
// Task 4 adds the live-growth half: the refresh DIFF (entering ids + the
// off-canvas 'brain' badge, gated on activityFeedStore.viewedTab exactly like
// brainStore's tree growth) and the OPTIMISTIC forget path with rollback.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { BrainGraph, BrainGraphEdge, BrainGraphNode } from '../../../shared/types';

vi.stubGlobal('electronAPI', {
  buildBrainGraph: vi.fn(),
});
vi.stubGlobal('window', globalThis);

const { useMemoryGraphStore, graphScopeKeyFor } = await import('../memoryGraphStore');
const { useActivityFeedStore } = await import('../activityFeedStore');
const { useCanvasBadgeStore } = await import('../canvasBadgeStore');

function node(id: string): BrainGraphNode {
  return { id, type: 'person', label: id, recordId: id, degree: 1, newestTimestamp: null };
}

function graph(ids: string[], droppedCount = 0, edges: BrainGraphEdge[] = []): BrainGraph {
  return { nodes: ids.map(node), edges, droppedCount };
}

const buildBrainGraph = vi.mocked(window.electronAPI.buildBrainGraph);

beforeEach(() => {
  vi.clearAllMocks();
  useMemoryGraphStore.setState({ scopes: {}, activeScopeKey: null });
  useActivityFeedStore.setState({ viewedTab: 'transcript' });
  useCanvasBadgeStore.getState().reset();
});

describe('graphScopeKeyFor', () => {
  it('keys the whole-workspace graph and a session graph distinctly', () => {
    expect(graphScopeKeyFor('everything')).toBe('everything');
    expect(graphScopeKeyFor({ meetingId: 'm1' })).toBe('session:m1');
  });
});

describe('memoryGraphStore — load', () => {
  it('fetches over IPC and stores the graph under its scope key', async () => {
    buildBrainGraph.mockResolvedValue(graph(['entity:e1']));

    await useMemoryGraphStore.getState().load({ meetingId: 'm1' });

    expect(buildBrainGraph).toHaveBeenCalledWith({ meetingId: 'm1' });
    expect(useMemoryGraphStore.getState().scopes['session:m1'].graph?.nodes).toHaveLength(1);
  });

  it('is cache-or-fetch: a second load of the same scope never refetches', async () => {
    buildBrainGraph.mockResolvedValue(graph(['entity:e1']));

    await useMemoryGraphStore.getState().load('everything');
    await useMemoryGraphStore.getState().load('everything');

    expect(buildBrainGraph).toHaveBeenCalledTimes(1);
  });

  it('de-dupes overlapping in-flight loads into ONE IPC call', async () => {
    buildBrainGraph.mockResolvedValue(graph(['entity:e1']));

    await Promise.all([
      useMemoryGraphStore.getState().load('everything'),
      useMemoryGraphStore.getState().load('everything'),
    ]);

    expect(buildBrainGraph).toHaveBeenCalledTimes(1);
  });

  it('keeps separate buckets per scope', async () => {
    buildBrainGraph.mockImplementation((scope) =>
      Promise.resolve(scope === 'everything' ? graph(['a', 'b']) : graph(['a'])),
    );

    await useMemoryGraphStore.getState().load('everything');
    await useMemoryGraphStore.getState().load({ meetingId: 'm1' });

    const { scopes } = useMemoryGraphStore.getState();
    expect(scopes.everything.graph?.nodes).toHaveLength(2);
    expect(scopes['session:m1'].graph?.nodes).toHaveLength(1);
  });

  it('never throws when the IPC call rejects — the scope simply stays unloaded', async () => {
    buildBrainGraph.mockRejectedValue(new Error('ipc down'));

    await expect(useMemoryGraphStore.getState().load('everything')).resolves.toBeUndefined();
    expect(useMemoryGraphStore.getState().scopes.everything).toBeUndefined();
  });

  it('retries after a failed load (the failure did not leave a stuck in-flight entry)', async () => {
    buildBrainGraph.mockRejectedValueOnce(new Error('ipc down')).mockResolvedValueOnce(graph(['entity:e1']));

    await useMemoryGraphStore.getState().load('everything');
    await useMemoryGraphStore.getState().load('everything');

    expect(buildBrainGraph).toHaveBeenCalledTimes(2);
    expect(useMemoryGraphStore.getState().scopes.everything.graph?.nodes).toHaveLength(1);
  });
});

describe('memoryGraphStore — refresh', () => {
  it('always refetches and replaces the stored graph, cap count included', async () => {
    buildBrainGraph.mockResolvedValueOnce(graph(['a'])).mockResolvedValueOnce(graph(['a', 'b'], 4));

    await useMemoryGraphStore.getState().load('everything');
    await useMemoryGraphStore.getState().refresh('everything');

    expect(buildBrainGraph).toHaveBeenCalledTimes(2);
    const stored = useMemoryGraphStore.getState().scopes.everything.graph;
    expect(stored?.nodes).toHaveLength(2);
    expect(stored?.droppedCount).toBe(4);
  });

  it('keeps the previously loaded graph when a refresh rejects (never blanks the tab)', async () => {
    buildBrainGraph.mockResolvedValueOnce(graph(['a'])).mockRejectedValueOnce(new Error('ipc down'));

    await useMemoryGraphStore.getState().load('everything');
    await useMemoryGraphStore.getState().refresh('everything');

    expect(useMemoryGraphStore.getState().scopes.everything.graph?.nodes).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Task 4 — live growth: the entering diff, the off-canvas badge, idempotency.
// ---------------------------------------------------------------------------
describe('memoryGraphStore — refresh diff (live growth)', () => {
  it('reports the ENTERING node ids a refresh added', async () => {
    buildBrainGraph.mockResolvedValueOnce(graph(['a'])).mockResolvedValueOnce(graph(['a', 'b', 'c']));

    await useMemoryGraphStore.getState().load('everything');
    await useMemoryGraphStore.getState().refresh('everything');

    expect([...useMemoryGraphStore.getState().scopes.everything.entering]).toEqual(['b', 'c']);
  });

  it("marks nothing entering on a scope's very first population (a fresh load is not growth)", async () => {
    buildBrainGraph.mockResolvedValue(graph(['a', 'b']));

    await useMemoryGraphStore.getState().refresh('everything');

    expect(useMemoryGraphStore.getState().scopes.everything.entering.size).toBe(0);
    expect(useCanvasBadgeStore.getState().counts.brain).toBe(0);
  });

  it('bumps the off-canvas brain badge when the Brain tab is NOT the one being viewed', async () => {
    buildBrainGraph.mockResolvedValueOnce(graph(['a'])).mockResolvedValueOnce(graph(['a', 'b']));
    useActivityFeedStore.setState({ viewedTab: 'transcript' });

    await useMemoryGraphStore.getState().load('everything');
    await useMemoryGraphStore.getState().refresh('everything');

    expect(useCanvasBadgeStore.getState().counts.brain).toBe(1);
  });

  it('does NOT bump the badge while Brain IS the viewed tab (the user can already see it)', async () => {
    buildBrainGraph.mockResolvedValueOnce(graph(['a'])).mockResolvedValueOnce(graph(['a', 'b']));
    useActivityFeedStore.setState({ viewedTab: 'brain' });

    await useMemoryGraphStore.getState().load('everything');
    await useMemoryGraphStore.getState().refresh('everything');

    expect(useCanvasBadgeStore.getState().counts.brain).toBe(0);
  });

  it('an identical refetch is a genuine no-op — no state churn, no badge', async () => {
    buildBrainGraph.mockResolvedValue(graph(['a', 'b']));

    await useMemoryGraphStore.getState().load('everything');
    const before = useMemoryGraphStore.getState().scopes.everything;
    await useMemoryGraphStore.getState().refresh('everything');

    expect(useMemoryGraphStore.getState().scopes.everything).toBe(before); // same object
    expect(useCanvasBadgeStore.getState().counts.brain).toBe(0);
  });

  it('clears entering marks on the next plain write, so a bloom only ever runs once', async () => {
    buildBrainGraph.mockResolvedValueOnce(graph(['a'])).mockResolvedValueOnce(graph(['a', 'b']));
    await useMemoryGraphStore.getState().load('everything');
    await useMemoryGraphStore.getState().refresh('everything');
    expect(useMemoryGraphStore.getState().scopes.everything.entering.size).toBe(1);

    useMemoryGraphStore.getState().setGraph('everything', graph(['a', 'b']));

    expect(useMemoryGraphStore.getState().scopes.everything.entering.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Task 4 — the optimistic forget. A forget that silently failed would look like
// data loss, so the rollback path is load-bearing, not polish.
// ---------------------------------------------------------------------------
describe('memoryGraphStore — removeNode / forgetNode', () => {
  const EDGES: BrainGraphEdge[] = [
    { fromId: 'fact', toId: 'entity', kind: 'attribution' },
    { fromId: 'fact', toId: 'session', kind: 'provenance' },
    { fromId: 'entity', toId: 'session', kind: 'participation' },
  ];

  async function seed(): Promise<void> {
    buildBrainGraph.mockResolvedValue(graph(['fact', 'entity', 'session'], 0, EDGES));
    await useMemoryGraphStore.getState().load('everything');
  }

  it('removeNode drops the node AND every edge touching it', async () => {
    await seed();

    useMemoryGraphStore.getState().removeNode('everything', 'fact');

    const stored = useMemoryGraphStore.getState().scopes.everything.graph!;
    expect(stored.nodes.map((n) => n.id)).toEqual(['entity', 'session']);
    expect(stored.edges).toEqual([{ fromId: 'entity', toId: 'session', kind: 'participation' }]);
  });

  it('removeNode leaves state untouched for an unknown node', async () => {
    await seed();
    const before = useMemoryGraphStore.getState().scopes.everything;

    useMemoryGraphStore.getState().removeNode('everything', 'nope');

    expect(useMemoryGraphStore.getState().scopes.everything).toBe(before);
  });

  it('forgetNode removes the node optimistically — BEFORE the IPC call resolves', async () => {
    await seed();
    let release = (): void => undefined;
    const commit = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));

    const pending = useMemoryGraphStore.getState().forgetNode('everything', 'fact', commit);

    expect(useMemoryGraphStore.getState().scopes.everything.graph!.nodes.map((n) => n.id)).toEqual([
      'entity',
      'session',
    ]);
    release();
    await expect(pending).resolves.toBe(true);
  });

  it('ROLLS BACK the node and its edges when the IPC commit rejects, and reports failure', async () => {
    await seed();

    const ok = await useMemoryGraphStore
      .getState()
      .forgetNode('everything', 'fact', () => Promise.reject(new Error('db down')));

    expect(ok).toBe(false);
    const stored = useMemoryGraphStore.getState().scopes.everything.graph!;
    expect(stored.nodes.map((n) => n.id)).toEqual(['fact', 'entity', 'session']);
    expect(stored.edges).toHaveLength(3);
  });

  it('does NOT roll back over a live refresh that landed mid-forget (that payload is the truth)', async () => {
    await seed();

    const ok = await useMemoryGraphStore.getState().forgetNode('everything', 'fact', async () => {
      useMemoryGraphStore.getState().setGraph('everything', graph(['entity']));
      throw new Error('db down');
    });

    expect(ok).toBe(false);
    expect(useMemoryGraphStore.getState().scopes.everything.graph!.nodes.map((n) => n.id)).toEqual(['entity']);
  });
});

describe('memoryGraphStore — activeScopeKey', () => {
  it('records the mounted scope and ignores a no-op set', () => {
    const { setActiveScope } = useMemoryGraphStore.getState();
    setActiveScope('session:m1');
    const first = useMemoryGraphStore.getState();
    setActiveScope('session:m1');

    expect(useMemoryGraphStore.getState().activeScopeKey).toBe('session:m1');
    expect(useMemoryGraphStore.getState()).toBe(first); // identical state object — no churn
  });
});
