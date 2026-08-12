// === FILE PURPOSE ===
// The twin memory graph's CANVAS (TWIN-GRAPH.2 Task 3) — the tiered, laned view
// of the twin core, its category hubs and every ACTIVE learned fact. Adapted from
// brain-graph/BrainMemoryGraph (which stays in place, unreferenced, per the
// project's code-retention convention): the rAF settle discipline, the d3-zoom
// wiring with an explicit extent, the fit math, the pinned-card anchoring and the
// reduced-motion hook are reused rather than reinvented.
//
// WHAT IS NEW HERE, and why:
//   * LANE CHROME. Tiers and category regions are DRAWN (TwinMemoryLaneChrome),
//     from the layout's own TieredGeometry. "Structured, not Obsidian" is the
//     whole point of the phase; legibility of the structure is the feature.
//   * A lane's floor follows its deepest fact, repainted per frame alongside the
//     nodes, because tier 2 is deliberately open-ended downward.
//   * MIN_SCALE is lower than the entity graph's, because a crowded lane can grow
//     arbitrarily tall (Task 2 caveat #1) and "Fit to view" must still frame it
//     rather than clamp short of it.
//
// >>> PROGRESSIVE DISCLOSURE (TWIN-READ.1 Task 2) — the readability fix. <<<
// The graph OPENS COLLAPSED: the twin core and one hub per populated category,
// nothing else. A collapsed lane's facts are not hidden with CSS — they are not
// in the graph handed to the simulation at all, so the settled layout is
// dramatically smaller and one screen holds ~5 labels instead of ~600.
// Readability stops depending on zoom-threshold tuning; it is bounded by
// construction.
//
//   * MULTIPLE LANES MAY BE OPEN AT ONCE. Decision, and the reasoning: lanes are
//     spatially separate regions, so two open lanes never overlap or compete for
//     the same pixels — this is navigation ("show me People and Preferences"),
//     not an accordion where a second panel would push the first off screen.
//     Auto-collapsing the previous lane would also silently undo a choice the
//     user made, which is the behaviour an accordion is criticised for.
//   * THE HUB IS THE DISCLOSURE CONTROL. It is a real `role="button"` with
//     `aria-expanded`, and its accessible name states the lane's fact count, so
//     a screen-reader user knows what opening it will reveal. Activating it
//     toggles its lane; it no longer opens the inspector, because one control
//     doing two unrelated things is what makes aria-expanded a lie. FACT nodes
//     and the twin core are UNCHANGED — a fact click still opens
//     TwinMemoryInspector with provenance and forget exactly as before.
//   * KEYBOARD PARITY IS THE POINT, not a courtesy: the hubs sit in tab order
//     before the facts, so Tab -> Enter on a hub, then Tab, walks straight into
//     the facts it just revealed. Nothing about disclosure is pointer-only.
//   * EXPANSION ANIMATES FOR FREE, then re-freezes. A revealed fact has no
//     carried-over position, so ForceLayout seeds it at its hub (the same
//     deterministic hub-spawn TWIN-GRAPH.2 Task 4 built for live growth) and the
//     shared frame loop runs it out into the lane and stops. Under reduced
//     motion the rebuild is ticked to rest synchronously — settled layout,
//     rendered once, no frames at all.
//   * The lane's fact COUNT is drawn by the lane chrome heading and is fed from
//     the FULL payload, never from the simulated nodes — a collapsed lane must
//     still say how much it holds (and Task 5 needs that count able to bump when
//     a fact arrives in a lane that is closed).
//
// >>> LABELS (TWIN-READ.1 Task 3) — the other half of the readability fix. <<<
// A node wears its SHORT stored label at rest and reveals its FULL text when
// hovered, keyboard-focused or inspected; both are wrapped `<tspan>` lines with
// a native `paint-order: stroke` halo so a caption survives crossing a
// connection. The rendering itself lives in TwinMemoryNodeLabel, whose header
// carries the foreignObject-vs-tspan spike evidence.
//
//   * THE ZOOM GATE IS GONE. `LABEL_ZOOM_THRESHOLD` hid every fact label below
//     0.75 and took the hub names with it — a knob standing in for a design.
//     Visibility is now DISCLOSURE-aware (see isLabelVisible): structure is
//     captioned at every zoom, a fact is captioned when its lane is open. The
//     constant stays exported for BrainMemoryGraph, which still uses it.
//   * FOCUS IS A FIRST-CLASS REVEAL. `focusedId` is tracked separately from
//     `hoveredId` so Tab reveals a node's full text without also dimming the
//     rest of the canvas on every keypress.
//   * NO MOTION WAS ADDED. The rest -> full swap is instant, so there is nothing
//     for prefers-reduced-motion to switch off and nothing new scheduled.
//
// >>> TASK 2 CAVEAT #2 — RESIZE. Decision: the layout is NOT re-laned on resize.
// `viewportWidth` is read once, when the layout is built. A resize instead
// re-runs AUTO-FIT (ResizeObserver -> handleFit, event-driven, no rAF, no
// re-simulation). Reasons, in order: re-laning means calling start() again, which
// reheats the whole graph and slides every lane sideways under the user's cursor
// — during a drag-resize that is a force simulation restarted per frame, exactly
// the CPU cost this phase exists to avoid; MIN_LANE_WIDTH already means the
// layout is routinely wider than the viewport by design, so pan/zoom is the
// intended framing mechanism, not a fallback; and it makes the tab's
// always-mounted-while-hidden case correct for free (the first real size arrives
// as a resize, and the graph frames itself then). <<<
//
// >>> THE SYNAPTIC VISUAL LANGUAGE (TWIN-READ.1 Task 4). <<<
// The canvas COMPOSES it and owns its gates; none of the geometry lives here
// (synapticVisuals.ts, TwinMemoryDendrite.tsx, TwinMemorySoma.tsx). What this
// file owns is the wiring the visuals cannot own themselves:
//   * THE SURFACE, theme-adaptive since TWIN-LIGHT.1 — one class that
//     re-pins the palette (one value set per theme, in globals.css) for
//     this subtree, so nothing below needs a theme branch.
//   * THE PER-FRAME PAINT of the dendrite ribbons AND their terminal dots. The
//     terminal is a second element per edge, so it joins the same hot loop
//     rather than being left to lag a whole settle behind its ribbon.
//   * THE ACTIVATION PULSE, one-shot and INTERACTION-TRIGGERED: touching a node
//     mounts a travelling highlight on its connections and a single timeout
//     removes it. The timeout is why it cannot outlive its animation — an
//     animation class that stuck would be a permanent GPU tenant, which is the
//     one thing this canvas must never leave behind.
//   * THE CORE SHIMMER'S GATE. It is the phase's ONE sanctioned idle animation
//     and it is granted only while the Memory tab is on screen (`active`) AND
//     the window is visible (Page Visibility API) AND the user has not asked for
//     reduced motion. Note the trap this answers: a CSS animation schedules
//     neither rAF nor setInterval, so the settle-discipline test below CANNOT
//     see it — the test that proves it stops when hidden is a separate,
//     explicit one, because otherwise the supersession would be silent.
//
// >>> LIVE GROWTH UNDER DISCLOSURE (TWIN-READ.1 Task 5). <<<
// Task 2's disclosure filters an arriving fact clean out of the DOM when its
// lane is shut — the "watching it learn" moment silently disappears. This
// restores it AT THE HUB, and does so by REUSING Task 4's activation pulse
// verbatim (triggerPulse, DENDRITE_PULSE_MS, the same setTimeout clearing) —
// there is no second animation mechanism and no second timing constant. A
// dedicated effect below diffs the FULL `entering` set (not the filtered
// `visible` one) against `expandedLanes`: the first entering fact whose lane
// is currently shut fires triggerPulse(hubId), which lands on the ONE
// connection a collapsed hub still draws (twin -> hub) exactly as a touch
// would. The count itself needs no new code — laneCounts already reads the
// FULL payload (Task 2), so it bumps on its own.
//   * Deliberately keyed on [entering, graph] ONLY, never on `expandedLanes`:
//     reading expandedLanes inside the effect (rather than depending on it)
//     means toggling an UNRELATED lane later cannot replay a stale pulse for
//     a batch that already landed and finished animating.
//   * NEVER auto-expands — the effect only ever calls triggerPulse, never
//     onToggleLane. An arrival must not yank the view out from under a user
//     reading something else.
//   * An EXPANDED lane needs nothing extra here: its arriving fact is already
//     inside `visible.nodes`, so the rebuild effect above blooms it in via the
//     ordinary hub-spawn + reheat + brain-node-enter path, unchanged.
//
// MOTION — "simulate-then-freeze", unchanged from the adapted original: one rAF
// loop, running only while the simulation is hot or a drag is in progress, then
// stopping dead. prefers-reduced-motion runs tickUntilSettled() synchronously and
// renders the finished layout with NO animation and NO rAF at all — and now also
// suppresses the shimmer and the pulse outright, not merely their keyframes.
//
// === DEPENDENCIES ===
// react, d3-zoom + d3-selection, forceLayout + prominence + graphVisuals +
// GraphPinnedCard (brain-graph, reused), TwinMemoryLaneChrome, TwinMemoryDendrite,
// TwinMemorySoma, synapticVisuals, useDocumentVisible, shared twin types

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { ForceLayout, type LayoutLink, type LayoutNode } from '../brain-graph/forceLayout';
import { GLOW_HALO_PX, TWIN_GRAPH_TYPE_LABEL, laneHeading } from '../brain-graph/graphVisuals';
import type { TieredGeometry } from '../brain-graph/tieredLayout';
import GraphPinnedCardLayer from '../brain-graph/GraphPinnedCard';
import { useDocumentVisible } from '../../hooks/useDocumentVisible';
import TwinMemoryLaneChrome, { laneBottomsOf, laneHeightFor } from './TwinMemoryLaneChrome';
import TwinMemoryNodeLabel, { fullTextOf } from './TwinMemoryNodeLabel';
import TwinMemoryDendrite, { TwinMemoryDendriteDefs } from './TwinMemoryDendrite';
import TwinMemorySoma from './TwinMemorySoma';
import {
  DENDRITE_PULSE_MS,
  FADED_CLASS,
  GRAPH_SURFACE_CLASS,
  SOMA_OUTER_RING_PX,
  dendriteRibbonPath,
  terminalPointOf,
} from './synapticVisuals';
import type { TwinGraphEdge, TwinGraphNode, TwinMemoryGraph } from '../../../shared/types';

export type TwinLayoutNode = LayoutNode<TwinGraphNode>;
type TwinLayoutLink = LayoutLink<TwinGraphNode>;

const FALLBACK_W = 900;
const FALLBACK_H = 600;
/** A crowded lane grows arbitrarily far downward (tier 2 has no floor), so the
 *  zoom-out end has to reach further than the entity graph's 0.2. */
const SCALE_EXTENT: [number, number] = [0.06, 2.5];
/** Fraction of the viewport the fitted content fills (a little breathing room). */
const FIT_FILL = 0.9;
/** One-shot entrance for a newly-learned fact. `fill-box` origin so it scales
 *  about the node's own centre, applied to an INNER <g> because the outer one
 *  carries the positioning `transform` ATTRIBUTE a CSS transform would override.
 *  Reuses globals.css's existing brain-node-enter keyframes. */
const NODE_ENTRANCE_STYLE: React.CSSProperties = {
  animation: 'brain-node-enter 300ms ease-out',
  transformBox: 'fill-box',
  transformOrigin: 'center',
};
/** Shared empty node list for "no layout yet" — a module const, so the pinned-card
 *  layer and the lane chrome get a STABLE reference instead of a new array per
 *  render. */
const NO_NODES: readonly TwinLayoutNode[] = [];

const FIT_BUTTON_CLASS =
  'absolute top-3 right-3 z-10 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[var(--color-accent-subtle)] border border-[var(--color-border-accent)] text-[var(--color-accent)] hover:border-[var(--color-accent-dim)]';

/** Read the OS reduced-motion preference reactively; guards jsdom/no-matchMedia. */
function readReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * All three gates on the phase's ONE sanctioned idle animation, in one place:
 * the Memory tab is on screen, the window is visible, and the user has not asked
 * for reduced motion. Any one of them false and the shimmer class is simply not
 * rendered — not merely paused, because a class that survives its gate is a
 * permanent GPU tenant and nothing in the settle-discipline test can see it.
 */
function useCoreShimmerAllowed(active: boolean, reducedMotion: boolean): boolean {
  const documentVisible = useDocumentVisible();
  return active && documentVisible && !reducedMotion;
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
  nodes: readonly TwinLayoutNode[];
  links: readonly TwinLayoutLink[];
  geometry: TieredGeometry | null;
}

/** Stable per-edge key. The index disambiguates a repeated endpoint pair and is
 *  safe because the rendered list and the paint loop walk THE SAME array. */
function edgeKeyFor(link: TwinLayoutLink, index: number): string {
  return `${index}:${link.source.id}>${link.target.id}`;
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

/** What the simulation is actually given: all structure (the core and every
 *  hub), plus the facts of the OPEN lanes only. A collapsed lane contributes its
 *  hub and nothing more, which is the whole disclosure mechanism — the facts are
 *  absent, not merely invisible.
 *
 *  Edges are passed through WHOLE on purpose: ForceLayout.start() drops any edge
 *  whose endpoints are missing from the node list (documented there, because
 *  d3's forceLink throws on a dangling id), so filtering them here would be a
 *  second implementation of a rule that already exists. */
function visibleGraphOf(
  graph: TwinMemoryGraph | null,
  expandedLanes: ReadonlySet<string>,
): { nodes: TwinGraphNode[]; edges: readonly TwinGraphEdge[] } | null {
  if (!graph) return null;
  return {
    nodes: graph.nodes.filter((node) => node.type !== 'fact' || (!!node.category && expandedLanes.has(node.category))),
    edges: graph.edges,
  };
}

/** True for a node that owns a lane — i.e. the disclosure control for it. */
function isLaneHub(node: TwinGraphNode): boolean {
  return node.type === 'category' && !!node.category;
}

export interface TwinMemoryGraphCanvasProps {
  /** The ledger graph, or null while it loads. */
  graph: TwinMemoryGraph | null;
  /** Node ids that arrived in the last refresh (bloom once, then re-freeze). */
  entering: ReadonlySet<string>;
  /** Category lanes currently OPEN. Empty is the default: everything collapsed. */
  expandedLanes: ReadonlySet<string>;
  /** Fired when a lane hub is activated by click or Enter/Space. */
  onToggleLane: (category: string) => void;
  /** Fired when a node is activated. `viaKeyboard` is true for Enter/Space, which
   *  is what lets the host move focus into the inspector — the forget action must
   *  be reachable WITHOUT a pointer. */
  onInspect: (node: TwinGraphNode, viaKeyboard: boolean) => void;
  pinnedId?: string | null;
  /** Inspector CONTENT for the pinned node; this component owns POSITIONING. */
  pinnedPanel?: React.ReactNode;
  /** Whether the Memory tab is the one on screen. The component stays MOUNTED
   *  either way (the tab badge counts from elsewhere), so this is the only thing
   *  that can tell the core shimmer to stop — one of its three gates. */
  active?: boolean;
}

export default function TwinMemoryGraphCanvas({
  graph,
  entering,
  expandedLanes,
  onToggleLane,
  onInspect,
  pinnedId,
  pinnedPanel,
  active = true,
}: TwinMemoryGraphCanvasProps) {
  const reducedMotion = usePrefersReducedMotion();
  /** THE ONE SANCTIONED IDLE ANIMATION — granted only while all three gates hold. */
  const shimmerCore = useCoreShimmerAllowed(active, reducedMotion);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const layoutRef = useRef<ForceLayout<TwinGraphNode> | null>(null);
  const nodeElsRef = useRef(new Map<string, SVGGElement>());
  const edgeElsRef = useRef(new Map<string, SVGPathElement>());
  /** The synaptic terminal dots, cached alongside their ribbons — a terminal
   *  that only moved on React renders would float off its node for a whole
   *  settle. */
  const terminalElsRef = useRef(new Map<string, SVGCircleElement>());
  const laneElsRef = useRef(new Map<string, SVGRectElement>());
  const dragIdRef = useRef<string | null>(null);
  const dragMovedRef = useRef(false);
  /** True once the user has panned/zoomed themselves — auto-fit then stops
   *  touching their framing (d3 leaves `sourceEvent` null for our own transforms). */
  const userFramedRef = useRef(false);

  const [zoomTransform, setZoomTransform] = useState<ZoomTransform>(zoomIdentity);
  const [view, setView] = useState<GraphView | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  /** Kept SEPARATE from hoveredId on purpose: keyboard focus must reveal a node's
   *  full text (pointer parity — TWIN-READ.1 Task 3), but it must not also dim
   *  the rest of the graph the way a deliberate hover does, or every Tab press
   *  would strobe the whole canvas. */
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [settled, setSettled] = useState(true);
  /** The node whose connections are currently carrying an activation pulse, plus
   *  a sequence number: a CSS animation only replays when its element is
   *  remounted, so re-touching the SAME node has to change something React can
   *  see. Null between pulses, which is what keeps idle free. */
  const [pulse, setPulse] = useState<{ id: string; seq: number } | null>(null);
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseSeqRef = useRef(0);

  // --- The layout controller: one instance for the component's whole life, so a
  // refresh CARRIES OVER surviving nodes' positions instead of teleporting them.
  // viewportWidth is read here, once (see the resize decision in the header).
  useEffect(() => {
    const layout = new ForceLayout<TwinGraphNode>({ viewportWidth: svgRef.current?.clientWidth || undefined });
    layoutRef.current = layout;
    return () => {
      layout.stop();
      layoutRef.current = null;
    };
  }, []);

  // --- d3-zoom, attached once. Pan/zoom updates transform state (event-driven,
  // no rAF). The explicit extent avoids d3's viewBox-reading default, which jsdom
  // does not implement.
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

  /** Frame the whole graph, chrome included. Reads live node positions, so it is
   *  correct both before the first tick and after settling. */
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
      // The soma's outer ring reaches past the prominence halo, so framing has
      // to include it or "Fit to view" crops every node's bloom.
      const pad = node.radius + GLOW_HALO_PX[node.glow] + SOMA_OUTER_RING_PX;
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

  /** Write the live simulation positions straight to the DOM — the hot path.
   *  Lane regions are repainted with the nodes so a growing lane's floor stays
   *  glued to its deepest fact instead of lagging a whole settle behind. */
  const paint = useCallback(() => {
    const layout = layoutRef.current;
    if (!layout) return;
    const nodes = layout.getNodes();
    for (const node of nodes) {
      nodeElsRef.current.get(node.id)?.setAttribute('transform', `translate(${node.x},${node.y})`);
    }
    const links = layout.getLinks();
    for (let i = 0; i < links.length; i++) {
      const { source, target } = links[i];
      const key = edgeKeyFor(links[i], i);
      edgeElsRef.current.get(key)?.setAttribute('d', dendriteRibbonPath(source.x, source.y, target.x, target.y));
      // The terminal rides its ribbon: same live objects, same frame.
      const terminal = terminalElsRef.current.get(key);
      if (terminal) {
        const point = terminalPointOf(source.x, source.y, target.x, target.y, target.radius);
        terminal.setAttribute('cx', String(point.x));
        terminal.setAttribute('cy', String(point.y));
      }
    }
    if (laneElsRef.current.size === 0) return;
    const bottoms = laneBottomsOf(nodes);
    for (const [key, el] of laneElsRef.current) {
      el.setAttribute('height', String(laneHeightFor(bottoms.get(key))));
    }
  }, []);

  /** The graph minus every collapsed lane's facts — what the simulation sees. */
  const visible = useMemo(() => visibleGraphOf(graph, expandedLanes), [graph, expandedLanes]);

  // --- (Re)build the layout whenever the VISIBLE graph changes — a new payload
  // and a lane opening are the same event to the simulation. Under reduced
  // motion it is run to rest RIGHT HERE, so the first paint is the final one.
  useEffect(() => {
    const layout = layoutRef.current;
    if (!layout) return;
    if (!visible) {
      setView(null);
      return;
    }
    // Ids the layout held BEFORE this rebuild. What is new afterwards is either
    // a freshly-learned fact or a fact just revealed by opening its lane, and
    // both want the same thing: a LANE-LOCAL reheat around the arrival. Empty on
    // the very first build, where reheating everything would be meaningless
    // (start() already sets alpha to 1) and would perturb the seeded layout.
    const before = new Set(layout.getNodes().map((node) => node.id));
    layout.start(visible.nodes, visible.edges);
    const arrived = before.size === 0 ? [] : visible.nodes.filter((n) => !before.has(n.id)).map((n) => n.id);
    if (reducedMotion) {
      layout.tickUntilSettled();
      layout.stop();
    } else if (arrived.length > 0) {
      // Make room LOCALLY around what just arrived, then let the shared frame
      // loop run it back down to rest and freeze — never a permanent loop.
      layout.reheat(arrived);
    }
    nodeElsRef.current.clear();
    edgeElsRef.current.clear();
    terminalElsRef.current.clear();
    laneElsRef.current.clear();
    setView({ nodes: layout.getNodes(), links: layout.getLinks(), geometry: layout.getGeometry() });
    setSettled(reducedMotion);
  }, [visible, reducedMotion]);

  // --- Cache the rendered elements once per structure change, so the frame loop
  // never touches the DOM query path.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !view) return;
    nodeElsRef.current.clear();
    edgeElsRef.current.clear();
    terminalElsRef.current.clear();
    laneElsRef.current.clear();
    for (const el of svg.querySelectorAll<SVGGElement>('[data-node-id]')) {
      const id = el.getAttribute('data-node-id');
      if (id) nodeElsRef.current.set(id, el);
    }
    for (const el of svg.querySelectorAll<SVGPathElement>('[data-edge-key]')) {
      const key = el.getAttribute('data-edge-key');
      if (key) edgeElsRef.current.set(key, el);
    }
    for (const el of svg.querySelectorAll<SVGCircleElement>('[data-terminal-for]')) {
      const key = el.getAttribute('data-terminal-for');
      if (key) terminalElsRef.current.set(key, el);
    }
    for (const el of svg.querySelectorAll<SVGRectElement>('[data-lane-key]')) {
      const key = el.getAttribute('data-lane-key');
      if (key) laneElsRef.current.set(key, el);
    }
    autoFit(); // initial framing; re-fitted once the layout settles
  }, [view, autoFit]);

  // --- Resize: re-FRAME, never re-lane (see the header decision). Event-driven
  // via ResizeObserver, which jsdom does not implement — hence the bail.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => autoFit());
    observer.observe(svg);
    return () => observer.disconnect();
  }, [autoFit]);

  // --- THE frame loop. Runs only while hot; the moment the simulation settles it
  // freezes the layout, hands the final positions to React in a SINGLE setState,
  // and schedules nothing further.
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

  // --- THE ACTIVATION PULSE. Interaction-triggered and self-terminating: one
  // timeout, one node, and nothing left behind. A `setTimeout` rather than the
  // `animationend` event on purpose — animationend is the prettier mechanism but
  // it can simply never arrive (a hidden tab, a suppressed animation), and a
  // pulse class that outlived its animation would be a permanent GPU tenant,
  // which is precisely what this canvas exists to avoid. Reduced motion never
  // starts one at all, so there is nothing for the CSS carve-out to catch.
  const triggerPulse = useCallback(
    (id: string | null): void => {
      if (reducedMotion || !id) return;
      pulseSeqRef.current += 1;
      setPulse({ id, seq: pulseSeqRef.current });
      if (pulseTimerRef.current !== null) clearTimeout(pulseTimerRef.current);
      pulseTimerRef.current = setTimeout(() => {
        pulseTimerRef.current = null;
        setPulse(null);
      }, DENDRITE_PULSE_MS);
    },
    [reducedMotion],
  );

  // Unmounting mid-pulse must not leave a timer holding a setState.
  useEffect(
    () => () => {
      if (pulseTimerRef.current !== null) clearTimeout(pulseTimerRef.current);
    },
    [],
  );

  // --- HUB PULSE FOR A COLLAPSED-LANE ARRIVAL (TWIN-READ.1 Task 5). The one
  // path Task 2's disclosure made invisible: a fact whose lane is shut never
  // reaches `visible.nodes`, so nothing about it would otherwise be seen.
  // Scans the FULL entering set (not `visible`) for the first fact whose lane
  // is currently collapsed and pulses its hub — the same triggerPulse a touch
  // would fire, landing on the twin -> hub connection a collapsed lane still
  // draws. A fact entering an OPEN lane is left alone: it is already inside
  // `visible.nodes` and blooms via the rebuild effect above.
  //
  // Deps are deliberately [entering, graph] ONLY. Reading expandedLanes here
  // rather than depending on it means later toggling an UNRELATED lane cannot
  // replay a stale pulse for a batch that already finished animating.
  useEffect(() => {
    if (entering.size === 0 || !graph) return;
    for (const node of graph.nodes) {
      if (node.type !== 'fact' || !node.category || !entering.has(node.id)) continue;
      if (!expandedLanes.has(node.category)) {
        triggerPulse(`category:${node.category}`);
        break; // one live pulse at a time — see triggerPulse's single-slot state
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entering, graph]);

  const handleHover = useCallback(
    (id: string | null): void => {
      setHoveredId(id);
      triggerPulse(id);
    },
    [triggerPulse],
  );

  // --- Hover: the hovered node plus its direct neighbours stay lit.
  const litIds = useMemo(() => {
    if (!hoveredId || !view) return null;
    const lit = new Set<string>([hoveredId]);
    for (const link of view.links) {
      if (link.source.id === hoveredId) lit.add(link.target.id);
      else if (link.target.id === hoveredId) lit.add(link.source.id);
    }
    return lit;
  }, [hoveredId, view]);

  // Resolved once so the "no view yet" case is answered in one place instead of
  // at every read site.
  const nodes = view?.nodes ?? NO_NODES;
  // --- Lane chrome inputs, deliberately NOT memoised: both are one O(nodes) pass
  // over the live node objects, whose x/y the frame loop mutates in place. A memo
  // keyed on `view` would hand the chrome stale floors on the settle render (same
  // array identity, new positions) — and every render that reaches here is
  // already O(nodes) anyway.
  //
  // The COUNT is taken from the full payload, not from the simulated nodes: a
  // collapsed lane holds no fact nodes, and "Preferences · 0" would be a lie
  // about the memory rather than a statement about the view.
  const laneCounts = countFactsPerLane(graph?.nodes ?? NO_NODES);
  const laneBottoms = laneBottomsOf(nodes);

  function handlePointerDown(event: React.PointerEvent<SVGGElement>, node: TwinLayoutNode): void {
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

  function handlePointerMove(event: React.PointerEvent<SVGGElement>, node: TwinLayoutNode): void {
    if (dragIdRef.current !== node.id) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const [x, y] = zoomTransform.invert([event.clientX - rect.left, event.clientY - rect.top]);
    // No lane logic here on purpose: ForceLayout clamps fx/fy to the node's own
    // lane and tier after every integration and inside reheat(), so a dragged
    // fact cannot be pulled into a neighbouring category.
    node.fx = x;
    node.fy = y;
    dragMovedRef.current = true;
  }

  function handlePointerUp(event: React.PointerEvent<SVGGElement>, node: TwinLayoutNode): void {
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

  function handleActivate(node: TwinLayoutNode, viaKeyboard: boolean): void {
    if (dragMovedRef.current) {
      dragMovedRef.current = false; // a drag that ended on this node is not a click
      return;
    }
    // Activation fires the pulse too, so the keyboard route gets the same
    // feedback the pointer does — hover is not reachable without a mouse.
    triggerPulse(node.id);
    // A hub is its lane's disclosure control (aria-expanded), so activating it
    // opens or closes that lane. Facts and the twin core are untouched: they
    // open the inspector exactly as they always have.
    if (isLaneHub(node) && node.category) {
      onToggleLane(node.category);
      return;
    }
    onInspect(node, viaKeyboard);
  }

  const fadeClass = reducedMotion ? '' : 'transition-opacity duration-150';
  const droppedCount = graph?.droppedCount ?? 0;
  const hasNodes = nodes.length > 0;

  return (
    <div
      data-testid="twin-memory-graph-canvas"
      data-reduced-motion={reducedMotion}
      data-settled={settled}
      // The graph's own surface, theme-adaptive since TWIN-LIGHT.1. The
      // class re-pins the palette for this subtree per app theme (see
      // globals.css), which is what lets every var(--color-*) below stay
      // theme-agnostic.
      className={`relative flex-1 min-h-0 overflow-hidden ${GRAPH_SURFACE_CLASS}`}
    >
      {hasNodes && (
        <button type="button" onClick={handleFit} className={FIT_BUTTON_CLASS}>
          Fit to view
        </button>
      )}

      {/* The <svg> ALWAYS mounts so the d3-zoom attach effect binds on the first
          commit, even while the graph is still loading over IPC. */}
      <svg
        ref={svgRef}
        role="img"
        aria-label="Twin memory graph — the twin, its memory categories, and every learned fact"
        width="100%"
        height="100%"
        className="block w-full h-full touch-none select-none"
      >
        <TwinMemoryDendriteDefs />
        {view && (
          <g transform={zoomTransform.toString()}>
            {view.geometry && (
              <TwinMemoryLaneChrome
                geometry={view.geometry}
                laneBottoms={laneBottoms}
                laneCounts={laneCounts}
                expandedLanes={expandedLanes}
              />
            )}
            <g>
              {view.links.map((link, index) => (
                <TwinMemoryDendrite
                  key={edgeKeyFor(link, index)}
                  edgeKey={edgeKeyFor(link, index)}
                  link={link}
                  hoveredId={hoveredId}
                  pulse={pulse}
                  fadeClass={fadeClass}
                  entering={!reducedMotion && (entering.has(link.source.id) || entering.has(link.target.id))}
                />
              ))}
            </g>
            {nodes.map((node) => {
              // "Attended" = the user is attending to THIS node, however they got
              // there: pointer, keyboard focus, or an open inspector. All three
              // reveal the same thing, so none of them is a second-class path.
              const attended = node.id === hoveredId || node.id === focusedId || node.id === pinnedId;
              return (
                <GraphNode
                  key={node.id}
                  node={node}
                  laneCount={node.category ? (laneCounts.get(node.category) ?? 0) : 0}
                  expanded={isLaneHub(node) ? !!node.category && expandedLanes.has(node.category) : undefined}
                  faded={litIds != null && !litIds.has(node.id)}
                  highlighted={node.id === hoveredId || node.id === pinnedId}
                  showLabel={isLabelVisible(node, expandedLanes, attended)}
                  revealed={attended}
                  fadeClass={fadeClass}
                  entering={entering.has(node.id)}
                  animateEntrance={!reducedMotion && entering.has(node.id)}
                  shimmer={shimmerCore && node.type === 'twin'}
                  onHover={handleHover}
                  onFocusChange={setFocusedId}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onActivate={handleActivate}
                />
              );
            })}
          </g>
        )}
      </svg>

      <GraphPinnedCardLayer
        pinnedId={pinnedId}
        panel={pinnedPanel}
        nodes={nodes}
        zoomTransform={zoomTransform}
        svgRef={svgRef}
      />

      {/* Cap honesty: facts dropped by the main-side node cap are NEVER silently
          truncated — they are counted on screen. */}
      {droppedCount > 0 && (
        <div
          data-testid="twin-memory-graph-dropped"
          title="Least-prominent memories beyond the display cap"
          className="absolute bottom-3 left-3 z-10 px-2.5 py-1 rounded-lg text-xs font-medium bg-[var(--color-chrome)] border border-[var(--color-border)] text-[var(--color-text-secondary)] overflow-hidden break-words"
        >
          +{droppedCount} not shown
        </div>
      )}

      {!hasNodes && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--color-text-secondary)]">
          Loading your twin&rsquo;s memory…
        </div>
      )}
    </div>
  );
}

/** Facts per lane, for the lane headings and the hub accessible names. Hubs and
 *  the core are structure, not memories, so they never count. Fed from the FULL
 *  payload so a collapsed lane still reports what it holds. */
function countFactsPerLane(nodes: readonly TwinGraphNode[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    if (node.type !== 'fact' || !node.category) continue;
    counts.set(node.category, (counts.get(node.category) ?? 0) + 1);
  }
  return counts;
}

/**
 * Which nodes wear a caption — DISCLOSURE-aware, not zoom-aware (TWIN-READ.1
 * Task 3). The old rule hid every fact label below `LABEL_ZOOM_THRESHOLD`, which
 * is a decluttering knob standing in for a decluttering *design*: it made the
 * graph unreadable when zoomed out and a wall of text when zoomed in, and it
 * took the lane headings and hub names — the STRUCTURE you navigate by — with
 * it. Zoom is not an input here at all:
 *
 *   * Structure (the twin core and every category hub) is captioned at EVERY
 *     zoom. There are at most six of them, and they are how you find anything.
 *   * A fact is captioned when its lane is open. Task 2 already keeps a
 *     collapsed lane's facts out of the DOM entirely, so this is belt-and-braces
 *     for the one case that can outlive it: a fact still mounted from a lane the
 *     user just closed. A collapsed lane therefore shows its hub and count and
 *     nothing else, exactly as designed.
 *   * `active` (hovered / focused / inspected) always wins — attending to a node
 *     must never be silent.
 *
 * Exported so the rule can be asserted directly: "present at low zoom" is proven
 * by the fact that zoom cannot reach this function, which is a stronger claim
 * than any single simulated zoom level.
 */
export function isLabelVisible(
  node: Pick<TwinGraphNode, 'type' | 'category'>,
  expandedLanes: ReadonlySet<string>,
  active: boolean,
): boolean {
  if (active) return true;
  if (node.type !== 'fact') return true;
  return !!node.category && expandedLanes.has(node.category);
}

/**
 * Accessible name for a node. A lane hub is a DISCLOSURE control, so its name
 * says what the lane holds ("3 learned facts") — that is the information a
 * screen-reader user needs to decide whether to open it, and it is the only
 * place a collapsed lane's size is spoken. The name deliberately does NOT change
 * when the lane opens: `aria-expanded` carries that state, and a name that
 * flipped with it would be announced as a different control.
 *
 * A FACT is named by its FULL text, not by its short caption. Sighted users get
 * the full text revealed on hover/focus (TWIN-READ.1 Task 3); naming the control
 * with the 2-4 word caption would leave a screen-reader user deciding whether to
 * forget a memory they were never read. The caption is a caption; the accessible
 * name has to be the memory.
 */
function nodeAriaLabel(node: TwinLayoutNode, laneCount: number): string {
  if (isLaneHub(node) && node.category) {
    const noun = laneCount === 1 ? 'learned fact' : 'learned facts';
    return `${TWIN_GRAPH_TYPE_LABEL[node.type]}: ${laneHeading(node.category)}, ${laneCount} ${noun}`;
  }
  return `${TWIN_GRAPH_TYPE_LABEL[node.type]}: ${fullTextOf(node)}`;
}

interface GraphNodeProps {
  node: TwinLayoutNode;
  /** Facts in this node's lane, from the full payload. Only read for a hub. */
  laneCount: number;
  /** Open/closed for a lane hub; undefined for every other node, which is what
   *  keeps `aria-expanded` off controls that disclose nothing. */
  expanded: boolean | undefined;
  faded: boolean;
  highlighted: boolean;
  showLabel: boolean;
  /** Swap the short caption for the node's FULL text — hovered, focused or
   *  inspected. */
  revealed: boolean;
  fadeClass: string;
  /** This memory arrived in the last refresh (marked regardless of motion
   *  preference, so the state is observable even when nothing animates). */
  entering: boolean;
  animateEntrance: boolean;
  /** Grant the core shimmer. True for the twin core ONLY, and only while the
   *  canvas's three gates allow it — never widened here. */
  shimmer: boolean;
  onHover: (id: string | null) => void;
  /** Keyboard focus entering/leaving this node — the pointer-free route to the
   *  same full-text reveal a hover gives. */
  onFocusChange: (id: string | null) => void;
  onPointerDown: (event: React.PointerEvent<SVGGElement>, node: TwinLayoutNode) => void;
  onPointerMove: (event: React.PointerEvent<SVGGElement>, node: TwinLayoutNode) => void;
  onPointerUp: (event: React.PointerEvent<SVGGElement>, node: TwinLayoutNode) => void;
  onActivate: (node: TwinLayoutNode, viaKeyboard: boolean) => void;
}

/** One memory. Radius and glow come straight off the LayoutNode (computed once by
 *  prominence.ts) — nothing here recomputes them. Every node is a real control:
 *  tabbable, named, and activatable with Enter/Space, because the forget action
 *  behind it must not be pointer-only. */
function GraphNode({
  node,
  laneCount,
  expanded,
  faded,
  highlighted,
  showLabel,
  revealed,
  fadeClass,
  entering,
  animateEntrance,
  shimmer,
  onHover,
  onFocusChange,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onActivate,
}: GraphNodeProps) {
  return (
    <g
      data-node-id={node.id}
      data-node-type={node.type}
      data-tier={node.tier}
      data-category={node.category ?? undefined}
      data-glow={node.glow}
      data-faded={faded || undefined}
      data-entering={entering || undefined}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      aria-label={nodeAriaLabel(node, laneCount)}
      transform={`translate(${node.x},${node.y})`}
      className={`cursor-pointer outline-none ${faded ? FADED_CLASS : 'opacity-100'} ${fadeClass}`}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onFocusChange(node.id)}
      onBlur={() => onFocusChange(null)}
      onMouseDown={(event) => event.stopPropagation()} // never let a node drag pan the canvas
      onPointerDown={(event) => onPointerDown(event, node)}
      onPointerMove={(event) => onPointerMove(event, node)}
      onPointerUp={(event) => onPointerUp(event, node)}
      onClick={() => onActivate(node, false)}
      onKeyDown={onButtonKey(() => onActivate(node, true))}
    >
      {/* Inner group carries the entrance animation: the outer one's positioning
          `transform` ATTRIBUTE would be overridden by a CSS transform. */}
      <g style={animateEntrance ? NODE_ENTRANCE_STYLE : undefined}>
        <TwinMemorySoma
          type={node.type}
          radius={node.radius}
          glow={node.glow}
          highlighted={highlighted}
          shimmer={shimmer}
        />
        {showLabel && (
          <TwinMemoryNodeLabel
            node={node}
            offsetY={node.radius + 12}
            revealed={revealed}
            emphasised={node.type !== 'fact'}
          />
        )}
      </g>
    </g>
  );
}
