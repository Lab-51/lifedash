// === FILE PURPOSE ===
// The twin's MEMORY GRAPH canvas (TWIN-GRAPH.1 Task 3) — an Obsidian-style
// force-directed view of entities, their facts, the twin's own memory ledger and
// the sessions those came from.
//
// NOT CURRENTLY MOUNTED ANYWHERE. It was briefly wired into BrainTabPanel (the
// session/project Brain tab); that was the wrong surface and has been reverted —
// the Brain tab is BrainMindMap's tidy tree again. This component is retained,
// self-contained and fully tested, awaiting its real host: TwinPage's Memory tab.
// BrainMindMap is likewise untouched and must not be edited.
//
// Pure SVG (no canvas2d at these node counts). Layout comes from Task 2's
// ForceLayout; radius/glow/score are READ OFF each LayoutNode and never
// re-derived here — prominence.ts is the single source of truth.
//
// MOTION — "simulate-then-freeze". This is the phase's headline constraint:
//   * The component owns ONE rAF loop. It runs only while the simulation is hot
//     (`!isSettled()`) or a drag is in progress, and then STOPS. At idle there
//     are ZERO pending frames and zero intervals (BrainMemoryGraph.test.tsx's
//     settle-discipline test proves it) — a permanent render loop would compete
//     with Whisper and the local LLM for the same GPU.
//   * While hot, positions are painted IMPERATIVELY (one setAttribute per node/
//     edge) instead of re-rendering React 60x/second; React's own render is
//     driven once, on settle, off the same live node objects — so what React
//     writes then already matches what the DOM shows.
//   * prefers-reduced-motion runs `tickUntilSettled()` synchronously and renders
//     the finished layout with NO animation and NO rAF at all. Accessibility
//     affordance, not an optimisation.
//
// LIVE GROWTH — "watching it learn" (TWIN-GRAPH.1 Task 4). memoryGraphStore's
// refresh diff hands this component the set of ENTERING node ids. Each one is
// moved to its strongest existing neighbour's position BEFORE the first tick (a
// brand-new node would otherwise start at its id-hash seed, i.e. anywhere), the
// layout is reheated around them so the graph visibly makes room, and a one-shot
// `brain-node-enter` blooms the node in. Then it re-freezes: this is the second
// of the two sanctioned animation triggers, not an exception to simulate-then-
// freeze. Under reduced motion the newcomers simply appear, already at rest.
//
// PLUMBING REUSE: the d3-zoom wiring, the fit-to-view math, the pinned-card
// anchoring and `usePrefersReducedMotion` are lifted from BrainMindMap (proven
// here; copying beats reinventing). One deliberate improvement: the zoom
// behaviour is given an explicit `.extent()`, because d3-zoom's default extent
// reads `svg.viewBox.baseVal`, which jsdom does not implement — that is exactly
// why BrainMindMap's own fit is untestable, and this one is testable.
//
// === DEPENDENCIES ===
// react, d3-zoom + d3-selection (pan/zoom), forceLayout + prominence (Task 2),
// memoryGraphStore, graphVisuals, GraphPinnedCard, shared brain types

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { useMemoryGraphStore, NO_ENTERING_NODES } from '../../stores/memoryGraphStore';
import { ForceLayout, seedPosition, type LayoutLink, type LayoutNode } from './forceLayout';
import {
  GLOW_HALO_PX,
  GLOW_OPACITY,
  GRAPH_TYPE_COLOR,
  GRAPH_TYPE_LABEL,
  LABEL_ZOOM_THRESHOLD,
  curvedEdgePath,
  truncateLabel,
} from './graphVisuals';
import GraphPinnedCardLayer from './GraphPinnedCard';
import type { BrainGraphNode } from '../../../shared/types';

const FALLBACK_W = 900;
const FALLBACK_H = 600;
const SCALE_EXTENT: [number, number] = [0.2, 2.5];
/** Fraction of the viewport the fitted content fills (a little breathing room). */
const FIT_FILL = 0.9;
/** Opacity a node/edge fades to when another node is hovered (Obsidian's tell). */
const FADED_CLASS = 'opacity-15';
/** How far a newly-arrived node spawns from its anchor neighbour. Small enough to
 *  read as "out of that memory", big enough that forceCollide has a direction to
 *  push in (two nodes at the identical pixel get d3's RANDOM jiggle instead). */
const SPAWN_OFFSET_PX = 12;
/** One-shot entrance for a newly-arrived node. `fill-box` origin so it scales
 *  about the node's own centre — SVG's default transform-box is the view-box,
 *  which would fling it across the canvas. Applied to an INNER <g>, because the
 *  outer one carries the positioning `transform` ATTRIBUTE that a CSS transform
 *  would override. Reuses globals.css's existing brain-node-enter keyframes. */
const NODE_ENTRANCE_STYLE: React.CSSProperties = {
  animation: 'brain-node-enter 300ms ease-out',
  transformBox: 'fill-box',
  transformOrigin: 'center',
};
/** Matching one-shot for an edge that arrived with it — opacity only, so there is
 *  no transform to conflict with the path geometry. */
const EDGE_ENTRANCE_STYLE: React.CSSProperties = { animation: 'brain-link-enter 300ms ease-out' };

const FIT_BUTTON_CLASS =
  'absolute top-3 right-3 z-10 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[var(--color-accent-subtle)] border border-[var(--color-border-accent)] text-[var(--color-accent)] hover:border-[var(--color-accent-dim)]';

/** Read the OS reduced-motion preference reactively; guards jsdom/no-matchMedia.
 *  (Same implementation BrainMindMap uses — reused by copy, since that file is
 *  frozen retained code and cannot export it.) */
function readReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(readReducedMotion);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (): void => setReduced(mq.matches);
    handler();
    mq.addEventListener?.('change', handler);
    return () => mq.removeEventListener?.('change', handler);
  }, []);
  return reduced;
}

interface GraphView {
  nodes: readonly LayoutNode[];
  links: readonly LayoutLink[];
}

/** Stable per-edge key. The index disambiguates the (rare) repeated endpoint pair,
 *  and is safe because the rendered list and the paint loop walk THE SAME array in
 *  the same order (`layout.getLinks()`). */
function edgeKeyFor(link: LayoutLink, index: number): string {
  return `${index}:${link.source.id}>${link.target.id}`;
}

/** Deterministic direction to nudge a spawning node in, so two facts arriving on
 *  the same entity don't land on the same pixel. Reuses forceLayout's own seeding
 *  hash rather than adding a second one (and never Math.random — tests must not
 *  flake). */
function spawnOffset(id: string): { x: number; y: number } {
  const seed = seedPosition(id);
  const length = Math.hypot(seed.x, seed.y) || 1;
  return { x: (seed.x / length) * SPAWN_OFFSET_PX, y: (seed.y / length) * SPAWN_OFFSET_PX };
}

/**
 * Move each newly-arrived node to its STRONGEST existing neighbour's position,
 * before the first tick. `start()` seeds genuinely new nodes from their id hash,
 * which is anywhere on a 600px disc; without this a fact learned about Ada would
 * fly in from the far side of the canvas instead of blooming out of her.
 *
 * "Strongest" = the highest prominence score among neighbours that are NOT
 * themselves entering (a newcomer is no anchor). An orphan newcomer keeps its
 * deterministic seed, and a pinned node is never moved out from under the user.
 */
function seedEnteringNodes(layout: ForceLayout, entering: ReadonlySet<string>): void {
  const links = layout.getLinks();
  for (const id of entering) {
    const node = layout.getNode(id);
    if (!node || node.fx != null) continue;
    let anchor: LayoutNode | null = null;
    for (const link of links) {
      const other = link.source.id === id ? link.target : link.target.id === id ? link.source : null;
      if (!other || entering.has(other.id)) continue;
      if (!anchor || other.score > anchor.score) anchor = other;
    }
    if (!anchor) continue;
    const offset = spawnOffset(id);
    node.x = anchor.x + offset.x;
    node.y = anchor.y + offset.y;
    node.vx = 0;
    node.vy = 0;
  }
}

/** Enter/Space -> activate, matching native button semantics for SVG controls. */
function onButtonKey(handler: () => void) {
  return (event: React.KeyboardEvent): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handler();
    }
  };
}

export interface BrainMemoryGraphProps {
  /** Scope bucket to render (see memoryGraphStore.graphScopeKeyFor). */
  scopeKey: string;
  /** Fired when an INSPECTABLE node is activated (click / Enter / Space). The
   *  host decides what to show; the graph only reports the node. */
  onInspect?: (node: BrainGraphNode) => void;
  /** The currently pinned node id — stays highlighted while the inspector is open. */
  pinnedId?: string | null;
  /** Inspector CONTENT for the pinned node. This component owns POSITIONING (an
   *  anchored card popped out of the node); the caller owns what's inside. */
  pinnedPanel?: React.ReactNode;
}

export default function BrainMemoryGraph({ scopeKey, onInspect, pinnedId, pinnedPanel }: BrainMemoryGraphProps) {
  const graph = useMemoryGraphStore((s) => s.scopes[scopeKey]?.graph ?? null);
  // Node ids that arrived in the last live refresh. NO_ENTERING_NODES is a shared
  // module constant, so this selector returns a STABLE reference and can never
  // spin the subscription.
  const entering = useMemoryGraphStore((s) => s.scopes[scopeKey]?.entering ?? NO_ENTERING_NODES);
  const reducedMotion = usePrefersReducedMotion();

  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const layoutRef = useRef<ForceLayout | null>(null);
  const nodeElsRef = useRef(new Map<string, SVGGElement>());
  const edgeElsRef = useRef(new Map<string, SVGPathElement>());
  const dragIdRef = useRef<string | null>(null);
  const dragMovedRef = useRef(false);
  /** True once the user has panned/zoomed themselves — auto-fit then stops
   *  touching their framing (d3 leaves `sourceEvent` null for our own transforms). */
  const userFramedRef = useRef(false);

  const [zoomTransform, setZoomTransform] = useState<ZoomTransform>(zoomIdentity);
  const [view, setView] = useState<GraphView | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [settled, setSettled] = useState(true);

  // --- The layout controller: one instance for the component's whole life, so a
  // refresh CARRIES OVER surviving nodes' positions instead of teleporting them.
  useEffect(() => {
    const layout = new ForceLayout();
    layoutRef.current = layout;
    return () => {
      layout.stop();
      layoutRef.current = null;
    };
  }, []);

  // --- d3-zoom, attached once. Pan/zoom updates transform state (event-driven,
  // no rAF). The explicit extent avoids d3's viewBox-reading default.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent(SCALE_EXTENT)
      .extent((): [[number, number], [number, number]] => [
        [0, 0],
        [svg.clientWidth || FALLBACK_W, svg.clientHeight || FALLBACK_H],
      ])
      .on('zoom', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        if (event.sourceEvent) userFramedRef.current = true;
        setZoomTransform(event.transform);
      });
    zoomRef.current = behavior;
    const selection = select(svg);
    selection.call(behavior);
    return () => {
      selection.on('.zoom', null);
      zoomRef.current = null;
    };
  }, []);

  /** Frame the whole graph. Reads live node positions, so it is correct both
   *  before the first tick and after settling. */
  const handleFit = useCallback(() => {
    const svg = svgRef.current;
    const behavior = zoomRef.current;
    const layout = layoutRef.current;
    if (!svg || !behavior || !layout) return;
    const nodes = layout.getNodes();
    if (nodes.length === 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      const pad = node.radius + GLOW_HALO_PX[node.glow];
      minX = Math.min(minX, node.x - pad);
      minY = Math.min(minY, node.y - pad);
      maxX = Math.max(maxX, node.x + pad);
      maxY = Math.max(maxY, node.y + pad);
    }
    const viewW = svg.clientWidth || FALLBACK_W;
    const viewH = svg.clientHeight || FALLBACK_H;
    const contentW = maxX - minX || 1;
    const contentH = maxY - minY || 1;
    const k = Math.min(
      SCALE_EXTENT[1],
      Math.max(SCALE_EXTENT[0], FIT_FILL * Math.min(viewW / contentW, viewH / contentH)),
    );
    const tx = (viewW - contentW * k) / 2 - minX * k;
    const ty = (viewH - contentH * k) / 2 - minY * k;
    select(svg).call(behavior.transform, zoomIdentity.translate(tx, ty).scale(k));
  }, []);

  /** Auto-fit unless the user has framed the view themselves. */
  const autoFit = useCallback(() => {
    if (!userFramedRef.current) handleFit();
  }, [handleFit]);

  /** Write the live simulation positions straight to the DOM — the hot path. */
  const paint = useCallback(() => {
    const layout = layoutRef.current;
    if (!layout) return;
    for (const node of layout.getNodes()) {
      nodeElsRef.current.get(node.id)?.setAttribute('transform', `translate(${node.x},${node.y})`);
    }
    const links = layout.getLinks();
    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      const el = edgeElsRef.current.get(edgeKeyFor(link, i));
      el?.setAttribute('d', curvedEdgePath(link.source.x, link.source.y, link.target.x, link.target.y));
    }
  }, []);

  // --- A new SCOPE is a new picture, so auto-fit gets to frame it again. A live
  // REFRESH deliberately does not reset this: yanking the view back to a fit
  // every time a fact arrives would fight the user for control of the canvas.
  useEffect(() => {
    userFramedRef.current = false;
  }, [scopeKey]);

  // --- (Re)build the layout whenever the graph payload changes. Under reduced
  // motion it is run to rest RIGHT HERE, so the first paint is the final one —
  // newly-arrived nodes then simply appear, with no bloom and no frame.
  useEffect(() => {
    const layout = layoutRef.current;
    if (!layout) return;
    if (!graph) {
      setView(null);
      return;
    }
    layout.start(graph.nodes, graph.edges);
    if (entering.size > 0) seedEnteringNodes(layout, entering);
    if (reducedMotion) {
      layout.tickUntilSettled();
      layout.stop();
    } else if (entering.size > 0) {
      // Make room LOCALLY around what just arrived, then let the shared frame
      // loop run it back down to rest and freeze — never a permanent loop.
      layout.reheat([...entering]);
    }
    nodeElsRef.current.clear();
    edgeElsRef.current.clear();
    setView({ nodes: layout.getNodes(), links: layout.getLinks() });
    setSettled(reducedMotion);
  }, [graph, entering, reducedMotion]);

  // --- Cache the rendered elements once per structure change, so the frame loop
  // never touches the DOM query path. Declared BEFORE the loop effect so the map
  // is populated by the time the first frame runs.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !view) return;
    const nodeEls = nodeElsRef.current;
    const edgeEls = edgeElsRef.current;
    nodeEls.clear();
    edgeEls.clear();
    for (const el of svg.querySelectorAll<SVGGElement>('[data-node-id]')) {
      const id = el.getAttribute('data-node-id');
      if (id) nodeEls.set(id, el);
    }
    for (const el of svg.querySelectorAll<SVGPathElement>('[data-edge-key]')) {
      const key = el.getAttribute('data-edge-key');
      if (key) edgeEls.set(key, el);
    }
    autoFit(); // initial framing; re-fitted once the layout settles
  }, [view, autoFit]);

  // --- THE frame loop. Runs only while hot; the moment the simulation settles it
  // freezes the layout, hands the final positions to React in a SINGLE setState,
  // and schedules nothing further. `settled` in the deps is also how a drag
  // restarts it (drag sets settled=false).
  useEffect(() => {
    if (!view || reducedMotion || settled) return;
    const layout = layoutRef.current;
    if (!layout) return;

    let frame = requestAnimationFrame(function step() {
      layout.tick();
      paint();
      if (!layout.isSettled() || dragIdRef.current !== null) {
        frame = requestAnimationFrame(step);
        return;
      }
      layout.stop(); // freeze means freeze: alpha AND velocities zeroed
      autoFit();
      setSettled(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [view, reducedMotion, settled, paint, autoFit]);

  // --- Hover: the hovered node plus its direct neighbours stay lit, everything
  // else fades. Pure set arithmetic over the existing links — no re-simulation.
  const litIds = useMemo(() => {
    if (!hoveredId || !view) return null;
    const lit = new Set<string>([hoveredId]);
    for (const link of view.links) {
      if (link.source.id === hoveredId) lit.add(link.target.id);
      else if (link.target.id === hoveredId) lit.add(link.source.id);
    }
    return lit;
  }, [hoveredId, view]);

  function handlePointerDown(event: React.PointerEvent<SVGGElement>, node: LayoutNode): void {
    const layout = layoutRef.current;
    if (!layout) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragIdRef.current = node.id;
    dragMovedRef.current = false;
    node.fx = node.x; // pin where it stands — d3's drag idiom, there is no pin API
    node.fy = node.y;
    layout.reheat([node.id]);
    setSettled(false); // wakes the frame loop
  }

  function handlePointerMove(event: React.PointerEvent<SVGGElement>, node: LayoutNode): void {
    if (dragIdRef.current !== node.id) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const [x, y] = zoomTransform.invert([event.clientX - rect.left, event.clientY - rect.top]);
    node.fx = x;
    node.fy = y;
    dragMovedRef.current = true;
  }

  function handlePointerUp(event: React.PointerEvent<SVGGElement>, node: LayoutNode): void {
    if (dragIdRef.current !== node.id) return;
    dragIdRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    node.fx = null; // release the pin
    node.fy = null;
    layoutRef.current?.reheat([node.id]);
    setSettled(false);
  }

  function handleActivate(node: LayoutNode): void {
    if (dragMovedRef.current) {
      dragMovedRef.current = false; // a drag that ended on this node is not a click
      return;
    }
    onInspect?.(node);
  }

  const showLabels = zoomTransform.k >= LABEL_ZOOM_THRESHOLD;
  const fadeClass = reducedMotion ? '' : 'transition-opacity duration-150';
  const droppedCount = graph?.droppedCount ?? 0;
  const hasNodes = (view?.nodes.length ?? 0) > 0;

  return (
    <div
      data-testid="brain-memory-graph"
      data-reduced-motion={reducedMotion}
      data-settled={settled}
      className="relative flex-1 min-h-0 overflow-hidden"
    >
      {hasNodes && (
        <button type="button" onClick={handleFit} className={FIT_BUTTON_CLASS}>
          Fit to view
        </button>
      )}

      {/* The <svg> ALWAYS mounts so the d3-zoom attach effect binds on the first
          commit, even while the graph is still loading over IPC (BrainMindMap
          learned this the hard way: the map was un-pannable until a remount). */}
      <svg
        ref={svgRef}
        role="img"
        aria-label="Twin memory graph"
        width="100%"
        height="100%"
        className="block w-full h-full touch-none select-none"
      >
        {view && (
          <g transform={zoomTransform.toString()}>
            <g fill="none">
              {view.links.map((link, index) => (
                <GraphEdge
                  key={edgeKeyFor(link, index)}
                  edgeKey={edgeKeyFor(link, index)}
                  link={link}
                  hoveredId={hoveredId}
                  fadeClass={fadeClass}
                  entering={!reducedMotion && (entering.has(link.source.id) || entering.has(link.target.id))}
                />
              ))}
            </g>
            {view.nodes.map((node) => (
              <GraphNode
                key={node.id}
                node={node}
                faded={litIds != null && !litIds.has(node.id)}
                highlighted={node.id === hoveredId || node.id === pinnedId}
                showLabel={showLabels || node.id === hoveredId || node.id === pinnedId}
                fadeClass={fadeClass}
                entering={entering.has(node.id)}
                animateEntrance={!reducedMotion && entering.has(node.id)}
                onHover={setHoveredId}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onActivate={handleActivate}
              />
            ))}
          </g>
        )}
      </svg>

      <GraphPinnedCardLayer
        pinnedId={pinnedId}
        panel={pinnedPanel}
        nodes={view?.nodes ?? null}
        zoomTransform={zoomTransform}
        svgRef={svgRef}
      />

      {/* Cap honesty: facts dropped by the main-side node cap are NEVER silently
          truncated — they are counted on screen. */}
      {droppedCount > 0 && (
        <div
          data-testid="memory-graph-dropped"
          title="Least-prominent memories beyond the display cap"
          className="absolute bottom-3 left-3 z-10 px-2.5 py-1 rounded-lg text-xs font-medium bg-[var(--color-chrome)] border border-[var(--color-border)] text-[var(--color-text-secondary)] overflow-hidden break-words"
        >
          +{droppedCount} not shown
        </div>
      )}

      {!hasNodes && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--color-text-secondary)]">
          No memories to show yet.
        </div>
      )}
    </div>
  );
}

interface GraphEdgeProps {
  edgeKey: string;
  link: LayoutLink;
  hoveredId: string | null;
  fadeClass: string;
  /** This connector arrived with a newly-learned memory — fade it in once. */
  entering: boolean;
}

/** One curved connector. `d` is written here on every React render AND by the
 *  frame loop's imperative paint while the simulation is hot — both read the same
 *  live node objects, so they can never disagree. */
function GraphEdge({ edgeKey, link, hoveredId, fadeClass, entering }: GraphEdgeProps) {
  const touchesHovered = hoveredId != null && (link.source.id === hoveredId || link.target.id === hoveredId);
  const faded = hoveredId != null && !touchesHovered;
  return (
    <path
      data-edge-key={edgeKey}
      data-kind={link.kind}
      data-faded={faded || undefined}
      style={entering ? EDGE_ENTRANCE_STYLE : undefined}
      d={curvedEdgePath(link.source.x, link.source.y, link.target.x, link.target.y)}
      stroke={touchesHovered ? 'var(--color-accent)' : 'var(--color-border-accent)'}
      strokeWidth={touchesHovered ? 1.6 : 1}
      className={`${faded ? FADED_CLASS : 'opacity-60'} ${fadeClass}`}
    />
  );
}

interface GraphNodeProps {
  node: LayoutNode;
  faded: boolean;
  highlighted: boolean;
  showLabel: boolean;
  fadeClass: string;
  /** This memory arrived in the last live refresh (marked regardless of motion
   *  preference, so the state is observable even when nothing animates). */
  entering: boolean;
  /** Run the one-shot bloom. False under prefers-reduced-motion. */
  animateEntrance: boolean;
  onHover: (id: string | null) => void;
  onPointerDown: (event: React.PointerEvent<SVGGElement>, node: LayoutNode) => void;
  onPointerMove: (event: React.PointerEvent<SVGGElement>, node: LayoutNode) => void;
  onPointerUp: (event: React.PointerEvent<SVGGElement>, node: LayoutNode) => void;
  onActivate: (node: LayoutNode) => void;
}

/** One memory. Radius and glow come straight off the LayoutNode (computed once by
 *  prominence.ts) — nothing here recomputes them. */
function GraphNode({
  node,
  faded,
  highlighted,
  showLabel,
  fadeClass,
  entering,
  animateEntrance,
  onHover,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onActivate,
}: GraphNodeProps) {
  const color = GRAPH_TYPE_COLOR[node.type];
  const halo = GLOW_HALO_PX[node.glow];
  const activate = (): void => onActivate(node);

  return (
    <g
      data-node-id={node.id}
      data-node-type={node.type}
      data-glow={node.glow}
      data-faded={faded || undefined}
      data-entering={entering || undefined}
      role="button"
      tabIndex={0}
      aria-label={`${GRAPH_TYPE_LABEL[node.type]}: ${node.label}`}
      transform={`translate(${node.x},${node.y})`}
      className={`cursor-pointer outline-none ${faded ? FADED_CLASS : 'opacity-100'} ${fadeClass}`}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      onMouseDown={(event) => event.stopPropagation()} // never let a node drag pan the canvas
      onPointerDown={(event) => onPointerDown(event, node)}
      onPointerMove={(event) => onPointerMove(event, node)}
      onPointerUp={(event) => onPointerUp(event, node)}
      onClick={activate}
      onKeyDown={onButtonKey(activate)}
    >
      {/* Inner group carries the entrance animation: the outer one's positioning
          `transform` ATTRIBUTE would be overridden by a CSS transform. */}
      <g style={animateEntrance ? NODE_ENTRANCE_STYLE : undefined}>
        {halo > 0 && <circle r={node.radius + halo} fill={color} opacity={0.12} />}
        <circle
          r={node.radius}
          fill={`color-mix(in srgb, ${color} 55%, var(--color-chrome))`}
          fillOpacity={GLOW_OPACITY[node.glow]}
          stroke={highlighted ? 'var(--color-accent)' : color}
          strokeWidth={highlighted ? 2.5 : 1.25}
        />
        {showLabel && (
          <text
            x={0}
            y={node.radius + 12}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={11}
            fontWeight={500}
            fill="var(--color-text-primary)"
            aria-hidden="true"
            className="pointer-events-none"
          >
            {truncateLabel(node.label)}
          </text>
        )}
      </g>
    </g>
  );
}
