// === FILE PURPOSE ===
// The twin memory graph's synaptic GEOMETRY (TWIN-READ.1 Task 4), tested where it
// can actually be tested: as pure functions.
//
// This matters more than it looks. jsdom has no layout engine and stubs SVG
// measurement entirely — `getBBox`, `getComputedTextLength` and `getTotalLength`
// are not functions on its SVGElement (proved in Task 3's spike) — so NOTHING
// about a rendered path's real shape is observable from a component test. Keeping
// every number in a pure module is what lets the taper be asserted at all: the
// widths below are read out of the `d` string itself, not out of a stub.
//
// Two properties are load-bearing rather than cosmetic:
//   1. THE RIBBON GENUINELY TAPERS. "Filled tapered ribbon, not a uniform stroke"
//      is the phase's single highest-impact visual change; a ribbon that came out
//      the same width at both ends would look right in a screenshot and be wrong.
//   2. NOTHING EVER YIELDS NaN. A NaN in a `d` attribute silently drops the whole
//      path — the same failure mode tieredLayout guards its coordinates against.
//      Degenerate input here is a correctness case, not politeness.

import { describe, it, expect } from 'vitest';
import {
  ATTENTION_OPACITY,
  ATTENTION_TRANSITION_CLASS,
  DENDRITE_GRADIENT_ID,
  DENDRITE_HUB_WIDTH,
  DENDRITE_TIP_WIDTH,
  RIVER_DENDRITE_GRADIENT_ID,
  SOMA_RING_OPACITY,
  SOMA_RING_OPACITY_ACTIVE,
  dendriteFillOf,
  dendriteGradientIdOf,
  dendriteRibbonPath,
  riverDendriteFillOf,
  riverDendriteGradientIdOf,
  riverTerminalPointOf,
  sCenterlinePath,
  somaRingsFor,
  sRibbonPath,
  terminalPointOf,
} from '../synapticVisuals';

interface Point {
  x: number;
  y: number;
}

/** Every coordinate pair in a path string, in order. The ribbon emits exactly
 *  six: left start, left control, left end, right end, right control, right
 *  start — so the outline's own width can be measured at both ends. */
function pointsOf(d: string): Point[] {
  const numbers = (d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
  const points: Point[] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) points.push({ x: numbers[i], y: numbers[i + 1] });
  return points;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe('synapticVisuals — dendriteRibbonPath', () => {
  it('draws a CLOSED outline, not an open curve — it is filled, so it must enclose an area', () => {
    const d = dendriteRibbonPath(0, 0, 0, 260);

    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    // Down one bowed side, across the tip, back up the other bowed side.
    expect((d.match(/Q/g) ?? []).length).toBe(2);
    expect((d.match(/L/g) ?? []).length).toBe(1);
    expect(pointsOf(d)).toHaveLength(6);
  });

  it('TAPERS: wide where it leaves the parent, thin where it reaches the child', () => {
    const points = pointsOf(dendriteRibbonPath(0, 0, 0, 260));
    const [startLeft, , endLeft, endRight, , startRight] = points;

    expect(distance(startLeft, startRight)).toBeCloseTo(DENDRITE_HUB_WIDTH, 5);
    expect(distance(endLeft, endRight)).toBeCloseTo(DENDRITE_TIP_WIDTH, 5);
    // The whole point of the change, stated as an inequality so a future tuning
    // round cannot quietly flatten it back into a uniform stroke.
    expect(distance(startLeft, startRight)).toBeGreaterThan(distance(endLeft, endRight) * 2);
  });

  it('honours explicitly-passed widths at both ends', () => {
    const points = pointsOf(dendriteRibbonPath(10, 10, 200, 400, 8, 2));
    expect(distance(points[0], points[5])).toBeCloseTo(8, 5);
    expect(distance(points[2], points[3])).toBeCloseTo(2, 5);
  });

  it('stays finite for a diagonal connection — no NaN reaches the d attribute', () => {
    const d = dendriteRibbonPath(-431, -260, 137, 260);
    expect(d).not.toContain('NaN');
    for (const point of pointsOf(d)) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  });

  it('collapses rather than explodes when both endpoints are identical', () => {
    const d = dendriteRibbonPath(42, 42, 42, 42);
    expect(d).not.toContain('NaN');
    for (const point of pointsOf(d)) {
      expect(point.x).toBe(42);
      expect(point.y).toBe(42);
    }
  });

  it('returns an EMPTY d for non-finite input — an absent path beats a voided one', () => {
    expect(dendriteRibbonPath(Number.NaN, 0, 10, 10)).toBe('');
    expect(dendriteRibbonPath(0, 0, Number.POSITIVE_INFINITY, 10)).toBe('');
  });
});

describe('synapticVisuals — terminalPointOf', () => {
  it('sits on the receiving node’s MEMBRANE, not at its centre', () => {
    const target = { x: 0, y: 260 };
    const terminal = terminalPointOf(0, 0, target.x, target.y, 9);

    expect(distance(terminal, target)).toBeCloseTo(9, 5);
    // ...and on the approach side, i.e. above a node the connection descends to.
    expect(terminal.y).toBeLessThan(target.y);
  });

  it('never overshoots past the curve’s control point on a very short connection', () => {
    const terminal = terminalPointOf(0, 0, 0, 4, 500);
    expect(Number.isFinite(terminal.x)).toBe(true);
    expect(Number.isFinite(terminal.y)).toBe(true);
    expect(terminal.y).toBeGreaterThanOrEqual(0);
  });

  it('degrades to the node centre for a zero radius and for identical endpoints', () => {
    expect(terminalPointOf(0, 0, 0, 260, 0)).toEqual({ x: 0, y: 260 });
    expect(terminalPointOf(7, 7, 7, 7, 5)).toEqual({ x: 7, y: 7 });
  });

  it('returns a finite point for non-finite input', () => {
    expect(terminalPointOf(Number.NaN, 0, 0, 0, 5)).toEqual({ x: 0, y: 0 });
  });
});

describe('synapticVisuals — soma rings', () => {
  it('returns TWO rings, outermost first, both at low alpha', () => {
    const rings = somaRingsFor(10, 0, false);

    expect(rings.map((ring) => ring.key)).toEqual(['outer', 'inner']);
    expect(rings[0].r).toBeGreaterThan(rings[1].r); // painted behind, so wider
    expect(rings[1].r).toBeGreaterThan(10); // ...and both clear of the core
    expect(rings[0].opacity).toBe(SOMA_RING_OPACITY.outer);
    expect(rings[1].opacity).toBe(SOMA_RING_OPACITY.inner);
    expect(rings.every((ring) => ring.opacity < 0.4)).toBe(true);
  });

  it('brightens both rings while the node is attended to', () => {
    const rest = somaRingsFor(10, 0, false);
    const active = somaRingsFor(10, 0, true);

    expect(active[0].opacity).toBe(SOMA_RING_OPACITY_ACTIVE.outer);
    expect(active[1].opacity).toBe(SOMA_RING_OPACITY_ACTIVE.inner);
    expect(active[0].opacity).toBeGreaterThan(rest[0].opacity);
    expect(active[1].opacity).toBeGreaterThan(rest[1].opacity);
  });

  it('blooms wider for a livelier memory — the glow halo widens the rings', () => {
    const dim = somaRingsFor(10, 0, false);
    const radiant = somaRingsFor(10, 12, false);
    expect(radiant[0].r).toBeGreaterThan(dim[0].r);
    expect(radiant[1].r).toBeGreaterThan(dim[1].r);
  });

  it('stays finite and positive for a zero, negative or non-finite radius', () => {
    for (const radius of [0, -5, Number.NaN]) {
      for (const ring of somaRingsFor(radius, Number.NaN, false)) {
        expect(Number.isFinite(ring.r)).toBe(true);
        expect(ring.r).toBeGreaterThan(0);
      }
    }
  });
});

describe('synapticVisuals — dendrite gradients', () => {
  it('maps each edge kind to its own gradient, and anything unknown to the leaf one', () => {
    expect(dendriteGradientIdOf('twin-hub')).toBe(DENDRITE_GRADIENT_ID['twin-hub']);
    expect(dendriteGradientIdOf('hub-fact')).toBe(DENDRITE_GRADIENT_ID['hub-fact']);
    // LayoutLink.kind is widened to the brain graph's kinds too, so an unknown
    // one must resolve to a real gradient rather than to url(#undefined).
    expect(dendriteGradientIdOf('attribution')).toBe(DENDRITE_GRADIENT_ID['hub-fact']);
  });

  it('produces a usable fill reference', () => {
    expect(dendriteFillOf('hub-fact')).toBe(`url(#${DENDRITE_GRADIENT_ID['hub-fact']})`);
  });
});

// ---------------------------------------------------------------------------
// RIVER DENDRITES (TWIN-READ.2 Task 1) — the S-curve vocabulary added below
// synapticVisuals.ts's boundary. Same jsdom-measures-nothing constraint as
// above: every claim is read out of the `d` string via the SAME pointsOf/
// distance helpers, never a DOM measurement.
// ---------------------------------------------------------------------------

describe('synapticVisuals — sRibbonPath (river dendrites)', () => {
  it('draws a CLOSED outline with two CUBIC segments — filled, so it must enclose an area', () => {
    const d = sRibbonPath(0, 0, 260, 0);

    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect((d.match(/C/g) ?? []).length).toBe(2);
    expect((d.match(/L/g) ?? []).length).toBe(1);
    // Two cubics (3 coordinate pairs each) plus the initial M and the L
    // endpoint: start, ctrl, ctrl, tip-top, tip-bottom, ctrl, ctrl, start.
    expect(pointsOf(d)).toHaveLength(8);
  });

  it('TAPERS: wide at the parent end, thin at the child end', () => {
    const points = pointsOf(sRibbonPath(0, 0, 260, 0));
    const [start, , , tipTop, tipBottom, , , end] = points;

    expect(distance(start, end)).toBeCloseTo(DENDRITE_HUB_WIDTH, 5);
    expect(distance(tipTop, tipBottom)).toBeCloseTo(DENDRITE_TIP_WIDTH, 5);
    expect(distance(start, end)).toBeGreaterThan(distance(tipTop, tipBottom) * 2);
  });

  it('honours explicitly-passed widths at both ends', () => {
    const points = pointsOf(sRibbonPath(10, 10, 400, 200, 8, 2));
    expect(distance(points[0], points[7])).toBeCloseTo(8, 5);
    expect(distance(points[3], points[4])).toBeCloseTo(2, 5);
  });

  it('has HORIZONTAL tangents at both ends — the whole point of the river variant', () => {
    const points = pointsOf(sRibbonPath(0, 100, 300, 260, 6, 2, 0.4));
    // [start, ctrl-leaving-start, ctrl-arriving-tip, tip-top, tip-bottom, ctrl-leaving-tip, ctrl-arriving-start, end]
    expect(points[1].y).toBe(points[0].y); // leaves the parent level with the parent
    expect(points[2].y).toBe(points[3].y); // arrives at the child level with the child
    expect(points[5].y).toBe(points[4].y); // leaves the child level with the child (return side)
    expect(points[6].y).toBe(points[7].y); // arrives at the parent level with the parent (return side)
  });

  it('bends at the requested fraction of the run — every control point shares the same bend x', () => {
    const points = pointsOf(sRibbonPath(0, 0, 100, 0, 4, 2, 0.25));
    for (const i of [1, 2, 5, 6]) expect(points[i].x).toBeCloseTo(25, 10);
  });

  it('stays finite for a genuinely diagonal run — no NaN reaches the d attribute', () => {
    const d = sRibbonPath(-431, -260, 137, 260);
    expect(d).not.toContain('NaN');
    for (const point of pointsOf(d)) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  });

  it('stays finite when both endpoints coincide — no zero-length tangent to guard, unlike the quadratic ribbon', () => {
    const d = sRibbonPath(42, 42, 42, 42, 6, 2);
    expect(d).not.toContain('NaN');
    for (const point of pointsOf(d)) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  });

  it('returns an EMPTY d for non-finite input, matching dendriteRibbonPath’s contract', () => {
    expect(sRibbonPath(Number.NaN, 0, 10, 10)).toBe('');
    expect(sRibbonPath(0, 0, 10, 10, DENDRITE_HUB_WIDTH, DENDRITE_TIP_WIDTH, Number.POSITIVE_INFINITY)).toBe('');
  });
});

describe('synapticVisuals — sCenterlinePath (river pulse track)', () => {
  it('is an OPEN cubic curve — no Z, unlike the ribbon it runs inside', () => {
    const d = sCenterlinePath(0, 0, 260, 40);
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(false);
    expect((d.match(/C/g) ?? []).length).toBe(1);
  });

  it('starts and ends exactly on the two endpoints', () => {
    const points = pointsOf(sCenterlinePath(12, 34, 500, 210, 0.3));
    expect(points[0]).toEqual({ x: 12, y: 34 });
    expect(points[points.length - 1]).toEqual({ x: 500, y: 210 });
  });

  it('has horizontal tangents at both ends: each control point is level with its own endpoint', () => {
    const points = pointsOf(sCenterlinePath(0, 50, 300, 120, 0.4));
    expect(points[1].y).toBe(points[0].y);
    expect(points[2].y).toBe(points[3].y);
  });

  it('returns an EMPTY d for non-finite input', () => {
    expect(sCenterlinePath(Number.NaN, 0, 10, 10)).toBe('');
    expect(sCenterlinePath(0, 0, 10, 10, Number.POSITIVE_INFINITY)).toBe('');
  });
});

describe('synapticVisuals — riverTerminalPointOf', () => {
  it('sits targetRadius px to the LEFT of the target, on the same y — arrival is horizontal by construction', () => {
    expect(riverTerminalPointOf(300, 88, 5)).toEqual({ x: 295, y: 88 });
  });

  it('degrades to the target itself for a zero, negative or non-finite radius', () => {
    expect(riverTerminalPointOf(300, 88, 0)).toEqual({ x: 300, y: 88 });
    expect(riverTerminalPointOf(300, 88, -4)).toEqual({ x: 300, y: 88 });
    expect(riverTerminalPointOf(300, 88, Number.POSITIVE_INFINITY)).toEqual({ x: 300, y: 88 });
  });

  it('returns a finite point for non-finite x/y, matching terminalPointOf’s {0,0}', () => {
    expect(riverTerminalPointOf(Number.NaN, 10, 5)).toEqual({ x: 0, y: 0 });
  });
});

describe('synapticVisuals — river dendrite gradients', () => {
  it('maps each edge kind to its own RIVER gradient id, distinct from the tiered (top-down) ones', () => {
    expect(riverDendriteGradientIdOf('twin-hub')).toBe(RIVER_DENDRITE_GRADIENT_ID['twin-hub']);
    expect(riverDendriteGradientIdOf('hub-fact')).toBe(RIVER_DENDRITE_GRADIENT_ID['hub-fact']);
    expect(riverDendriteGradientIdOf('twin-hub')).not.toBe(DENDRITE_GRADIENT_ID['twin-hub']);
    // Same unknown-kind fallback as the tiered helper.
    expect(riverDendriteGradientIdOf('attribution')).toBe(RIVER_DENDRITE_GRADIENT_ID['hub-fact']);
  });

  it('produces a usable fill reference', () => {
    expect(riverDendriteFillOf('hub-fact')).toBe(`url(#${RIVER_DENDRITE_GRADIENT_ID['hub-fact']})`);
  });
});

describe('synapticVisuals — category-scoped attention (TWIN-READ.2 Task 4)', () => {
  it('exposes the mockup’s three starting levels — the only block a tuning round touches', () => {
    expect(ATTENTION_OPACITY).toEqual({ lit: 1, mid: 0.55, dim: 0.25 });
  });

  it('lit is fully opaque and dim is dimmer than mid, at every level', () => {
    expect(ATTENTION_OPACITY.lit).toBe(1);
    expect(ATTENTION_OPACITY.dim).toBeLessThan(ATTENTION_OPACITY.mid);
    expect(ATTENTION_OPACITY.mid).toBeLessThan(ATTENTION_OPACITY.lit);
  });

  it('reuses the app’s existing 150ms opacity-ease utility — no bespoke transition invented', () => {
    expect(ATTENTION_TRANSITION_CLASS).toBe('transition-opacity duration-150');
  });
});
