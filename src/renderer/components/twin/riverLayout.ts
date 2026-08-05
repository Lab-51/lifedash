// === FILE PURPOSE ===
// Pure, DOM-free geometry for the twin memory graph's RIVERBANK layout
// (TWIN-READ.2 Task 1) — the user-chosen replacement for the tiered force
// simulation ON THIS SURFACE ONLY. forceLayout.ts and TwinMemoryGraphCanvas.tsx
// are untouched; d3-force stays exactly as it is for BrainMemoryGraph.
//
// THE DESIGN CONTRACT IS THE MOCKUP:
// .planning/design/twin-memory-layout-variants.html (?v=riverbank) — its
// renderRiverbank() is where every constant below was measured. Where a doc
// comment says "mockup: ...", that is the literal line it was lifted from.
//
// THE SHAPE: the twin core sits at a fixed left column, one hub per POPULATED
// category is stacked vertically (the payload already carries exactly one hub
// per populated category — nothing here re-derives "populated" from the fact
// list), and one row per fact sits at a fixed pitch inside its hub's block.
// There is nothing left for a simulation to settle: every position below is
// closed-form arithmetic off (graph, expandedLanes, viewportWidth), which is
// what makes "a fact never leaves its category's band" a STRUCTURAL property
// of the output instead of a per-tick clamp applied to something that could
// still drift (tieredLayout.ts's own header makes the same point about ITS
// clamp — this file takes the idea one step further and removes the drift).
//
// COLUMN RATIOS, NOT FIXED PIXELS: the mockup's renderRiverbank() hardcodes
// twinX/hubX/factX (150/430/660) because its demo canvas is always exactly
// 1640px wide. This component's real container is not, so the three columns
// are stored as RATIOS of that same 1640px reference width and re-multiplied
// by the caller's actual (floored) viewport width — at exactly 1640px wide
// the output is pixel-identical to the mockup; at any other width the columns
// scale with it instead of drifting off-canvas. This mirrors the pattern
// tieredLayout.ts's own computeLanes already uses for its lane width.
//
// DETERMINISM: nothing here reads Date.now(), Math.random() or relies on
// object/row iteration order beyond the payload's own — the only per-row
// variation (a fact branch's S-bend point) is derived from
// tieredLayout.hash32(id), the SAME id hash seedInLane/seedPosition already
// use elsewhere in this codebase, so a rebuilt graph reproduces identical
// geometry and the app trusts exactly one hash implementation, not two.
//
// WHAT THIS FILE DOES NOT OWN: ribbon/centreline PATH STRINGS and their pixel
// widths live in synapticVisuals.ts (extended alongside this file, in the
// same task) — this file only says WHERE things are, never how the connection
// between two of them is drawn.
//
// === DEPENDENCIES ===
// tieredLayout (hash32 + laneOrderOf — pure utilities reused rather than
// reimplemented; forceLayout.ts, the SIMULATION half of that module, is not
// touched), shared twin types

import { hash32, laneOrderOf } from '../brain-graph/tieredLayout';
import type { TwinGraphNode, TwinMemoryGraph } from '../../../shared/types';

// ---------------------------------------------------------------------------
// CONSTANTS — the mockup's proven starting values, named. A tuning round
// after the manual smoke test touches only this block.
// ---------------------------------------------------------------------------

/** Vertical distance between two fact rows in the same open lane, in px.
 *  Mockup: `const ROW = 30`. */
export const ROW_PITCH = 30;

/** Fixed block height for a COLLAPSED lane (hub + heading only), in px, and
 *  the floor an OPEN lane's own row-driven height can never shrink below.
 *  Mockup: `const HUB_BLOCK = 56`. */
export const COLLAPSED_BLOCK_HEIGHT = 56;

/** Gap between two consecutive category blocks, in px. Mockup: `const GAP = 36`. */
export const BLOCK_GAP = 36;

/** The canvas width the mockup's column positions were measured against —
 *  `renderRiverbank(1640)` is the only width it was ever called with. See the
 *  file header for why the real columns are ratios of this, not copies of the
 *  raw pixel values. */
export const REFERENCE_WIDTH = 1640;

/** Twin core column, as a fraction of the (floored) viewport. Mockup: `const twinX = 150`. */
export const TWIN_COLUMN_RATIO = 150 / REFERENCE_WIDTH;
/** Category hub column. Mockup: `const hubX = 430`. */
export const HUB_COLUMN_RATIO = 430 / REFERENCE_WIDTH;
/** Fact soma column. Mockup: `const factX = 660`. */
export const FACT_COLUMN_RATIO = 660 / REFERENCE_WIDTH;

/** A viewport narrower than this would crush the hub<->fact gap a title needs
 *  to stay readable. NOT a mockup value (its demo canvas never varied width)
 *  — this file's own floor for a genuinely responsive host, the same role
 *  tieredLayout.ts's MIN_LANE_WIDTH plays for its lanes. */
export const MIN_RIVER_WIDTH = 640;

/** Horizontal gap between a fact's soma and its title's left edge, in px.
 *  Mockup: the row's `<text ... x="${factX + 16}" ...>`. */
export const TITLE_OFFSET_X = 16;

/** Height floor for a near-empty graph, so the canvas never collapses to a
 *  sliver. Mockup: `Math.max(720, totalH + 170)`. */
export const MIN_CANVAS_HEIGHT = 720;
/** Breathing room above and below the stacked blocks (split evenly), added
 *  before the floor above is applied. Mockup: the `+ 170` in that same line. */
export const CANVAS_HEIGHT_PADDING = 170;

/** Soma radii, verbatim from the mockup's `soma(...)` call sites in
 *  renderRiverbank — fixed per node type, not prominence-derived: the whole
 *  point of "one row per fact" is that collisions are impossible by
 *  construction, not by a glow tier tuned to fit. */
export const TWIN_RADIUS = 14;
export const HUB_RADIUS = 11;
export const FACT_RADIUS = 5;

/** Base fraction (0..1) of a branch's run where its S bends, before jitter.
 *  Mockup: `const mt = .38 + jit(fx.id, .1)`. */
export const BRANCH_BEND_BASE = 0.38;
/** Jitter amplitude applied to a branch's bend fraction. Several branches
 *  converge on the SAME hub point, so an identical bend for all of them would
 *  read as drafted rather than grown — jitter (never Math.random; see
 *  branchBendFraction below) staggers them. Mockup: the `.1` in `jit(fx.id, .1)`. */
export const BRANCH_BEND_JITTER = 0.1;
/** A trunk (twin -> hub) is never jittered: there is exactly one per hub, so
 *  there is no bundle to stagger, and each hub already sits at a different y.
 *  Mockup: `sRibbon(twinX, twinY, hx, hy, 4.6, 1.6, .5)`. */
export const TRUNK_BEND_FRACTION = 0.5;

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

export interface RiverTwinPosition {
  id: string;
  x: number;
  y: number;
  radius: number;
}

export interface RiverHubPosition {
  /** The hub node's own id (`category:${category}`) when the payload carries
   *  one, so a caller can key straight back into `graph.nodes`. */
  id: string;
  category: string;
  x: number;
  /** Vertical centre of this block. */
  y: number;
  radius: number;
  /** Top of this block's allocated vertical span. */
  top: number;
  /** Height of this block's allocated vertical span — see blockHeightFor. */
  height: number;
  open: boolean;
  /** Active fact count for this lane, from the FULL payload regardless of
   *  `open` — TWIN-READ.1's established rule: a collapsed lane still reports
   *  what it holds. */
  count: number;
  /** Always TRUNK_BEND_FRACTION — carried on the position anyway so a caller
   *  can pass `hub.bendFraction` to sRibbonPath without importing a second
   *  constant for "which bend does a hub's trunk use". */
  bendFraction: number;
}

export interface RiverFactPosition {
  id: string;
  category: string;
  x: number;
  y: number;
  radius: number;
  /** Left edge of the row's title text. */
  titleX: number;
  /** This row's own S-bend fraction — id-hashed, so the SAME fact bends at
   *  the SAME point on every relayout regardless of what else is on screen. */
  bendFraction: number;
}

export interface RiverLayout {
  twin: RiverTwinPosition;
  /** Top to bottom, canonical category order (tieredLayout.laneOrderOf). */
  hubs: RiverHubPosition[];
  /** Only OPEN lanes' facts — a collapsed lane contributes a hub and nothing
   *  else (TWIN-READ.1 (b): collapsed facts are absent from the layout, not
   *  merely hidden). Ordered by hub, then row index within that hub. */
  facts: RiverFactPosition[];
  /** Effective width the columns were computed against: viewportWidth,
   *  floored at MIN_RIVER_WIDTH (garbage input falls back to REFERENCE_WIDTH
   *  first, per usableWidth). */
  width: number;
  /** Total canvas height: floored at MIN_CANVAS_HEIGHT for a near-empty
   *  graph, padded above the raw content height otherwise. */
  height: number;
  /** Sum of every block's height plus the gaps between them — i.e. `height`
   *  before CANVAS_HEIGHT_PADDING and the MIN_CANVAS_HEIGHT floor apply. */
  contentHeight: number;
}

// ---------------------------------------------------------------------------
// HELPERS — each total: garbage/degenerate input yields a finite result,
// never a thrown error or a NaN that would silently void the whole canvas.
// ---------------------------------------------------------------------------

/** viewportWidth, defended the same way tieredLayout.computeLanes defends its
 *  own: a non-finite/non-positive input falls back to the mockup's reference
 *  width, and a genuinely narrow real container is floored so the hub<->fact
 *  gap a title needs never gets crushed to nothing. */
function usableWidth(viewportWidth: number): number {
  const width = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : REFERENCE_WIDTH;
  return Math.max(width, MIN_RIVER_WIDTH);
}

/** The three fixed columns for an already-floored width. */
function columnsFor(width: number): { twinX: number; hubX: number; factX: number } {
  return { twinX: width * TWIN_COLUMN_RATIO, hubX: width * HUB_COLUMN_RATIO, factX: width * FACT_COLUMN_RATIO };
}

/** A block's allocated height: proportional to its visible rows when the
 *  lane is open, a fixed size when it is shut — a row's slot is reserved
 *  whether or not anyone has opened the lane, which is what makes collisions
 *  impossible by construction rather than by tuning. Mockup:
 *  `expanded.has(c.key) ? Math.max(vis[c.key].length * ROW, HUB_BLOCK) : HUB_BLOCK`. */
function blockHeightFor(visibleCount: number, open: boolean): number {
  if (!open) return COLLAPSED_BLOCK_HEIGHT;
  return Math.max(visibleCount * ROW_PITCH, COLLAPSED_BLOCK_HEIGHT);
}

/** This fact's own S-bend fraction — id-hashed (never Math.random, a hard
 *  constraint) so the same fact bends at the same point every time. Mockup:
 *  `mt = .38 + jit(fx.id, .1)`, where `jit` is the mockup's own toy hash;
 *  this reuses the app's REAL id hash (tieredLayout.hash32, already proven by
 *  seedInLane/seedPosition) rather than a second hash implementation. */
function branchBendFraction(id: string): number {
  const unit = (hash32(id) % 1000) / 1000; // [0, 1)
  return BRANCH_BEND_BASE + (unit - 0.5) * 2 * BRANCH_BEND_JITTER;
}

/** Split the payload's nodes into per-category fact lists and the hub node
 *  for each category, in one pass. A node with no category (there should be
 *  none besides the twin core, which is neither a fact nor a hub) is simply
 *  skipped — degenerate input stays finite rather than throwing. */
function groupNodes(nodes: readonly TwinGraphNode[]): {
  factsByCategory: Map<string, TwinGraphNode[]>;
  hubByCategory: Map<string, TwinGraphNode>;
} {
  const factsByCategory = new Map<string, TwinGraphNode[]>();
  const hubByCategory = new Map<string, TwinGraphNode>();
  for (const node of nodes) {
    if (node.type === 'fact' && node.category) {
      const list = factsByCategory.get(node.category);
      if (list) list.push(node);
      else factsByCategory.set(node.category, [node]);
    } else if (node.type === 'category' && node.category) {
      hubByCategory.set(node.category, node);
    }
  }
  return { factsByCategory, hubByCategory };
}

// ---------------------------------------------------------------------------
// THE LAYOUT
// ---------------------------------------------------------------------------

/**
 * (graph payload, expandedLanes, viewportWidth) -> the whole riverbank
 * geometry. Pure and deterministic: the same three inputs always produce the
 * same output, deep-equal.
 *
 * `graph` may be null (the store's "not loaded yet" state) — that yields the
 * empty-but-valid floor layout (twin centred, no hubs, no facts) rather than
 * requiring every caller to null-check before it can render anything.
 */
export function computeRiverLayout(
  graph: TwinMemoryGraph | null,
  expandedLanes: ReadonlySet<string>,
  viewportWidth: number = REFERENCE_WIDTH,
): RiverLayout {
  const width = usableWidth(viewportWidth);
  const { twinX, hubX, factX } = columnsFor(width);
  const { factsByCategory, hubByCategory } = groupNodes(graph?.nodes ?? []);
  const order = laneOrderOf(hubByCategory.keys());

  const blockHeights = order.map((category) =>
    blockHeightFor(factsByCategory.get(category)?.length ?? 0, expandedLanes.has(category)),
  );
  const contentHeight = blockHeights.reduce((sum, h) => sum + h, 0) + BLOCK_GAP * Math.max(0, order.length - 1);
  const height = Math.max(MIN_CANVAS_HEIGHT, contentHeight + CANVAS_HEIGHT_PADDING);
  const top0 = (height - contentHeight) / 2;

  const hubs: RiverHubPosition[] = [];
  const facts: RiverFactPosition[] = [];
  let cursorY = top0;

  order.forEach((category, index) => {
    const blockHeight = blockHeights[index];
    const open = expandedLanes.has(category);
    const categoryFacts = factsByCategory.get(category) ?? [];
    const blockTop = cursorY;

    hubs.push({
      id: hubByCategory.get(category)?.id ?? `category:${category}`,
      category,
      x: hubX,
      y: blockTop + blockHeight / 2,
      radius: HUB_RADIUS,
      top: blockTop,
      height: blockHeight,
      open,
      count: categoryFacts.length,
      bendFraction: TRUNK_BEND_FRACTION,
    });

    if (open) {
      categoryFacts.forEach((fact, i) => {
        facts.push({
          id: fact.id,
          category,
          x: factX,
          y: blockTop + ROW_PITCH / 2 + i * ROW_PITCH,
          radius: FACT_RADIUS,
          titleX: factX + TITLE_OFFSET_X,
          bendFraction: branchBendFraction(fact.id),
        });
      });
    }

    cursorY += blockHeight + BLOCK_GAP;
  });

  return {
    twin: { id: 'twin', x: twinX, y: top0 + contentHeight / 2, radius: TWIN_RADIUS },
    hubs,
    facts,
    width,
    height,
    contentHeight,
  };
}
