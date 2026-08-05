// === FILE PURPOSE ===
// The twin memory graph's SYNAPTIC visual language (TWIN-READ.1 Task 4), as pure
// numbers, path strings and class names. No React, no DOM, no d3 — so every
// piece of geometry below is unit-testable on its own, and the canvas component
// gains composition rather than several hundred lines of path math (the explicit
// directive for this task: TwinMemoryGraphCanvas.tsx was already 829 lines).
//
// THE POINT OF THE WHOLE EXERCISE: a uniform 1px stroke between two circles is
// what makes a force graph read as a DIAGRAM. Three cheap changes make it read
// as tissue instead, and none of them needs a filter, a canvas or a dependency:
//
//   1. A DENDRITE IS A FILLED TAPERED RIBBON, not a stroke — wide where it
//      leaves the parent (soma) and thin where it reaches the child. This is the
//      single highest-impact item in the phase.
//   2. A SOMA IS A CORE INSIDE TWO CONCENTRIC LOW-ALPHA RINGS. Layered alpha is
//      a glow; `feGaussianBlur` per node is a per-frame filter pass on hundreds
//      of elements, which is exactly the GPU cost this phase exists to avoid.
//      (Explicitly forbidden by the plan, not merely avoided.)
//   3. A CONNECTION ENDS IN A SYNAPTIC TERMINAL — a small filled dot where it
//      meets the receiving node. It is the detail that sells "synapse" over
//      "line", and it costs one circle per edge.
//
// WHY THE TAPER IS TWO BÉZIERS AND NOT AN OFFSET CURVE: exactly offsetting a
// quadratic bézier by a varying distance is not itself a quadratic bézier (it is
// a rational curve of higher degree), so the honest cheap construction is to
// bound the ribbon with two quadratics — one down each side — whose control
// points are offset along the curve's own normals. At dendrite scale (≤4px wide
// over ~260px of length) the difference from a true offset is sub-pixel, and it
// stays a single `d` string the existing per-frame paint can write.
//
// EVERY FUNCTION HERE IS TOTAL. A NaN reaching a `d` attribute silently drops
// the whole path — the same failure mode tieredLayout guards against — so
// degenerate input (identical endpoints, a non-finite coordinate, a zero radius)
// returns something finite and drawable rather than something plausible.
//
// === DEPENDENCIES ===
// graphVisuals (EDGE_CURVATURE + the twin palette — read only, never modified),
// shared twin types

import { EDGE_CURVATURE, TWIN_GRAPH_TYPE_COLOR } from '../brain-graph/graphVisuals';
import type { TwinGraphEdgeKind } from '../../../shared/types';

// ---------------------------------------------------------------------------
// SURFACE
// ---------------------------------------------------------------------------

/** The graph's own ALWAYS-DARK surface, in both app themes (explicit user
 *  decision). The class re-pins the dark palette for its whole subtree — the
 *  `.on-accent-surface` idiom already in globals.css — so every `var(--color-*)`
 *  the canvas already used keeps working and no component needs a light/dark
 *  branch. Glow and gradients only read on dark, and maintaining two visual
 *  languages would be twice the surface to get wrong. */
export const GRAPH_SURFACE_CLASS = 'twin-graph-surface';

// ---------------------------------------------------------------------------
// ATTENUATION — depth as attention (item 6)
// ---------------------------------------------------------------------------

/** Opacity of a lane region whose facts are not disclosed. Applied to the lane
 *  CHROME only (an aria-hidden `<g>` of scenery), never to the hub that opens
 *  it: the hub is a real control, and dimming a control to a third of its
 *  contrast is an accessibility regression dressed as depth. */
export const COLLAPSED_LANE_OPACITY = 0.35;
export const EXPANDED_LANE_OPACITY = 1;

/** Fill/stroke of a lane region, brighter once the lane is open — so "which lane
 *  am I reading" is answered by the region itself, not only by its contents. */
export const LANE_REGION_FILL_OPACITY = { collapsed: 0.03, expanded: 0.07 };

/** What a node/dendrite fades to while the user is attending to something else.
 *  0.3 rather than the 0.15 this started at: attenuation is decoration, and a
 *  node that is still focusable and still nameable must also still be legible
 *  when a screen reader lands on it. Shared by the canvas and its dendrites so
 *  the two can never drift apart. */
export const FADED_CLASS = 'opacity-30';

// ---------------------------------------------------------------------------
// SOMA (item 1)
// ---------------------------------------------------------------------------

/** Extra radius of the tight inner ring, in px. */
export const SOMA_INNER_RING_PX = 3;
/** Extra radius of the outer bloom ring, in px. */
export const SOMA_OUTER_RING_PX = 9;

/** Ring alphas at rest and while the node is attended to. Low on purpose: two
 *  layered discs at these alphas read as a glow; at higher ones they read as a
 *  target. */
export const SOMA_RING_OPACITY = { outer: 0.07, inner: 0.16 };
export const SOMA_RING_OPACITY_ACTIVE = { outer: 0.16, inner: 0.32 };

export interface SomaRing {
  /** Stable identity for the React key and for `data-soma-ring`. */
  key: 'outer' | 'inner';
  r: number;
  opacity: number;
}

/**
 * The two concentric rings behind a node's core, outermost first (SVG paints in
 * document order, so the bloom must be emitted before the tighter ring).
 *
 * `halo` is the prominence-derived glow width the node already carries
 * (`GLOW_HALO_PX[node.glow]`) — a livelier memory blooms wider. Nothing here
 * re-derives prominence; it only maps an already-computed number onto pixels.
 */
export function somaRingsFor(radius: number, halo: number, active: boolean): SomaRing[] {
  const base = Number.isFinite(radius) && radius > 0 ? radius : 1;
  const bloom = Number.isFinite(halo) && halo > 0 ? halo : 0;
  const alpha = active ? SOMA_RING_OPACITY_ACTIVE : SOMA_RING_OPACITY;
  return [
    { key: 'outer', r: base + SOMA_OUTER_RING_PX + bloom, opacity: alpha.outer },
    { key: 'inner', r: base + SOMA_INNER_RING_PX + bloom * 0.4, opacity: alpha.inner },
  ];
}

// ---------------------------------------------------------------------------
// DENDRITES (items 2 and 3)
// ---------------------------------------------------------------------------

/** Ribbon width where a connection leaves the PARENT node, in px. */
export const DENDRITE_HUB_WIDTH = 3.5;
/** Ribbon width where it reaches the CHILD node, in px. */
export const DENDRITE_TIP_WIDTH = 0.75;
/** Radius of the synaptic terminal dot. */
export const TERMINAL_RADIUS = 2.4;

/** One shared gradient definition per edge KIND rather than one per edge.
 *
 *  DELIBERATE, AND STATED: the plan asked for a per-connection `linearGradient`.
 *  Because these gradients are expressed in the default `objectBoundingBox`
 *  units and run straight down (y1=0 -> y2=1), and because the tiered layout
 *  guarantees a connection's source is ALWAYS in the tier above its target
 *  (twin -> hub -> fact), every edge of a kind would need a byte-identical
 *  definition. Two `<linearGradient>` elements therefore render exactly what N
 *  of them would, and a 600-fact ledger does not pay for 600 gradient elements
 *  plus 1200 stops on the same GPU this phase is protecting. */
export const DENDRITE_GRADIENT_ID: Record<TwinGraphEdgeKind, string> = {
  'twin-hub': 'twin-dendrite-twin-hub',
  'hub-fact': 'twin-dendrite-hub-fact',
};

/** Hub hue -> fact hue: the gradient carries direction without motion. Stops are
 *  taken from the SAME palette the nodes use, so a connection is visibly made of
 *  the two things it joins. */
export const DENDRITE_GRADIENT_STOPS: Record<TwinGraphEdgeKind, { from: string; to: string }> = {
  'twin-hub': { from: TWIN_GRAPH_TYPE_COLOR.twin, to: TWIN_GRAPH_TYPE_COLOR.category },
  'hub-fact': { from: TWIN_GRAPH_TYPE_COLOR.category, to: TWIN_GRAPH_TYPE_COLOR.fact },
};

/** Alpha at each end of a dendrite: it emerges from the parent and firms up as
 *  it arrives, which is what makes the terminal read as the business end. */
export const DENDRITE_STOP_OPACITY = { from: 0.35, to: 0.85 };

/** Every edge kind the twin canvas can be handed. `LayoutLink.kind` is widened to
 *  the union of the brain graph's kinds and the twin graph's, so an unknown kind
 *  resolves to the leaf gradient rather than to `undefined` in a `url(#...)`. */
export function dendriteGradientIdOf(kind: string): string {
  return kind === 'twin-hub' ? DENDRITE_GRADIENT_ID['twin-hub'] : DENDRITE_GRADIENT_ID['hub-fact'];
}

/** `fill` value for a dendrite of the given kind. */
export function dendriteFillOf(kind: string): string {
  return `url(#${dendriteGradientIdOf(kind)})`;
}

interface Vec {
  x: number;
  y: number;
}

/** Unit normal (left-hand) of a vector. A zero-length vector has no direction, so
 *  it yields the zero vector — which collapses the ribbon to its centreline
 *  rather than producing NaN. */
function unitNormal(dx: number, dy: number): Vec {
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return { x: 0, y: 0 };
  return { x: -dy / length, y: dx / length };
}

/** The quadratic control point of a connection — the same bow `curvedEdgePath`
 *  draws, so the ribbon and the pulse that travels along it agree on the curve.
 *  (graphVisuals is shared with the session Brain canvas and was deliberately
 *  left untouched, so the three lines are restated here rather than refactored
 *  out of it.) */
function controlPointOf(x1: number, y1: number, x2: number, y2: number, curvature: number): Vec {
  return {
    x: (x1 + x2) / 2 - (y2 - y1) * curvature,
    y: (y1 + y2) / 2 + (x2 - x1) * curvature,
  };
}

function allFinite(...values: number[]): boolean {
  return values.every((value) => Number.isFinite(value));
}

/**
 * A dendrite as a CLOSED, FILLED, TAPERED ribbon: wide at (x1,y1) — the parent —
 * and thin at (x2,y2) — the child.
 *
 * The outline is `M l0 Q lc l1 L r1 Q rc r0 Z`: down the left side, across the
 * narrow tip, back up the right side. Each side's control point is the shared
 * bézier control offset along the CHORD normal, and each endpoint is offset
 * along that end's own tangent normal, which is what keeps the ribbon square to
 * the curve where it meets a node instead of skewed.
 *
 * Returns '' for non-finite input: an absent `d` draws nothing, which is a
 * visible-but-harmless gap, whereas a NaN silently voids the path element.
 */
export function dendriteRibbonPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  hubWidth: number = DENDRITE_HUB_WIDTH,
  tipWidth: number = DENDRITE_TIP_WIDTH,
  curvature: number = EDGE_CURVATURE,
): string {
  if (!allFinite(x1, y1, x2, y2, hubWidth, tipWidth, curvature)) return '';
  const control = controlPointOf(x1, y1, x2, y2, curvature);

  // Normals at the two ends come from the curve's own tangents there; the
  // control point's comes from the chord, which is its tangent by construction.
  const nStart = unitNormal(control.x - x1, control.y - y1);
  const nEnd = unitNormal(x2 - control.x, y2 - control.y);
  const nMid = unitNormal(x2 - x1, y2 - y1);

  const hStart = hubWidth / 2;
  const hEnd = tipWidth / 2;
  const hMid = (hStart + hEnd) / 2;

  return (
    `M${x1 + nStart.x * hStart},${y1 + nStart.y * hStart}` +
    `Q${control.x + nMid.x * hMid},${control.y + nMid.y * hMid} ` +
    `${x2 + nEnd.x * hEnd},${y2 + nEnd.y * hEnd}` +
    `L${x2 - nEnd.x * hEnd},${y2 - nEnd.y * hEnd}` +
    `Q${control.x - nMid.x * hMid},${control.y - nMid.y * hMid} ` +
    `${x1 - nStart.x * hStart},${y1 - nStart.y * hStart}Z`
  );
}

/**
 * Where a connection MEETS its receiving node — on the curve, at the node's own
 * edge rather than at its centre, so the terminal dot sits on the membrane the
 * way a synapse does.
 *
 * Backed off from the target along the curve's arrival direction (target minus
 * control point), never past the control point itself, so a very short
 * connection cannot put the terminal behind the parent.
 */
export function terminalPointOf(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  targetRadius: number,
  curvature: number = EDGE_CURVATURE,
): Vec {
  if (!allFinite(x1, y1, x2, y2)) return { x: 0, y: 0 };
  const control = controlPointOf(x1, y1, x2, y2, curvature);
  const dx = x2 - control.x;
  const dy = y2 - control.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return { x: x2, y: y2 };
  const inset = Number.isFinite(targetRadius) && targetRadius > 0 ? Math.min(targetRadius, length) : 0;
  return { x: x2 - (dx / length) * inset, y: y2 - (dy / length) * inset };
}

// ---------------------------------------------------------------------------
// MOTION — the two sanctioned animations, and their gates (items 5 + the shimmer)
// ---------------------------------------------------------------------------

/** One-shot travelling highlight along a connection, INTERACTION-TRIGGERED only,
 *  so simulate-then-freeze holds: nothing is scheduled unless the user touches a
 *  node. Keyframes live in globals.css. */
export const DENDRITE_PULSE_CLASS = 'twin-dendrite-pulse';

/** The same animation played backwards, for a connection the pulsed node RECEIVES
 *  — the highlight must travel OUTWARD from what the user touched, and a
 *  connection's path always runs parent -> child. */
export const DENDRITE_PULSE_REVERSE_CLASS = 'twin-dendrite-pulse-reverse';

/** How long a pulse lives, in ms. The element is removed after this — a class
 *  that outlived its animation would be a permanent GPU tenant, which is the one
 *  thing this graph must never leave behind. Kept a hair above the CSS duration
 *  so the animation is never cut short. */
export const DENDRITE_PULSE_MS = 560;

/** Direction a pulse travels along one connection, relative to its `d`. */
export type PulseDirection = 'none' | 'forward' | 'reverse';

/** THE ONE SANCTIONED IDLE ANIMATION: a slow CSS breath on the twin core node's
 *  outer ring, and nothing else on the canvas.
 *
 *  Scope is the whole allowance, and it is deliberate rather than incidental —
 *  shimmer on every node was explicitly rejected, because a permanent animation
 *  loop competes with local Whisper transcription and a local LLM for the same
 *  GPU, which is the entire reason the zero-idle rule exists. It is applied only
 *  while the Memory tab is on screen AND the window is visible, and never under
 *  `prefers-reduced-motion`. */
export const CORE_SHIMMER_CLASS = 'twin-core-shimmer';

// ---------------------------------------------------------------------------
// RIVER DENDRITES (TWIN-READ.2 Task 1) — additive, below the tiered-canvas
// boundary above. Everything above this line is UNCHANGED and still serves
// TwinMemoryGraphCanvas + TwinMemoryDendrite exactly as before; this section
// is the S-curve vocabulary riverLayout.ts's geometry pairs with.
//
// THE DESIGN CONTRACT IS THE MOCKUP:
// .planning/design/twin-memory-layout-variants.html (?v=riverbank), its
// `sRibbon`/`sCenter` functions. Constants and shapes below are lifted from
// there, not invented — see each export's doc comment for exactly where.
//
// WHY A SEPARATE CURVE FAMILY, not a parameter on dendriteRibbonPath above:
// the tiered ribbon's taper is bounded by a QUADRATIC bézier whose end
// tangents point wherever its one shared control point is, which is what
// makes it bow "up and over" on a horizontal run — the user saw exactly that
// in the real TWIN-READ.1 render and called it "weird" on sight. A river
// dendrite instead uses two CUBIC béziers with HORIZONTAL tangents at BOTH
// ends: a branch leaves its hub flowing right and arrives at its fact
// flowing right, at every x along a strictly left-to-right layout, the way a
// river branches at a delta rather than bowing like a suspension cable.
//
// A useful side effect of horizontal-only tangents: unlike the quadratic
// ribbon above, this shape needs no unit-normal/hypot maths at all — the
// offset from the centreline at every point is simply vertical, so there is
// no zero-length tangent to guard against. It is total by construction, not
// by a NaN check bolted on afterwards.
// ---------------------------------------------------------------------------

/** Default S-bend fraction (0..1 along the run) when a caller passes none.
 *  Mockup: `sRibbon`/`sCenter`'s own `mt === undefined ? .45 : mt` fallback.
 *  riverLayout.ts always passes an explicit fraction (id-hash jittered per
 *  branch, fixed per trunk — its BRANCH_BEND_BASE/BRANCH_BEND_JITTER and
 *  TRUNK_BEND_FRACTION), so this default is this module's own safety net,
 *  not a value anything currently renders with. */
export const S_BEND_DEFAULT = 0.45;

/** Trunk (twin -> hub) ribbon widths — wider than a branch because a trunk
 *  carries every fact in the lane, exactly as the mockup's orbit/canopy
 *  trunks are also wider than their branches. Mockup:
 *  `sRibbon(twinX, twinY, hx, hy, 4.6, 1.6, .5)`. Branches keep reusing
 *  DENDRITE_HUB_WIDTH/DENDRITE_TIP_WIDTH above (3.5/0.75) exactly as the
 *  mockup's `sRibbon(hx, hy, factX, y, HUB_W, TIP_W, mt)` does — one width
 *  pair per EDGE ROLE, not a second pair per layout variant. */
export const RIVER_TRUNK_HUB_WIDTH = 4.6;
export const RIVER_TRUNK_TIP_WIDTH = 1.6;

/**
 * A river dendrite as a CLOSED, FILLED, TAPERED ribbon — the same taper
 * contract as `dendriteRibbonPath` (wide at the parent, thin at the child),
 * but its two sides are CUBIC béziers with HORIZONTAL tangents at (x1,y1)
 * and (x2,y2) instead of one shared quadratic control point.
 *
 * Because the tangents are horizontal by construction, the ribbon's vertical
 * OFFSET from the centreline at each endpoint is EXACTLY its half-width there
 * — no normal-vector projection needed, unlike the quadratic ribbon, whose
 * endpoint tangent points wherever the curve's own control point is. That is
 * what "exact at the endpoints" means, and it is also why this function
 * cannot produce the tiered ribbon's "bows up and over a horizontal run"
 * shape the user rejected.
 *
 * `bend` (`mt` in the mockup) is where the S turns, as a fraction of the run
 * — the caller supplies it (riverLayout.ts jitters it per fact id for a
 * branch, fixes it for a trunk).
 *
 * Returns '' for non-finite input, matching dendriteRibbonPath's contract.
 */
export function sRibbonPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  hubWidth: number = DENDRITE_HUB_WIDTH,
  tipWidth: number = DENDRITE_TIP_WIDTH,
  bend: number = S_BEND_DEFAULT,
): string {
  if (!allFinite(x1, y1, x2, y2, hubWidth, tipWidth, bend)) return '';
  const bendX = x1 + (x2 - x1) * bend;
  const hStart = hubWidth / 2;
  const hEnd = tipWidth / 2;
  return (
    `M${x1},${y1 - hStart}` +
    `C${bendX},${y1 - hStart} ${bendX},${y2 - hEnd} ${x2},${y2 - hEnd}` +
    `L${x2},${y2 + hEnd}` +
    `C${bendX},${y2 + hEnd} ${bendX},${y1 + hStart} ${x1},${y1 + hStart}Z`
  );
}

/**
 * The pulse track for a river dendrite: the OPEN centreline `sRibbonPath`
 * bounds, for the travelling activation highlight. Same horizontal-tangent
 * construction and the same bend contract, but stroked rather than filled —
 * it never closes with `Z`, matching how the tiered pulse path is a stroked
 * copy of its ribbon's centreline rather than the ribbon itself.
 */
export function sCenterlinePath(x1: number, y1: number, x2: number, y2: number, bend: number = S_BEND_DEFAULT): string {
  if (!allFinite(x1, y1, x2, y2, bend)) return '';
  const bendX = x1 + (x2 - x1) * bend;
  return `M${x1},${y1}C${bendX},${y1} ${bendX},${y2} ${x2},${y2}`;
}

/**
 * Where a RIVER dendrite meets its receiving node. Arrival is horizontal by
 * construction (the end tangent is always horizontal), so — unlike
 * `terminalPointOf` above, which backs off along a curving approach
 * direction — the terminal simply sits `targetRadius` px to the LEFT of the
 * target on its own y: just short of the soma on the incoming side, exactly
 * on its membrane, the same way the tiered terminal sits on a node's.
 *
 * Returns the target point itself for a non-finite or non-positive radius
 * (no inset), and a finite point for non-finite x/y (matching
 * terminalPointOf's {0,0}).
 */
export function riverTerminalPointOf(x2: number, y2: number, targetRadius: number): Vec {
  if (!allFinite(x2, y2)) return { x: 0, y: 0 };
  const inset = Number.isFinite(targetRadius) && targetRadius > 0 ? targetRadius : 0;
  return { x: x2 - inset, y: y2 };
}

/** Same-purpose gradient ids for the RIVERBANK layout's dendrites, which flow
 *  strictly LEFT -> RIGHT rather than top -> bottom. A second def per kind,
 *  not a rewrite of the first: TwinMemoryGraphCanvas's tiered dendrites keep
 *  referencing DENDRITE_GRADIENT_ID unchanged (still top-down, still correct
 *  for that layout), and these two ids point the SAME two stop colours
 *  (DENDRITE_GRADIENT_STOPS, DENDRITE_STOP_OPACITY) along a horizontal
 *  `objectBoundingBox` axis instead. The two-shared-defs-per-kind rationale
 *  from TWIN-READ.1 Task 4 still holds: every river edge flows left->right,
 *  so N per-edge gradients would render pixels identical to these two. */
export const RIVER_DENDRITE_GRADIENT_ID: Record<TwinGraphEdgeKind, string> = {
  'twin-hub': 'twin-river-dendrite-twin-hub',
  'hub-fact': 'twin-river-dendrite-hub-fact',
};

/** Resolves an edge kind to its RIVER gradient id — same unknown-kind
 *  fallback as dendriteGradientIdOf above. */
export function riverDendriteGradientIdOf(kind: string): string {
  return kind === 'twin-hub' ? RIVER_DENDRITE_GRADIENT_ID['twin-hub'] : RIVER_DENDRITE_GRADIENT_ID['hub-fact'];
}

/** `fill` value for a river dendrite of the given kind. */
export function riverDendriteFillOf(kind: string): string {
  return `url(#${riverDendriteGradientIdOf(kind)})`;
}

// ---------------------------------------------------------------------------
// CATEGORY-SCOPED ATTENTION (TWIN-READ.2 Task 4) — additive, below the river
// section above. The three levels the mockup's `.lit`/`.semi`/`.dimmable`
// classes read from: the attended fact and its own category's anchors (hub,
// trunk, heading) at 1, a same-category sibling row/branch at ~0.55, every
// OTHER category at ~0.25. Named constants because a smoke-test tuning round
// touches only this block — the computation that PICKS a level for a given
// node lives in riverAttention.ts, deliberately kept out of this file so the
// "pure numbers/paths/class names" contract above still holds.
//
// >>> A SEPARATE RULE FROM COLLAPSED_LANE_OPACITY/FADED_CLASS ABOVE. <<< Those
// attenuate a SHUT lane's own chrome (TWIN-READ.1 Task 6) and explicitly
// exempt a hub from ever dimming. This is a DIFFERENT axis — which category
// the user is attending to — and it DOES cover hubs/trunks/headings of every
// OTHER category (the plan's own words). Where both apply to the same
// element (a lane heading), they COMPOUND by multiplication rather than one
// replacing the other — see TwinMemoryRiverStructure.tsx.
//
// >>> APPLIED AS THE `opacity` SVG ATTRIBUTE, NOT A CLASS. <<< 0.55 has no
// Tailwind utility on this project's default scale (unlike the 0.25/1 that
// FADED_CLASS-style classes could cover) — COLLAPSED_LANE_OPACITY/
// EXPANDED_LANE_OPACITY above already answered exactly this gap the same
// way. A plain attribute is also what keeps the fill-mode trap structurally
// out of reach: it is set on each row/hub's OUTER control group, never on the
// INNER group that owns the bloom/growth `animation` (TwinMemoryRiverRow.tsx
// keeps those two concerns on two different elements on purpose), so a
// lingering fill-mode on the animation could never have this value to fight
// even if one were reintroduced by mistake.
// ---------------------------------------------------------------------------

export type AttentionLevel = 'lit' | 'mid' | 'dim';

/** The mockup's own `1 / .55 / .25` — starting values a tuning round may
 *  retune without touching anything that reads them. */
export const ATTENTION_OPACITY: Record<AttentionLevel, number> = {
  lit: 1,
  mid: 0.55,
  dim: 0.25,
};

/** The mockup's `transition: opacity .15s` so an attention shift breathes
 *  instead of snapping — a TRANSITION on a state change, not idle animation:
 *  it schedules nothing when nothing changes. Reuses the exact Tailwind
 *  utility BrainMemoryGraph and the tiered twin canvas already apply for the
 *  identical purpose (their own `fadeClass`), gated off under reduced motion
 *  by every caller — dimming itself is state and stays; only the ease and the
 *  pulse are motion. */
export const ATTENTION_TRANSITION_CLASS = 'transition-opacity duration-150';
