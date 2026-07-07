// === FILE PURPOSE ===
// Pure-SVG collapsible mind map for the "living brain" (V3.2 Task 2). Renders a
// BrainTree (from brainStore, keyed by scope) as a horizontal L->R tidy tree:
// rounded-rect type-tinted nodes, cubic-bezier links, a circular expand/collapse
// chevron on every branch node, d3-zoom pan/zoom + a fit-to-view button, and
// on-demand dashed crossLink overlays that appear only while a node is
// hovered/selected.
//
// LAYOUT is d3-hierarchy `tree().nodeSize([ROW_H, COL_W])`; only EXPANDED branches
// are laid out (a node's children are fed to d3 iff its id is in the expansion
// set), so collapse — not a node cap or physics — is the scaling mechanism.
//
// GPU DISCIPLINE (hard rule): NO continuous animation loop. No requestAnimationFrame
// render loop, no setInterval. Rendering is event-driven only — React re-renders on
// brainStore change; d3-zoom's own DOM event handling updates a transform in state.
// Position changes on expand/collapse are smoothed with CSS transforms (disabled
// under prefers-reduced-motion), not an animation loop.
//
// THEMING: every fill/stroke/text colour is a Tailwind CSS variable (or a
// color-mix over one) so light AND dark both work — no single-theme hex.
//
// d3-selection's `select` is imported only to attach the d3-zoom behavior to the
// svg (its required companion — a transitive dep, not added to package.json). The
// bezier link path is a ~3-line pure function; no d3-shape.
//
// forwardRef (V3.2 Task 3): exposes an imperative `{ fit }` handle so BrainTabPanel
// can trigger the same fit-to-view the button performs, once on tab mount. Purely
// additive — existing callers that render `<BrainMindMap .../>` without a ref are
// unaffected.
//
// INSPECTOR CARD (Inspector-card story): an optional `pinnedPanel` node is shown in
// an absolute-positioned card popped out of the pinned node — anchored at the node's
// ON-SCREEN position (derived from its layout position + the live d3 zoomTransform)
// with a connector line, so the inspector feels part of the map instead of a docked
// side drawer. The card follows the node on pan/zoom (re-derived from zoomTransform
// state — event-driven, no rAF), flips L/R and clamps at the container edges, and
// simply hides if the pinned node isn't in the current layout (never crashes).
//
// HUGE-EXPANSION GUARD (V3.2 Task 5): expanding a node with > HEAVY_EXPANSION_
// THRESHOLD DIRECT children (e.g. a column with hundreds of cards) shows an
// inline "Show N nodes?" confirm chip instead of laying out — and freezing on —
// an enormous subtree in one click. Local per-node state in NodeGroup; collapse
// and ordinary (small) expansions are unaffected.
//
// === DEPENDENCIES ===
// react, d3-hierarchy (layout), d3-zoom + d3-selection (pan/zoom), brainStore,
// shared brain types

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { hierarchy, tree, type HierarchyPointNode } from 'd3-hierarchy';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { useBrainStore } from '../stores/brainStore';
import type { BrainNode, BrainNodeType } from '../../shared/types';

// --- Layout constants -------------------------------------------------------
const ROW_H = 46; // sibling separation (cross-axis -> vertical)
const COL_W = 220; // depth separation (main-axis -> horizontal)
const NODE_W = 168;
const NODE_H = 34;
const CHEVRON_R = 11;
const PADDING = 48; // viewport inset so content never starts at a negative coord
const FALLBACK_W = 900;
const FALLBACK_H = 600;
// --- Node-anchored inspector card (Inspector-card story) ---------------------
const CARD_W = 320; // fixed inspector-card width (px)
const CARD_GAP = 16; // gap between the node edge and the card's near edge
const CARD_MARGIN = 12; // keep the whole card this far from the container edges
const CARD_EST_H = 360; // height guess used until the card measures itself (px)
/** Task 5 huge-expansion guard: expanding a node with more DIRECT children than
 *  this (e.g. a column with hundreds of cards) asks via an inline confirm chip
 *  instead of laying out — and freezing on — an enormous subtree in one click. */
const HEAVY_EXPANSION_THRESHOLD = 100;

// Stable empty fallbacks (Task 4 live growth) — avoids allocating a fresh
// Set/object every render when a scope has no store entry yet.
const EMPTY_ENTERING: ReadonlySet<string> = new Set();
const EMPTY_NEW_COUNTS: Readonly<Record<string, number>> = {};

// --- Per-type theming (all values resolve to a themed CSS variable) ---------
const TYPE_COLOR: Record<BrainNodeType, string> = {
  workspace: 'var(--color-accent)',
  project: 'var(--color-primary-500)',
  group: 'var(--color-text-muted)',
  column: 'var(--color-warm)',
  session: 'var(--color-magenta)',
  card: 'var(--color-primary-400)',
  decision: 'var(--color-success)',
  question: 'var(--color-warning)',
};

// Compact type glyphs (decorative; the accessible name lives on the buttons).
const TYPE_GLYPH: Record<BrainNodeType, string> = {
  workspace: '◈',
  project: '▣',
  group: '▢',
  column: '≡',
  session: '◉',
  card: '▤',
  decision: '✓',
  question: '?',
};

export interface BrainMindMapProps {
  /** Scope bucket to render (see brainStore.scopeKeyFor). Task 3 passes this. */
  scopeKey: string;
  /** Fired when a node with a non-null entityId has its label activated. Used as
   *  the FALLBACK when no `onInspect` is supplied (kept for the prop contract). */
  onOpenEntity: (arg: { type: BrainNodeType; entityId: string }) => void;
  /** In-brain Inspector (Inspector story): when supplied, a node-label click
   *  fires this INSTEAD of onOpenEntity — the click pins the node and opens the
   *  in-canvas inspector rather than navigating the underlying page. Gated on a
   *  non-null entityId, same as onOpenEntity. */
  onInspect?: (node: BrainNode) => void;
  /** The currently PINNED node id (inspector open on it) — kept highlighted like
   *  a selection even as the mouse moves elsewhere. Null when no inspector is open. */
  pinnedId?: string | null;
  /** Inspector-card story: the CONTENT to show in a card popped out of the pinned
   *  node (with a connector line to the node). When BOTH `pinnedId` and this are set
   *  AND the pinned node is in the current layout, BrainMindMap positions this inside
   *  an absolute card over the map. BrainMindMap owns POSITIONING; this owns CONTENT. */
  pinnedPanel?: React.ReactNode;
}

/** Imperative handle (V3.2 Task 3) — lets BrainTabPanel trigger the same
 *  fit-to-view the "Fit to view" button performs, once on tab mount. */
export interface BrainMindMapHandle {
  /** Frame the current layout to the viewport. No-op before a layout exists. */
  fit: () => void;
  /** Pan a node into the visible-left region (clear of a right-docked inspector
   *  drawer) WITHOUT changing the current zoom level — a one-shot transform, no
   *  re-fit, no animation loop. No-op before a layout exists / node not visible. */
  panToNode: (nodeId: string) => void;
}

interface LaidOutNode {
  /** Unique per POSITION (ancestry path) — a card can appear twice with the same
   *  id, so this, not node.id, is the React key / DOM id. */
  pathKey: string;
  id: string;
  data: BrainNode;
  x: number; // screen x (horizontal, from d3 node.y)
  y: number; // screen y (vertical, from d3 node.x)
}

interface LaidOutLink {
  key: string;
  /** The CHILD (target) node's stable id — Task 4 uses this to fade the link in
   *  when its target just entered (see brainStore's `entering` set). */
  id: string;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}

interface Layout {
  nodes: LaidOutNode[];
  links: LaidOutLink[];
  /** id -> visible positions, for resolving crossLink endpoints. */
  positions: Map<string, { x: number; y: number }[]>;
  offsetX: number;
  offsetY: number;
}

/** Horizontal cubic-bezier link (mirrors d3.linkHorizontal), pure. */
function linkPath(sx: number, sy: number, tx: number, ty: number): string {
  const mx = (sx + tx) / 2;
  return `M${sx},${sy}C${mx},${sy} ${mx},${ty} ${tx},${ty}`;
}

/** Fit-button position class — top-right of the map. (The inspector is now a
 *  node-anchored card, not a right-docked drawer, so no left-shift is needed.) */
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

/** Filter to expanded branches and run the d3-hierarchy tidy tree (horizontal).
 *  Exported (Task 5) so the perf regression test can measure it directly against
 *  a large synthetic tree without rendering React. */
export function buildLayout(root: BrainNode, expanded: Set<string>): Layout {
  const rootPoint = hierarchy<BrainNode>(root, (node) => (expanded.has(node.id) ? node.children : null));
  tree<BrainNode>().nodeSize([ROW_H, COL_W])(rootPoint);

  const points = rootPoint.descendants() as HierarchyPointNode<BrainNode>[];

  // d3 assigns x across siblings (cross-axis) and y per depth (main-axis). For a
  // horizontal L->R map: screenX = node.y, screenY = node.x.
  let minX = Infinity;
  let minY = Infinity;
  for (const p of points) {
    if (p.y < minX) minX = p.y;
    if (p.x < minY) minY = p.x;
  }
  const offsetX = PADDING - (Number.isFinite(minX) ? minX : 0);
  const offsetY = PADDING - (Number.isFinite(minY) ? minY : 0);

  const nodes: LaidOutNode[] = [];
  const positions = new Map<string, { x: number; y: number }[]>();
  for (const p of points) {
    const pathKey = p
      .ancestors()
      .reverse()
      .map((a) => a.data.id)
      .join('/');
    const laid: LaidOutNode = { pathKey, id: p.data.id, data: p.data, x: p.y, y: p.x };
    nodes.push(laid);
    const list = positions.get(p.data.id);
    if (list) list.push({ x: laid.x, y: laid.y });
    else positions.set(p.data.id, [{ x: laid.x, y: laid.y }]);
  }

  const links: LaidOutLink[] = [];
  for (const p of points) {
    if (!p.parent) continue;
    const childKey = p
      .ancestors()
      .reverse()
      .map((a) => a.data.id)
      .join('/');
    links.push({
      key: childKey,
      id: p.data.id,
      sx: p.parent.y + NODE_W, // parent right-center
      sy: p.parent.x,
      tx: p.y, // child left-center
      ty: p.x,
    });
  }

  return { nodes, links, positions, offsetX, offsetY };
}

/** Project a laid-out node's edge centers into SCREEN space. The node rect spans
 *  content-x `pos.x .. pos.x + NODE_W` and is vertically centered on `pos.y` (both
 *  inside the offset group), so its right/left-edge centers map through the current
 *  d3 zoom transform exactly like `handlePanToNode` computes its target. Pure. */
function nodeScreenAnchor(
  pos: { x: number; y: number },
  offsetX: number,
  offsetY: number,
  transform: ZoomTransform,
): { rightX: number; leftX: number; sy: number } {
  const cy = pos.y + offsetY;
  const [rightX, sy] = transform.apply([pos.x + offsetX + NODE_W, cy]);
  const [leftX] = transform.apply([pos.x + offsetX, cy]);
  return { rightX, leftX, sy };
}

/** Place the node-anchored inspector card: default to the RIGHT of the node, flip
 *  LEFT when the right placement would overflow the container, then clamp both axes
 *  so the whole card stays inside. Returns the card top-left + the connector's
 *  node-side x (so the line still points at the correct node edge after a flip).
 *  Pure — extracted so BrainMindMap's own complexity stays under the lint ceiling. */
function computeCardPlacement(
  rightX: number,
  leftX: number,
  sy: number,
  containerW: number,
  containerH: number,
  cardH: number,
): { left: number; top: number; flipped: boolean; connectorX: number } {
  const flipped = rightX + CARD_GAP + CARD_W > containerW - CARD_MARGIN;
  const rawLeft = flipped ? leftX - CARD_GAP - CARD_W : rightX + CARD_GAP;
  const left = Math.max(CARD_MARGIN, Math.min(rawLeft, containerW - CARD_W - CARD_MARGIN));
  const top = Math.max(CARD_MARGIN, Math.min(sy - cardH / 2, containerH - cardH - CARD_MARGIN));
  return { left, top, flipped, connectorX: flipped ? leftX : rightX };
}

interface PinnedCardProps {
  panel: React.ReactNode;
  rightX: number;
  leftX: number;
  sy: number;
  svgRef: React.RefObject<SVGSVGElement | null>;
}

/** The node-anchored inspector CARD + its connector to the node (Inspector-card
 *  story). Measures its own rendered height AND the container size (both via
 *  ResizeObserver — event-driven, no rAF; absent in jsdom, where the estimate +
 *  fallbacks stand) so the flip/clamp and the connector endpoint track the real card
 *  and container. Refs are read inside effects only (never during render). The node
 *  anchor (rightX/leftX/sy) arrives as props, which BrainMindMap recomputes on each
 *  `zoomTransform` change, so the card FOLLOWS the node on pan/zoom — no loop. */
function PinnedCard({ panel, rightX, leftX, sy, svgRef }: PinnedCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [cardH, setCardH] = useState(CARD_EST_H);
  const [container, setContainer] = useState({ w: FALLBACK_W, h: FALLBACK_H });

  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setCardH(el.offsetHeight || CARD_EST_H));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const measure = (): void => setContainer({ w: el.clientWidth || FALLBACK_W, h: el.clientHeight || FALLBACK_H });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [svgRef]);

  const { left, top, flipped, connectorX } = computeCardPlacement(rightX, leftX, sy, container.w, container.h, cardH);
  const cardNearX = flipped ? left + CARD_W : left;
  const cardAttachY = Math.max(top, Math.min(sy, top + cardH));

  return (
    <>
      {/* Connector overlay — never intercepts the map's pan/zoom (pointer-events-none). */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none z-10" aria-hidden="true">
        <line
          data-testid="brain-pinned-connector"
          x1={connectorX}
          y1={sy}
          x2={cardNearX}
          y2={cardAttachY}
          stroke="var(--color-accent)"
          strokeWidth={1.5}
        />
        <circle cx={connectorX} cy={sy} r={3} fill="var(--color-accent)" />
      </svg>
      <div ref={cardRef} data-testid="brain-pinned-card" style={{ left, top, width: CARD_W }} className="absolute z-20">
        {panel}
      </div>
    </>
  );
}

/** Resolve the pinned node's on-screen anchor and render the anchored card — or
 *  nothing when the pin/panel/layout aren't all present, or the pinned node isn't in
 *  the current layout (e.g. an ancestor was collapsed): never crash, just hide the
 *  card + connector. Kept as its own component so BrainMindMap renders it with no
 *  extra inline conditionals (its render is already at the complexity ceiling). */
function PinnedCardLayer({
  pinnedId,
  panel,
  layout,
  zoomTransform,
  svgRef,
}: {
  pinnedId: string | null | undefined;
  panel: React.ReactNode;
  layout: Layout | null;
  zoomTransform: ZoomTransform;
  svgRef: React.RefObject<SVGSVGElement | null>;
}) {
  if (!pinnedId || !panel || !layout) return null;
  const pos = layout.positions.get(pinnedId)?.[0];
  if (!pos) return null;
  const { rightX, leftX, sy } = nodeScreenAnchor(pos, layout.offsetX, layout.offsetY, zoomTransform);
  return <PinnedCard panel={panel} rightX={rightX} leftX={leftX} sy={sy} svgRef={svgRef} />;
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

const BrainMindMap = forwardRef<BrainMindMapHandle, BrainMindMapProps>(function BrainMindMap(
  { scopeKey, onOpenEntity, onInspect, pinnedId, pinnedPanel },
  ref,
) {
  const scope = useBrainStore((s) => s.scopes[scopeKey]);
  const toggleExpansion = useBrainStore((s) => s.toggleExpansion);
  const setSelection = useBrainStore((s) => s.setSelection);

  const reducedMotion = usePrefersReducedMotion();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [zoomTransform, setZoomTransform] = useState<ZoomTransform>(zoomIdentity);

  const tree_ = scope?.tree ?? null;
  const expanded = scope?.expanded;
  const selection = scope?.selection ?? null;
  const entering = scope?.entering ?? EMPTY_ENTERING;
  const newCounts = scope?.newCounts ?? EMPTY_NEW_COUNTS;

  const layout = useMemo<Layout | null>(() => {
    if (!tree_ || !expanded) return null;
    return buildLayout(tree_.root, expanded);
  }, [tree_, expanded]);

  // Attach the d3-zoom behavior to the svg once; pan/zoom updates transform state
  // (event-driven — no rAF). Cleaned up on unmount.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 2.5])
      .on('zoom', (event: D3ZoomEvent<SVGSVGElement, unknown>) => setZoomTransform(event.transform));
    zoomRef.current = behavior;
    const selection_ = select(svg);
    selection_.call(behavior);
    return () => {
      selection_.on('.zoom', null);
      zoomRef.current = null;
    };
  }, []);

  // Cross-links whose involved node is currently selected AND both endpoints are
  // visible — drawn as dashed overlays only, never permanent edges.
  const activeCrossLinks = useMemo(() => {
    if (!tree_ || !layout || !selection) return [];
    const out: { key: string; sx: number; sy: number; tx: number; ty: number; kind: string }[] = [];
    for (const link of tree_.crossLinks) {
      if (link.fromId !== selection && link.toId !== selection) continue;
      const from = layout.positions.get(link.fromId)?.[0];
      const to = layout.positions.get(link.toId)?.[0];
      if (!from || !to) continue;
      out.push({
        key: `${link.kind}:${link.fromId}->${link.toId}`,
        sx: from.x + NODE_W / 2,
        sy: from.y,
        tx: to.x + NODE_W / 2,
        ty: to.y,
        kind: link.kind,
      });
    }
    return out;
  }, [tree_, layout, selection]);

  function handleFit(): void {
    const svg = svgRef.current;
    const behavior = zoomRef.current;
    if (!svg || !behavior || !layout || layout.nodes.length === 0) return;
    const viewW = svg.clientWidth || FALLBACK_W;
    const viewH = svg.clientHeight || FALLBACK_H;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of layout.nodes) {
      const x = n.x + layout.offsetX;
      const y = n.y + layout.offsetY;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y - NODE_H / 2);
      maxX = Math.max(maxX, x + NODE_W);
      maxY = Math.max(maxY, y + NODE_H / 2);
    }
    const contentW = maxX - minX || 1;
    const contentH = maxY - minY || 1;
    const k = Math.min(2.5, Math.max(0.2, 0.9 * Math.min(viewW / contentW, viewH / contentH)));
    const tx = (viewW - contentW * k) / 2 - minX * k;
    const ty = (viewH - contentH * k) / 2 - minY * k;
    select(svg).call(behavior.transform, zoomIdentity.translate(tx, ty).scale(k));
  }

  // Pan a node into the visible-left region (so a right-docked inspector drawer
  // never covers it) while PRESERVING the user's current zoom level — a one-shot
  // transform, not a full re-fit and not an animation loop.
  function handlePanToNode(nodeId: string): void {
    const svg = svgRef.current;
    const behavior = zoomRef.current;
    if (!svg || !behavior || !layout) return;
    const pos = layout.positions.get(nodeId)?.[0];
    if (!pos) return;
    const k = zoomTransform.k; // keep the current zoom; only translate
    const viewW = svg.clientWidth || FALLBACK_W;
    const viewH = svg.clientHeight || FALLBACK_H;
    // Node center in content space (rect spans x=0..NODE_W, centered vertically).
    const cx = pos.x + layout.offsetX + NODE_W / 2;
    const cy = pos.y + layout.offsetY;
    // Land it in the upper-LEFT region so it stays clear of BOTH a right-docked
    // drawer AND a bottom sheet (the map doesn't know which is active), without a
    // jarring full re-fit.
    const targetX = Math.min(viewW * 0.24, 220);
    const targetY = Math.min(viewH * 0.3, 220);
    const tx = targetX - k * cx;
    const ty = targetY - k * cy;
    select(svg).call(behavior.transform, zoomIdentity.translate(tx, ty).scale(k));
  }

  useImperativeHandle(ref, () => ({ fit: handleFit, panToNode: handlePanToNode }));

  return (
    <div
      data-testid="brain-mindmap"
      data-reduced-motion={reducedMotion}
      className="relative flex-1 min-h-0 overflow-hidden"
    >
      {layout && (
        <button type="button" onClick={handleFit} className={FIT_BUTTON_CLASS}>
          Fit to view
        </button>
      )}

      {/* The <svg> (and svgRef) ALWAYS mounts so the d3-zoom attach effect binds
          on the first commit, even while the tree is still loading over IPC.
          If the svg only rendered once a tree existed, the empty-dep attach effect
          would run against a null ref on first open and never re-run — leaving the
          map un-pannable until a remount (the "not draggable until re-click" bug). */}
      <svg
        ref={svgRef}
        role="img"
        aria-label="Brain mind map"
        width="100%"
        height="100%"
        className="block w-full h-full touch-none select-none"
      >
        {tree_ && layout && (
          <g transform={zoomTransform.toString()}>
            <g transform={`translate(${layout.offsetX},${layout.offsetY})`}>
              {/* Tree links (behind nodes) — a link whose child just entered (Task 4
                live growth) fades in alongside its node's own entrance bloom. */}
              <g fill="none" stroke="var(--color-border-accent)" strokeWidth={1.5}>
                {layout.links.map((l) => (
                  <path
                    key={l.key}
                    d={linkPath(l.sx, l.sy, l.tx, l.ty)}
                    style={
                      entering.has(l.id) && !reducedMotion
                        ? { animation: 'brain-link-enter 300ms ease-out' }
                        : undefined
                    }
                  />
                ))}
              </g>

              {/* On-demand dashed crossLink overlays (hover/selection only) */}
              {activeCrossLinks.length > 0 && (
                <g fill="none" strokeWidth={1.5} strokeDasharray="5 4">
                  {activeCrossLinks.map((c) => (
                    <path
                      key={c.key}
                      data-testid="brain-crosslink"
                      data-kind={c.kind}
                      d={linkPath(c.sx, c.sy, c.tx, c.ty)}
                      stroke={c.kind === 'provenance' ? 'var(--color-magenta)' : 'var(--color-warm)'}
                    />
                  ))}
                </g>
              )}

              {/* Nodes */}
              {layout.nodes.map((n) => (
                <NodeGroup
                  key={n.pathKey}
                  node={n}
                  isRoot={n.data === tree_.root}
                  // Pinned (inspector open) counts as selected for the highlight so
                  // it stays lit even as the mouse moves; hover crossLinks (driven
                  // by `selection`, not this flag) keep working independently.
                  isSelected={selection === n.id || n.id === pinnedId}
                  expanded={expanded?.has(n.id) ?? false}
                  reducedMotion={reducedMotion}
                  isEntering={entering.has(n.id)}
                  newCount={newCounts[n.id] ?? 0}
                  onToggle={() => toggleExpansion(scopeKey, n.id)}
                  onHoverIn={() => setSelection(scopeKey, n.id)}
                  onHoverOut={() => setSelection(scopeKey, null)}
                  onOpen={() => {
                    if (n.data.entityId == null) return;
                    // Inspector story: a click INSPECTS in-canvas (pins + opens the
                    // drawer). onOpenEntity is now the explicit "Open full page →"
                    // action from inside the inspector — kept here only as a fallback
                    // for callers that don't wire an inspector.
                    if (onInspect) onInspect(n.data);
                    else onOpenEntity({ type: n.data.type, entityId: n.data.entityId });
                  }}
                />
              ))}
            </g>
          </g>
        )}
      </svg>

      {/* Node-anchored inspector card (Inspector-card story). Rendered
          unconditionally with a self-guarding layer so BrainMindMap's own render
          gains no inline conditionals (it is already at the complexity ceiling). */}
      <PinnedCardLayer
        pinnedId={pinnedId}
        panel={pinnedPanel}
        layout={layout}
        zoomTransform={zoomTransform}
        svgRef={svgRef}
      />

      {!layout && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--color-text-secondary)]">
          No graph to show yet.
        </div>
      )}
    </div>
  );
});

export default BrainMindMap;

interface NodeGroupProps {
  node: LaidOutNode;
  isRoot: boolean;
  isSelected: boolean;
  expanded: boolean;
  reducedMotion: boolean;
  /** True for one render cycle after this node just entered the tree (Task 4 live
   *  growth) — triggers a one-shot CSS bloom. Never a continuous animation. */
  isEntering: boolean;
  /** "N new" count for a COLLAPSED branch with entering descendants (Task 4) —
   *  rendered as a small badge near the chevron; 0 renders nothing. */
  newCount: number;
  onToggle: () => void;
  onHoverIn: () => void;
  onHoverOut: () => void;
  onOpen: () => void;
}

/** Node fill/stroke (pure, extracted so NodeGroup's own branching stays low —
 *  ESLint's complexity rule counts each function separately). */
function nodeFill(isRoot: boolean, typeColor: string): string {
  return isRoot ? 'var(--color-accent-subtle)' : `color-mix(in srgb, ${typeColor} 12%, var(--color-chrome))`;
}
function nodeStroke(isRoot: boolean, isSelected: boolean, typeColor: string): string {
  if (isSelected || isRoot) return 'var(--color-accent)';
  return `color-mix(in srgb, ${typeColor} 45%, var(--color-border))`;
}

/** One-shot entrance style (Task 4 live growth) — undefined skips it entirely
 *  (no entry in the entering set, or prefers-reduced-motion). */
function entranceStyle(isEntering: boolean, reducedMotion: boolean): React.CSSProperties | undefined {
  if (!isEntering || reducedMotion) return undefined;
  return { animation: 'brain-node-enter 300ms ease-out', transformOrigin: `${NODE_W / 2}px 0px` };
}

interface NodeLabelProps {
  label: string;
  isRoot: boolean;
  openable: boolean;
  onOpen: () => void;
}

/** Node label — an accessible button only when the node is openable. */
function NodeLabel({ label, isRoot, openable, onOpen }: NodeLabelProps) {
  const fontWeight = isRoot ? 600 : 500;
  if (!openable) {
    return (
      <text
        x={28}
        y={0}
        dominantBaseline="central"
        fontSize={12}
        fontWeight={fontWeight}
        fill="var(--color-text-primary)"
      >
        {truncate(label)}
      </text>
    );
  }
  return (
    <text
      role="button"
      tabIndex={0}
      aria-label={`Open ${label}`}
      onClick={onOpen}
      onKeyDown={onButtonKey(onOpen)}
      x={28}
      y={0}
      dominantBaseline="central"
      fontSize={12}
      fontWeight={fontWeight}
      fill="var(--color-text-primary)"
      className="cursor-pointer outline-none"
    >
      {truncate(label)}
    </text>
  );
}

interface ExpandChevronProps {
  label: string;
  childCount: number;
  expanded: boolean;
  isSelected: boolean;
  /** "N new" count for a COLLAPSED node with entering descendants (Task 4) —
   *  renders a small badge near the chevron; 0 renders nothing. */
  newCount: number;
  onToggle: () => void;
}

/** Expand/collapse chevron — a circular button on every branch node, plus its
 *  "N new since collapsed" badge (Task 4 live growth; cleared on expand). */
function ExpandChevron({ label, childCount, expanded, isSelected, newCount, onToggle }: ExpandChevronProps) {
  const showNewBadge = !expanded && newCount > 0;
  const ariaLabel = expanded
    ? `Collapse ${label}`
    : `Expand ${label} (${childCount}${newCount > 0 ? `, ${newCount} new` : ''})`;

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={onToggle}
      onKeyDown={onButtonKey(onToggle)}
      transform={`translate(${NODE_W + CHEVRON_R + 2}, 0)`}
      className="cursor-pointer outline-none"
    >
      <circle
        r={CHEVRON_R}
        fill="var(--color-chrome)"
        stroke={isSelected ? 'var(--color-accent)' : 'var(--color-border-accent)'}
        strokeWidth={1.25}
      />
      {expanded ? (
        // Open / left-pointing chevron
        <path
          d="M2.5,-4 L-2.5,0 L2.5,4"
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        // Collapsed: child count (right-pointing affordance via the count)
        <text
          dominantBaseline="central"
          textAnchor="middle"
          fontSize={10}
          fontWeight={600}
          fill="var(--color-accent)"
          aria-hidden="true"
        >
          {childCount}
        </text>
      )}

      {showNewBadge && (
        <g data-testid="brain-new-badge" transform={`translate(${CHEVRON_R * 0.7}, ${-CHEVRON_R * 0.7})`}>
          <circle r={7} fill="var(--color-accent)" />
          <text
            dominantBaseline="central"
            textAnchor="middle"
            fontSize={8.5}
            fontWeight={700}
            fill="var(--color-chrome)"
            aria-hidden="true"
          >
            {newCount > 9 ? '9+' : newCount}
          </text>
        </g>
      )}
    </g>
  );
}

function NodeGroup({
  node,
  isRoot,
  isSelected,
  expanded,
  reducedMotion,
  isEntering,
  newCount,
  onToggle,
  onHoverIn,
  onHoverOut,
  onOpen,
}: NodeGroupProps) {
  const { data, x, y } = node;
  const typeColor = TYPE_COLOR[data.type];
  const hasChildren = data.childCount > 0;
  const openable = data.entityId != null;
  // Task 5 huge-expansion guard: only a COLLAPSED node with a huge direct-child
  // count is "heavy" — collapsing, and any already-expanded node, are unaffected.
  const isHeavyExpand = !expanded && data.childCount > HEAVY_EXPANSION_THRESHOLD;
  const [confirmingExpand, setConfirmingExpand] = useState(false);

  // First click on a heavy collapsed node only arms the inline "Show N nodes?"
  // chip; the real toggle (and its layout cost) only runs once that chip — or a
  // second activation of this same chevron — confirms it. Chip disappears on its
  // own once `expanded` flips true (isHeavyExpand recomputes to false).
  function handleToggle(): void {
    if (isHeavyExpand && !confirmingExpand) {
      setConfirmingExpand(true);
      return;
    }
    setConfirmingExpand(false);
    onToggle();
  }

  return (
    <g
      data-node-id={data.id}
      data-node-type={data.type}
      onMouseEnter={onHoverIn}
      onMouseLeave={onHoverOut}
      style={{
        transform: `translate(${x}px, ${y}px)`,
        transition: reducedMotion ? 'none' : 'transform 300ms ease',
      }}
    >
      {/* Inner group carries the one-shot entrance bloom (Task 4 live growth) so
          it never fights the OUTER group's own position transform/transition
          above — scale/fade only, from the node's own center. Event-driven CSS
          animation only; no rAF/interval, nothing to clean up on unmount. */}
      <g data-testid={isEntering ? 'brain-node-entering' : undefined} style={entranceStyle(isEntering, reducedMotion)}>
        <rect
          x={0}
          y={-NODE_H / 2}
          width={NODE_W}
          height={NODE_H}
          rx={9}
          ry={9}
          fill={nodeFill(isRoot, typeColor)}
          stroke={nodeStroke(isRoot, isSelected, typeColor)}
          strokeWidth={isRoot || isSelected ? 2 : 1.25}
        />

        {/* Type glyph (decorative) */}
        <text
          x={14}
          y={0}
          dominantBaseline="central"
          textAnchor="middle"
          fontSize={13}
          fill={typeColor}
          aria-hidden="true"
        >
          {TYPE_GLYPH[data.type]}
        </text>

        <NodeLabel label={data.label} isRoot={isRoot} openable={openable} onOpen={onOpen} />

        {hasChildren && (
          <ExpandChevron
            label={data.label}
            childCount={data.childCount}
            expanded={expanded}
            isSelected={isSelected}
            newCount={newCount}
            onToggle={handleToggle}
          />
        )}

        {confirmingExpand && isHeavyExpand && <ExpansionConfirmChip count={data.childCount} onConfirm={handleToggle} />}
      </g>
    </g>
  );
}

interface ExpansionConfirmChipProps {
  count: number;
  onConfirm: () => void;
}

/** Inline "Show N nodes?" confirm chip (Task 5 huge-expansion guard) — appears
 *  next to a heavy collapsed node's chevron instead of expanding it immediately.
 *  Keyboard-operable (Enter/Space via onButtonKey, matching every other control
 *  in this file); confirming it performs the real expansion. */
function ExpansionConfirmChip({ count, onConfirm }: ExpansionConfirmChipProps) {
  const label = `Show ${count} nodes?`;
  return (
    <g data-testid="brain-expand-confirm" transform={`translate(${NODE_W + CHEVRON_R * 2 + 12}, 0)`}>
      <rect
        x={0}
        y={-11}
        width={96}
        height={22}
        rx={11}
        ry={11}
        fill="color-mix(in srgb, var(--color-warning) 15%, var(--color-chrome))"
        stroke="var(--color-warning)"
        strokeWidth={1.25}
      />
      <text
        role="button"
        tabIndex={0}
        aria-label={label}
        onClick={onConfirm}
        onKeyDown={onButtonKey(onConfirm)}
        x={48}
        y={0}
        dominantBaseline="central"
        textAnchor="middle"
        fontSize={10}
        fontWeight={600}
        fill="var(--color-warning)"
        className="cursor-pointer outline-none"
      >
        {label}
      </text>
    </g>
  );
}

/** Keep labels inside the node rect — SVG text has no wrapping/ellipsis. */
function truncate(label: string, max = 20): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}
