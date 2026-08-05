// === FILE PURPOSE ===
// Pure visual helpers for the memory graph canvas (TWIN-GRAPH.1 Task 3): the
// per-type palette, the glow-tier -> opacity/halo mapping, the curved-edge path
// string, and label truncation. Split out of BrainMemoryGraph so the component
// file stays about behaviour (layout, frames, interaction) and so a colour/curve
// tuning round touches ONE file.
//
// NOTHING here derives a radius, a glow tier or a prominence score — prominence.ts
// is the single source of truth for those and forceLayout stores its output on
// every LayoutNode. This module only maps an ALREADY-COMPUTED tier onto pixels.
//
// THEMING: every colour is a Tailwind CSS variable (or a color-mix over one), the
// same convention BrainMindMap uses, so light and dark both work.
//
// === DEPENDENCIES ===
// shared brain types (BrainGraphNodeType), prominence (GlowTier type only)

import type { SVGProps } from 'react';
import type { BrainGraphNodeType, TwinFactCategory, TwinGraphNodeType } from '../../../shared/types';
import type { GlowTier } from './prominence';

/** Per-type hue. person/topic/session keep the hues BrainMindMap already used for
 *  those concepts (so the Brain doesn't recolour itself under the user); the two
 *  fact ledgers get their own distinct hues. */
export const GRAPH_TYPE_COLOR: Record<BrainGraphNodeType, string> = {
  person: 'var(--color-error)',
  topic: 'var(--color-primary-300)',
  session: 'var(--color-magenta)',
  entityFact: 'var(--color-accent)',
  twinFact: 'var(--color-warm)',
};

/** Human label per type — used for accessible names, never as decoration. */
export const GRAPH_TYPE_LABEL: Record<BrainGraphNodeType, string> = {
  person: 'Person',
  topic: 'Topic',
  session: 'Session',
  entityFact: 'Fact',
  twinFact: 'Twin memory',
};

/** Per-type hue for the TWIN memory graph's three node kinds (TWIN-GRAPH.2).
 *  The twin core takes the app accent (it is "you"), a category hub takes the
 *  structural primary, and a learned fact keeps the same warm hue twin facts
 *  already have in the entity graph above — so one memory does not change colour
 *  depending on which canvas it is drawn on. */
export const TWIN_GRAPH_TYPE_COLOR: Record<TwinGraphNodeType, string> = {
  twin: 'var(--color-accent)',
  category: 'var(--color-primary-300)',
  fact: 'var(--color-warm)',
};

/** Human label per twin-graph type — used for accessible names, never decoration. */
export const TWIN_GRAPH_TYPE_LABEL: Record<TwinGraphNodeType, string> = {
  twin: 'Twin',
  category: 'Category',
  fact: 'Learned fact',
};

/** Display name per category lane. Capitalised titles rather than the raw enum
 *  value, which is what the lane headings and the inspector chip both render. */
export const TWIN_CATEGORY_LABEL: Record<TwinFactCategory, string> = {
  person: 'People',
  project: 'Projects',
  preference: 'Preferences',
  domain: 'Domain',
  commitment: 'Commitments',
};

/** Heading for a lane key, tolerating a category the enum does not know (the
 *  layout appends unknown lanes alphabetically rather than dropping them). */
export function laneHeading(key: string): string {
  return TWIN_CATEGORY_LABEL[key as TwinFactCategory] ?? key;
}

/** Brightness per glow tier — the quantised "how alive is this memory" signal. */
export const GLOW_OPACITY: Record<GlowTier, number> = {
  dim: 0.42,
  soft: 0.62,
  bright: 0.82,
  radiant: 1,
};

/** Extra px of soft halo drawn behind a node, per tier. `dim` draws none at all,
 *  so a stale isolated memory costs zero extra DOM. */
export const GLOW_HALO_PX: Record<GlowTier, number> = {
  dim: 0,
  soft: 3,
  bright: 7,
  radiant: 12,
};

/** Below this zoom scale labels are hidden — declutter, so a dense graph reads as
 *  shape rather than a wall of text. */
export const LABEL_ZOOM_THRESHOLD = 0.75;

/** Sideways bow of an edge as a fraction of its length. Small on purpose: enough
 *  to read as organic, not enough to make an edge ambiguous about its endpoints. */
export const EDGE_CURVATURE = 0.16;

/**
 * Quadratic bézier between two points, bowed perpendicular to the straight line
 * — the organic connector look, as a plain string. Deliberately NOT d3-shape:
 * this is three subtractions and a template literal.
 *
 * Degenerate input (identical endpoints) collapses to a zero-length curve rather
 * than producing NaN, because a NaN in a `d` attribute silently drops the path.
 */
export function curvedEdgePath(x1: number, y1: number, x2: number, y2: number, curvature = EDGE_CURVATURE): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const cx = (x1 + x2) / 2 - dy * curvature;
  const cy = (y1 + y2) / 2 + dx * curvature;
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return `M${x1},${y1}L${x2},${y2}`;
  return `M${x1},${y1}Q${cx},${cy} ${x2},${y2}`;
}

/** Keep labels short — SVG text has no wrapping or ellipsis. Mirrors
 *  BrainMindMap.truncate; fact labels are sentences, so the cap is longer.
 *
 *  RETAINED FOR THE ENTITY GRAPH ONLY (BrainMemoryGraph), whose node labels are
 *  genuinely short names. The TWIN graph retired it in TWIN-READ.1 Task 3:
 *  chopping a sentence at 34 characters produced a fragment too long to sit
 *  beside its neighbours and too short to mean anything. Use `wrapLabelLines`
 *  there instead. */
export function truncateLabel(label: string, max = 34): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

// ---------------------------------------------------------------------------
// LABEL LEGIBILITY (TWIN-READ.1 Task 3). Everything below is ADDITIVE — the
// exports above are shared with BrainMemoryGraph and were deliberately left
// untouched so that surface stays byte-identical.
// ---------------------------------------------------------------------------

/**
 * The text halo, as props to spread onto an SVG `<text>`.
 *
 * `paint-order: stroke` is the NATIVE SVG answer to "this label crosses a
 * connection and becomes unreadable": it paints the stroke *under* the fill, so
 * a background-coloured stroke reads as a knockout outline rather than as an
 * outlined font. No duplicate shadow-text element, no filter, no extra DOM.
 *
 * The stroke colour is `--color-chrome` — the same surface variable the node
 * fills already mix against, so the halo follows the theme instead of pinning
 * one background colour into the renderer.
 */
export const LABEL_HALO_PROPS: Pick<SVGProps<SVGTextElement>, 'stroke' | 'strokeWidth' | 'strokeLinejoin' | 'style'> = {
  stroke: 'var(--color-chrome)',
  strokeWidth: 3,
  strokeLinejoin: 'round',
  style: { paintOrder: 'stroke' },
};

/** Baseline-to-baseline distance for a wrapped label, in px (11px text). */
export const LABEL_LINE_HEIGHT = 13;

/** Characters per line for a node's RESTING caption. Two lines of this comfortably
 *  hold factLabel.ts's 40-character ceiling, so a stored label is wrapped, never
 *  truncated. */
export const LABEL_LINE_CHARS = 22;

/** Lines a resting caption may use. A 2-4 word label needs one; the second exists
 *  only so the 40-char worst case still renders in full. */
export const LABEL_MAX_LINES = 2;

/** Characters per line when a node is revealing its FULL text. Wider than the
 *  resting caption because the revealed block is the thing being read. */
export const LABEL_FOCUS_LINE_CHARS = 30;

/** Lines the revealed full text may use — 30x6 = 180 characters, which covers a
 *  learned fact with room to spare. Beyond that the last line ellipsises; the
 *  inspector holds the complete text either way. */
export const LABEL_FOCUS_MAX_LINES = 6;

/** Marks the end of a line that had to break inside a single long word. */
const ELLIPSIS = '…';

/** Split one over-long word into hard chunks of at most `maxChars`. A URL or a
 *  hash has no spaces to break on, and letting it run would push the label
 *  clean out of its lane. */
function hardChunks(word: string, maxChars: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < word.length; i += maxChars) chunks.push(word.slice(i, i + maxChars));
  return chunks;
}

/**
 * Greedy word wrap on a CHARACTER budget — deliberately NOT a measurement.
 *
 * The renderer has no reliable way to measure SVG text: `getComputedTextLength`
 * and `getBBox` are unimplemented under this project's jsdom (verified), and a
 * canvas-based estimate needs `getContext`, which is also unimplemented. A
 * character budget is therefore the ONLY strategy that behaves identically in
 * the app and in a test, which is what lets a test assert the real line breaks
 * instead of asserting that a stub was called.
 *
 * Pure, total, and never empty for non-blank input: whitespace collapses, an
 * unbreakable word is hard-chunked, and overflow past `maxLines` ellipsises the
 * last line rather than silently dropping content.
 */
export function wrapLabelLines(text: string, maxChars = LABEL_LINE_CHARS, maxLines = LABEL_MAX_LINES): string[] {
  const budget = Math.max(1, Math.floor(maxChars));
  const lineCap = Math.max(1, Math.floor(maxLines));
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    for (const piece of word.length > budget ? hardChunks(word, budget) : [word]) {
      if (!current) current = piece;
      else if (current.length + 1 + piece.length <= budget) current = `${current} ${piece}`;
      else {
        lines.push(current);
        current = piece;
      }
      if (lines.length > lineCap) break;
    }
    if (lines.length > lineCap) break;
  }
  if (current) lines.push(current);

  if (lines.length <= lineCap) return lines;
  const kept = lines.slice(0, lineCap);
  const last = kept[lineCap - 1];
  kept[lineCap - 1] =
    last.length + ELLIPSIS.length <= budget
      ? `${last}${ELLIPSIS}`
      : `${last.slice(0, budget - 1).trimEnd()}${ELLIPSIS}`;
  return kept;
}
