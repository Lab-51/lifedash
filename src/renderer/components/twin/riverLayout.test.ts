// === FILE PURPOSE ===
// Unit tests for the twin memory graph's RIVERBANK geometry (TWIN-READ.2 Task
// 1). Pure arithmetic — nothing here mounts a component or ticks a
// simulation, which is the whole point of the layout being closed-form: every
// structural promise ("a fact never leaves its category's band", "a
// collapsed lane holds no rows") is provable from the returned numbers alone.
//
// NOTE: this file deliberately carries NO environment pragma, so it inherits
// vitest.config.ts's `environment: 'node'`. Do not name the jsdom pragma even
// inside a comment: vitest scans the leading comment block for it and would
// silently switch this file's environment.

import { describe, it, expect } from 'vitest';
import type { TwinFactCategory, TwinGraphEdge, TwinGraphNode, TwinMemoryGraph } from '../../../shared/types';
import {
  BLOCK_GAP,
  BRANCH_BEND_BASE,
  BRANCH_BEND_JITTER,
  CANVAS_HEIGHT_PADDING,
  COLLAPSED_BLOCK_HEIGHT,
  computeRiverLayout,
  FACT_RADIUS,
  HUB_RADIUS,
  MIN_CANVAS_HEIGHT,
  MIN_RIVER_WIDTH,
  REFERENCE_WIDTH,
  ROW_PITCH,
  TITLE_OFFSET_X,
  TRUNK_BEND_FRACTION,
  TWIN_RADIUS,
  type RiverHubPosition,
} from './riverLayout';

const NONE_EXPANDED: ReadonlySet<string> = new Set();

function expanded(...categories: string[]): ReadonlySet<string> {
  return new Set(categories);
}

function twinNode(): TwinGraphNode {
  return {
    id: 'twin',
    type: 'twin',
    tier: 0,
    label: 'You',
    recordId: 'singleton',
    category: null,
    degree: 1,
    newestTimestamp: null,
  };
}

function hubNode(category: TwinFactCategory): TwinGraphNode {
  return {
    id: `category:${category}`,
    type: 'category',
    tier: 1,
    label: category,
    recordId: category,
    category,
    degree: 1,
    newestTimestamp: null,
  };
}

function factNode(category: TwinFactCategory, index: number): TwinGraphNode {
  return {
    id: `fact:${category}-${index}`,
    type: 'fact',
    tier: 2,
    label: `fact ${category} ${index}`,
    recordId: `${category}-${index}`,
    category,
    degree: 1,
    newestTimestamp: null,
  };
}

/** A graph carrying one hub per key and exactly that many active facts under
 *  it — mirrors the payload's own "one hub per populated category" contract.
 *  A count of 0 still gets a hub (a lane whose last fact was just forgotten
 *  client-side, before the next refresh). */
function graphOf(counts: Partial<Record<TwinFactCategory, number>>): TwinMemoryGraph {
  const nodes: TwinGraphNode[] = [twinNode()];
  const edges: TwinGraphEdge[] = [];
  for (const category of Object.keys(counts) as TwinFactCategory[]) {
    nodes.push(hubNode(category));
    edges.push({ fromId: 'twin', toId: `category:${category}`, kind: 'twin-hub' });
    const count = counts[category] ?? 0;
    for (let i = 0; i < count; i++) {
      const fact = factNode(category, i);
      nodes.push(fact);
      edges.push({ fromId: `category:${category}`, toId: fact.id, kind: 'hub-fact' });
    }
  }
  return { nodes, edges, droppedCount: 0 };
}

describe('computeRiverLayout — columns', () => {
  it('reproduces the mockup exactly at its own reference width', () => {
    const layout = computeRiverLayout(graphOf({}), NONE_EXPANDED, REFERENCE_WIDTH);
    expect(layout.width).toBe(REFERENCE_WIDTH);
    expect(layout.twin.x).toBeCloseTo(150, 10);
  });

  it('scales every column with viewport width', () => {
    const half = computeRiverLayout(graphOf({ domain: 1 }), expanded('domain'), REFERENCE_WIDTH / 2);
    expect(half.twin.x).toBeCloseTo(75, 10);
    expect(half.hubs[0].x).toBeCloseTo(215, 10);
    expect(half.facts[0].x).toBeCloseTo(330, 10);
  });

  it('keeps twin < hub < fact column order at every width', () => {
    for (const w of [MIN_RIVER_WIDTH, 900, REFERENCE_WIDTH, REFERENCE_WIDTH * 2]) {
      const layout = computeRiverLayout(graphOf({ domain: 1 }), expanded('domain'), w);
      expect(layout.twin.x).toBeLessThan(layout.hubs[0].x);
      expect(layout.hubs[0].x).toBeLessThan(layout.facts[0].x);
    }
  });

  it('floors a narrower-than-usable viewport at MIN_RIVER_WIDTH', () => {
    const layout = computeRiverLayout(graphOf({}), NONE_EXPANDED, 100);
    expect(layout.width).toBe(MIN_RIVER_WIDTH);
  });

  it('falls back to the reference width for a missing, zero, negative or non-finite viewport', () => {
    const expectedWidth = computeRiverLayout(graphOf({}), NONE_EXPANDED, REFERENCE_WIDTH).width;
    for (const bad of [undefined, 0, -800, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(computeRiverLayout(graphOf({}), NONE_EXPANDED, bad as number).width).toBe(expectedWidth);
    }
  });
});

describe('computeRiverLayout — block allocation is proportional to visible rows', () => {
  it('grows an OPEN block with its fact count', () => {
    const five = computeRiverLayout(graphOf({ domain: 5 }), expanded('domain'), REFERENCE_WIDTH);
    expect(five.hubs[0].height).toBe(5 * ROW_PITCH);

    const twenty = computeRiverLayout(graphOf({ domain: 20 }), expanded('domain'), REFERENCE_WIDTH);
    expect(twenty.hubs[0].height).toBe(20 * ROW_PITCH);
  });

  it('floors a sparsely-populated OPEN block at COLLAPSED_BLOCK_HEIGHT', () => {
    const layout = computeRiverLayout(graphOf({ domain: 1 }), expanded('domain'), REFERENCE_WIDTH);
    expect(layout.hubs[0].height).toBe(COLLAPSED_BLOCK_HEIGHT);
  });

  it('COLLAPSED block height is fixed, whatever the fact count', () => {
    const small = computeRiverLayout(graphOf({ domain: 2 }), NONE_EXPANDED, REFERENCE_WIDTH);
    const big = computeRiverLayout(graphOf({ domain: 200 }), NONE_EXPANDED, REFERENCE_WIDTH);
    expect(small.hubs[0].height).toBe(COLLAPSED_BLOCK_HEIGHT);
    expect(big.hubs[0].height).toBe(COLLAPSED_BLOCK_HEIGHT);
  });
});

describe('computeRiverLayout — block heights and gaps sum to the reported total', () => {
  const counts = { person: 2, project: 11, domain: 15, commitment: 2 };

  it('hub heights plus the gaps between them equal contentHeight exactly', () => {
    const layout = computeRiverLayout(graphOf(counts), expanded('project', 'domain'), REFERENCE_WIDTH);
    const sum = layout.hubs.reduce((total, hub) => total + hub.height, 0) + BLOCK_GAP * (layout.hubs.length - 1);
    expect(sum).toBe(layout.contentHeight);

    // Blocks are contiguous and gap-separated, so the same sum also falls out
    // of the first and last block's own positions.
    const first = layout.hubs[0];
    const last = layout.hubs[layout.hubs.length - 1];
    expect(last.top + last.height - first.top).toBe(sum);
  });

  it('derives the final canvas height from contentHeight, padded then floored', () => {
    const layout = computeRiverLayout(graphOf(counts), expanded('project', 'domain'), REFERENCE_WIDTH);
    expect(layout.height).toBe(Math.max(MIN_CANVAS_HEIGHT, layout.contentHeight + CANVAS_HEIGHT_PADDING));
  });

  it('floors the canvas height for a near-empty graph', () => {
    const layout = computeRiverLayout(graphOf({ commitment: 1 }), NONE_EXPANDED, REFERENCE_WIDTH);
    expect(layout.height).toBe(MIN_CANVAS_HEIGHT);
  });
});

describe('computeRiverLayout — every row lands inside its own category band', () => {
  it('keeps a row strictly within [top, top+height] of its OWN hub, and outside every other hub’s band', () => {
    const counts = { person: 3, project: 11, domain: 15, commitment: 2 };
    const layout = computeRiverLayout(
      graphOf(counts),
      expanded('person', 'project', 'domain', 'commitment'),
      REFERENCE_WIDTH,
    );
    const hubByCategory = new Map(layout.hubs.map((hub) => [hub.category, hub]));

    for (const fact of layout.facts) {
      const own = hubByCategory.get(fact.category) as RiverHubPosition;
      expect(fact.y).toBeGreaterThan(own.top);
      expect(fact.y).toBeLessThan(own.top + own.height);

      for (const other of layout.hubs) {
        if (other.category === fact.category) continue;
        expect(fact.y < other.top || fact.y > other.top + other.height).toBe(true);
      }
    }
  });

  it('never overlaps two category blocks, whether open or collapsed', () => {
    const counts = { person: 1, project: 11, domain: 15, commitment: 40 };
    const layout = computeRiverLayout(graphOf(counts), expanded('domain'), REFERENCE_WIDTH);
    for (let i = 1; i < layout.hubs.length; i++) {
      expect(layout.hubs[i - 1].top + layout.hubs[i - 1].height).toBeLessThanOrEqual(layout.hubs[i].top);
    }
  });
});

describe('computeRiverLayout — determinism', () => {
  it('two calls on equivalent, freshly-built input produce deep-equal output', () => {
    const counts = { person: 2, project: 11, domain: 15, commitment: 2 };
    const a = computeRiverLayout(graphOf(counts), expanded('project', 'domain'), 1200);
    const b = computeRiverLayout(graphOf(counts), expanded('project', 'domain'), 1200);
    expect(a).toEqual(b);
  });

  it('a fact’s bend fraction depends only on its own id, never its neighbours or its row index', () => {
    const alone = computeRiverLayout(graphOf({ domain: 1 }), expanded('domain'), REFERENCE_WIDTH);
    const crowded = computeRiverLayout(
      graphOf({ person: 4, project: 11, domain: 1, commitment: 2 }),
      expanded('person', 'project', 'domain', 'commitment'),
      REFERENCE_WIDTH,
    );
    const aloneFact = alone.facts.find((f) => f.id === 'fact:domain-0');
    const crowdedFact = crowded.facts.find((f) => f.id === 'fact:domain-0');
    expect(aloneFact?.bendFraction).toBe(crowdedFact?.bendFraction);
  });

  it('spreads distinct fact ids across the jitter range instead of collapsing them to one value', () => {
    const layout = computeRiverLayout(graphOf({ domain: 40 }), expanded('domain'), REFERENCE_WIDTH);
    const unique = new Set(layout.facts.map((f) => f.bendFraction));
    expect(unique.size).toBeGreaterThan(1);
  });

  it('every branch bend fraction stays within BRANCH_BEND_BASE +/- BRANCH_BEND_JITTER', () => {
    const layout = computeRiverLayout(graphOf({ domain: 40 }), expanded('domain'), REFERENCE_WIDTH);
    expect(layout.facts.length).toBeGreaterThan(0);
    for (const fact of layout.facts) {
      expect(fact.bendFraction).toBeGreaterThanOrEqual(BRANCH_BEND_BASE - BRANCH_BEND_JITTER);
      expect(fact.bendFraction).toBeLessThanOrEqual(BRANCH_BEND_BASE + BRANCH_BEND_JITTER);
    }
  });

  it('a trunk always bends at the fixed TRUNK_BEND_FRACTION, never jittered', () => {
    const layout = computeRiverLayout(graphOf({ person: 1, domain: 3 }), expanded('domain'), REFERENCE_WIDTH);
    expect(layout.hubs.length).toBeGreaterThan(0);
    for (const hub of layout.hubs) expect(hub.bendFraction).toBe(TRUNK_BEND_FRACTION);
  });
});

describe('computeRiverLayout — disclosure (collapsed lanes hold no rows)', () => {
  it('a collapsed lane contributes its hub and zero fact rows', () => {
    const layout = computeRiverLayout(graphOf({ domain: 15 }), NONE_EXPANDED, REFERENCE_WIDTH);
    expect(layout.hubs).toHaveLength(1);
    expect(layout.facts).toHaveLength(0);
    expect(layout.hubs[0].count).toBe(15); // still reports what it holds
  });

  it('multiple lanes may be open at once, each contributing only its own rows', () => {
    const layout = computeRiverLayout(
      graphOf({ project: 3, domain: 2, commitment: 1 }),
      expanded('project', 'commitment'),
      REFERENCE_WIDTH,
    );
    expect(layout.facts.filter((f) => f.category === 'project')).toHaveLength(3);
    expect(layout.facts.filter((f) => f.category === 'commitment')).toHaveLength(1);
    expect(layout.facts.filter((f) => f.category === 'domain')).toHaveLength(0);
  });

  it('hub count reflects the FULL payload regardless of open/closed', () => {
    const graph = graphOf({ domain: 7 });
    const closed = computeRiverLayout(graph, NONE_EXPANDED, REFERENCE_WIDTH);
    const open = computeRiverLayout(graph, expanded('domain'), REFERENCE_WIDTH);
    expect(closed.hubs[0].count).toBe(7);
    expect(open.hubs[0].count).toBe(7);
  });
});

describe('computeRiverLayout — forgotten facts shrink the allocation', () => {
  it('one fewer active fact yields a smaller open block and one fewer row', () => {
    const before = computeRiverLayout(graphOf({ domain: 10 }), expanded('domain'), REFERENCE_WIDTH);
    const after = computeRiverLayout(graphOf({ domain: 9 }), expanded('domain'), REFERENCE_WIDTH);
    expect(after.hubs[0].height).toBeLessThan(before.hubs[0].height);
    expect(after.hubs[0].count).toBe(9);
    expect(after.facts).toHaveLength(9);
  });

  it('forgetting every fact in a lane leaves its hub at the collapsed floor, not negative or NaN', () => {
    const layout = computeRiverLayout(
      graphOf({ domain: 0, project: 3 }),
      expanded('domain', 'project'),
      REFERENCE_WIDTH,
    );
    const domainHub = layout.hubs.find((h) => h.category === 'domain') as RiverHubPosition;
    expect(domainHub.height).toBe(COLLAPSED_BLOCK_HEIGHT);
    expect(domainHub.count).toBe(0);
  });
});

describe('computeRiverLayout — canonical category order', () => {
  it('orders hubs top-to-bottom canonically, regardless of payload order', () => {
    const graph = graphOf({ commitment: 1, person: 1, domain: 1, project: 1, preference: 1 });
    const layout = computeRiverLayout(graph, NONE_EXPANDED, REFERENCE_WIDTH);
    expect(layout.hubs.map((h) => h.category)).toEqual(['person', 'project', 'preference', 'domain', 'commitment']);
  });
});

describe('computeRiverLayout — near-empty and null-graph floor', () => {
  it('a null graph yields a valid, centred, empty layout rather than throwing', () => {
    const layout = computeRiverLayout(null, NONE_EXPANDED, REFERENCE_WIDTH);
    expect(layout.hubs).toEqual([]);
    expect(layout.facts).toEqual([]);
    expect(layout.contentHeight).toBe(0);
    expect(layout.height).toBe(MIN_CANVAS_HEIGHT);
    expect(layout.twin.y).toBe(MIN_CANVAS_HEIGHT / 2);
  });

  it('an empty-but-non-null graph behaves identically to a null one', () => {
    const layout = computeRiverLayout({ nodes: [], edges: [], droppedCount: 0 }, NONE_EXPANDED, REFERENCE_WIDTH);
    expect(layout).toEqual(computeRiverLayout(null, NONE_EXPANDED, REFERENCE_WIDTH));
  });
});

describe('computeRiverLayout — radii and title placement', () => {
  it('assigns the fixed per-type radii', () => {
    const layout = computeRiverLayout(graphOf({ domain: 1 }), expanded('domain'), REFERENCE_WIDTH);
    expect(layout.twin.radius).toBe(TWIN_RADIUS);
    expect(layout.hubs[0].radius).toBe(HUB_RADIUS);
    expect(layout.facts[0].radius).toBe(FACT_RADIUS);
  });

  it('places a title TITLE_OFFSET_X to the right of its own fact column', () => {
    const layout = computeRiverLayout(graphOf({ domain: 3 }), expanded('domain'), REFERENCE_WIDTH);
    expect(layout.facts.length).toBeGreaterThan(0);
    for (const fact of layout.facts) expect(fact.titleX).toBe(fact.x + TITLE_OFFSET_X);
  });
});
