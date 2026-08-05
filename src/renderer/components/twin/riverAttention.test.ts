// === FILE PURPOSE ===
// riverAttention — the riverbank's CATEGORY-SCOPED ATTENTION (TWIN-READ.2
// Task 4), tested as pure functions before any component ever consumes them.
//
// Four properties, each load-bearing rather than cosmetic:
//   1. NEUTRAL BY DEFAULT — nothing attended (or something that resolves to
//      no rendered row) must mean full opacity for EVERYONE, matching the
//      mockup's own `.dimmable` alone (without `svg.attending`) carrying no
//      rule at all.
//   2. ONLY A FACT DRIVES IT — a hub or the twin core (neither is a row) must
//      resolve to neutral, exactly like the mockup's `[data-fact]`-only
//      wiring.
//   3. THREE LEVELS, CORRECTLY SCOPED — the attended fact and its own
//      category's anchors read 'lit', a same-category sibling reads 'mid'
//      (never an anchor), everything else reads 'dim'.
//   4. PRIORITY — a live hover wins over a stale focus, which wins over a
//      pin, when more than one is set at once.

import { describe, it, expect } from 'vitest';
import {
  anchorAttentionLevel,
  computeRiverAttentionLevels,
  factAttentionLevel,
  resolveAttendedCategory,
} from './riverAttention';
import type { RiverHubPosition } from './riverLayout';
import type { RiverRowModel } from './riverCanvasModel';
import type { TwinGraphNode } from '../../../shared/types';

function node(id: string, category: string): TwinGraphNode {
  return {
    id,
    type: 'fact',
    tier: 2,
    label: id,
    recordId: id,
    category: category as TwinGraphNode['category'],
    degree: 1,
    newestTimestamp: null,
  };
}

function row(id: string, category: string): RiverRowModel {
  return { node: node(id, category), x: 0, y: 0, category, index: 0, laneRows: 1 };
}

function hub(id: string, category: string): RiverHubPosition {
  return { id, category, x: 0, y: 0, radius: 11, top: 0, height: 56, open: true, count: 1, bendFraction: 0.5 };
}

const ROWS = [row('fact:a1', 'preference'), row('fact:a2', 'preference'), row('fact:b1', 'person')];
const HUBS = [hub('category:preference', 'preference'), hub('category:person', 'person')];

describe('riverAttention — resolveAttendedCategory', () => {
  it('resolves nothing when nothing is hovered, focused or pinned', () => {
    expect(resolveAttendedCategory(null, null, null, ROWS)).toEqual({ attendedId: null, attendedCategory: null });
  });

  it('resolves a rendered fact to its own category', () => {
    expect(resolveAttendedCategory('fact:a1', null, null, ROWS)).toEqual({
      attendedId: 'fact:a1',
      attendedCategory: 'preference',
    });
  });

  it('resolves to NEUTRAL for an id that is not a rendered row — a hub or the twin core', () => {
    expect(resolveAttendedCategory('category:preference', null, null, ROWS)).toEqual({
      attendedId: null,
      attendedCategory: null,
    });
    expect(resolveAttendedCategory('twin', null, null, ROWS)).toEqual({ attendedId: null, attendedCategory: null });
  });

  it('prefers hover over focus, and focus over pinned', () => {
    expect(resolveAttendedCategory('fact:a1', 'fact:b1', null, ROWS).attendedId).toBe('fact:a1');
    expect(resolveAttendedCategory(null, 'fact:a1', 'fact:b1', ROWS).attendedId).toBe('fact:a1');
    expect(resolveAttendedCategory(null, null, 'fact:b1', ROWS).attendedId).toBe('fact:b1');
  });

  it('falls back to neutral once the pointer/focus/pin leaves, without needing a fourth caller-side branch', () => {
    expect(resolveAttendedCategory(null, null, null, ROWS).attendedCategory).toBeNull();
  });
});

describe('riverAttention — factAttentionLevel', () => {
  it('is lit for everyone when nothing is attended', () => {
    expect(factAttentionLevel('fact:a1', 'preference', null, null)).toBe('lit');
  });

  it('is lit for the attended fact itself', () => {
    expect(factAttentionLevel('fact:a1', 'preference', 'fact:a1', 'preference')).toBe('lit');
  });

  it('is mid for a SAME-CATEGORY sibling', () => {
    expect(factAttentionLevel('fact:a2', 'preference', 'fact:a1', 'preference')).toBe('mid');
  });

  it('is dim for every OTHER category', () => {
    expect(factAttentionLevel('fact:b1', 'person', 'fact:a1', 'preference')).toBe('dim');
  });
});

describe('riverAttention — anchorAttentionLevel (hub, trunk, heading)', () => {
  it('is lit for everyone when nothing is attended', () => {
    expect(anchorAttentionLevel('preference', null)).toBe('lit');
  });

  it('is lit for the attended category’s own anchor', () => {
    expect(anchorAttentionLevel('preference', 'preference')).toBe('lit');
  });

  it('is dim for every OTHER category — never mid, an anchor is not a sibling', () => {
    expect(anchorAttentionLevel('person', 'preference')).toBe('dim');
  });
});

describe('riverAttention — computeRiverAttentionLevels (the one map every caller reads)', () => {
  it('returns an EMPTY map when nothing is attended — every reader’s ?? "lit" fallback means full opacity', () => {
    const levels = computeRiverAttentionLevels(null, null, null, HUBS, ROWS);
    expect(levels.size).toBe(0);
  });

  it('lights the attended fact, its own hub/trunk (same id), and dims the other category’s row + hub', () => {
    const levels = computeRiverAttentionLevels('fact:a1', null, null, HUBS, ROWS);
    expect(levels.get('fact:a1')).toBe('lit');
    expect(levels.get('fact:a2')).toBe('mid'); // sibling row
    expect(levels.get('category:preference')).toBe('lit'); // own hub/trunk anchor
    expect(levels.get('fact:b1')).toBe('dim'); // other category's row
    expect(levels.get('category:person')).toBe('dim'); // other category's hub/trunk anchor
  });

  it('never contains the twin — it is not a key, so a caller can never look it up as dimmed', () => {
    const levels = computeRiverAttentionLevels('fact:a1', null, null, HUBS, ROWS);
    expect(levels.has('twin')).toBe(false);
  });

  it('stays neutral when the hovered/focused/pinned id is a hub, not a fact', () => {
    const levels = computeRiverAttentionLevels('category:preference', null, null, HUBS, ROWS);
    expect(levels.size).toBe(0);
  });

  it('settles back onto the pinned fact once hover and focus both clear', () => {
    const hovered = computeRiverAttentionLevels('fact:b1', null, 'fact:a1', HUBS, ROWS);
    expect(hovered.get('fact:a1')).toBe('dim'); // the pin recedes while something else is hovered

    const settled = computeRiverAttentionLevels(null, null, 'fact:a1', HUBS, ROWS);
    expect(settled.get('fact:a1')).toBe('lit'); // and returns once the hover clears
  });
});
