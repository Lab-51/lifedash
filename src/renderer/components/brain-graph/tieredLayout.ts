// === FILE PURPOSE ===
// Pure geometry for the twin memory graph's TIERED LANE layout (TWIN-GRAPH.2
// Task 2). This is the "structure" half of "dynamic but visually structured":
//
//   tier 0 = the twin core        -> top y-band, centred over every lane
//   tier 1 = a category hub       -> middle y-band, one per POPULATED category
//   tier 2 = a learned fact       -> bottom y-band, INSIDE its category's lane
//
// Position therefore MEANS something: vertical = depth, horizontal = category.
// A uniform force blob (what this replaces) makes position meaningless.
//
// PURE + DOM-FREE by design, exactly like prominence.ts: no React, no window, no
// timers, no d3. forceLayout.ts consumes these numbers; the simulation never
// lives here, which is what makes the geometry unit-testable on its own.
//
// Every band/lane number below is an exported constant so a tuning round touches
// ONE file.
//
// Degenerate input is load-bearing, not polish: zero categories, one category, a
// lane narrower than the node drawn in it, a non-finite viewport width and a
// non-finite/absent tier must ALL yield a finite coordinate. A NaN position
// reaching the SVG silently drops the whole canvas.
//
// === DEPENDENCIES ===
// shared twin types (TwinFactCategory, for the canonical lane order) — types only.

import type { TwinFactCategory } from '../../../shared/types';

/** Depth index in the fixed 3-tier layout, mirroring TwinGraphNode.tier. */
export type TierIndex = 0 | 1 | 2;

/** Deepest tier. Facts live here and their band has NO floor below it, so a
 *  crowded lane grows downward instead of deadlocking against a ceiling. */
export const LAST_TIER: TierIndex = 2;

/** Middle tier — a category hub, by the fixed 3-tier convention documented at
 *  the top of this file. Exported so callers (TWIN-GRAPH.2 Task 4's
 *  live-growth spawn logic in forceLayout.ts) reference the convention by
 *  name instead of hardcoding the literal `1`. */
export const HUB_TIER: TierIndex = 1;

/** Vertical distance between two tier centres, in px. Also the rest length used
 *  for twin->hub and hub->fact links, so the link force and the tier force agree
 *  on where a child belongs instead of fighting over it. */
export const TIER_GAP = 260;

/** y of tier 0. Tier centres are TIER_TOP_Y + tier * TIER_GAP, so the core sits
 *  above the hubs and the hubs above the facts, centred on the origin. */
export const TIER_TOP_Y = -TIER_GAP;

/** Half-height of a tier's band. Bands must not overlap: with TIER_GAP 260 the
 *  gap between two adjacent bands is 260 - 2*70 = 120px of clear air, which is
 *  what makes "core above hub above fact" provable rather than typical. */
export const TIER_BAND_HALF_HEIGHT = 70;

/** Fraction of a band's half-height that seeds are allowed to use, so a freshly
 *  seeded node starts comfortably inside its band rather than on its edge. */
export const SEED_BAND_FILL = 0.8;

/** Total horizontal span the lanes divide when the caller gives no viewport. */
export const DEFAULT_LAYOUT_WIDTH = 1600;

/** A lane never narrows below this, however many categories are populated —
 *  five lanes in a phone-width viewport would otherwise be unusable. The layout
 *  gets wider than the viewport instead, and the canvas pans/zooms. */
export const MIN_LANE_WIDTH = 260;

/** Inset from a lane's edge to its usable bounds — the visible gutter between
 *  two neighbouring regions. */
export const LANE_PADDING = 28;

/** Strength of the soft forceX pulling a node toward its lane centre. Soft on
 *  purpose: the HARD guarantee is the clamp in forceLayout, not this. */
export const LANE_X_STRENGTH = 0.22;

/** Strength of the soft forceY pulling a node toward its tier centre. */
export const TIER_Y_STRENGTH = 0.28;

/** Canonical left-to-right lane order. Fixed rather than first-seen so lanes do
 *  not reshuffle just because rows came back in a different order; categories
 *  outside this list (there should be none) are appended alphabetically. */
export const CATEGORY_LANE_ORDER: readonly TwinFactCategory[] = [
  'person',
  'project',
  'preference',
  'domain',
  'commitment',
];

/** One category's horizontal region. `min`/`max` are the USABLE bounds (already
 *  inset by LANE_PADDING); a node is clamped between them, never past them. */
export interface Lane {
  key: string;
  index: number;
  center: number;
  min: number;
  max: number;
}

export interface TieredGeometry {
  /** Populated categories, left to right. */
  order: readonly string[];
  lanes: ReadonlyMap<string, Lane>;
  /** Full-span pseudo-lane for the one laneless node (the twin core, whose
   *  `category` is null) — it belongs above ALL lanes, not inside one. */
  core: Lane;
  laneWidth: number;
  /** Total span of every lane together. */
  width: number;
}

/** FNV-1a, 32-bit unsigned. Stable across runs and platforms — the whole
 *  determinism story (seeds, reheat impulses) hangs off this. */
export function hash32(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Snap any incoming tier to a real index. A missing/garbage tier lands on the
 *  fact tier, which is the only band with no ceiling — the safe default. */
export function tierIndexOf(tier: number | null | undefined): TierIndex {
  if (typeof tier !== 'number' || !Number.isFinite(tier)) return LAST_TIER;
  const rounded = Math.round(tier);
  if (rounded <= 0) return 0;
  if (rounded >= LAST_TIER) return LAST_TIER;
  return 1;
}

/** Centre y of a tier's band. Strictly increasing in tier. */
export function tierCenterY(tier: number | null | undefined): number {
  return TIER_TOP_Y + tierIndexOf(tier) * TIER_GAP;
}

/** Band a tier's nodes are confined to. The deepest tier is open-ended downward
 *  so a lane with hundreds of facts stacks instead of deadlocking between a
 *  clamped x and a clamped y. */
export function tierBounds(tier: number | null | undefined): { min: number; max: number } {
  const index = tierIndexOf(tier);
  const center = tierCenterY(index);
  return {
    min: center - TIER_BAND_HALF_HEIGHT,
    max: index === LAST_TIER ? Number.POSITIVE_INFINITY : center + TIER_BAND_HALF_HEIGHT,
  };
}

/** Clamp y into its tier band. Non-finite in -> band centre out, never NaN. */
export function clampToTier(y: number, tier: number | null | undefined): number {
  if (!Number.isFinite(y)) return tierCenterY(tier);
  const { min, max } = tierBounds(tier);
  if (y < min) return min;
  if (y > max) return max;
  return y;
}

/**
 * The populated categories, deduped and put in canonical order.
 * Nulls (the twin core) are dropped — the core has no lane by design.
 */
export function laneOrderOf(categories: Iterable<string | null | undefined>): string[] {
  const present = new Set<string>();
  for (const category of categories) {
    if (typeof category === 'string' && category.length > 0) present.add(category);
  }
  const known = CATEGORY_LANE_ORDER.filter((category) => present.has(category));
  const unknown = [...present].filter((category) => !CATEGORY_LANE_ORDER.includes(category as TwinFactCategory)).sort();
  return [...known, ...unknown];
}

/** Usable bounds of a slice, inset by LANE_PADDING. A slice narrower than the
 *  padding collapses to its centre rather than inverting (min > max would make
 *  every clamp nonsense). */
function boundsAround(center: number, width: number): { min: number; max: number } {
  const half = width / 2 - LANE_PADDING;
  if (!(half > 0)) return { min: center, max: center };
  return { min: center - half, max: center + half };
}

/**
 * Divide the viewport into one lane per populated category, left to right and
 * centred on the origin.
 *
 * An empty category set still yields a valid geometry (one full-width core
 * pseudo-lane), because an empty graph must not be a special case for callers.
 */
export function computeLanes(
  categories: Iterable<string | null | undefined>,
  viewportWidth: number = DEFAULT_LAYOUT_WIDTH,
): TieredGeometry {
  const order = laneOrderOf(categories);
  const usableViewport = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : DEFAULT_LAYOUT_WIDTH;
  const laneWidth = Math.max(MIN_LANE_WIDTH, usableViewport / Math.max(1, order.length));
  const width = laneWidth * Math.max(1, order.length);

  const lanes = new Map<string, Lane>();
  order.forEach((key, index) => {
    const center = -width / 2 + laneWidth * (index + 0.5);
    lanes.set(key, { key, index, center, ...boundsAround(center, laneWidth) });
  });

  return {
    order,
    lanes,
    core: { key: '', index: -1, center: 0, ...boundsAround(0, width) },
    laneWidth,
    width,
  };
}

/** The lane a node belongs to. The laneless core — and, defensively, any node
 *  whose category has no hub — falls back to the full-span core lane rather
 *  than to an undefined lane. */
export function laneFor(geometry: TieredGeometry, category: string | null | undefined): Lane {
  if (typeof category !== 'string') return geometry.core;
  return geometry.lanes.get(category) ?? geometry.core;
}

/**
 * Clamp x into a lane, keeping a node of the given radius fully inside it.
 * A lane too narrow for the node collapses to the lane centre — overlapping the
 * gutter symmetrically beats an inverted range, and it stays finite.
 */
export function clampToLane(x: number, lane: Lane, radius = 0): number {
  const inset = Number.isFinite(radius) && radius > 0 ? radius : 0;
  const min = lane.min + inset;
  const max = lane.max - inset;
  if (!(min <= max)) return lane.center;
  if (!Number.isFinite(x)) return lane.center;
  if (x < min) return min;
  if (x > max) return max;
  return x;
}

/**
 * Deterministic start position for a node, INSIDE its lane and its tier band —
 * derived only from the node id, so a rebuilt graph re-seeds to the same place
 * regardless of row order. The renderer draws frame 0 before any tick runs, so
 * the seed itself must already satisfy the structural promise.
 */
export function seedInLane(id: string, lane: Lane, tier: number | null | undefined): { x: number; y: number } {
  const hash = hash32(id);
  const alongLane = ((hash % 1024) + 0.5) / 1024;
  const alongBand = (((hash >>> 12) % 1024) + 0.5) / 1024;
  const span = lane.max - lane.min;
  const x = span > 0 ? lane.min + alongLane * span : lane.center;
  const drift = (alongBand - 0.5) * 2 * TIER_BAND_HALF_HEIGHT * SEED_BAND_FILL;
  return { x, y: clampToTier(tierCenterY(tier) + drift, tier) };
}
