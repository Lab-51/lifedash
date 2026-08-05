// === FILE PURPOSE ===
// Force-directed layout controller for the memory graph (TWIN-GRAPH.1 Task 2,
// extended with tiered lanes in TWIN-GRAPH.2 Task 2).
//
// A plain-TS wrapper around d3-force. It computes positions and NOTHING else:
// no DOM, no React, no rAF, no setTimeout/setInterval of its own. The COMPONENT
// owns the frame loop and calls tick() from its own rAF; this class only
// advances the simulation when asked. That is what lets the whole engine be
// unit-tested in vitest's node environment with no jsdom pragma.
//
// TWO MODES, decided per start() from the data:
//   * UNTIERED (no node carries a `tier`) — the original uniform blob, centred
//     on the origin. Byte-identical to before; nothing here changes for it.
//   * TIERED (any node carries a `tier`) — tiered flow with category regions.
//     tier -> y band, category -> x lane, per tieredLayout.ts. A fact can NEVER
//     cross into a neighbouring lane; see the clamp note below.
//
// WHY THE CLAMP IS NOT A d3 FORCE (verified against the installed d3-force@3.0.0
// source, simulation.js, not from memory): d3's tick() runs every force FIRST
// and integrates positions AFTERWARDS (`node.x += node.vx *= velocityDecay`).
// A clamp registered as a force would therefore be overshot by the integration
// step in the same tick, and the caller would observe a node outside its lane.
// So the clamp runs AFTER each integration step, from this class's own loop —
// which is what makes "a fact is never outside its lane" true at every moment a
// caller can observe, including after drag-release and after reheat().
//
// d3-force caveat (same source): forceSimulation() unconditionally starts a
// d3-timer stepper at construction. We call simulation.stop() immediately and
// never call restart(), so we drive every tick ourselves. d3-timer's own
// bookkeeping still leaves one pending frame callback plus a 1s "poke" interval
// that IT clears on that first frame (~17ms later); after that the engine
// schedules nothing, so the zero-timers-at-idle rule holds.
//
// Determinism: initial positions come from an FNV-1a hash of the node id, never
// Math.random and never the array index — so a rebuilt graph re-seeds to the
// same place regardless of row order, and tests cannot flake.

import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import type { BrainGraphEdgeKind, BrainGraphNode, TwinGraphEdgeKind } from '../../../shared/types';
import { scoreGraph, type GlowTier, type ProminenceNode } from './prominence';
import {
  clampToLane,
  clampToTier,
  computeLanes,
  hash32,
  HUB_TIER,
  laneFor,
  LANE_X_STRENGTH,
  seedInLane,
  TIER_GAP,
  TIER_Y_STRENGTH,
  tierCenterY,
  type TieredGeometry,
} from './tieredLayout';

/** Every edge kind the layout can be handed: the entity-centric brain graph's
 *  three, plus the twin memory graph's two parent->child kinds. */
export type LayoutEdgeKind = BrainGraphEdgeKind | TwinGraphEdgeKind;

/** Rest length per edge kind: attribution binds a fact to its entity tightly;
 *  provenance/participation reach across to sessions and sit further out. The
 *  two tiered kinds rest at exactly one tier gap, so the link force and the
 *  tier force want the same thing instead of fighting over it. */
export const LINK_DISTANCE: Record<LayoutEdgeKind, number> = {
  attribution: 45,
  provenance: 110,
  participation: 130,
  'twin-hub': TIER_GAP,
  'hub-fact': TIER_GAP,
};

export const DEFAULT_CHARGE_STRENGTH = -160;
export const DEFAULT_CENTERING_STRENGTH = 0.04;
export const DEFAULT_COLLIDE_PADDING = 4;
/** Radius of the deterministic seeding disc, in px. UNTIERED graphs only —
 *  tiered ones seed inside their lane (tieredLayout.seedInLane). */
export const SEED_SPREAD = 600;
/** Hard cap on tickUntilSettled() so a pathological graph can never spin
 *  forever. d3's defaults settle in ~300 ticks, so this is 2x headroom. */
export const MAX_SETTLE_TICKS = 600;
/** Alpha reheat() uses when the caller does not specify one. */
export const DEFAULT_REHEAT_ALPHA = 0.4;
/** Velocity kick applied to the nodes named in reheat(). */
export const REHEAT_IMPULSE = 4;
/** TWIN-GRAPH.2 Task 4 live growth: how far (px) a brand-new tiered node's
 *  deterministic jitter offsets it from its category hub's last known
 *  position, so several facts arriving in the same batch don't seed exactly
 *  on top of one another (a d3-force zero-distance tie for charge/collide). */
export const HUB_SPAWN_JITTER_PX = 10;

const TAU = Math.PI * 2;

/**
 * The graph-node shape the layout consumes. Both `BrainGraphNode` (untiered)
 * and `TwinGraphNode` (tiered) satisfy it structurally, so ForceLayout serves
 * both without either shape being converted or privileged.
 */
export interface LayoutSourceNode extends ProminenceNode {
  /** Layout depth when the source graph is tiered; absent on flat graphs. */
  tier?: number;
  /** Lane key when the source graph has regions; null on the laneless core. */
  category?: string | null;
}

/** The edge shape the layout consumes — `BrainGraphEdge` and `TwinGraphEdge`
 *  both satisfy it. */
export interface LayoutSourceEdge {
  fromId: string;
  toId: string;
  kind: LayoutEdgeKind;
}

/** A graph node plus its simulation state and its prominence-derived styling.
 *  x/y/vx/vy are narrowed to required: start() seeds them before the simulation
 *  ever runs, so the renderer never sees undefined. The source node's own
 *  fields pass through unchanged, keeping their literal types. */
export type LayoutNode<TNode extends LayoutSourceNode = BrainGraphNode> = TNode &
  SimulationNodeDatum & {
    x: number;
    y: number;
    vx: number;
    vy: number;
    /** From prominence.ts — never re-derive this downstream. */
    radius: number;
    glow: GlowTier;
    score: number;
  };

/** source/target are narrowed to LayoutNode because start() resolves them to
 *  node objects up front; d3-force leaves object endpoints alone, so the
 *  renderer can read link.source.x with no cast and no id lookup. */
export interface LayoutLink<TNode extends LayoutSourceNode = BrainGraphNode> extends SimulationLinkDatum<
  LayoutNode<TNode>
> {
  source: LayoutNode<TNode>;
  target: LayoutNode<TNode>;
  kind: LayoutEdgeKind;
}

export interface ForceLayoutOptions {
  /** Per-kind rest lengths; merged over LINK_DISTANCE. */
  linkDistance?: Partial<Record<LayoutEdgeKind, number>>;
  /** Negative = repulsion. */
  chargeStrength?: number;
  centeringStrength?: number;
  collidePadding?: number;
  /** Horizontal span the category lanes divide, in layout px. Ignored by
   *  untiered graphs. Defaults to tieredLayout.DEFAULT_LAYOUT_WIDTH. */
  viewportWidth?: number;
  /** Clock injected for prominence scoring — pass a fixed value in tests. */
  now?: number;
}

/** Deterministic point on a disc, derived only from the node id. sqrt() keeps
 *  the distribution uniform instead of clumping everything at the centre. */
export function seedPosition(id: string): { x: number; y: number } {
  const hash = hash32(id);
  const angle = ((hash % 3600) / 3600) * TAU;
  const radius = SEED_SPREAD * Math.sqrt((((hash >>> 12) % 1024) + 0.5) / 1024);
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

/**
 * Simulate-then-freeze layout controller.
 *
 * Owns no timers. Typical animated use: start() -> tick() once per rAF frame
 * until isSettled() -> stop the frame loop. Reduced-motion / test use:
 * start() -> tickUntilSettled().
 */
export class ForceLayout<TNode extends LayoutSourceNode = BrainGraphNode> {
  private simulation: Simulation<LayoutNode<TNode>, LayoutLink<TNode>> | null = null;
  private nodes: LayoutNode<TNode>[] = [];
  private links: LayoutLink<TNode>[] = [];
  private byId = new Map<string, LayoutNode<TNode>>();
  /** Non-null only for a tiered graph — it is also the "clamping is on" flag. */
  private geometry: TieredGeometry | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly options: Required<Omit<ForceLayoutOptions, 'now' | 'linkDistance' | 'viewportWidth'>> & {
    now: number | null;
    viewportWidth: number | null;
    linkDistance: Record<LayoutEdgeKind, number>;
  };

  constructor(options: ForceLayoutOptions = {}) {
    this.options = {
      linkDistance: { ...LINK_DISTANCE, ...options.linkDistance },
      chargeStrength: options.chargeStrength ?? DEFAULT_CHARGE_STRENGTH,
      centeringStrength: options.centeringStrength ?? DEFAULT_CENTERING_STRENGTH,
      collidePadding: options.collidePadding ?? DEFAULT_COLLIDE_PADDING,
      viewportWidth: options.viewportWidth ?? null,
      now: options.now ?? null,
    };
  }

  /**
   * (Re)build the simulation. Positions of nodes that survive from a previous
   * start() are carried over, so a graph refresh after a new memory arrives
   * nudges the layout instead of teleporting every node.
   *
   * Edges whose endpoints are missing from `graphNodes` are dropped rather than
   * thrown on — d3's forceLink throws "node not found" for a dangling id, which
   * would take down the whole canvas.
   */
  start(graphNodes: readonly TNode[], graphEdges: readonly LayoutSourceEdge[]): void {
    const previous = this.byId;
    this.stop();

    this.geometry = ForceLayout.geometryFor(graphNodes, this.options.viewportWidth);
    const prominence = scoreGraph(graphNodes, this.options.now ?? Date.now());
    // Live-growth spawn point (TWIN-GRAPH.2 Task 4): read BEFORE previous is
    // overwritten below, so a brand-new fact node can seed at its category
    // hub's CURRENT (pre-rebuild) position instead of a random lane offset —
    // it must read as growing FROM the hub, not teleporting into the lane.
    const hubByCategory = this.hubPositionsOf(previous);
    this.nodes = graphNodes.map((node) => this.toLayoutNode(node, prominence, previous, hubByCategory));
    this.byId = new Map(this.nodes.map((node) => [node.id, node]));
    this.links = [];
    for (const edge of graphEdges) {
      const source = this.byId.get(edge.fromId);
      const target = this.byId.get(edge.toId);
      if (source && target) this.links.push({ source, target, kind: edge.kind });
    }

    const distances = this.options.linkDistance;
    const padding = this.options.collidePadding;
    const simulation = forceSimulation<LayoutNode<TNode>>(this.nodes)
      .force(
        'link',
        forceLink<LayoutNode<TNode>, LayoutLink<TNode>>(this.links).distance((link) => distances[link.kind]),
      )
      .force('charge', forceManyBody<LayoutNode<TNode>>().strength(this.options.chargeStrength))
      .force(
        'collide',
        forceCollide<LayoutNode<TNode>>().radius((node) => node.radius + padding),
      );
    this.applyShapingForces(simulation);

    // We own the loop, d3 must not: kill the stepper it started at construction.
    simulation.stop();
    this.simulation = simulation;
    // Carried-over and freshly seeded positions alike must already satisfy the
    // structure — the renderer draws frame 0 before any tick runs, and a lane
    // set can change shape between two start() calls.
    this.clampToStructure();
  }

  /** Lanes for a tiered graph, or null for a flat one. A graph is tiered iff at
   *  least one node carries a finite `tier`; lanes come from every category
   *  present, not only the hubs', so a fact can never be laneless. */
  private static geometryFor(
    graphNodes: readonly LayoutSourceNode[],
    viewportWidth: number | null,
  ): TieredGeometry | null {
    const tiered = graphNodes.some((node) => typeof node.tier === 'number' && Number.isFinite(node.tier));
    if (!tiered) return null;
    return computeLanes(
      graphNodes.map((node) => node.category),
      viewportWidth ?? undefined,
    );
  }

  /** Tiered graphs are shaped by lane/tier targets; flat ones keep the original
   *  pull toward the origin. Same two force slots either way. */
  private applyShapingForces(simulation: Simulation<LayoutNode<TNode>, LayoutLink<TNode>>): void {
    const geometry = this.geometry;
    if (!geometry) {
      simulation
        .force('x', forceX<LayoutNode<TNode>>(0).strength(this.options.centeringStrength))
        .force('y', forceY<LayoutNode<TNode>>(0).strength(this.options.centeringStrength));
      return;
    }
    simulation
      .force(
        'x',
        forceX<LayoutNode<TNode>>((node) => laneFor(geometry, node.category).center).strength(LANE_X_STRENGTH),
      )
      .force('y', forceY<LayoutNode<TNode>>((node) => tierCenterY(node.tier)).strength(TIER_Y_STRENGTH));
  }

  private toLayoutNode(
    node: TNode,
    prominence: ReturnType<typeof scoreGraph>,
    previous: Map<string, LayoutNode<TNode>>,
    hubByCategory: ReadonlyMap<string, { x: number; y: number }>,
  ): LayoutNode<TNode> {
    const score = prominence.get(node.id);
    const carried = previous.get(node.id);
    const seed = carried ?? this.seedFor(node, hubByCategory);
    return {
      ...node,
      x: seed.x,
      y: seed.y,
      // Momentum is deliberately NOT carried: start() halts the previous
      // simulation first, and alpha is reset to 1 anyway.
      vx: 0,
      vy: 0,
      // Keep a pin across a rebuild — a node dragged and held must not jump
      // free just because a new memory arrived. null (not undefined) = unpinned.
      fx: carried?.fx ?? null,
      fy: carried?.fy ?? null,
      radius: score?.radius ?? 0,
      glow: score?.glow ?? 'dim',
      score: score?.score ?? 0,
    };
  }

  /** Tiered nodes seed inside their own lane and band; flat ones on the disc.
   *  A brand-new tiered node (no carried-over position) whose category ALREADY
   *  has a hub seeds AT that hub instead (deterministic jitter only, never
   *  Math.random) — this is what makes live growth read as spawning from the
   *  category rather than appearing at a random point in the lane. The
   *  structural clamp run at the end of start() still applies afterward, so
   *  the node lands legally inside its own tier band (in practice, just below
   *  the hub, since the hub's own y sits in the tier ABOVE). A node whose
   *  category has NO existing hub (a brand-new category — see tieredLayout's
   *  header) falls through to the ordinary lane seed; there is no prior hub
   *  position to grow from in that case. */
  private seedFor(node: TNode, hubByCategory: ReadonlyMap<string, { x: number; y: number }>): { x: number; y: number } {
    if (!this.geometry) return seedPosition(node.id);
    const hub = typeof node.category === 'string' ? hubByCategory.get(node.category) : undefined;
    if (hub) {
      const angle = (((hash32(node.id) >>> 4) % 3600) / 3600) * TAU;
      return {
        x: hub.x + Math.cos(angle) * HUB_SPAWN_JITTER_PX,
        y: hub.y + Math.sin(angle) * HUB_SPAWN_JITTER_PX,
      };
    }
    return seedInLane(node.id, laneFor(this.geometry, node.category), node.tier);
  }

  /** Category -> its hub's CURRENT position, read from the byId map as it
   *  stood BEFORE this rebuild. Empty for an untiered graph, for the very
   *  first start() (nothing existed yet to grow from), or for a category
   *  whose hub is itself brand-new this rebuild. */
  private hubPositionsOf(previous: Map<string, LayoutNode<TNode>>): ReadonlyMap<string, { x: number; y: number }> {
    const byCategory = new Map<string, { x: number; y: number }>();
    if (!this.geometry) return byCategory;
    for (const node of previous.values()) {
      if (node.tier === HUB_TIER && typeof node.category === 'string') {
        byCategory.set(node.category, { x: node.x, y: node.y });
      }
    }
    return byCategory;
  }

  /**
   * THE HARD STRUCTURAL GUARANTEE. Runs after every integration step, never as
   * a d3 force (see the file header for why). Charge and collide are free to
   * push a node at a lane wall; this puts it back ON the wall and kills the
   * velocity component that pushed it, so the node rests there instead of
   * oscillating. A pinned node's fx/fy are clamped too, which is what confines
   * a drag in progress AND leaves it lane-legal the moment it is released.
   *
   * No-op for an untiered graph.
   */
  private clampToStructure(): void {
    const geometry = this.geometry;
    if (!geometry) return;
    for (const node of this.nodes) {
      const lane = laneFor(geometry, node.category);
      if (node.fx != null) node.fx = clampToLane(node.fx, lane, node.radius);
      if (node.fy != null) node.fy = clampToTier(node.fy, node.tier);
      const x = clampToLane(node.x, lane, node.radius);
      if (x !== node.x) {
        node.x = x;
        node.vx = 0;
      }
      const y = clampToTier(node.y, node.tier);
      if (y !== node.y) {
        node.y = y;
        node.vy = 0;
      }
    }
  }

  /** Live node objects — d3 mutates x/y in place, so the renderer reads these
   *  directly each frame. Do not reorder or splice the returned array. */
  getNodes(): readonly LayoutNode<TNode>[] {
    return this.nodes;
  }

  getLinks(): readonly LayoutLink<TNode>[] {
    return this.links;
  }

  getNode(id: string): LayoutNode<TNode> | undefined {
    return this.byId.get(id);
  }

  /** The lane geometry this layout is actually clamping to, or null for a flat
   *  graph. Exposed so a renderer can draw the lane CHROME from the very same
   *  numbers the simulation obeys — recomputing computeLanes() in the component
   *  would let the drawn regions drift from the enforced ones. Read-only. */
  getGeometry(): TieredGeometry | null {
    return this.geometry;
  }

  /** Advance the simulation. Call once per frame from the component's rAF.
   *  Stepping one integration at a time is identical to d3's own multi-tick
   *  loop, and it is what lets the structural clamp run after EACH of them. */
  tick(iterations = 1): void {
    if (!this.simulation || this.nodes.length === 0) return;
    for (let i = 0; i < iterations; i++) {
      this.simulation.tick(1);
      this.clampToStructure();
    }
    this.emit();
  }

  /**
   * Run synchronously to rest — the reduced-motion path and the one tests use.
   * Notifies onTick listeners ONCE at the end rather than per tick. Returns the
   * number of ticks actually run.
   */
  tickUntilSettled(maxTicks: number = MAX_SETTLE_TICKS): number {
    if (!this.simulation || this.nodes.length === 0) return 0;
    let ticks = 0;
    while (ticks < maxTicks && !this.isSettled()) {
      this.simulation.tick(1);
      this.clampToStructure();
      ticks++;
    }
    this.emit();
    return ticks;
  }

  /** Subscribe to tick notifications. Returns an unsubscribe function. */
  onTick(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Freeze where it stands. Alpha is zeroed so isSettled() reports true and the
   * component's frame loop exits; residual velocities are zeroed too, because
   * d3 keeps integrating velocity even at alpha 0 — without this a stray tick
   * after stop() would still drift. Listeners are kept for a later reheat.
   */
  stop(): void {
    if (!this.simulation) return;
    this.simulation.stop();
    this.simulation.alpha(0);
    for (const node of this.nodes) {
      node.vx = 0;
      node.vy = 0;
    }
    // Freezing must freeze somewhere legal, even if the caller stops mid-drag.
    this.clampToStructure();
  }

  /**
   * Warm the simulation back up — for drag and for newly arrived memories.
   * Raises alpha (never lowers it) and gives each named node a deterministic
   * velocity impulse so the change is felt locally, not just globally. Unknown
   * ids are ignored.
   */
  reheat(nodeIds: readonly string[] = [], alpha: number = DEFAULT_REHEAT_ALPHA): void {
    if (!this.simulation || this.nodes.length === 0) return;
    const target = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : DEFAULT_REHEAT_ALPHA;
    if (target > this.simulation.alpha()) this.simulation.alpha(target);

    for (const id of nodeIds) {
      const node = this.byId.get(id);
      if (!node) continue;
      const angle = (((hash32(id) >>> 8) % 3600) / 3600) * TAU;
      node.vx += Math.cos(angle) * REHEAT_IMPULSE;
      node.vy += Math.sin(angle) * REHEAT_IMPULSE;
    }
    // A drag ends as "clear fx/fy, then reheat" — so this is the moment a
    // released node is guaranteed lane-legal even if no tick follows.
    this.clampToStructure();
  }

  /** True when there is nothing left to animate. An empty graph is settled by
   *  definition, so callers never spin on it. */
  isSettled(): boolean {
    if (!this.simulation || this.nodes.length === 0) return true;
    return this.simulation.alpha() < this.simulation.alphaMin();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
