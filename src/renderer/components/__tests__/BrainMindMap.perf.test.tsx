// === FILE PURPOSE ===
// Perf regression guard for BrainMindMap's d3-hierarchy layout (V3.2 Task 5).
// Builds a synthetic 500+-card BrainTree in-memory (no DB) mirroring the real
// shape — workspace -> many projects -> columns -> many cards — and times a
// FULLY-EXPANDED relayout via the exported `buildLayout` pure function. A fully
// expanded tree is the worst case the feature must protect against: collapse
// (not a node cap or memoization) is the designed scaling mechanism, so this is
// the ceiling `buildLayout` should never cross even before any collapsing.
//
// Per the story: only memoize subtree layouts if this budget is ACTUALLY
// breached. It is not (see the measured number logged below), so no
// memoization was added — this test is the regression guard instead.

// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { buildLayout } from '../BrainMindMap';
import type { BrainNode } from '../../../shared/types';

const PROJECT_COUNT = 20;
const COLUMNS_PER_PROJECT = 5;
const CARDS_PER_COLUMN = 5; // 20 * 5 * 5 = 500 cards

/** workspace -> 20 projects -> 5 columns each -> 5 cards each (500 cards, 621
 *  nodes total including workspace/project/column nodes). */
function buildHeavyFixture(): BrainNode {
  const projects: BrainNode[] = [];
  for (let p = 0; p < PROJECT_COUNT; p++) {
    const columns: BrainNode[] = [];
    for (let c = 0; c < COLUMNS_PER_PROJECT; c++) {
      const cards: BrainNode[] = [];
      for (let k = 0; k < CARDS_PER_COLUMN; k++) {
        cards.push({
          id: `card:p${p}c${c}k${k}`,
          type: 'card',
          label: `Card ${p}-${c}-${k}`,
          entityId: `p${p}c${c}k${k}`,
          childCount: 0,
          children: [],
        });
      }
      columns.push({
        id: `column:p${p}c${c}`,
        type: 'column',
        label: `Column ${p}-${c}`,
        entityId: `p${p}c${c}`,
        childCount: cards.length,
        children: cards,
      });
    }
    projects.push({
      id: `project:p${p}`,
      type: 'project',
      label: `Project ${p}`,
      entityId: `p${p}`,
      childCount: columns.length,
      children: columns,
    });
  }
  return {
    id: 'workspace',
    type: 'workspace',
    label: 'Workspace',
    entityId: null,
    childCount: projects.length,
    children: projects,
  };
}

/** Every id with children — fully expanded is the layout's worst case. */
function allBranchIds(root: BrainNode): Set<string> {
  const ids = new Set<string>();
  const walk = (node: BrainNode): void => {
    if (node.children.length > 0) ids.add(node.id);
    node.children.forEach(walk);
  };
  walk(root);
  return ids;
}

describe('BrainMindMap buildLayout perf (Task 5)', () => {
  it('relayouts a fully-expanded 500+-card tree in well under 50ms', () => {
    const root = buildHeavyFixture();
    const expanded = allBranchIds(root);

    // Warm up once so the measured call reflects steady-state (JIT-settled) cost,
    // not one-time module/parse overhead.
    buildLayout(root, expanded);

    const start = performance.now();
    const layout = buildLayout(root, expanded);
    const elapsed = performance.now() - start;

    expect(layout.nodes.length).toBeGreaterThan(500);
    console.log(
      `[perf] BrainMindMap.buildLayout: ${layout.nodes.length} nodes, ${layout.links.length} links -> ${elapsed.toFixed(3)}ms`,
    );
    expect(elapsed).toBeLessThan(50);
  });
});
