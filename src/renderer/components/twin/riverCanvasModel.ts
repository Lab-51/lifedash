// === FILE PURPOSE ===
// Everything TwinMemoryRiverCanvas MAPS OVER, derived from riverLayout's
// positions in one pass each (TWIN-READ.2 Task 2). Pure and DOM-free, so the
// canvas component stays composition and each derivation is testable without
// mounting anything.
//
// THE DIVISION OF LABOUR, top to bottom:
//   riverLayout.ts   — WHERE everything is (closed-form arithmetic).
//   THIS FILE        — WHAT is drawn: rows paired with their payload nodes,
//                      the trunk/branch edge list, the pinned-card anchors, and
//                      the box "Fit to view" has to cover.
//   synapticVisuals  — HOW a connection between two of them is shaped.
//
// TWO RULES THIS FILE EXISTS TO KEEP HONEST:
//   * A ROW'S STAGGER INDEX IS ITS INDEX WITHIN ITS OWN LANE, never its index in
//     the global row list — otherwise the second open lane would start its
//     cascade wherever the first one finished, which reads as a stall.
//   * EDGES ARE DERIVED FROM THE LAYOUT, not from `graph.edges`: the layout has
//     already resolved which facts are disclosed, and a payload edge pointing at
//     a collapsed fact has no endpoint to draw to.
//
// NO MEASUREMENT ANYWHERE. Widths come from a deterministic character estimate,
// because jsdom implements neither getBBox nor getComputedTextLength — a
// measured width would behave one way in the app and another in every test.
//
// === DEPENDENCIES ===
// riverLayout (positions + column constants), synapticVisuals (ribbon widths,
// ring geometry), graphVisuals (lane headings), GraphPinnedCard (AnchoredNode),
// TwinMemoryNodeLabel (the shared label accessor), shared twin types

import type { AnchoredNode } from '../brain-graph/GraphPinnedCard';
import { laneHeading } from '../brain-graph/graphVisuals';
import { FACT_RADIUS, TITLE_OFFSET_X, type RiverHubPosition, type RiverLayout } from './riverLayout';
import {
  DENDRITE_HUB_WIDTH,
  DENDRITE_TIP_WIDTH,
  RIVER_TRUNK_HUB_WIDTH,
  RIVER_TRUNK_TIP_WIDTH,
  SOMA_OUTER_RING_PX,
} from './synapticVisuals';
import { restLabelOf } from './TwinMemoryNodeLabel';
import type { RiverEdge } from './TwinMemoryRiverDendrite';
import type { TwinGraphNode, TwinMemoryGraph } from '../../../shared/types';

/** Gap between a lane heading's right edge and its hub. Mockup: `hx - 34`. */
export const HUB_LABEL_OFFSET_X = 34;
/** Font size of a lane heading, in px — the width estimate's other input. */
export const HUB_LABEL_FONT_PX = 12;
/** Font size of a row title, in px. Matches the tiered canvas's captions. */
export const ROW_TITLE_FONT_PX = 11;
/** Clear air around the content box, in layout px. */
export const CONTENT_PAD = 28;

/** One rendered row: its position, its payload node, and where it sits in ITS
 *  OWN lane (which is what the cascade stagger counts). */
export interface RiverRowModel {
  node: TwinGraphNode;
  x: number;
  y: number;
  category: string;
  index: number;
  laneRows: number;
}

/**
 * A title's rendered width, ESTIMATED from its character count — never measured
 * (see the header). 0.56em is a conservative average advance for this UI's sans
 * stack, deliberately generous: both consumers (a row's hit target and the
 * fit-to-view box) fail SAFE when it over-estimates.
 */
export function estimatedTitleWidth(title: string, fontPx: number = ROW_TITLE_FONT_PX): number {
  return title.length * fontPx * 0.56;
}

/** Rows in draw order, each paired with the payload node that names it. */
export function rowModelsOf(layout: RiverLayout, graph: TwinMemoryGraph | null): RiverRowModel[] {
  if (!graph) return [];
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const laneTotals = new Map<string, number>();
  for (const fact of layout.facts) laneTotals.set(fact.category, (laneTotals.get(fact.category) ?? 0) + 1);

  const seen = new Map<string, number>();
  const models: RiverRowModel[] = [];
  for (const fact of layout.facts) {
    const node = byId.get(fact.id);
    if (!node) continue; // a position with no payload node could be neither named nor inspected
    const index = seen.get(fact.category) ?? 0;
    seen.set(fact.category, index + 1);
    models.push({
      node,
      x: fact.x,
      y: fact.y,
      category: fact.category,
      index,
      laneRows: laneTotals.get(fact.category) ?? 1,
    });
  }
  return models;
}

/**
 * Every connection the river draws: one TRUNK per hub (twin -> hub — wider,
 * un-jittered, and deliberately WITHOUT a terminal dot, because it ends at a
 * control that already carries its own count) and one BRANCH per visible row.
 */
export function riverEdgesOf(layout: RiverLayout): RiverEdge[] {
  const edges: RiverEdge[] = [];
  const hubByCategory = new Map(layout.hubs.map((hub) => [hub.category, hub]));

  for (const hub of layout.hubs) {
    edges.push({
      key: `${edges.length}:${layout.twin.id}>${hub.id}`,
      kind: 'twin-hub',
      fromId: layout.twin.id,
      toId: hub.id,
      x1: layout.twin.x,
      y1: layout.twin.y,
      x2: hub.x,
      y2: hub.y,
      hubWidth: RIVER_TRUNK_HUB_WIDTH,
      tipWidth: RIVER_TRUNK_TIP_WIDTH,
      bend: hub.bendFraction,
      targetRadius: null,
    });
  }
  for (const fact of layout.facts) {
    const hub = hubByCategory.get(fact.category);
    if (!hub) continue;
    edges.push({
      key: `${edges.length}:${hub.id}>${fact.id}`,
      kind: 'hub-fact',
      fromId: hub.id,
      toId: fact.id,
      x1: hub.x,
      y1: hub.y,
      x2: fact.x,
      y2: fact.y,
      hubWidth: DENDRITE_HUB_WIDTH,
      tipWidth: DENDRITE_TIP_WIDTH,
      bend: fact.bendFraction,
      targetRadius: fact.radius,
    });
  }
  return edges;
}

/**
 * What GraphPinnedCardLayer may pin to: the twin core, every hub, and every
 * RENDERED row — built from `rows`, never `layout.facts` directly, so an anchor
 * can never exist for an id nothing on screen can actually be clicked to reach
 * (rowModelsOf already drops a layout position with no payload node).
 *
 * >>> THE ROW ANCHOR IS ASYMMETRIC — the pre-named trap of this task. <<< A
 * row's caption sits to the RIGHT of its soma, so anchoring at the circle's
 * edge (the OLD behaviour, and still what twin/hub anchors do — nothing sits
 * beside THEM) would default-place the pinned card right on top of the title
 * that was just clicked. `rightExtent` is `TITLE_OFFSET_X +
 * estimatedTitleWidth(restLabelOf(node))` — the SAME deterministic,
 * character-based estimate the row's own `[data-row-hit]` rect is built from
 * (never a measured width; jsdom has no SVG text metrics) — so the card and
 * the row's actual hit target agree by construction. The LEFT side is
 * untouched (`radius`): nothing sits left of a row, so a flipped card still
 * anchors at the soma's edge exactly as before.
 */
export function anchorsOf(layout: RiverLayout, rows: readonly RiverRowModel[]): AnchoredNode[] {
  return [
    { id: layout.twin.id, x: layout.twin.x, y: layout.twin.y, radius: layout.twin.radius },
    ...layout.hubs.map((hub) => ({ id: hub.id, x: hub.x, y: hub.y, radius: hub.radius })),
    ...rows.map((row) => ({
      id: row.node.id,
      x: row.x,
      y: row.y,
      radius: FACT_RADIUS,
      rightExtent: TITLE_OFFSET_X + estimatedTitleWidth(restLabelOf(row.node)),
    })),
  ];
}

/** A lane heading's full text — composed in ONE place, so the width estimate and
 *  the rendered heading cannot drift apart. */
export function headingTextOf(hub: RiverHubPosition): string {
  return `${laneHeading(hub.category)} · ${hub.count}`;
}

/** The box framing has to cover, in layout space — titles and headings included,
 *  or "Fit to view" would crop the very text this layout exists to make legible. */
export function contentBoxOf(
  layout: RiverLayout,
  rows: readonly RiverRowModel[],
): { x: number; y: number; width: number; height: number } {
  let left = layout.twin.x - layout.twin.radius - SOMA_OUTER_RING_PX;
  let right = layout.twin.x + layout.twin.radius + SOMA_OUTER_RING_PX;
  for (const hub of layout.hubs) {
    // A heading is right-anchored, so it reaches LEFT of its hub — in a narrow
    // container that is the leftmost thing on the canvas, not the twin core.
    left = Math.min(left, hub.x - HUB_LABEL_OFFSET_X - estimatedTitleWidth(headingTextOf(hub), HUB_LABEL_FONT_PX));
    right = Math.max(right, hub.x + hub.radius + SOMA_OUTER_RING_PX);
  }
  for (const row of rows) {
    right = Math.max(right, row.x + TITLE_OFFSET_X + estimatedTitleWidth(restLabelOf(row.node)));
  }
  return {
    x: left - CONTENT_PAD,
    y: (layout.height - layout.contentHeight) / 2 - CONTENT_PAD,
    width: Math.max(right - left + CONTENT_PAD * 2, 1),
    height: Math.max(layout.contentHeight + CONTENT_PAD * 2, 1),
  };
}
