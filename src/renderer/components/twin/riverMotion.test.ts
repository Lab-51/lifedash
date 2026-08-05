// === FILE PURPOSE ===
// riverMotion — the riverbank's growth-cascade STAGGER (TWIN-READ.2 Task 2).
//
// The cascade itself is CSS and therefore invisible to any rAF/timer counter, so
// what can actually be proven is the arithmetic underneath it. Four properties,
// each of which a "harmless" tuning change could silently break:
//
//   1. DETERMINISM — same input, same delays. The jitter is an id hash, never
//      Math.random (a hard constraint of this phase): a re-render must reproduce
//      the same cascade, or the motion would flicker on every state change.
//   2. STRICTLY INCREASING — a cascade must read DOWNSTREAM. The jitter is a
//      fraction of the pitch precisely so no row can ever overtake its
//      successor, at ANY row count.
//   3. BOUNDED — a 200-row lane compresses its pitch instead of cascading for
//      five seconds. This is also what keeps the cleanup timeout bounded.
//   4. THE WINDOW COVERS EVERY ROW — the canvas strips the cascade classes when
//      it elapses, so a window that ended early would cut an animation off
//      mid-flight, and one that never ended would be the permanent-fill bug this
//      phase named in advance.

import { describe, it, expect } from 'vitest';
import {
  BRANCH_GROWTH_MS,
  CASCADE_JITTER_FRACTION,
  CASCADE_SPREAD_MS,
  ROW_STAGGER_MS,
  TAP_MS,
  cascadeDelayMs,
  cascadeStaggerMs,
  cascadeWindowMs,
} from './riverMotion';

/** Ids shaped like the real ones, so the hash is exercised on real input. */
function idsFor(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `fact:row-${i}-abcdef`);
}

function delaysFor(count: number): number[] {
  return idsFor(count).map((id, index) => cascadeDelayMs(index, id, count));
}

describe('riverMotion — the cascade stagger', () => {
  it('is deterministic: the same row cascades identically every time', () => {
    expect(delaysFor(15)).toEqual(delaysFor(15));
    expect(cascadeDelayMs(3, 'fact:abc', 8)).toBe(cascadeDelayMs(3, 'fact:abc', 8));
  });

  it('varies BETWEEN rows — an unjittered bundle would read as drafted, not grown', () => {
    // Two rows at the same index in the same-sized lane, differing only by id.
    expect(cascadeDelayMs(2, 'fact:one', 10)).not.toBe(cascadeDelayMs(2, 'fact:two', 10));
  });

  it('increases STRICTLY with the row index, at every lane size', () => {
    for (const count of [2, 3, 15, 60, 240]) {
      const delays = delaysFor(count);
      for (let i = 1; i < delays.length; i++) {
        expect(delays[i], `lane of ${count} rows, row ${i}`).toBeGreaterThan(delays[i - 1]);
      }
    }
  });

  it('never starts a row in the past', () => {
    for (const delay of delaysFor(40)) expect(delay).toBeGreaterThanOrEqual(0);
  });

  it('uses the nominal pitch for a normal lane and COMPRESSES it for a huge one', () => {
    expect(cascadeStaggerMs(15)).toBe(ROW_STAGGER_MS);
    expect(cascadeStaggerMs(2)).toBe(ROW_STAGGER_MS);
    // 200 rows at the nominal pitch would cascade for nearly five seconds; the
    // whole stagger is capped instead, so "growth" never becomes "wait".
    expect(cascadeStaggerMs(200)).toBeLessThan(ROW_STAGGER_MS);
    const widest = delaysFor(200).at(-1) ?? 0;
    expect(widest).toBeLessThanOrEqual(CASCADE_SPREAD_MS * (1 + CASCADE_JITTER_FRACTION));
  });

  it('keeps the jitter strictly under one pitch, which is WHY the order holds', () => {
    const pitch = cascadeStaggerMs(10);
    for (const [index, id] of idsFor(10).entries()) {
      const jitter = cascadeDelayMs(index, id, 10) - index * pitch;
      expect(jitter).toBeGreaterThanOrEqual(0);
      expect(jitter).toBeLessThan(pitch);
    }
  });
});

describe('riverMotion — the cascade window', () => {
  it('covers the LAST row of the biggest lane, animation included', () => {
    for (const count of [1, 3, 15, 200]) {
      const window = cascadeWindowMs([count]);
      const last = delaysFor(count).at(-1) ?? 0;
      expect(window, `lane of ${count} rows`).toBeGreaterThanOrEqual(last + BRANCH_GROWTH_MS);
    }
  });

  it('covers the widest lane when several open at once', () => {
    expect(cascadeWindowMs([2, 15, 4])).toBe(cascadeWindowMs([15]));
  });

  it('still outlasts the hub tap when nothing grew — a collapse animates only that', () => {
    expect(cascadeWindowMs([])).toBeGreaterThan(TAP_MS);
    expect(cascadeWindowMs([0])).toBeGreaterThan(TAP_MS);
  });

  it('is finite and bounded for garbage input — a NaN window would never clear', () => {
    for (const counts of [[Number.NaN], [-3], [Number.POSITIVE_INFINITY]]) {
      const window = cascadeWindowMs(counts);
      expect(Number.isFinite(window)).toBe(true);
      expect(window).toBeGreaterThan(0);
    }
  });
});
