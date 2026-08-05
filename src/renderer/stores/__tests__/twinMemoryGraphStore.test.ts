// === FILE PURPOSE ===
// twinMemoryGraphStore (TWIN-GRAPH.2 Task 3): cache-or-fetch `load` (de-duped and
// rejection-safe), always-refetch `refresh` with its entering DIFF and genuine
// no-op, the active-fact count the Memory tab badge rides on, and — the
// safety-critical one — the OPTIMISTIC forget path with rollback, since a forget
// that silently failed would look exactly like data loss.
//
// Node env: the store is DOM-free; `window` is stubbed to globalThis the same way
// memoryGraphStore.test.ts / brainStore.test.ts do it.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { TwinGraphEdge, TwinGraphNode, TwinMemoryGraph } from '../../../shared/types';

const twinBuildMemoryGraph = vi.fn();
vi.stubGlobal('electronAPI', { twinBuildMemoryGraph });
vi.stubGlobal('window', globalThis);

const { useTwinMemoryGraphStore, factCountOf, NO_ENTERING_NODES, NO_EXPANDED_LANES } =
  await import('../twinMemoryGraphStore');

function factNode(id: string): TwinGraphNode {
  return {
    id: `fact:${id}`,
    type: 'fact',
    tier: 2,
    label: `fact ${id}`,
    recordId: id,
    category: 'preference',
    degree: 1,
    newestTimestamp: null,
    sourceMeetingId: null,
    sourceMeetingTitle: null,
  };
}

function graphOf(factIds: string[], droppedCount = 0): TwinMemoryGraph {
  const nodes: TwinGraphNode[] = [
    {
      id: 'twin',
      type: 'twin',
      tier: 0,
      label: 'You',
      recordId: 'singleton',
      category: null,
      degree: 1,
      newestTimestamp: null,
    },
    {
      id: 'category:preference',
      type: 'category',
      tier: 1,
      label: 'Preference',
      recordId: 'preference',
      category: 'preference',
      degree: 1,
      newestTimestamp: null,
    },
    ...factIds.map(factNode),
  ];
  const edges: TwinGraphEdge[] = [
    { fromId: 'twin', toId: 'category:preference', kind: 'twin-hub' },
    ...factIds.map((id) => ({ fromId: 'category:preference', toId: `fact:${id}`, kind: 'hub-fact' as const })),
  ];
  return { nodes, edges, droppedCount };
}

beforeEach(() => {
  vi.clearAllMocks();
  useTwinMemoryGraphStore.setState({
    graph: null,
    entering: NO_ENTERING_NODES,
    expandedLanes: NO_EXPANDED_LANES,
  });
});

describe('twinMemoryGraphStore — load', () => {
  it('fetches once and then serves from cache', async () => {
    twinBuildMemoryGraph.mockResolvedValue(graphOf(['a']));

    await useTwinMemoryGraphStore.getState().load();
    await useTwinMemoryGraphStore.getState().load();

    expect(twinBuildMemoryGraph).toHaveBeenCalledTimes(1);
    expect(useTwinMemoryGraphStore.getState().graph?.nodes).toHaveLength(3);
  });

  it('de-dupes overlapping calls into a single IPC request', async () => {
    twinBuildMemoryGraph.mockResolvedValue(graphOf(['a']));

    await Promise.all([useTwinMemoryGraphStore.getState().load(), useTwinMemoryGraphStore.getState().load()]);

    expect(twinBuildMemoryGraph).toHaveBeenCalledTimes(1);
  });

  it('never throws on a failed fetch — the canvas shows its own placeholder', async () => {
    twinBuildMemoryGraph.mockRejectedValue(new Error('ipc down'));

    await expect(useTwinMemoryGraphStore.getState().load()).resolves.toBeUndefined();
    expect(useTwinMemoryGraphStore.getState().graph).toBeNull();
  });
});

describe('twinMemoryGraphStore — refresh', () => {
  it('marks nothing as entering on the first population (a load is not growth)', async () => {
    twinBuildMemoryGraph.mockResolvedValue(graphOf(['a']));

    await useTwinMemoryGraphStore.getState().refresh();

    expect(useTwinMemoryGraphStore.getState().entering.size).toBe(0);
  });

  it('diffs the new node ids and reports exactly what arrived', async () => {
    useTwinMemoryGraphStore.getState().setGraph(graphOf(['a']));
    twinBuildMemoryGraph.mockResolvedValue(graphOf(['a', 'b']));

    await useTwinMemoryGraphStore.getState().refresh();

    expect([...useTwinMemoryGraphStore.getState().entering]).toEqual(['fact:b']);
  });

  it('is a genuine no-op when nothing changed — no new state object at all', async () => {
    useTwinMemoryGraphStore.getState().setGraph(graphOf(['a']));
    const before = useTwinMemoryGraphStore.getState().graph;
    twinBuildMemoryGraph.mockResolvedValue(graphOf(['a']));

    await useTwinMemoryGraphStore.getState().refresh();

    expect(useTwinMemoryGraphStore.getState().graph).toBe(before);
  });

  it('keeps whatever was loaded when the refetch fails', async () => {
    useTwinMemoryGraphStore.getState().setGraph(graphOf(['a']));
    twinBuildMemoryGraph.mockRejectedValue(new Error('ipc down'));

    await useTwinMemoryGraphStore.getState().refresh();

    expect(useTwinMemoryGraphStore.getState().graph?.nodes).toHaveLength(3);
  });

  it('a FORCED refresh replaces the graph even though the id diff sees nothing', async () => {
    // The label backfill's case: same facts, same ids, better labels. Without
    // `force` the no-op bail above would swallow it and the user would be told
    // labels improved while watching nothing change.
    useTwinMemoryGraphStore.getState().setGraph(graphOf(['a']));
    const before = useTwinMemoryGraphStore.getState().graph;
    twinBuildMemoryGraph.mockResolvedValue(graphOf(['a']));

    await useTwinMemoryGraphStore.getState().refresh(true);

    expect(useTwinMemoryGraphStore.getState().graph).not.toBe(before);
    expect(useTwinMemoryGraphStore.getState().entering.size).toBe(0); // a relabel is not growth
  });
});

// ---------------------------------------------------------------------------
// TWIN-READ.1 Task 2 — progressive disclosure. The state lives here rather than
// in the canvas precisely so that a refresh or a live update, both of which
// replace `graph` wholesale, cannot silently close what the user opened.
// ---------------------------------------------------------------------------
describe('twinMemoryGraphStore — expandedLanes', () => {
  it('starts with every lane collapsed', () => {
    expect(useTwinMemoryGraphStore.getState().expandedLanes.size).toBe(0);
  });

  it('opens a collapsed lane and collapses an open one', () => {
    useTwinMemoryGraphStore.getState().toggleLane('preference');
    expect([...useTwinMemoryGraphStore.getState().expandedLanes]).toEqual(['preference']);

    useTwinMemoryGraphStore.getState().toggleLane('preference');
    expect(useTwinMemoryGraphStore.getState().expandedLanes.size).toBe(0);
  });

  it('allows several lanes open at once — lanes are separate places, not accordion panels', () => {
    useTwinMemoryGraphStore.getState().toggleLane('preference');
    useTwinMemoryGraphStore.getState().toggleLane('person');

    expect([...useTwinMemoryGraphStore.getState().expandedLanes].sort()).toEqual(['person', 'preference']);
  });

  it('survives a graph replacement and a refresh', async () => {
    useTwinMemoryGraphStore.getState().toggleLane('preference');

    useTwinMemoryGraphStore.getState().setGraph(graphOf(['a']));
    expect([...useTwinMemoryGraphStore.getState().expandedLanes]).toEqual(['preference']);

    twinBuildMemoryGraph.mockResolvedValue(graphOf(['a', 'b']));
    await useTwinMemoryGraphStore.getState().refresh();

    expect([...useTwinMemoryGraphStore.getState().expandedLanes]).toEqual(['preference']);
  });
});

describe('twinMemoryGraphStore — forget (optimistic, with rollback)', () => {
  it('removes the node and every edge touching it, then commits', async () => {
    useTwinMemoryGraphStore.getState().setGraph(graphOf(['a', 'b']));
    const commit = vi.fn().mockResolvedValue(undefined);

    const ok = await useTwinMemoryGraphStore.getState().forgetNode('fact:a', commit);

    expect(ok).toBe(true);
    const graph = useTwinMemoryGraphStore.getState().graph!;
    expect(graph.nodes.some((n) => n.id === 'fact:a')).toBe(false);
    expect(graph.edges.some((e) => e.toId === 'fact:a')).toBe(false);
    expect(graph.nodes.some((n) => n.id === 'fact:b')).toBe(true);
  });

  it('removes the node BEFORE the commit resolves — that is what makes it optimistic', async () => {
    useTwinMemoryGraphStore.getState().setGraph(graphOf(['a']));
    let release = (): void => {};
    const commit = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));

    const pending = useTwinMemoryGraphStore.getState().forgetNode('fact:a', commit);
    expect(useTwinMemoryGraphStore.getState().graph?.nodes.some((n) => n.id === 'fact:a')).toBe(false);

    release();
    await expect(pending).resolves.toBe(true);
  });

  it('RESTORES the graph and reports false when the commit throws', async () => {
    useTwinMemoryGraphStore.getState().setGraph(graphOf(['a', 'b']));
    const commit = vi.fn().mockRejectedValue(new Error('no such fact'));

    const ok = await useTwinMemoryGraphStore.getState().forgetNode('fact:a', commit);

    expect(ok).toBe(false);
    expect(useTwinMemoryGraphStore.getState().graph?.nodes.some((n) => n.id === 'fact:a')).toBe(true);
    expect(useTwinMemoryGraphStore.getState().graph?.edges.some((e) => e.toId === 'fact:a')).toBe(true);
  });

  it('does not roll back over a refresh that landed while the commit was in flight', async () => {
    useTwinMemoryGraphStore.getState().setGraph(graphOf(['a']));
    const fresher = graphOf(['c']);
    const commit = vi.fn(async () => {
      useTwinMemoryGraphStore.getState().setGraph(fresher);
      throw new Error('too late');
    });

    const ok = await useTwinMemoryGraphStore.getState().forgetNode('fact:a', commit);

    expect(ok).toBe(false);
    expect(useTwinMemoryGraphStore.getState().graph).toBe(fresher);
  });

  it('ignores an unknown node id', async () => {
    useTwinMemoryGraphStore.getState().setGraph(graphOf(['a']));
    const commit = vi.fn().mockResolvedValue(undefined);

    await useTwinMemoryGraphStore.getState().forgetNode('fact:nope', commit);

    expect(useTwinMemoryGraphStore.getState().graph?.nodes).toHaveLength(3);
  });
});

describe('twinMemoryGraphStore — factCountOf (the Memory tab badge)', () => {
  it('counts FACT nodes only — hubs and the twin core are structure, not memories', () => {
    expect(factCountOf(graphOf(['a', 'b', 'c']))).toBe(3);
  });

  it('is 0 for a graph with no facts, and for no graph at all', () => {
    expect(factCountOf(graphOf([]))).toBe(0);
    expect(factCountOf(null)).toBe(0);
  });
});
