// === FILE PURPOSE ===
// One CONNECTION in the twin memory graph, drawn as a dendrite (TWIN-READ.1
// Task 4) — the change that stops the canvas reading as a diagram.
//
// Three elements, and each is answering something the old uniform 1px stroke
// could not:
//   * THE RIBBON — a filled, tapered bézier (synapticVisuals.dendriteRibbonPath),
//     wide where it leaves the parent and thin where it arrives. Direction is
//     legible from the SHAPE, at any zoom, with no arrowhead and no motion.
//   * THE TERMINAL — a small filled dot on the receiving node's membrane. One
//     circle per edge; the detail that reads as "synapse" rather than "line".
//   * THE PULSE — a stroked copy of the centreline whose dash travels outward
//     when the user touches a node. Mounted ONLY while a pulse is live and
//     removed with it, so idle costs nothing.
//
// SPLIT OUT OF THE CANVAS ON PURPOSE: TwinMemoryGraphCanvas.tsx was already 829
// lines before this task, and the standing directive was that it gain
// composition, not path math.
//
// THE PER-FRAME CONTRACT, which is easy to break silently: while the simulation
// is hot the canvas's rAF paint writes `d` on `[data-edge-key]` and cx/cy on
// `[data-terminal-for]` DIRECTLY, bypassing React. So those two attributes have
// exactly one shape here and one in the paint loop, and both read the same live
// node objects. The pulse path is deliberately NOT in that loop: it lives for
// ~half a second on an already-settled graph, and one more per-frame attribute
// write on every edge is a worse trade than a stale highlight during the rare
// pulse-while-dragging overlap.
//
// === DEPENDENCIES ===
// react (types), forceLayout (LayoutLink), graphVisuals (curvedEdgePath +
// palette), synapticVisuals (all geometry and class names), shared twin types

import type { LayoutLink } from '../brain-graph/forceLayout';
import { TWIN_GRAPH_TYPE_COLOR, curvedEdgePath } from '../brain-graph/graphVisuals';
import {
  DENDRITE_GRADIENT_ID,
  DENDRITE_GRADIENT_STOPS,
  DENDRITE_PULSE_CLASS,
  DENDRITE_PULSE_REVERSE_CLASS,
  DENDRITE_STOP_OPACITY,
  FADED_CLASS,
  TERMINAL_RADIUS,
  dendriteFillOf,
  dendriteRibbonPath,
  terminalPointOf,
  type PulseDirection,
} from './synapticVisuals';
import type { TwinGraphEdgeKind, TwinGraphNode } from '../../../shared/types';

type DendriteLink = LayoutLink<TwinGraphNode>;

/** Every edge kind the twin graph emits, in the order they are defined. */
const EDGE_KINDS: readonly TwinGraphEdgeKind[] = ['twin-hub', 'hub-fact'];

/** One connector fading in with a newly-learned memory. Reuses globals.css's
 *  existing brain-link-enter keyframes rather than inventing a parallel one. */
const EDGE_ENTRANCE_STYLE: React.CSSProperties = { animation: 'brain-link-enter 300ms ease-out' };

/**
 * The gradient definitions every dendrite references — TWO of them, one per edge
 * kind, not one per edge. See DENDRITE_GRADIENT_ID for why that is identical in
 * output and cheaper by three orders of magnitude on a full ledger.
 *
 * Default `objectBoundingBox` units with y1=0 -> y2=1 means each gradient runs
 * top-to-bottom of whatever path references it, and the tiered layout guarantees
 * the parent is always the higher of the two — so "hub hue at the top, fact hue
 * at the bottom" is a property of the LAYOUT, not a per-edge calculation, and it
 * stays correct while the simulation moves the endpoints.
 */
export function TwinMemoryDendriteDefs() {
  return (
    <defs>
      {EDGE_KINDS.map((kind) => (
        <linearGradient key={kind} id={DENDRITE_GRADIENT_ID[kind]} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={DENDRITE_GRADIENT_STOPS[kind].from} stopOpacity={DENDRITE_STOP_OPACITY.from} />
          <stop offset="100%" stopColor={DENDRITE_GRADIENT_STOPS[kind].to} stopOpacity={DENDRITE_STOP_OPACITY.to} />
        </linearGradient>
      ))}
    </defs>
  );
}

/** A live activation pulse: the node the user touched, plus a sequence number.
 *  The sequence is what makes a REPEAT touch replay — React reuses an element
 *  with an unchanged key, and a running CSS animation on a reused element does
 *  not restart. */
export interface DendritePulse {
  id: string;
  seq: number;
}

/**
 * Which way a pulse travels along one connection — OUTWARD from the node the
 * user touched, always.
 *
 * A dendrite's `d` runs parent -> child, so a connection the pulsed node OWNS
 * plays forward and one it RECEIVES plays reversed. Getting this backwards is
 * not a cosmetic slip: a highlight converging on the thing you just touched
 * reads as the graph answering back, not as the memory activating outward.
 */
export function pulseDirectionFor(link: DendriteLink, pulse: DendritePulse | null): PulseDirection {
  if (!pulse) return 'none';
  if (link.source.id === pulse.id) return 'forward';
  if (link.target.id === pulse.id) return 'reverse';
  return 'none';
}

export interface TwinMemoryDendriteProps {
  edgeKey: string;
  link: DendriteLink;
  /** The node the user is attending to, if any. Resolved here rather than by the
   *  canvas so the canvas stays composition — same division GraphEdge had. */
  hoveredId: string | null;
  /** The live activation pulse, or null between pulses. */
  pulse: DendritePulse | null;
  /** This connector arrived with a newly-learned memory — fade it in once. */
  entering: boolean;
  fadeClass: string;
}

/** One dendrite: ribbon, terminal, and (only while live) an activation pulse. */
export default function TwinMemoryDendrite({
  edgeKey,
  link,
  hoveredId,
  pulse,
  entering,
  fadeClass,
}: TwinMemoryDendriteProps) {
  const { source, target } = link;
  const touched = hoveredId != null && (source.id === hoveredId || target.id === hoveredId);
  const faded = hoveredId != null && !touched;
  const direction = pulseDirectionFor(link, pulse);
  const terminal = terminalPointOf(source.x, source.y, target.x, target.y, target.radius);
  const attenuation = faded ? FADED_CLASS : touched ? 'opacity-100' : 'opacity-70';

  return (
    <g data-dendrite={edgeKey}>
      <path
        data-edge-key={edgeKey}
        data-kind={link.kind}
        data-faded={faded || undefined}
        style={entering ? EDGE_ENTRANCE_STYLE : undefined}
        d={dendriteRibbonPath(source.x, source.y, target.x, target.y)}
        fill={dendriteFillOf(link.kind)}
        stroke="none"
        className={`${attenuation} ${fadeClass}`}
      />
      <circle
        data-terminal-for={edgeKey}
        cx={terminal.x}
        cy={terminal.y}
        r={TERMINAL_RADIUS}
        fill={TWIN_GRAPH_TYPE_COLOR[target.type]}
        opacity={touched ? 0.95 : 0.7}
        className={`${faded ? FADED_CLASS : ''} ${fadeClass}`}
      />
      {direction !== 'none' && (
        <path
          key={`pulse-${pulse?.seq}`}
          data-pulse-for={edgeKey}
          data-pulse-direction={direction}
          d={curvedEdgePath(source.x, source.y, target.x, target.y)}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={2}
          strokeLinecap="round"
          className={
            direction === 'reverse' ? `${DENDRITE_PULSE_CLASS} ${DENDRITE_PULSE_REVERSE_CLASS}` : DENDRITE_PULSE_CLASS
          }
        />
      )}
    </g>
  );
}
