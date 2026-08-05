// === FILE PURPOSE ===
// CATEGORY-SCOPED ATTENTION (TWIN-READ.2 Task 4) — pure, DOM-free, and kept
// OUT of TwinMemoryRiverCanvas.tsx on purpose: that file sits at ~450 of a
// 500-line ceiling, and this is exactly the kind of derivation riverLayout.ts
// and riverCanvasModel.ts already model — WHAT level a node reads at, never
// how it is rendered.
//
// >>> ONLY A FACT DRIVES THE DIM WAVE. <<< The mockup's own `attend()`/
// `unattend()` are wired to `[data-fact]` ELEMENTS ONLY (mouseover/focusin
// handlers call `e.target.closest('[data-fact]')` and bail if it is null) —
// hovering, focusing or pinning a HUB or the TWIN CORE never triggers the
// scoped dim wave there, and the plan's own attention table is phrased
// entirely in terms of "the attended FACT". This module mirrors that
// precisely: `resolveAttendedCategory` returns neutral (nothing attended)
// unless the candidate id resolves to a RENDERED ROW. Each of those three
// node kinds keeps its own PRE-EXISTING per-node ring highlight either way
// (TwinMemoryRiverRow/Hub/Core's `highlighted` prop, untouched by this file).
//
// >>> ONE FLAT MAP ANSWERS ROWS, HUBS, HEADINGS AND EDGES ALIKE. <<< A trunk
// (twin-hub) or branch (hub-fact) edge's own level is always its `toId`'s
// level — a trunk tracks its hub, a branch tracks the fact it feeds — so
// `computeRiverAttentionLevels` keys ONE `Map<nodeId, AttentionLevel>` by
// every hub id and every rendered row's id, and every caller (row, hub,
// heading, edge) reads it with the SAME `levels.get(id) ?? 'lit'` lookup.
// Missing = neutral = 'lit', which is also what an EMPTY map means when
// nothing is attended at all (the mockup's `.dimmable` alone, without
// `svg.attending`, carries no rule — full opacity for everyone). The TWIN is
// simply never a key in this map: it is never queried, so it never dims.
//
// === DEPENDENCIES ===
// synapticVisuals (AttentionLevel, the level enum this module resolves to),
// riverLayout (RiverHubPosition), riverCanvasModel (RiverRowModel)

import type { AttentionLevel } from './synapticVisuals';
import type { RiverHubPosition } from './riverLayout';
import type { RiverRowModel } from './riverCanvasModel';

/** The single id the category-scoped system treats as "attended" this
 *  render, and that id's category — or both null when nothing (or something
 *  that is not a rendered fact) is attended. Priority hovered > focused >
 *  pinned: a live pointer signal wins over a stale keyboard focus if a test
 *  or an unusual input sequence ever sets both at once. */
export function resolveAttendedCategory(
  hoveredId: string | null,
  focusedId: string | null,
  pinnedId: string | null,
  rows: readonly RiverRowModel[],
): { attendedId: string | null; attendedCategory: string | null } {
  const candidate = hoveredId ?? focusedId ?? pinnedId;
  if (!candidate) return { attendedId: null, attendedCategory: null };
  const row = rows.find((r) => r.node.id === candidate);
  if (!row) return { attendedId: null, attendedCategory: null };
  return { attendedId: candidate, attendedCategory: row.category };
}

/** A FACT ROW's own level: the attended fact itself is 'lit', a same-category
 *  sibling is 'mid', everything else is 'dim' — 'lit' uniformly when nothing
 *  is attended. */
export function factAttentionLevel(
  factId: string,
  category: string,
  attendedId: string | null,
  attendedCategory: string | null,
): AttentionLevel {
  if (!attendedCategory) return 'lit';
  if (factId === attendedId) return 'lit';
  return category === attendedCategory ? 'mid' : 'dim';
}

/** A CATEGORY ANCHOR's level — a hub, its trunk, or its heading. Never 'mid':
 *  an anchor is read as a whole, not as one sibling among others. */
export function anchorAttentionLevel(category: string, attendedCategory: string | null): AttentionLevel {
  if (!attendedCategory) return 'lit';
  return category === attendedCategory ? 'lit' : 'dim';
}

/**
 * Every hub id and every RENDERED row's id, mapped to its attention level —
 * built once per render and read by rows, hubs, headings and edges alike
 * (see the file header for why one map is enough for all four). Empty
 * whenever nothing is attended, which every reader's `?? 'lit'` fallback
 * already treats as full opacity.
 */
export function computeRiverAttentionLevels(
  hoveredId: string | null,
  focusedId: string | null,
  pinnedId: string | null,
  hubs: readonly RiverHubPosition[],
  rows: readonly RiverRowModel[],
): ReadonlyMap<string, AttentionLevel> {
  const { attendedId, attendedCategory } = resolveAttendedCategory(hoveredId, focusedId, pinnedId, rows);
  const levels = new Map<string, AttentionLevel>();
  if (!attendedCategory) return levels;

  for (const hub of hubs) levels.set(hub.id, anchorAttentionLevel(hub.category, attendedCategory));
  for (const row of rows)
    levels.set(row.node.id, factAttentionLevel(row.node.id, row.category, attendedId, attendedCategory));
  return levels;
}
