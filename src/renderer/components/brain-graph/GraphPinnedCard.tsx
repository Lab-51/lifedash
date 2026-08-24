// === FILE PURPOSE ===
// The node-anchored inspector CARD + its connector for the memory graph
// (TWIN-GRAPH.1 Task 3). A deliberate, adapted COPY of BrainMindMap's
// PinnedCard/PinnedCardLayer — the placement/flip/clamp math and the
// ResizeObserver-with-jsdom-bail measurement are proven in this codebase and are
// reused verbatim in shape; only the ANCHOR differs (a circle's left/right edge
// at the current zoom, instead of a fixed-width rect's).
//
// BrainMindMap is retained-but-unreferenced code and must not be edited, so this
// is a copy rather than an extraction: exporting those helpers would mean
// touching a file the phase froze.
//
// The card OWNS POSITIONING ONLY; its `panel` prop owns content (Task 4 supplies
// the per-type inspector). It simply renders nothing when the pinned node isn't
// in the current layout — never a crash.
//
// >>> TWIN-READ.2 Task 3 — TWO ADDITIVE WIDENINGS, both optional so this file's
// only other caller (BrainMemoryGraph, whose plain {id,x,y,radius} nodes never
// set either field) compiles and behaves byte-for-byte as before: <<<
//   * `AnchoredNode.rightExtent` — a riverbank ROW's caption sits beside its
//     soma, so anchoring at the circle's edge would cover the very title that
//     was clicked. `rightExtent` overrides the RIGHT-side reach only (left
//     stays `radius` — nothing sits left of a row); absent means "use radius",
//     i.e. today's behaviour.
//   * `animateConnector` — the twin river canvas's one piece of pin "organic
//     touch": the connector LINE draws out of the node toward the card
//     (globals.css's `graph-connector-draw-in`, driven by `--connector-
//     length` — pure `Math.hypot` arithmetic on the line's own two
//     endpoints, never `getTotalLength()`, which jsdom does not implement).
//     The DOT keeps a plain fade (`brain-link-enter`, reused verbatim) — it
//     has no length to draw. The caller re-keys this component per pin so
//     both replay on every pin, not just the first. Absent renders the
//     connector exactly as before — no style/class attribute at all.
//
// === DEPENDENCIES ===
// react, d3-zoom (ZoomTransform type), forceLayout (LayoutNode type)

import { useEffect, useRef, useState } from 'react';
import type { ZoomTransform } from 'd3-zoom';
import type { LayoutNode } from './forceLayout';

const CARD_W = 320; // fixed inspector-card width (px)
const CARD_GAP = 16; // gap between the node edge and the card's near edge
const CARD_MARGIN = 12; // keep the whole card this far from the container edges
const CARD_EST_H = 360; // height guess used until the card measures itself (px)
// Floor for the container-derived cap, so a very short container yields a
// small-but-usable card (header + a little body) rather than a degenerate sliver.
const CARD_MIN_H = 180;
const FALLBACK_W = 900;
const FALLBACK_H = 600;

/** The only four fields this layer reads off a laid-out node. Declared
 *  structurally (rather than as `LayoutNode`, which defaults to the ENTITY
 *  graph's node shape) so the twin memory graph's `LayoutNode<TwinGraphNode>`
 *  can be passed in unchanged — additive widening, no caller affected. */
export type AnchoredNode = Pick<LayoutNode, 'id' | 'x' | 'y' | 'radius'> & {
  /** Overrides the node's RIGHT-side reach only, in the same pre-zoom-scale
   *  layout units as `radius` (scaled by `transform.k` identically). A plain
   *  circular node has nothing to its right beyond its own edge, so leaving
   *  this unset — as every BrainMemoryGraph node does — reproduces exactly
   *  the old `radius`-only anchor. */
  rightExtent?: number;
};

/** A node's on-screen left/right edge centres, through the live zoom transform.
 *  Pure — the graph node is a CIRCLE, so its LEFT edge is always centre -
 *  radius*scale; the RIGHT edge is centre + radius*scale UNLESS `rightExtent`
 *  widens it (a riverbank row, whose caption extends past the soma). */
export function nodeScreenAnchor(
  node: Pick<LayoutNode, 'x' | 'y' | 'radius'> & Pick<AnchoredNode, 'rightExtent'>,
  transform: ZoomTransform,
): { rightX: number; leftX: number; sy: number } {
  const [cx, sy] = transform.apply([node.x, node.y]);
  const leftReach = node.radius * transform.k;
  const rightReach = (node.rightExtent ?? node.radius) * transform.k;
  return { rightX: cx + rightReach, leftX: cx - leftReach, sy };
}

/** Default to the RIGHT of the node, flip LEFT when that would overflow, then
 *  clamp both axes so the whole card stays inside the container. Returns the card
 *  top-left plus the connector's node-side x. Pure. */
export function computeCardPlacement(
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
  /** Play the connector's one-shot draw-in/fade instead of it simply
   *  appearing. Opt-in (see the file header) — omitted, the connector renders
   *  exactly as it always has. */
  animateConnector?: boolean;
}

/** The card + its connector line. Measures its own height AND the container (both
 *  via ResizeObserver — event-driven, no rAF; absent in jsdom, where the estimate
 *  and fallbacks stand). Refs are read inside effects only, never during render. */
function PinnedCard({ panel, rightX, leftX, sy, svgRef, animateConnector }: PinnedCardProps) {
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
  // The connector is a STRAIGHT LINE, so its length is pure arithmetic — never
  // getTotalLength(), which jsdom does not implement and which would behave
  // one way in the app and another in every test regardless.
  const connectorLength = Math.hypot(cardNearX - connectorX, cardAttachY - sy);

  return (
    <>
      {/* Connector overlay — never intercepts the canvas's pan/zoom. */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none z-10" aria-hidden="true">
        {/* The LINE draws OUT of the node toward the card: `x1,y1` (the node
            side) is this path's start, `x2,y2` (the card side) its end, so
            animating stroke-dashoffset from the line's own length down to 0
            (globals.css's graph-connector-draw-in, driven by the
            --connector-length custom property set below) sweeps start->end
            — node->card, reading as growing OUT of the thing that was
            clicked. See that keyframe's own comment for why no fill-mode is
            needed for this one to end clean. */}
        <line
          data-testid="memory-graph-connector"
          x1={connectorX}
          y1={sy}
          x2={cardNearX}
          y2={cardAttachY}
          stroke="var(--color-accent)"
          strokeWidth={1.5}
          strokeDasharray={animateConnector ? connectorLength : undefined}
          className={animateConnector ? 'graph-connector-draw-in' : undefined}
          style={
            animateConnector ? ({ '--connector-length': String(connectorLength) } as React.CSSProperties) : undefined
          }
        />
        {/* The dot keeps the simpler fade (brain-link-enter, reused
            verbatim) — it has no length for a sweep to express. */}
        <circle
          cx={connectorX}
          cy={sy}
          r={3}
          fill="var(--color-accent)"
          style={animateConnector ? { animation: 'brain-link-enter 220ms ease-out' } : undefined}
        />
      </svg>
      {/* maxHeight is derived from the CONTAINER, not the viewport — see the same
          fix in BrainMindMap's PinnedCard. The card's own cap is in vh, which says
          nothing about this container; whenever it resolved taller, the `top` clamp
          above degenerated to CARD_MARGIN and the card ran off the bottom with its
          overflow (and sometimes its ✕) unreachable. `flex flex-col` + the card's
          own `min-h-0` let it shrink to this cap rather than overflow it. */}
      <div
        ref={cardRef}
        data-testid="memory-graph-pinned-card"
        style={{ left, top, width: CARD_W, maxHeight: Math.max(CARD_MIN_H, container.h - CARD_MARGIN * 2) }}
        className="absolute z-20 flex flex-col overflow-hidden break-words"
      >
        {panel}
      </div>
    </>
  );
}

/** Resolve the pinned node's on-screen anchor and render the card — or nothing
 *  when the pin/panel/layout aren't all present, or the pinned node is no longer
 *  in the graph (e.g. a refresh dropped it): never crash, just hide it. */
export default function GraphPinnedCardLayer({
  pinnedId,
  panel,
  nodes,
  zoomTransform,
  svgRef,
  animateConnector,
}: {
  pinnedId: string | null | undefined;
  panel: React.ReactNode;
  nodes: readonly AnchoredNode[] | null;
  zoomTransform: ZoomTransform;
  svgRef: React.RefObject<SVGSVGElement | null>;
  /** See PinnedCardProps — optional, additive, BrainMemoryGraph omits it. */
  animateConnector?: boolean;
}) {
  if (!pinnedId || !panel || !nodes) return null;
  const node = nodes.find((n) => n.id === pinnedId);
  if (!node) return null;
  const { rightX, leftX, sy } = nodeScreenAnchor(node, zoomTransform);
  return (
    <PinnedCard
      panel={panel}
      rightX={rightX}
      leftX={leftX}
      sy={sy}
      svgRef={svgRef}
      animateConnector={animateConnector}
    />
  );
}
