// === FILE PURPOSE ===
// ONE CONNECTION on the riverbank canvas (TWIN-READ.2 Task 2), drawn as a RIVER
// DELTA S-CURVE: a filled tapered ribbon bounded by two cubics with HORIZONTAL
// tangents at both ends, so a branch leaves its hub flowing right and arrives at
// its row flowing right.
//
// WHY NOT TwinMemoryDendrite: that component draws the TIERED canvas's quadratic
// ribbon, whose single control point makes it bow "up and over" a horizontal run
// — the user saw exactly that in the real TWIN-READ.1 render and called it
// "weird". Both components are thin compositions over synapticVisuals; the
// geometry is shared, the CURVE FAMILY is not (see synapticVisuals' river
// section for the full argument). The tiered one is untouched and still serves
// the retained canvas.
//
// THREE ELEMENTS, and one of them is deliberately absent on a trunk:
//   * THE RIBBON — `sRibbonPath`, filled with the shared left→right gradient of
//     its kind, never stroked. Direction is legible from the SHAPE.
//   * THE TERMINAL — a dot on the receiving soma's membrane, for FACT-LEVEL
//     EDGES ONLY. A trunk ends at a hub that is itself a control with a count
//     inside it; a dot there would read as a second, unclickable affordance.
//   * THE PULSE — a stroked copy of the centreline, mounted ONLY while a pulse
//     is live and removed with it, so idle costs nothing.
//
// THE GROWTH CASCADE lives on the ribbon's wrapper group: `scaleX` about the
// ribbon's LEFT edge, which — because every river edge runs strictly left to
// right — is exactly its hub end. That is the "branch draws outward from the
// hub" reveal, expressed in the one transform every engine gets right. The
// class carries NO persistent fill; see riverMotion.ts's header for why that
// matters. TWO CALLERS drive `growthDelayMs`, both zero-JS-cleanup: a LANE
// CASCADE (the canvas strips the class once the cascade window closes) and a
// fact ARRIVING into an already-open lane (TWIN-READ.2 Task 5 — zero delay,
// nothing strips it because nothing needs to: the CSS animation's default
// fill-mode already reverts cleanly on its own once it has played once, the
// same guarantee the row's own `brain-node-enter` bloom already relies on).
//
// >>> CATEGORY-SCOPED ATTENTION (TWIN-READ.2 Task 4) shares that SAME wrapper
// group. <<< Unlike the row (whose attention lives on a DIFFERENT element
// than its animation slot, on purpose), this is safe here: the growth
// class's fill-mode is `backwards`, which — unlike forwards/both — retains
// NOTHING once the animation ends (globals.css's own header states this).
// `opacity` is a normal-cascade ATTRIBUTE, so once growth finishes the
// element falls straight back to it; no separate wrapper needed. It replaces
// the flat `opacity-70` this ribbon used to carry at rest — the mockup itself
// draws every edge at full opacity absent an attending ancestor, so 'lit'
// (1) is the correct neutral, not 0.7.
//
// === DEPENDENCIES ===
// react (types), synapticVisuals (river path math, gradients, pulse classes,
// attention transition class), riverMotion (cascade class), graphVisuals
// (palette), shared twin types

import { TWIN_GRAPH_TYPE_COLOR } from '../brain-graph/graphVisuals';
import {
  ATTENTION_TRANSITION_CLASS,
  DENDRITE_GRADIENT_STOPS,
  DENDRITE_PULSE_CLASS,
  DENDRITE_PULSE_REVERSE_CLASS,
  DENDRITE_STOP_OPACITY,
  RIVER_DENDRITE_GRADIENT_ID,
  TERMINAL_RADIUS,
  riverDendriteFillOf,
  riverTerminalPointOf,
  sCenterlinePath,
  sRibbonPath,
  type PulseDirection,
} from './synapticVisuals';
import { BRANCH_GROWTH_CLASS } from './riverMotion';
import type { TwinGraphEdgeKind } from '../../../shared/types';

/** Every edge kind the twin graph emits, in the order they are defined. */
const EDGE_KINDS: readonly TwinGraphEdgeKind[] = ['twin-hub', 'hub-fact'];

/**
 * The gradient definitions every river dendrite references — TWO of them, one
 * per edge kind, not one per edge. `objectBoundingBox` units running x1=0 →
 * x2=1 means each gradient runs left-to-right across whatever path references
 * it, and the riverbank guarantees the parent is always the LEFTMOST of the two
 * — so "hub hue at the left, fact hue at the right" is a property of the
 * LAYOUT, not a per-edge calculation. The stop colours and alphas are the
 * tiered canvas's own (DENDRITE_GRADIENT_STOPS / DENDRITE_STOP_OPACITY): one
 * memory does not change colour because the layout did.
 */
export function TwinMemoryRiverDendriteDefs() {
  return (
    <defs>
      {EDGE_KINDS.map((kind) => (
        <linearGradient key={kind} id={RIVER_DENDRITE_GRADIENT_ID[kind]} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={DENDRITE_GRADIENT_STOPS[kind].from} stopOpacity={DENDRITE_STOP_OPACITY.from} />
          <stop offset="100%" stopColor={DENDRITE_GRADIENT_STOPS[kind].to} stopOpacity={DENDRITE_STOP_OPACITY.to} />
        </linearGradient>
      ))}
    </defs>
  );
}

/** One river connection, resolved to pixels by the canvas. Positions come from
 *  `computeRiverLayout`; nothing here recomputes geometry. */
export interface RiverEdge {
  /** Stable per-edge key, `${index}:${fromId}>${toId}` — the same shape the
   *  tiered canvas used, so pulse assertions read the same on both. */
  key: string;
  kind: TwinGraphEdgeKind;
  fromId: string;
  toId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Ribbon width at the parent / at the child. */
  hubWidth: number;
  tipWidth: number;
  /** Where the S turns, as a fraction of the run (id-hashed per branch). */
  bend: number;
  /** Receiving node's radius, or null for a trunk — which draws no terminal. */
  targetRadius: number | null;
}

/** A live activation pulse: the node the user touched, plus a sequence number
 *  (a CSS animation only replays when React can see something change). */
export interface RiverPulse {
  id: string;
  seq: number;
}

/**
 * Which way a pulse travels along one connection — OUTWARD from the node the
 * user touched, always. A ribbon's `d` runs parent → child, so a connection the
 * pulsed node OWNS plays forward and one it RECEIVES plays reversed. Backwards
 * would read as the graph answering back rather than as a memory activating.
 */
export function riverPulseDirectionFor(edge: RiverEdge, pulse: RiverPulse | null): PulseDirection {
  if (!pulse) return 'none';
  if (edge.fromId === pulse.id) return 'forward';
  if (edge.toId === pulse.id) return 'reverse';
  return 'none';
}

export interface TwinMemoryRiverDendriteProps {
  edge: RiverEdge;
  pulse: RiverPulse | null;
  /** ms this branch waits before growing out of its hub, or null when it is not
   *  growing (at rest, or under reduced motion). Either a lane-cascade delay
   *  or a flat 0 for a branch whose own fact just arrived (Task 5) — the
   *  caller resolves which; this component only plays what it is given. */
  growthDelayMs: number | null;
  /** Category-scoped attention (TWIN-READ.2 Task 4): this connection's own
   *  opacity — a trunk tracks its hub, a branch tracks the fact it feeds (see
   *  riverAttention.ts). 1 (own category, or nothing attended), ~0.55 (a
   *  sibling branch), ~0.25 (every other category). Persists under reduced
   *  motion. */
  attentionOpacity: number;
  /** Gates the ~150ms opacity EASE only. */
  reducedMotion: boolean;
}

/** One river dendrite: ribbon, terminal (facts only), and — only while live —
 *  an activation pulse. */
export default function TwinMemoryRiverDendrite({
  edge,
  pulse,
  growthDelayMs,
  attentionOpacity,
  reducedMotion,
}: TwinMemoryRiverDendriteProps) {
  const direction = riverPulseDirectionFor(edge, pulse);
  // Inset by the soma's radius PLUS the dot's own, so the terminal sits TANGENT
  // to the membrane rather than sunk into it — the mockup's `factX - 7.5` for
  // its radius-5 soma is exactly that sum, and the mockup is the contract.
  const terminal =
    edge.targetRadius === null ? null : riverTerminalPointOf(edge.x2, edge.y2, edge.targetRadius + TERMINAL_RADIUS);
  const growing = growthDelayMs !== null;
  const wrapperClassName = [growing ? BRANCH_GROWTH_CLASS : null, reducedMotion ? null : ATTENTION_TRANSITION_CLASS]
    .filter(Boolean)
    .join(' ');

  return (
    <g
      data-dendrite={edge.key}
      className={wrapperClassName || undefined}
      style={growing ? { animationDelay: `${growthDelayMs}ms` } : undefined}
      opacity={attentionOpacity}
    >
      <path
        data-edge-key={edge.key}
        data-kind={edge.kind}
        d={sRibbonPath(edge.x1, edge.y1, edge.x2, edge.y2, edge.hubWidth, edge.tipWidth, edge.bend)}
        fill={riverDendriteFillOf(edge.kind)}
        stroke="none"
      />
      {terminal && (
        <circle
          data-terminal-for={edge.key}
          cx={terminal.x}
          cy={terminal.y}
          r={TERMINAL_RADIUS}
          fill={TWIN_GRAPH_TYPE_COLOR.fact}
          opacity={0.7}
        />
      )}
      {direction !== 'none' && (
        <path
          key={`pulse-${pulse?.seq}`}
          data-pulse-for={edge.key}
          data-pulse-direction={direction}
          d={sCenterlinePath(edge.x1, edge.y1, edge.x2, edge.y2, edge.bend)}
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
