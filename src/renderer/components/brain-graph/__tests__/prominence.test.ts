// === FILE PURPOSE ===
// Unit tests for the memory graph's prominence scoring (TWIN-GRAPH.1 Task 2).
//
// NOTE: this file deliberately carries NO environment pragma, so it inherits
// vitest.config.ts's `environment: 'node'`. Running here — with no document and
// no window — is the proof that prominence.ts is DOM-free. Do not name the
// jsdom pragma even inside a comment: vitest scans the leading comment block
// for it and would silently switch this file's environment.

import { describe, it, expect } from 'vitest';
import type { BrainGraphNode } from '../../../../shared/types';
import {
  GLOW_TIER_THRESHOLDS,
  PROMINENCE_DEGREE_WEIGHT,
  PROMINENCE_MAX_RADIUS,
  PROMINENCE_MIN_RADIUS,
  PROMINENCE_RECENCY_DECAY_DAYS,
  PROMINENCE_RECENCY_WEIGHT,
  glowTierFor,
  maxDegreeOf,
  normalizedDegree,
  recencyDecay,
  scoreGraph,
  scoreProminence,
} from '../prominence';

const NOW = Date.parse('2026-08-04T12:00:00.000Z');
const MS_PER_DAY = 86_400_000;

function daysAgo(days: number): string {
  return new Date(NOW - days * MS_PER_DAY).toISOString();
}

function graphNode(id: string, over: Partial<BrainGraphNode> = {}): BrainGraphNode {
  return {
    id,
    type: 'topic',
    label: id,
    recordId: id,
    degree: 0,
    newestTimestamp: null,
    ...over,
  };
}

describe('prominence — the node env itself proves DOM-freedom', () => {
  it('runs with no document available', () => {
    expect(typeof document).toBe('undefined');
  });
});

describe('prominence constants', () => {
  it('blends two weights that sum to 1', () => {
    expect(PROMINENCE_DEGREE_WEIGHT + PROMINENCE_RECENCY_WEIGHT).toBeCloseTo(1, 10);
  });

  it('exposes the decay half-life and radius bounds as tuning points', () => {
    expect(PROMINENCE_RECENCY_DECAY_DAYS).toBe(30);
    expect(PROMINENCE_MIN_RADIUS).toBeLessThan(PROMINENCE_MAX_RADIUS);
  });
});

describe('normalizedDegree', () => {
  it('normalises against the graph max', () => {
    expect(normalizedDegree(5, 10)).toBe(0.5);
    expect(normalizedDegree(10, 10)).toBe(1);
  });

  it('returns 0 when max degree is 0 rather than dividing by zero', () => {
    expect(normalizedDegree(0, 0)).toBe(0);
    expect(Number.isNaN(normalizedDegree(0, 0))).toBe(false);
  });

  it('clamps a degree above the max and rejects non-finite input', () => {
    expect(normalizedDegree(20, 10)).toBe(1);
    expect(normalizedDegree(Number.NaN, 10)).toBe(0);
    expect(normalizedDegree(5, Number.NaN)).toBe(0);
    expect(normalizedDegree(-3, 10)).toBe(0);
  });
});

describe('recencyDecay', () => {
  it('is 1 for right now and 1/e at the decay constant', () => {
    expect(recencyDecay(daysAgo(0), NOW)).toBeCloseTo(1, 6);
    expect(recencyDecay(daysAgo(PROMINENCE_RECENCY_DECAY_DAYS), NOW)).toBeCloseTo(Math.exp(-1), 6);
  });

  it('treats a null timestamp as infinitely old instead of producing NaN', () => {
    expect(recencyDecay(null, NOW)).toBe(0);
  });

  it('treats an unparseable timestamp as infinitely old', () => {
    expect(recencyDecay('not-a-date', NOW)).toBe(0);
    expect(recencyDecay('', NOW)).toBe(0);
  });

  it('clamps a future timestamp to age zero so clock skew cannot exceed 1', () => {
    const tomorrow = new Date(NOW + MS_PER_DAY).toISOString();
    expect(recencyDecay(tomorrow, NOW)).toBe(1);
  });

  it('decays monotonically with age', () => {
    const ages = [0, 1, 7, 30, 90, 365];
    const decays = ages.map((d) => recencyDecay(daysAgo(d), NOW));
    for (let i = 1; i < decays.length; i++) {
      expect(decays[i]).toBeLessThan(decays[i - 1]);
      expect(decays[i]).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('glowTierFor', () => {
  it('buckets ascending scores into ascending tiers', () => {
    expect(glowTierFor(0)).toBe('dim');
    expect(glowTierFor(GLOW_TIER_THRESHOLDS.soft)).toBe('soft');
    expect(glowTierFor(GLOW_TIER_THRESHOLDS.bright)).toBe('bright');
    expect(glowTierFor(GLOW_TIER_THRESHOLDS.radiant)).toBe('radiant');
    expect(glowTierFor(1)).toBe('radiant');
  });
});

describe('scoreProminence', () => {
  it('scores a max-degree, brand-new node at the top of the range', () => {
    const result = scoreProminence({ degree: 10, newestTimestamp: daysAgo(0) }, 10, NOW);
    expect(result.score).toBeCloseTo(1, 6);
    expect(result.radius).toBeCloseTo(PROMINENCE_MAX_RADIUS, 6);
    expect(result.glow).toBe('radiant');
  });

  it('scores an unconnected, undated node at the bottom of the range', () => {
    const result = scoreProminence({ degree: 0, newestTimestamp: null }, 10, NOW);
    expect(result.score).toBe(0);
    expect(result.radius).toBe(PROMINENCE_MIN_RADIUS);
    expect(result.glow).toBe('dim');
  });

  it('applies the documented 0.6/0.4 blend', () => {
    const result = scoreProminence({ degree: 10, newestTimestamp: daysAgo(PROMINENCE_RECENCY_DECAY_DAYS) }, 10, NOW);
    expect(result.score).toBeCloseTo(0.6 + 0.4 * Math.exp(-1), 6);
  });

  it('MONOTONIC: more links => bigger radius', () => {
    const stamp = daysAgo(3);
    const radii = [0, 1, 4, 8, 12].map((degree) => scoreProminence({ degree, newestTimestamp: stamp }, 12, NOW).radius);
    for (let i = 1; i < radii.length; i++) {
      expect(radii[i]).toBeGreaterThan(radii[i - 1]);
    }
  });

  it('MONOTONIC: fresher => brighter', () => {
    const scores = [365, 90, 30, 7, 0].map(
      (days) => scoreProminence({ degree: 6, newestTimestamp: daysAgo(days) }, 12, NOW).score,
    );
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThan(scores[i - 1]);
    }
    expect(scoreProminence({ degree: 12, newestTimestamp: daysAgo(0) }, 12, NOW).glow).toBe('radiant');
    expect(scoreProminence({ degree: 12, newestTimestamp: daysAgo(365) }, 12, NOW).glow).toBe('bright');
  });

  it('keeps the radius finite and in bounds for every hostile input', () => {
    const hostile = [
      { degree: Number.NaN, newestTimestamp: null },
      { degree: Number.POSITIVE_INFINITY, newestTimestamp: 'garbage' },
      { degree: -5, newestTimestamp: daysAgo(-100) },
      { degree: 1e9, newestTimestamp: daysAgo(0) },
    ];
    for (const input of hostile) {
      for (const max of [0, Number.NaN, 10]) {
        const { score, radius } = scoreProminence(input, max, NOW);
        expect(Number.isFinite(radius)).toBe(true);
        expect(radius).toBeGreaterThanOrEqual(PROMINENCE_MIN_RADIUS);
        expect(radius).toBeLessThanOrEqual(PROMINENCE_MAX_RADIUS);
        expect(Number.isFinite(score)).toBe(true);
      }
    }
  });
});

describe('maxDegreeOf / scoreGraph — degenerate graphs', () => {
  it('EMPTY GRAPH: max degree 0, empty score map, nothing to divide by', () => {
    expect(maxDegreeOf([])).toBe(0);
    expect(scoreGraph([], NOW).size).toBe(0);
  });

  it('SINGLE NODE: scores without NaN even though max degree is 0', () => {
    const scores = scoreGraph([graphNode('entity:a', { degree: 0 })], NOW);
    const only = scores.get('entity:a');
    expect(only).toBeDefined();
    expect(Number.isFinite(only?.radius ?? Number.NaN)).toBe(true);
    expect(only?.radius).toBe(PROMINENCE_MIN_RADIUS);
    expect(only?.score).toBe(0);
  });

  it('SINGLE NODE with a timestamp still earns recency alone', () => {
    const scores = scoreGraph([graphNode('entity:a', { newestTimestamp: daysAgo(0) })], NOW);
    expect(scores.get('entity:a')?.score).toBeCloseTo(PROMINENCE_RECENCY_WEIGHT, 6);
  });

  it('ALL-ZERO DEGREES: every node normalises to 0 instead of NaN', () => {
    const scores = scoreGraph(
      [graphNode('a'), graphNode('b'), graphNode('c')].map((n) => ({ ...n, degree: 0 })),
      NOW,
    );
    expect(scores.size).toBe(3);
    for (const score of scores.values()) {
      expect(Number.isFinite(score.radius)).toBe(true);
      expect(score.radius).toBe(PROMINENCE_MIN_RADIUS);
    }
  });

  it('ignores non-finite degrees when picking the max', () => {
    expect(
      maxDegreeOf([
        { degree: Number.NaN, newestTimestamp: null },
        { degree: 4, newestTimestamp: null },
      ]),
    ).toBe(4);
  });

  it('keys results by node id and normalises against the graph max', () => {
    const scores = scoreGraph(
      [
        graphNode('entity:hub', { degree: 8, newestTimestamp: daysAgo(0) }),
        graphNode('twin-fact:orphan', { degree: 0, newestTimestamp: null }),
      ],
      NOW,
    );
    expect(scores.get('entity:hub')?.radius).toBeGreaterThan(
      scores.get('twin-fact:orphan')?.radius ?? Number.POSITIVE_INFINITY,
    );
  });
});
