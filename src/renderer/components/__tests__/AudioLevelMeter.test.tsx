// Unit tests for AudioLevelMeter's pure per-bar target helper. The canvas render
// loop itself is not exercised (jsdom has no 2D context); the important, testable
// invariant is the deterministic decay that makes parking possible: at silence the
// target collapses to 0 for every bar regardless of the random offset, so the loop
// can settle to a fixed empty frame and stop scheduling rAF.
import { describe, it, expect } from 'vitest';
import { computeBarTarget, EQ_BARS, SILENCE_EPSILON } from '../AudioLevelMeter';

describe('computeBarTarget', () => {
  it('returns 0 for every bar just below silence, whatever the random offset', () => {
    const level = SILENCE_EPSILON - 0.001; // quiet enough to park
    for (let i = 0; i < EQ_BARS; i++) {
      expect(computeBarTarget(level, i, 0.09)).toBe(0);
      expect(computeBarTarget(level, i, -0.09)).toBe(0);
      expect(computeBarTarget(level, i, 0)).toBe(0);
    }
  });

  it('returns 0 for every bar at exactly zero level (no residual jitter)', () => {
    for (let i = 0; i < EQ_BARS; i++) {
      expect(computeBarTarget(0, i, 0.09)).toBe(0);
    }
  });

  it('above silence applies center bias plus the offset, clamped to [0, 1]', () => {
    const center = EQ_BARS / 2;

    // Center bar has bias ~1; with no offset the target equals the level.
    expect(computeBarTarget(0.5, center, 0)).toBeCloseTo(0.5, 5);

    // Edge bars are biased slightly lower than the center bar.
    expect(computeBarTarget(0.5, 0, 0)).toBeLessThan(computeBarTarget(0.5, center, 0));

    // Clamps at both ends.
    expect(computeBarTarget(1, center, 0.5)).toBe(1);
    expect(computeBarTarget(0.02, 0, -1)).toBe(0);
  });
});
