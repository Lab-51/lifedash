// === FILE PURPOSE ===
// Unit tests for the twin memory graph's tiered-lane GEOMETRY (TWIN-GRAPH.2
// Task 2). Pure arithmetic — no simulation runs here at all, which is the whole
// point of splitting the geometry out of forceLayout: the structural promises
// (bands never overlap, lanes never overlap, a clamp is always finite) are
// provable without ticking anything.
//
// NOTE: this file deliberately carries NO environment pragma, so it inherits
// vitest.config.ts's `environment: 'node'`. Do not name the jsdom pragma even
// inside a comment: vitest scans the leading comment block for it and would
// silently switch this file's environment.

import { describe, it, expect } from 'vitest';
import {
  CATEGORY_LANE_ORDER,
  clampToLane,
  clampToTier,
  computeLanes,
  DEFAULT_LAYOUT_WIDTH,
  hash32,
  LANE_PADDING,
  LAST_TIER,
  laneFor,
  laneOrderOf,
  MIN_LANE_WIDTH,
  seedInLane,
  TIER_BAND_HALF_HEIGHT,
  TIER_GAP,
  tierBounds,
  tierCenterY,
  tierIndexOf,
  type Lane,
} from '../tieredLayout';

const ALL_FIVE = [...CATEGORY_LANE_ORDER];

describe('laneOrderOf', () => {
  it('puts populated categories in canonical order, whatever order they arrived in', () => {
    expect(laneOrderOf(['commitment', 'person', 'domain'])).toEqual(['person', 'domain', 'commitment']);
  });

  it('dedupes and DROPS the laneless core (null category) rather than inventing a lane for it', () => {
    expect(laneOrderOf(['person', null, 'person', undefined, 'domain', null])).toEqual(['person', 'domain']);
  });

  it('never invents a lane for an unpopulated category', () => {
    expect(laneOrderOf(['project'])).toEqual(['project']);
    expect(laneOrderOf([])).toEqual([]);
  });

  it('appends an unrecognised category deterministically instead of losing it', () => {
    expect(laneOrderOf(['zeta', 'person', 'alpha'])).toEqual(['person', 'alpha', 'zeta']);
  });

  it('ignores an empty-string category', () => {
    expect(laneOrderOf(['', 'person'])).toEqual(['person']);
  });
});

describe('computeLanes', () => {
  it('divides the viewport, centred on the origin, in canonical order', () => {
    const geometry = computeLanes(ALL_FIVE, 1600);
    expect(geometry.order).toEqual(ALL_FIVE);
    expect(geometry.laneWidth).toBe(1600 / 5);
    expect(geometry.width).toBe(1600);

    const centers = geometry.order.map((key) => (geometry.lanes.get(key) as Lane).center);
    expect(centers).toEqual([...centers].sort((a, b) => a - b));
    // Symmetric about 0: the whole band of lanes is centred, not left-aligned.
    expect(centers[0] + centers[centers.length - 1]).toBeCloseTo(0, 10);
  });

  it('produces NON-OVERLAPPING lanes with a real gutter between neighbours', () => {
    const geometry = computeLanes(ALL_FIVE, 1600);
    const lanes = geometry.order.map((key) => geometry.lanes.get(key) as Lane);
    for (let i = 1; i < lanes.length; i++) {
      expect(lanes[i - 1].max).toBeLessThan(lanes[i].min);
      expect(lanes[i].min - lanes[i - 1].max).toBeCloseTo(2 * LANE_PADDING, 10);
    }
  });

  it('floors lane width at MIN_LANE_WIDTH so a narrow viewport pans instead of collapsing', () => {
    const geometry = computeLanes(ALL_FIVE, 400);
    expect(geometry.laneWidth).toBe(MIN_LANE_WIDTH);
    expect(geometry.width).toBe(MIN_LANE_WIDTH * 5);
    for (const lane of geometry.lanes.values()) expect(lane.max).toBeGreaterThan(lane.min);
  });

  it('falls back to the default width for a missing, zero, negative or non-finite viewport', () => {
    const expected = computeLanes(ALL_FIVE, DEFAULT_LAYOUT_WIDTH).laneWidth;
    for (const bad of [undefined, 0, -1200, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(computeLanes(ALL_FIVE, bad).laneWidth).toBe(expected);
    }
  });

  it('SINGLE LANE: one full-width region, still centred', () => {
    const geometry = computeLanes(['person'], 1600);
    expect(geometry.order).toEqual(['person']);
    const lane = geometry.lanes.get('person') as Lane;
    expect(lane.center).toBe(0);
    expect(lane.min).toBeLessThan(lane.max);
  });

  it('EMPTY: no lanes, but a valid full-span core pseudo-lane rather than a special case', () => {
    const geometry = computeLanes([]);
    expect(geometry.order).toEqual([]);
    expect(geometry.lanes.size).toBe(0);
    expect(geometry.core.center).toBe(0);
    expect(geometry.core.min).toBeLessThan(geometry.core.max);
    expect(Number.isFinite(geometry.core.min)).toBe(true);
  });

  it('gives the laneless core a span covering EVERY lane — it sits above all of them', () => {
    const geometry = computeLanes(ALL_FIVE, 1600);
    for (const lane of geometry.lanes.values()) {
      expect(geometry.core.min).toBeLessThanOrEqual(lane.min);
      expect(geometry.core.max).toBeGreaterThanOrEqual(lane.max);
    }
  });
});

describe('laneFor', () => {
  const geometry = computeLanes(['person', 'domain'], 1600);

  it('resolves a category to its own lane', () => {
    expect(laneFor(geometry, 'domain')?.key).toBe('domain');
  });

  it('falls back to the core span for null and for a category with no lane', () => {
    expect(laneFor(geometry, null)).toBe(geometry.core);
    expect(laneFor(geometry, undefined)).toBe(geometry.core);
    expect(laneFor(geometry, 'commitment')).toBe(geometry.core);
  });
});

describe('tier bands', () => {
  it('tierIndexOf snaps anything to a real tier, defaulting a garbage tier to the open-ended one', () => {
    expect(tierIndexOf(0)).toBe(0);
    expect(tierIndexOf(1)).toBe(1);
    expect(tierIndexOf(2)).toBe(2);
    expect(tierIndexOf(-5)).toBe(0);
    expect(tierIndexOf(99)).toBe(LAST_TIER);
    for (const bad of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(tierIndexOf(bad)).toBe(LAST_TIER);
    }
  });

  it('orders tier centres core < hub < fact, one TIER_GAP apart', () => {
    expect(tierCenterY(0)).toBeLessThan(tierCenterY(1));
    expect(tierCenterY(1)).toBeLessThan(tierCenterY(2));
    expect(tierCenterY(1) - tierCenterY(0)).toBe(TIER_GAP);
    expect(tierCenterY(2) - tierCenterY(1)).toBe(TIER_GAP);
  });

  it('BANDS DO NOT OVERLAP — this is what makes the tier ordering provable, not typical', () => {
    const core = tierBounds(0);
    const hub = tierBounds(1);
    const fact = tierBounds(2);
    expect(core.max).toBeLessThan(hub.min);
    expect(hub.max).toBeLessThan(fact.min);
    expect(core.max - core.min).toBe(2 * TIER_BAND_HALF_HEIGHT);
  });

  it('leaves the fact band open-ended downward so a crowded lane stacks instead of deadlocking', () => {
    expect(tierBounds(LAST_TIER).max).toBe(Number.POSITIVE_INFINITY);
    expect(clampToTier(99_999, LAST_TIER)).toBe(99_999);
  });

  it('clampToTier pulls a stray y back into its band from either side', () => {
    const hub = tierBounds(1);
    expect(clampToTier(-9999, 1)).toBe(hub.min);
    expect(clampToTier(9999, 1)).toBe(hub.max);
    expect(clampToTier(tierCenterY(1), 1)).toBe(tierCenterY(1));
  });

  it('NEVER returns NaN — a non-finite y lands on the band centre', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      for (const tier of [0, 1, 2]) {
        const clamped = clampToTier(bad, tier);
        expect(Number.isFinite(clamped)).toBe(true);
        expect(clamped).toBe(tierCenterY(tier));
      }
    }
  });
});

describe('clampToLane', () => {
  const geometry = computeLanes(ALL_FIVE, 1600);
  const lane = geometry.lanes.get('domain') as Lane;

  it('leaves an in-lane x alone and pulls an out-of-lane x back to the wall', () => {
    expect(clampToLane(lane.center, lane)).toBe(lane.center);
    expect(clampToLane(lane.min - 5000, lane)).toBe(lane.min);
    expect(clampToLane(lane.max + 5000, lane)).toBe(lane.max);
  });

  it('keeps a node of a given radius FULLY inside, not just its centre', () => {
    const radius = 22;
    expect(clampToLane(lane.max + 1, lane, radius)).toBe(lane.max - radius);
    expect(clampToLane(lane.min - 1, lane, radius)).toBe(lane.min + radius);
  });

  it('collapses to the lane centre when the node is wider than the lane, instead of inverting', () => {
    const narrow = computeLanes(ALL_FIVE, 400).lanes.get('person') as Lane;
    const huge = (narrow.max - narrow.min) * 2;
    expect(clampToLane(99_999, narrow, huge)).toBe(narrow.center);
  });

  it('NEVER returns NaN — a non-finite x or radius lands somewhere finite', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(Number.isFinite(clampToLane(bad, lane))).toBe(true);
      expect(Number.isFinite(clampToLane(lane.center, lane, bad))).toBe(true);
    }
  });
});

describe('seedInLane', () => {
  const geometry = computeLanes(ALL_FIVE, 1600);

  it('is stable for the same id and independent of call order', () => {
    const lane = geometry.lanes.get('person') as Lane;
    expect(seedInLane('fact:abc', lane, 2)).toEqual(seedInLane('fact:abc', lane, 2));
  });

  it('SEEDS ALREADY INSIDE the lane and the band — frame 0 renders before any tick', () => {
    for (const category of ALL_FIVE) {
      const lane = geometry.lanes.get(category) as Lane;
      for (let i = 0; i < 200; i++) {
        const seed = seedInLane(`fact:${category}:${i}`, lane, 2);
        expect(seed.x).toBeGreaterThanOrEqual(lane.min);
        expect(seed.x).toBeLessThanOrEqual(lane.max);
        expect(seed.y).toBeGreaterThanOrEqual(tierBounds(2).min);
        expect(Number.isFinite(seed.y)).toBe(true);
      }
    }
  });

  it('keeps a tier-1 seed inside the CLOSED hub band', () => {
    const lane = geometry.lanes.get('project') as Lane;
    const bounds = tierBounds(1);
    for (let i = 0; i < 200; i++) {
      const seed = seedInLane(`category:${i}`, lane, 1);
      expect(seed.y).toBeGreaterThanOrEqual(bounds.min);
      expect(seed.y).toBeLessThanOrEqual(bounds.max);
    }
  });

  it('spreads distinct ids apart instead of stacking them on the lane centre', () => {
    const lane = geometry.lanes.get('domain') as Lane;
    const seeds = Array.from({ length: 200 }, (_, i) => seedInLane(`fact:${i}`, lane, 2));
    const unique = new Set(seeds.map((s) => `${s.x.toFixed(6)},${s.y.toFixed(6)}`));
    expect(unique.size).toBeGreaterThan(seeds.length * 0.9);
  });

  it('stays finite in a lane too narrow to spread in, and for a garbage tier', () => {
    const collapsed: Lane = { key: 'x', index: 0, center: 42, min: 42, max: 42 };
    const seed = seedInLane('fact:1', collapsed, Number.NaN);
    expect(seed.x).toBe(42);
    expect(Number.isFinite(seed.y)).toBe(true);
  });
});

describe('hash32', () => {
  it('is stable, unsigned and well spread — the whole determinism story rests on it', () => {
    expect(hash32('fact:abc')).toBe(hash32('fact:abc'));
    expect(hash32('')).toBeGreaterThanOrEqual(0);
    const hashes = new Set(Array.from({ length: 500 }, (_, i) => hash32(`fact:${i}`)));
    expect(hashes.size).toBe(500);
  });
});
