// === FILE PURPOSE ===
// Prominence scoring for the memory graph (TWIN-GRAPH.1 Task 2).
//
// score = 0.6 * normalisedDegree + 0.4 * recencyDecay, where
// recencyDecay = exp(-ageDays / 30). Both inputs (`degree`, `newestTimestamp`)
// arrive on BrainGraphNode from the main process; this module is the SINGLE
// source of truth that turns them into a radius and a glow tier. Nothing
// downstream may re-derive a radius — forceLayout stores what this returns on
// each LayoutNode and the renderer reads it back.
//
// PURE + DOM-FREE by design: no React, no window, no timers. Every weight and
// bound is an exported constant so a tuning round touches one file only.
//
// Degenerate graphs are load-bearing, not polish: an empty graph, a single
// node, a max degree of zero (division by zero) and a null/garbage timestamp
// must all yield a FINITE radius. A NaN radius reaching the SVG would break the
// whole canvas, so every path here is NaN-guarded.

/** Weight of connectivity in the blend. Sums to 1 with the recency weight. */
export const PROMINENCE_DEGREE_WEIGHT = 0.6;
/** Weight of freshness in the blend. Sums to 1 with the degree weight. */
export const PROMINENCE_RECENCY_WEIGHT = 0.4;
/** Exponential decay constant, in days: a memory this old scores 1/e on recency. */
export const PROMINENCE_RECENCY_DECAY_DAYS = 30;
/** Radius of the least prominent node, in px. */
export const PROMINENCE_MIN_RADIUS = 6;
/** Radius of the most prominent node, in px. */
export const PROMINENCE_MAX_RADIUS = 22;

/** Lower score bound of each glow tier above 'dim' — quantised brightness. */
export const GLOW_TIER_THRESHOLDS = {
  soft: 0.25,
  bright: 0.5,
  radiant: 0.75,
} as const;

/** Brightness bucket, ascending. Task 3 maps these to opacity/filter styling. */
export type GlowTier = 'dim' | 'soft' | 'bright' | 'radiant';

/** The only two graph-node fields prominence reads. Both BrainGraphNode and
 *  TwinGraphNode satisfy this structurally, so neither shape is privileged. */
export interface ProminenceInput {
  degree: number;
  newestTimestamp: string | null;
}

/** A prominence input that can be keyed back to its node. */
export interface ProminenceNode extends ProminenceInput {
  id: string;
}

export interface Prominence {
  /** Blended score, always finite and within [0, 1]. */
  score: number;
  /** Always finite, within [PROMINENCE_MIN_RADIUS, PROMINENCE_MAX_RADIUS]. */
  radius: number;
  glow: GlowTier;
}

const MS_PER_DAY = 86_400_000;

/** NaN-safe clamp to [0, 1] — a non-finite input scores 0 rather than poisoning
 *  the blend (Math.min/max would propagate NaN). */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Degree normalised against the graph's maximum.
 * Returns 0 when maxDegree is 0 (empty / fully disconnected graph) instead of
 * dividing by zero — the single-node and no-edge cases both land here.
 */
export function normalizedDegree(degree: number, maxDegree: number): number {
  if (!Number.isFinite(degree) || degree <= 0) return 0;
  if (!Number.isFinite(maxDegree) || maxDegree <= 0) return 0;
  return clamp01(degree / maxDegree);
}

/**
 * exp(-ageDays / 30), in [0, 1].
 * A null or unparseable timestamp decays to 0 (treated as infinitely old); a
 * timestamp in the future is clamped to age 0 so clock skew can never push the
 * score above 1.
 */
export function recencyDecay(newestTimestamp: string | null, now: number): number {
  if (!newestTimestamp) return 0;
  const parsed = Date.parse(newestTimestamp);
  if (!Number.isFinite(parsed) || !Number.isFinite(now)) return 0;
  const ageDays = Math.max(0, (now - parsed) / MS_PER_DAY);
  return clamp01(Math.exp(-ageDays / PROMINENCE_RECENCY_DECAY_DAYS));
}

/** Quantise a score into a brightness bucket. Monotonic in score. */
export function glowTierFor(score: number): GlowTier {
  if (score >= GLOW_TIER_THRESHOLDS.radiant) return 'radiant';
  if (score >= GLOW_TIER_THRESHOLDS.bright) return 'bright';
  if (score >= GLOW_TIER_THRESHOLDS.soft) return 'soft';
  return 'dim';
}

/** Largest degree across the graph, 0 for an empty graph. Non-finite degrees
 *  are ignored rather than becoming the max. */
export function maxDegreeOf(nodes: readonly ProminenceInput[]): number {
  let max = 0;
  for (const node of nodes) {
    if (Number.isFinite(node.degree) && node.degree > max) max = node.degree;
  }
  return max;
}

/**
 * Score one node. `maxDegree` comes from maxDegreeOf() over the same graph;
 * `now` is injected so callers (and tests) stay deterministic.
 */
export function scoreProminence(node: ProminenceInput, maxDegree: number, now: number = Date.now()): Prominence {
  const score = clamp01(
    PROMINENCE_DEGREE_WEIGHT * normalizedDegree(node.degree, maxDegree) +
      PROMINENCE_RECENCY_WEIGHT * recencyDecay(node.newestTimestamp, now),
  );
  return {
    score,
    radius: PROMINENCE_MIN_RADIUS + score * (PROMINENCE_MAX_RADIUS - PROMINENCE_MIN_RADIUS),
    glow: glowTierFor(score),
  };
}

/**
 * Score a whole graph in one pass, keyed by node id. Empty in, empty out — the
 * caller never has to special-case the empty graph.
 */
export function scoreGraph(nodes: readonly ProminenceNode[], now: number = Date.now()): Map<string, Prominence> {
  const maxDegree = maxDegreeOf(nodes);
  const scores = new Map<string, Prominence>();
  for (const node of nodes) {
    scores.set(node.id, scoreProminence(node, maxDegree, now));
  }
  return scores;
}
