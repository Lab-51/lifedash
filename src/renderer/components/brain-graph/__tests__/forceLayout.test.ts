// === FILE PURPOSE ===
// Unit tests for the memory graph's force-layout controller (TWIN-GRAPH.1 Task 2).
//
// NOTE: this file deliberately carries NO environment pragma, so it inherits
// vitest.config.ts's `environment: 'node'`. There is no document, no window and
// no requestAnimationFrame here — running green in this env IS the proof that
// forceLayout.ts is DOM-free and owns no frame loop. Do not name the jsdom
// pragma even inside a comment: vitest scans the leading comment block for it
// and would silently switch this file's environment.

import { describe, it, expect, vi } from 'vitest';
import type { BrainGraphEdge, BrainGraphNode, TwinGraphEdge, TwinGraphNode } from '../../../../shared/types';
import {
  DEFAULT_REHEAT_ALPHA,
  ForceLayout,
  HUB_SPAWN_JITTER_PX,
  LINK_DISTANCE,
  MAX_SETTLE_TICKS,
  SEED_SPREAD,
  seedPosition,
  type LayoutNode,
  type LayoutSourceNode,
} from '../forceLayout';
import { PROMINENCE_MAX_RADIUS, PROMINENCE_MIN_RADIUS } from '../prominence';
import {
  clampToLane,
  computeLanes,
  laneFor,
  seedInLane,
  tierBounds,
  type Lane,
  type TieredGeometry,
} from '../tieredLayout';

const NOW = Date.parse('2026-08-04T12:00:00.000Z');

function graphNode(id: string, over: Partial<BrainGraphNode> = {}): BrainGraphNode {
  return {
    id,
    type: 'topic',
    label: id,
    recordId: id,
    degree: 0,
    newestTimestamp: null,
    ...over,
  };
}

function edge(fromId: string, toId: string, kind: BrainGraphEdge['kind']): BrainGraphEdge {
  return { fromId, toId, kind };
}

/** entity:e1 with three attributed facts, one session, and a provenance link. */
function smallGraph(): { nodes: BrainGraphNode[]; edges: BrainGraphEdge[] } {
  const nodes = [
    graphNode('entity:e1', { type: 'person', degree: 4, newestTimestamp: new Date(NOW).toISOString() }),
    graphNode('entity-fact:f1', { type: 'entityFact', degree: 2 }),
    graphNode('entity-fact:f2', { type: 'entityFact', degree: 1 }),
    graphNode('entity-fact:f3', { type: 'entityFact', degree: 1 }),
    graphNode('session:s1', { type: 'session', degree: 2 }),
  ];
  const edges = [
    edge('entity:e1', 'entity-fact:f1', 'attribution'),
    edge('entity:e1', 'entity-fact:f2', 'attribution'),
    edge('entity:e1', 'entity-fact:f3', 'attribution'),
    edge('entity:e1', 'session:s1', 'participation'),
    edge('entity-fact:f1', 'session:s1', 'provenance'),
  ];
  return { nodes, edges };
}

function distance(a: LayoutNode, b: LayoutNode): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function positionsOf(layout: ForceLayout): [string, number, number][] {
  return layout.getNodes().map((node) => [node.id, node.x, node.y]);
}

describe('forceLayout — the node env itself proves DOM-freedom', () => {
  it('runs with no document, window or requestAnimationFrame available', () => {
    expect(typeof document).toBe('undefined');
    expect(typeof window).toBe('undefined');
    expect(typeof requestAnimationFrame).toBe('undefined');
  });

  it('settles a graph end to end without any of them', () => {
    const { nodes, edges } = smallGraph();
    const layout = new ForceLayout({ now: NOW });
    layout.start(nodes, edges);
    expect(layout.tickUntilSettled()).toBeGreaterThan(0);
    expect(layout.isSettled()).toBe(true);
  });
});

describe('seedPosition', () => {
  it('is stable for the same id and independent of array order', () => {
    const first = seedPosition('entity:abc');
    const second = seedPosition('entity:abc');
    expect(second).toEqual(first);
  });

  it('stays inside the seeding disc and spreads distinct ids apart', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `entity:${i}`);
    const seeds = ids.map(seedPosition);
    for (const seed of seeds) {
      expect(Number.isFinite(seed.x)).toBe(true);
      expect(Number.isFinite(seed.y)).toBe(true);
      expect(Math.hypot(seed.x, seed.y)).toBeLessThanOrEqual(SEED_SPREAD + 1e-9);
    }
    const unique = new Set(seeds.map((s) => `${s.x.toFixed(6)},${s.y.toFixed(6)}`));
    expect(unique.size).toBeGreaterThan(ids.length * 0.9);
  });
});

describe('ForceLayout determinism', () => {
  it('produces byte-identical positions across two independent runs', () => {
    const { nodes, edges } = smallGraph();
    const a = new ForceLayout({ now: NOW });
    const b = new ForceLayout({ now: NOW });
    a.start(nodes, edges);
    b.start(nodes, edges);
    a.tickUntilSettled();
    b.tickUntilSettled();
    expect(positionsOf(b)).toEqual(positionsOf(a));
  });

  it('seeds from the node id, so the same id always starts in the same place', () => {
    const { nodes, edges } = smallGraph();
    const layout = new ForceLayout({ now: NOW });
    layout.start(nodes, edges);
    for (const node of layout.getNodes()) {
      expect({ x: node.x, y: node.y }).toEqual(seedPosition(node.id));
    }
  });
});

describe('ForceLayout structure', () => {
  it('carries prominence radii onto the layout nodes rather than re-deriving them', () => {
    const { nodes, edges } = smallGraph();
    const layout = new ForceLayout({ now: NOW });
    layout.start(nodes, edges);
    const hub = layout.getNode('entity:e1');
    const leaf = layout.getNode('entity-fact:f2');
    expect(hub?.radius).toBeGreaterThan(leaf?.radius ?? Number.POSITIVE_INFINITY);
    for (const node of layout.getNodes()) {
      expect(node.radius).toBeGreaterThanOrEqual(PROMINENCE_MIN_RADIUS);
      expect(node.radius).toBeLessThanOrEqual(PROMINENCE_MAX_RADIUS);
    }
  });

  it('resolves link endpoints to node objects so the renderer needs no id lookup', () => {
    const { nodes, edges } = smallGraph();
    const layout = new ForceLayout({ now: NOW });
    layout.start(nodes, edges);
    expect(layout.getLinks()).toHaveLength(edges.length);
    for (const link of layout.getLinks()) {
      expect(layout.getNodes()).toContain(link.source);
      expect(layout.getNodes()).toContain(link.target);
    }
  });

  it('DROPS dangling edges instead of letting d3 throw "node not found"', () => {
    const layout = new ForceLayout({ now: NOW });
    expect(() => {
      layout.start(
        [graphNode('entity:a'), graphNode('entity:b')],
        [
          edge('entity:a', 'entity:b', 'attribution'),
          edge('entity:a', 'entity:ghost', 'provenance'),
          edge('entity:ghost', 'entity:b', 'participation'),
        ],
      );
    }).not.toThrow();
    expect(layout.getLinks()).toHaveLength(1);
    layout.tickUntilSettled();
    expect(layout.isSettled()).toBe(true);
  });

  it('pulls attribution pairs tighter than participation pairs', () => {
    const layout = new ForceLayout({ now: NOW });
    layout.start(
      [graphNode('a1'), graphNode('a2'), graphNode('p1'), graphNode('p2')],
      [edge('a1', 'a2', 'attribution'), edge('p1', 'p2', 'participation')],
    );
    layout.tickUntilSettled();
    const nodeOf = (id: string): LayoutNode => layout.getNode(id) as LayoutNode;
    const attribution = distance(nodeOf('a1'), nodeOf('a2'));
    const participation = distance(nodeOf('p1'), nodeOf('p2'));
    expect(LINK_DISTANCE.attribution).toBeLessThan(LINK_DISTANCE.participation);
    expect(attribution).toBeLessThan(participation);
  });
});

describe('ForceLayout degenerate graphs', () => {
  it('EMPTY GRAPH: settled immediately, no ticks, nothing to iterate', () => {
    const layout = new ForceLayout({ now: NOW });
    layout.start([], []);
    expect(layout.getNodes()).toHaveLength(0);
    expect(layout.getLinks()).toHaveLength(0);
    expect(layout.isSettled()).toBe(true);
    expect(layout.tickUntilSettled()).toBe(0);
    expect(() => {
      layout.tick();
      layout.reheat(['nope']);
      layout.stop();
    }).not.toThrow();
  });

  it('EMPTY GRAPH: is settled before start() is ever called', () => {
    const layout = new ForceLayout({ now: NOW });
    expect(layout.isSettled()).toBe(true);
    expect(layout.tickUntilSettled()).toBe(0);
    expect(layout.getNode('anything')).toBeUndefined();
  });

  it('SINGLE NODE, no edges: finite position, min radius, settles', () => {
    const layout = new ForceLayout({ now: NOW });
    layout.start([graphNode('entity:lonely')], []);
    const ticks = layout.tickUntilSettled();
    expect(ticks).toBeGreaterThan(0);
    expect(ticks).toBeLessThanOrEqual(MAX_SETTLE_TICKS);
    const only = layout.getNode('entity:lonely');
    expect(Number.isFinite(only?.x ?? Number.NaN)).toBe(true);
    expect(Number.isFinite(only?.y ?? Number.NaN)).toBe(true);
    expect(only?.radius).toBe(PROMINENCE_MIN_RADIUS);
    expect(only?.glow).toBe('dim');
  });

  it('ZERO MAX DEGREE + NULL TIMESTAMPS: no NaN reaches a position or a radius', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const layout = new ForceLayout({ now: NOW });
    layout.start(
      ids.map((id) => graphNode(id, { degree: 0, newestTimestamp: null })),
      [],
    );
    layout.tickUntilSettled();
    for (const node of layout.getNodes()) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
      expect(Number.isFinite(node.vx)).toBe(true);
      expect(Number.isFinite(node.vy)).toBe(true);
      expect(Number.isFinite(node.radius)).toBe(true);
      expect(node.radius).toBe(PROMINENCE_MIN_RADIUS);
      expect(node.score).toBe(0);
    }
  });

  it('COINCIDENT NODES: duplicate seeds do not divide by zero', () => {
    const layout = new ForceLayout({ now: NOW });
    // Same id hashed twice would collide; force the issue by pinning both seeds.
    layout.start([graphNode('x'), graphNode('y')], [edge('x', 'y', 'attribution')]);
    const [first, second] = layout.getNodes();
    second.x = first.x;
    second.y = first.y;
    layout.tickUntilSettled();
    for (const node of layout.getNodes()) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
  });

  it('caps tickUntilSettled so a pathological graph can never spin forever', () => {
    const { nodes, edges } = smallGraph();
    const layout = new ForceLayout({ now: NOW });
    layout.start(nodes, edges);
    expect(layout.tickUntilSettled(5)).toBe(5);
    expect(layout.isSettled()).toBe(false);
  });
});

describe('ForceLayout lifecycle', () => {
  it('notifies onTick subscribers and unsubscribes cleanly', () => {
    const { nodes, edges } = smallGraph();
    const layout = new ForceLayout({ now: NOW });
    layout.start(nodes, edges);

    const listener = vi.fn();
    const unsubscribe = layout.onTick(listener);
    layout.tick();
    layout.tick();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    layout.tick();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('notifies once per tickUntilSettled, not once per tick', () => {
    const { nodes, edges } = smallGraph();
    const layout = new ForceLayout({ now: NOW });
    layout.start(nodes, edges);
    const listener = vi.fn();
    layout.onTick(listener);
    const ticks = layout.tickUntilSettled();
    expect(ticks).toBeGreaterThan(10);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stop() freezes the layout and reports settled', () => {
    const { nodes, edges } = smallGraph();
    const layout = new ForceLayout({ now: NOW });
    layout.start(nodes, edges);
    layout.tick(10);
    expect(layout.isSettled()).toBe(false);
    layout.stop();
    expect(layout.isSettled()).toBe(true);
    const frozen = positionsOf(layout);
    layout.tick();
    expect(positionsOf(layout)).toEqual(frozen);
  });

  it('reheat() wakes a stopped layout and kicks only the named nodes', () => {
    const { nodes, edges } = smallGraph();
    const layout = new ForceLayout({ now: NOW });
    layout.start(nodes, edges);
    layout.tickUntilSettled();
    expect(layout.isSettled()).toBe(true);

    const untouched = layout.getNode('session:s1') as LayoutNode;
    const untouchedVelocity = { vx: untouched.vx, vy: untouched.vy };
    const kicked = layout.getNode('entity-fact:f1') as LayoutNode;

    layout.reheat(['entity-fact:f1'], 0.6);
    expect(layout.isSettled()).toBe(false);
    expect(Math.hypot(kicked.vx, kicked.vy)).toBeGreaterThan(0);
    expect(untouched.vx).toBe(untouchedVelocity.vx);
    expect(untouched.vy).toBe(untouchedVelocity.vy);
  });

  it('reheat() never cools a hotter simulation and ignores unknown ids', () => {
    const { nodes, edges } = smallGraph();
    const layout = new ForceLayout({ now: NOW });
    layout.start(nodes, edges);
    expect(() => layout.reheat(['entity:missing'], 0.01)).not.toThrow();
    expect(layout.isSettled()).toBe(false);
    layout.stop();
    expect(() => layout.reheat()).not.toThrow();
    expect(layout.isSettled()).toBe(false);
    expect(DEFAULT_REHEAT_ALPHA).toBeGreaterThan(0);
  });

  it('reheat() ignores a non-finite alpha instead of poisoning the simulation', () => {
    const { nodes, edges } = smallGraph();
    const layout = new ForceLayout({ now: NOW });
    layout.start(nodes, edges);
    layout.stop();
    layout.reheat(['entity:e1'], Number.NaN);
    expect(layout.isSettled()).toBe(false);
    layout.tickUntilSettled();
    for (const node of layout.getNodes()) {
      expect(Number.isFinite(node.x)).toBe(true);
    }
  });

  it('start() again carries surviving node positions over instead of teleporting them', () => {
    const { nodes, edges } = smallGraph();
    const layout = new ForceLayout({ now: NOW });
    layout.start(nodes, edges);
    layout.tickUntilSettled();
    const settled = layout.getNode('entity:e1') as LayoutNode;
    const before = { x: settled.x, y: settled.y };

    const arrival = graphNode('entity-fact:f4', { type: 'entityFact', degree: 1 });
    layout.start([...nodes, arrival], [...edges, edge('entity:e1', 'entity-fact:f4', 'attribution')]);

    const after = layout.getNode('entity:e1') as LayoutNode;
    expect(after.x).toBeCloseTo(before.x, 10);
    expect(after.y).toBeCloseTo(before.y, 10);
    // The genuinely new node starts from its deterministic seed.
    expect({ x: layout.getNode('entity-fact:f4')?.x, y: layout.getNode('entity-fact:f4')?.y }).toEqual(
      seedPosition('entity-fact:f4'),
    );
    expect(layout.isSettled()).toBe(false);
  });

  it('start() again keeps a pinned node pinned', () => {
    const { nodes, edges } = smallGraph();
    const layout = new ForceLayout({ now: NOW });
    layout.start(nodes, edges);
    const pinned = layout.getNode('entity:e1') as LayoutNode;
    pinned.fx = 123;
    pinned.fy = -456;
    layout.start(nodes, edges);
    const rebuilt = layout.getNode('entity:e1') as LayoutNode;
    expect(rebuilt.fx).toBe(123);
    expect(rebuilt.fy).toBe(-456);
    layout.tickUntilSettled();
    expect(rebuilt.x).toBe(123);
    expect(rebuilt.y).toBe(-456);
  });
});

// ---------------------------------------------------------------------------
// TWIN-GRAPH.2 Task 2 — tiered flow with category regions.
//
// The structural promise under test: a FACT NEVER CROSSES INTO A NEIGHBOURING
// LANE. A soft forceX cannot promise that (charge and collide push nodes out of
// their region), so forceLayout clamps AFTER each integration step. These tests
// are the proof, at settle, after a drag-release, and after a reheat.
// ---------------------------------------------------------------------------

const VIEWPORT = 1600;
const MS_PER_DAY = 86_400_000;
const LANES = ['person', 'project', 'domain'] as const;

function twinFixture(
  categories: readonly TwinGraphNode['category'][] = LANES,
  factsPerLane = 14,
): { nodes: TwinGraphNode[]; edges: TwinGraphEdge[] } {
  const nodes: TwinGraphNode[] = [
    {
      id: 'twin',
      type: 'twin',
      tier: 0,
      label: 'You',
      recordId: 'singleton',
      category: null,
      degree: categories.length,
      newestTimestamp: new Date(NOW).toISOString(),
    },
  ];
  const edges: TwinGraphEdge[] = [];
  for (const category of categories) {
    const hubId = `category:${category}`;
    nodes.push({
      id: hubId,
      type: 'category',
      tier: 1,
      label: String(category),
      recordId: String(category),
      category,
      degree: factsPerLane + 1,
      newestTimestamp: new Date(NOW).toISOString(),
    });
    edges.push({ fromId: 'twin', toId: hubId, kind: 'twin-hub' });
    for (let i = 0; i < factsPerLane; i++) {
      const id = `fact:${String(category)}-${i}`;
      nodes.push({
        id,
        type: 'fact',
        tier: 2,
        label: `${String(category)} fact ${i}`,
        recordId: `${String(category)}-${i}`,
        category,
        degree: 1,
        // Every 4th fact is undated — the null-timestamp path runs in here too.
        newestTimestamp: i % 4 === 0 ? null : new Date(NOW - i * MS_PER_DAY).toISOString(),
        sourceMeetingId: null,
        sourceMeetingTitle: null,
      });
      edges.push({ fromId: hubId, toId: id, kind: 'hub-fact' });
    }
  }
  return { nodes, edges };
}

function tieredLayoutFor(fixture: { nodes: TwinGraphNode[]; edges: TwinGraphEdge[] }): {
  layout: ForceLayout<TwinGraphNode>;
  geometry: TieredGeometry;
} {
  const layout = new ForceLayout<TwinGraphNode>({ now: NOW, viewportWidth: VIEWPORT });
  layout.start(fixture.nodes, fixture.edges);
  return {
    layout,
    geometry: computeLanes(
      fixture.nodes.map((n) => n.category),
      VIEWPORT,
    ),
  };
}

/** Every node fully inside its own lane — measured with its radius, not just
 *  its centre, so a circle can't bulge over the boundary either. */
function expectConfinedToLanes(layout: ForceLayout<TwinGraphNode>, geometry: TieredGeometry): void {
  for (const node of layout.getNodes()) {
    const lane = laneFor(geometry, node.category);
    expect(Number.isFinite(node.x)).toBe(true);
    expect(node.x).toBeGreaterThanOrEqual(lane.min + node.radius - 1e-9);
    expect(node.x).toBeLessThanOrEqual(lane.max - node.radius + 1e-9);
  }
}

function yRangeOfTier(layout: ForceLayout<TwinGraphNode>, tier: number): { min: number; max: number } {
  const ys = layout
    .getNodes()
    .filter((node) => node.tier === tier)
    .map((node) => node.y);
  return { min: Math.min(...ys), max: Math.max(...ys) };
}

function snapshot(layout: ForceLayout<TwinGraphNode>): Map<string, { x: number; y: number }> {
  return new Map(layout.getNodes().map((node) => [node.id, { x: node.x, y: node.y }]));
}

function maxDrift(layout: ForceLayout<TwinGraphNode>, before: Map<string, { x: number; y: number }>): number {
  let worst = 0;
  for (const node of layout.getNodes()) {
    const previous = before.get(node.id);
    if (!previous) continue;
    worst = Math.max(worst, Math.hypot(node.x - previous.x, node.y - previous.y));
  }
  return worst;
}

describe('ForceLayout tiered lanes — facts never cross into a neighbouring region', () => {
  it('settles EVERY fact inside its own category lane and outside every other one', () => {
    const fixture = twinFixture();
    const { layout, geometry } = tieredLayoutFor(fixture);
    layout.tickUntilSettled();
    expect(layout.isSettled()).toBe(true);
    expectConfinedToLanes(layout, geometry);

    // Stated the other way round as well: no fact's x falls in a foreign lane.
    for (const node of layout.getNodes()) {
      if (node.type !== 'fact') continue;
      for (const [key, lane] of geometry.lanes) {
        if (key === node.category) continue;
        expect(node.x >= lane.min && node.x <= lane.max).toBe(false);
      }
    }
  });

  it('seeds every node inside its lane and band BEFORE the first tick — frame 0 is already structured', () => {
    const fixture = twinFixture();
    const { layout, geometry } = tieredLayoutFor(fixture);
    expectConfinedToLanes(layout, geometry);
    for (const node of layout.getNodes()) {
      const lane = laneFor(geometry, node.category);
      const seed = seedInLane(node.id, lane, node.tier);
      // The seed places the node's CENTRE in the lane; start()'s clamp then
      // pulls its whole radius in, which is why this is the clamped seed and
      // not the raw one.
      expect({ x: node.x, y: node.y }).toEqual({ x: clampToLane(seed.x, lane, node.radius), y: seed.y });
    }
  });

  it('orders the tier bands: EVERY core above EVERY hub above EVERY fact', () => {
    const fixture = twinFixture();
    const { layout } = tieredLayoutFor(fixture);
    layout.tickUntilSettled();
    const core = yRangeOfTier(layout, 0);
    const hub = yRangeOfTier(layout, 1);
    const fact = yRangeOfTier(layout, 2);
    expect(core.max).toBeLessThan(hub.min);
    expect(hub.max).toBeLessThan(fact.min);
    // And each is inside its own declared band, not merely ordered by luck.
    expect(core.min).toBeGreaterThanOrEqual(tierBounds(0).min);
    expect(core.max).toBeLessThanOrEqual(tierBounds(0).max);
    expect(hub.min).toBeGreaterThanOrEqual(tierBounds(1).min);
    expect(hub.max).toBeLessThanOrEqual(tierBounds(1).max);
    expect(fact.min).toBeGreaterThanOrEqual(tierBounds(2).min);
  });

  it('CONFINES A DRAG in progress and leaves the fact lane-legal the moment it is released', () => {
    const fixture = twinFixture();
    const { layout, geometry } = tieredLayoutFor(fixture);
    layout.tickUntilSettled();

    const dragged = layout.getNode('fact:person-3') as LayoutNode<TwinGraphNode>;
    const ownLane = laneFor(geometry, 'person');
    const foreignLane = geometry.lanes.get('domain') as Lane;

    // Drag it hard into a neighbouring lane — and far below its band.
    dragged.fx = foreignLane.center + 400;
    dragged.fy = 5_000;
    layout.reheat([dragged.id]);
    layout.tick(20);
    expect(dragged.x).toBeLessThanOrEqual(ownLane.max - dragged.radius + 1e-9);
    expect(dragged.x).toBeGreaterThanOrEqual(ownLane.min + dragged.radius - 1e-9);
    expect(dragged.fx).toBeLessThanOrEqual(ownLane.max - dragged.radius + 1e-9);
    expectConfinedToLanes(layout, geometry);

    // Release: clear the pin and reheat, exactly as the component does.
    dragged.fx = null;
    dragged.fy = null;
    layout.reheat([dragged.id]);
    expectConfinedToLanes(layout, geometry);
    layout.tickUntilSettled();
    expectConfinedToLanes(layout, geometry);
    expect(dragged.y).toBeGreaterThanOrEqual(tierBounds(2).min);
  });

  it('keeps every fact in its lane after a full REHEAT and re-settle', () => {
    const fixture = twinFixture();
    const { layout, geometry } = tieredLayoutFor(fixture);
    layout.tickUntilSettled();
    layout.reheat(
      fixture.nodes.map((node) => node.id),
      1,
    );
    expect(layout.isSettled()).toBe(false);
    layout.tickUntilSettled();
    expect(layout.isSettled()).toBe(true);
    expectConfinedToLanes(layout, geometry);
  });

  it('holds the lanes under a DENSE graph, where collide pressure is highest', () => {
    const fixture = twinFixture(LANES, 120);
    const { layout, geometry } = tieredLayoutFor(fixture);
    layout.tickUntilSettled();
    expect(layout.getNodes()).toHaveLength(1 + 3 + 360);
    expectConfinedToLanes(layout, geometry);
  });
});

describe('ForceLayout tiered lanes — degenerate shapes', () => {
  it('SINGLE LANE: one region, still confined, still settles', () => {
    const fixture = twinFixture(['person']);
    const { layout, geometry } = tieredLayoutFor(fixture);
    expect(geometry.lanes.size).toBe(1);
    layout.tickUntilSettled();
    expect(layout.isSettled()).toBe(true);
    expectConfinedToLanes(layout, geometry);
  });

  it('CORE ONLY (no populated category): no lanes at all, nothing NaN, settles', () => {
    const fixture = twinFixture([]);
    const { layout, geometry } = tieredLayoutFor(fixture);
    expect(geometry.lanes.size).toBe(0);
    layout.tickUntilSettled();
    expect(layout.isSettled()).toBe(true);
    const core = layout.getNode('twin') as LayoutNode<TwinGraphNode>;
    expect(Number.isFinite(core.x)).toBe(true);
    expect(Number.isFinite(core.y)).toBe(true);
    expect(core.y).toBeLessThanOrEqual(tierBounds(0).max);
  });

  it('EMPTY tiered graph: settled by definition, no forces, no throw', () => {
    const layout = new ForceLayout<TwinGraphNode>({ now: NOW, viewportWidth: VIEWPORT });
    layout.start([], []);
    expect(layout.isSettled()).toBe(true);
    expect(layout.tickUntilSettled()).toBe(0);
    expect(() => {
      layout.tick();
      layout.reheat(['fact:nope']);
      layout.stop();
    }).not.toThrow();
  });

  it('re-lanes on rebuild: a node carried over from a WIDER lane set is clamped into its new lane', () => {
    const { layout } = tieredLayoutFor(twinFixture(LANES));
    layout.tickUntilSettled();

    // Drop two categories: lanes get wider and shift, so a carried-over x can
    // land outside its own new lane unless start() re-clamps.
    const narrowed = twinFixture(['person']);
    layout.start(narrowed.nodes, narrowed.edges);
    const geometry = computeLanes(
      narrowed.nodes.map((n) => n.category),
      VIEWPORT,
    );
    expectConfinedToLanes(layout, geometry);
    layout.tickUntilSettled();
    expectConfinedToLanes(layout, geometry);
  });

  it('produces byte-identical tiered positions across two independent runs', () => {
    const fixture = twinFixture();
    const a = new ForceLayout<TwinGraphNode>({ now: NOW, viewportWidth: VIEWPORT });
    const b = new ForceLayout<TwinGraphNode>({ now: NOW, viewportWidth: VIEWPORT });
    a.start(fixture.nodes, fixture.edges);
    b.start(fixture.nodes, fixture.edges);
    a.tickUntilSettled();
    b.tickUntilSettled();
    expect(b.getNodes().map((n) => [n.id, n.x, n.y])).toEqual(a.getNodes().map((n) => [n.id, n.x, n.y]));
  });

  it('leaves UNTIERED graphs completely alone — no lanes, no clamping', () => {
    const { nodes, edges } = smallGraph();
    const layout = new ForceLayout({ now: NOW, viewportWidth: VIEWPORT });
    layout.start(nodes, edges);
    // Untiered nodes seed on the disc, not in a lane, and nothing confines them.
    for (const node of layout.getNodes()) {
      expect({ x: node.x, y: node.y }).toEqual(seedPosition(node.id));
    }
    layout.tickUntilSettled();
    expect(layout.isSettled()).toBe(true);
  });
});

describe('ForceLayout tiered lanes — the clamp must not fight collide/charge into jitter', () => {
  // THE PLAN'S ONE FLAGGED ASSUMPTION, and these four tests are the evidence.
  // Hard clamping is not a force: it resets position and kills the outward
  // velocity after each integration step. If charge/collide kept shoving a node
  // at a wall and the clamp kept resetting it, the layout would oscillate.
  //
  // MEASURED (Windows 11, node env, vitest 4, the 46-node fixture below), max
  // displacement of any node, TIERED+clamped vs. the SAME graph UNTIERED (no
  // lanes, no clamping at all — the control):
  //
  //                            tiered   untiered
  //   200 ticks after settle    0.056     0.052
  //   settle -> reheat(1.0)     32.13    108.98
  //   ... -> reheat(1.0) again  12.72     65.34
  //   ... -> reheat(1.0) again   5.71     47.51
  //   settle -> reheat(0.4)      3.98     54.39   <- 0.4 = DEFAULT_REHEAT_ALPHA
  //
  // Conclusion: clamping does NOT fight the other forces. The layout is at rest
  // once settled (0.056px over 200 ticks), successive settles CONVERGE rather
  // than cycle, and the clamped layout is 3-13x MORE stable than the unclamped
  // control at every alpha. The residual movement after a full reheat is d3's
  // own alpha dependence — forceCollide ignores alpha while charge/link/x/y all
  // scale with it, so alpha 1 genuinely re-runs the physics from a different
  // force balance. Thresholds are set well above the measurements so scheduling
  // noise cannot flake them, and far below anything that would read as jitter.
  const IDLE_DRIFT_LIMIT = 0.5;
  /** A lane's usable width is ~477px here; 12px is ~2.5% of it, i.e. under one
   *  node diameter. Measured 3.98px. */
  const RESETTLE_DRIFT_LIMIT = 12;

  /** The same graph with `tier` and `category` stripped: identical ids, degrees,
   *  timestamps, edges and edge kinds, so charge/collide/link are unchanged and
   *  the ONLY differences are the lane/tier forces and the clamp. */
  function flatten(fixture: { nodes: TwinGraphNode[] }): Omit<TwinGraphNode, 'tier' | 'category'>[] {
    return fixture.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      label: node.label,
      recordId: node.recordId,
      degree: node.degree,
      newestTimestamp: node.newestTimestamp,
    }));
  }

  function driftAcrossSettles(alpha: number, settles: number): number[] {
    const fixture = twinFixture();
    const { layout } = tieredLayoutFor(fixture);
    layout.tickUntilSettled();
    const drifts: number[] = [];
    for (let i = 0; i < settles; i++) {
      const before = snapshot(layout);
      layout.reheat([], alpha);
      layout.tickUntilSettled();
      drifts.push(maxDrift(layout, before));
    }
    return drifts;
  }

  it('IS AT REST once settled: 200 further ticks move nothing (measured 0.056px)', () => {
    const fixture = twinFixture();
    const { layout, geometry } = tieredLayoutFor(fixture);
    layout.tickUntilSettled();
    const settled = snapshot(layout);
    layout.tick(200);
    expect(maxDrift(layout, settled)).toBeLessThan(IDLE_DRIFT_LIMIT);
    expectConfinedToLanes(layout, geometry);
  });

  it('SETTLED POSITIONS ARE STABLE across two consecutive settles at the reheat alpha the app uses', () => {
    const fixture = twinFixture();
    const { layout, geometry } = tieredLayoutFor(fixture);
    layout.tickUntilSettled();
    const first = snapshot(layout);

    layout.reheat([], DEFAULT_REHEAT_ALPHA);
    expect(layout.isSettled()).toBe(false);
    layout.tickUntilSettled();

    expect(layout.isSettled()).toBe(true);
    expect(maxDrift(layout, first)).toBeLessThan(RESETTLE_DRIFT_LIMIT);
    expectConfinedToLanes(layout, geometry);
  });

  it('CONVERGES rather than cycling: each full-alpha re-settle moves less than the one before', () => {
    const drifts = driftAcrossSettles(1, 3);
    // A limit cycle — the failure mode clamping could plausibly cause — would
    // hold this flat or grow it. Measured: 32.13 -> 12.72 -> 5.71.
    expect(drifts[2]).toBeLessThan(drifts[0] / 2);
  });

  it('IS MORE STABLE THAN THE UNCLAMPED CONTROL — clamping is not fighting the other forces', () => {
    const fixture = twinFixture();
    const tiered = new ForceLayout<TwinGraphNode>({ now: NOW, viewportWidth: VIEWPORT });
    tiered.start(fixture.nodes, fixture.edges);
    const flat = new ForceLayout<Omit<TwinGraphNode, 'tier' | 'category'>>({ now: NOW, viewportWidth: VIEWPORT });
    flat.start(flatten(fixture), fixture.edges);

    const driftOf = <T extends LayoutSourceNode>(layout: ForceLayout<T>): number => {
      layout.tickUntilSettled();
      const before = new Map(layout.getNodes().map((node) => [node.id, { x: node.x, y: node.y }]));
      layout.reheat([], 1);
      layout.tickUntilSettled();
      let worst = 0;
      for (const node of layout.getNodes()) {
        const previous = before.get(node.id);
        if (previous) worst = Math.max(worst, Math.hypot(node.x - previous.x, node.y - previous.y));
      }
      return worst;
    };

    // Measured 32.13 (tiered) vs 108.98 (untiered) — the structure REDUCES the
    // free play in the system rather than adding a fight to it.
    expect(driftOf(tiered)).toBeLessThan(driftOf(flat));
  });

  it('DECAYS toward rest instead of oscillating: the last ticks move far less than the first', () => {
    const fixture = twinFixture();
    const { layout } = tieredLayoutFor(fixture);
    const perTick = (): number => {
      const before = snapshot(layout);
      layout.tick(1);
      return maxDrift(layout, before);
    };
    const early = Math.max(perTick(), perTick(), perTick());
    layout.tickUntilSettled();
    const late = Math.max(perTick(), perTick(), perTick());
    expect(late).toBeLessThan(early / 100);
    expect(late).toBeLessThan(IDLE_DRIFT_LIMIT);
  });
});

// ---------------------------------------------------------------------------
// TWIN-GRAPH.2 Task 4 — LIVE GROWTH: a brand-new fact node spawns AT its
// category hub (not a random lane offset), and reheating just that one node
// is LANE-LOCAL to a small, measured epsilon — a single new fact must not
// read as re-shuffling the whole canvas. The one case that structurally
// CANNOT stay lane-local is a brand-new CATEGORY (Task 2 caveat #3: the lane
// set itself changes shape) — proven separately below, not glossed over.
// ---------------------------------------------------------------------------
describe('ForceLayout tiered lanes — TWIN-GRAPH.2 Task 4 live growth', () => {
  /** A single entering fact's reheat, measured against the SAME fixture this
   *  file already trusts (twinFixture/tieredLayoutFor/snapshot/maxDrift,
   *  above). Real numbers (Windows 11, node env, vitest 4): worst OTHER-lane
   *  drift 3.78px, worst SAME-lane (other facts making room) drift 33.27px.
   *  Thresholds are set generously above both, mirroring this file's own
   *  established convention (IDLE_DRIFT_LIMIT/RESETTLE_DRIFT_LIMIT above) of
   *  numeric margins rather than exact-zero assertions — d3-force's charge
   *  force is a global n-body force with no per-lane isolation, so "other
   *  lanes do not move" is a bounded-epsilon claim, not a literal one. */
  const OTHER_LANE_DRIFT_LIMIT = 8;

  function growByOneFact(fixture: { nodes: TwinGraphNode[]; edges: TwinGraphEdge[] }, category: string, id: string) {
    const nodes = [
      ...fixture.nodes,
      {
        id: `fact:${id}`,
        type: 'fact' as const,
        tier: 2 as const,
        label: `new ${id}`,
        recordId: id,
        category: category as TwinGraphNode['category'],
        degree: 1,
        newestTimestamp: new Date(NOW).toISOString(),
        sourceMeetingId: null,
        sourceMeetingTitle: null,
      },
    ];
    const edges = [...fixture.edges, { fromId: `category:${category}`, toId: `fact:${id}`, kind: 'hub-fact' as const }];
    return { nodes, edges };
  }

  it('SPAWNS a brand-new fact AT its category hub, not at a random lane-wide seed', () => {
    const fixture = twinFixture();
    const layout = new ForceLayout<TwinGraphNode>({ now: NOW, viewportWidth: VIEWPORT });
    layout.start(fixture.nodes, fixture.edges);
    layout.tickUntilSettled();
    layout.stop();

    const grown = growByOneFact(fixture, 'person', 'NEW');
    layout.start(grown.nodes, grown.edges);

    const hub = layout.getNode('category:person') as LayoutNode<TwinGraphNode>;
    const entering = layout.getNode('fact:NEW') as LayoutNode<TwinGraphNode>;

    // Horizontally: within HUB_SPAWN_JITTER_PX of the hub's own x (not spread
    // across the whole ~477px-wide lane the way an ordinary seedInLane fact
    // would be).
    expect(Math.abs(entering.x - hub.x)).toBeLessThanOrEqual(HUB_SPAWN_JITTER_PX + 1e-9);
    // Vertically: clamped into the fact tier band (tier 2 sits below tier 1,
    // so "spawn at the hub" lands at the TOP of that band — visually directly
    // under the hub, not overlapping it).
    expect(entering.y).toBe(tierBounds(2).min);
  });

  it('gives each fact in a SAME-BATCH multi-fact arrival a distinct seed (deterministic jitter, no exact overlap)', () => {
    const fixture = twinFixture();
    const layout = new ForceLayout<TwinGraphNode>({ now: NOW, viewportWidth: VIEWPORT });
    layout.start(fixture.nodes, fixture.edges);
    layout.tickUntilSettled();
    layout.stop();

    let grown = fixture;
    for (const id of ['NEW-1', 'NEW-2', 'NEW-3']) grown = growByOneFact(grown, 'person', id);
    layout.start(grown.nodes, grown.edges);

    const seeds = ['NEW-1', 'NEW-2', 'NEW-3'].map((id) => {
      const node = layout.getNode(`fact:${id}`) as LayoutNode<TwinGraphNode>;
      return `${node.x},${node.y}`;
    });
    expect(new Set(seeds).size).toBe(3); // no two landed on the exact same point
  });

  it('FALLS BACK to the ordinary lane seed when the category itself is brand new — no hub exists yet to grow from', () => {
    const fixture = twinFixture(['person']);
    const layout = new ForceLayout<TwinGraphNode>({ now: NOW, viewportWidth: VIEWPORT });
    layout.start(fixture.nodes, fixture.edges);
    layout.tickUntilSettled();
    layout.stop();

    // 'project' has never existed before — its hub AND its first fact arrive
    // in the same rebuild.
    const grown = twinFixture(['person', 'project'], 1);
    layout.start(grown.nodes, grown.edges);
    const geometry = computeLanes(
      grown.nodes.map((n) => n.category),
      VIEWPORT,
    );
    const lane = laneFor(geometry, 'project');
    const firstProjectFact = layout.getNode('fact:project-0') as LayoutNode<TwinGraphNode>;
    expect({ x: firstProjectFact.x, y: firstProjectFact.y }).toEqual(
      seedInLane('fact:project-0', lane, firstProjectFact.tier),
    );
    expect(Number.isFinite(firstProjectFact.x)).toBe(true);
    expect(Number.isFinite(firstProjectFact.y)).toBe(true);
  });

  it('REHEAT OF ONE ENTERING FACT is lane-local to a small, measured epsilon — other lanes barely move', () => {
    const fixture = twinFixture(); // person, project, domain — lane set UNCHANGED
    const { layout, geometry } = tieredLayoutFor(fixture);
    layout.tickUntilSettled();
    layout.stop();

    const grown = growByOneFact(fixture, 'person', 'NEW');
    layout.start(grown.nodes, grown.edges);
    const before = snapshot(layout);

    layout.reheat(['fact:NEW']);
    expect(layout.isSettled()).toBe(false);
    layout.tickUntilSettled();
    layout.stop();

    for (const node of layout.getNodes()) {
      if (node.category === 'person' || node.id === 'fact:NEW') continue; // own lane may reflow to make room
      const prior = before.get(node.id);
      if (!prior) continue;
      expect(Math.hypot(node.x - prior.x, node.y - prior.y)).toBeLessThan(OTHER_LANE_DRIFT_LIMIT);
    }
    expectConfinedToLanes(layout, geometry);
  });

  it('re-freezes after the bloom — a live-growth reheat still settles to isSettled() === true', () => {
    const fixture = twinFixture();
    const layout = new ForceLayout<TwinGraphNode>({ now: NOW, viewportWidth: VIEWPORT });
    layout.start(fixture.nodes, fixture.edges);
    layout.tickUntilSettled();
    layout.stop();
    expect(layout.isSettled()).toBe(true);

    const grown = growByOneFact(fixture, 'domain', 'NEW');
    layout.start(grown.nodes, grown.edges);
    layout.reheat(['fact:NEW']);
    layout.tickUntilSettled();
    layout.stop();

    expect(layout.isSettled()).toBe(true);
    for (const node of layout.getNodes()) {
      expect(node.vx).toBe(0);
      expect(node.vy).toBe(0);
    }
  });

  it('caveat #3, HONESTLY NOT LANE-LOCAL: a BRAND-NEW CATEGORY reshuffles every existing lane (viewport-divided lanes cannot avoid this)', () => {
    const fixture = twinFixture(); // person, project, domain
    const layout = new ForceLayout<TwinGraphNode>({ now: NOW, viewportWidth: VIEWPORT });
    layout.start(fixture.nodes, fixture.edges);
    layout.tickUntilSettled();
    layout.stop();
    const before = snapshot(layout);

    // 'commitment' has never existed before — a genuinely new lane is born.
    const grown = twinFixture([...LANES, 'commitment']);
    layout.start(grown.nodes, grown.edges);
    layout.reheat(['category:commitment']);
    layout.tickUntilSettled();
    layout.stop();

    // The whole layout is still finite and every fact is still confined to
    // ITS lane under the new geometry — the structural guarantee survives —
    // but existing nodes' positions are NOT preserved: this is the one case
    // this phase's plan explicitly says cannot stay lane-local.
    const geometry = computeLanes(
      grown.nodes.map((n) => n.category),
      VIEWPORT,
    );
    expectConfinedToLanes(layout, geometry);
    expect(maxDrift(layout, before)).toBeGreaterThan(OTHER_LANE_DRIFT_LIMIT * 10); // proves it reshuffled, not glossed
  });
});

describe('ForceLayout owns no frame loop', () => {
  it('schedules no timer of its own while ticking, reheating or stopping', () => {
    const { nodes, edges } = smallGraph();
    const layout = new ForceLayout({ now: NOW });
    layout.start(nodes, edges);

    // Spy AFTER start(): d3-force's forceSimulation() unconditionally creates a
    // d3-timer stepper at construction (we stop it immediately and never call
    // restart). Everything the controller does from here on must be timer-free.
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    try {
      layout.tickUntilSettled();
      layout.reheat(['entity:e1']);
      layout.tick(3);
      layout.stop();
      expect(setTimeoutSpy).not.toHaveBeenCalled();
      expect(setIntervalSpy).not.toHaveBeenCalled();
    } finally {
      setTimeoutSpy.mockRestore();
      setIntervalSpy.mockRestore();
    }
  });
});
