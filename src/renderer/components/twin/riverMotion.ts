// === FILE PURPOSE ===
// THE RIVERBANK'S MOTION VOCABULARY (TWIN-READ.2 Task 2), as pure numbers, class
// names and one delay function. No React, no DOM — so the one thing that could
// silently rot (the stagger) is unit-testable on its own.
//
// >>> WHY THIS MODULE EXISTS AT ALL. <<<
// The riverbank's layout is closed-form arithmetic, so the force simulation
// retires on this surface — and with it the SETTLE MOTION that made the graph
// feel alive. The user's instruction was explicit: *"make sure we keep the
// organic feel in terms of animation, clicks etc. Don't want to lose that."*
// Determinism must therefore REPLACE that motion, not delete it. Everything
// below is that replacement: interaction-triggered, one-shot, and finished.
//
// THE VOCABULARY (each item is one-shot, and every one of them ENDS CLEAN):
//   * GROWTH CASCADE — a lane's contents do not appear, they GROW. Each branch
//     scales out of its hub (hub-origin reveal) and each row fades and slides
//     its last few px into place, STAGGERED by row, on the springy ease below.
//   * TAP — the hub the user just toggled takes a hair of scale. It is the whole
//     of what a COLLAPSE plays: faster than the cascade and un-staggered, which
//     is exactly the "collapse reverses faster" half of the vocabulary. (A
//     collapsing lane's rows leave the DOM outright — progressive disclosure is
//     not a CSS trick — so there is nothing left to animate out.)
//   * The ARRIVAL BLOOM (`brain-node-enter`), the ACTIVATION PULSE and the CORE
//     SHIMMER are reused verbatim from TWIN-READ.1 and are not restated here.
//
// >>> NO PERSISTENT FILL-MODES. THE NAMED TRAP OF THIS PHASE. <<<
// A lingering `forwards`/`both` fill pins its final value FOREVER, and an
// animation beats a normal declaration — so a "finished" enter animation would
// silently defeat the attention dimming Task 4 layers on top. The cascade
// classes therefore use `backwards`, which applies the FIRST keyframe during the
// animation's DELAY and nothing at all after it ends: it fixes the pre-delay
// flash without leaving a tenant behind. Belt to that braces, the canvas REMOVES
// every cascade class once `cascadeWindowMs` has elapsed, so after the window
// there is no animation on the element at all — nothing left to override
// anything. Both halves are tested.
//
// DETERMINISM: the per-row jitter is derived from the SAME id hash the layout
// uses (tieredLayout.hash32) — never Math.random, a hard constraint of this
// phase — so the same lane cascades identically every time it is opened.
//
// === DEPENDENCIES ===
// tieredLayout (hash32 — the one id hash this codebase trusts)

import { hash32 } from '../brain-graph/tieredLayout';

// ---------------------------------------------------------------------------
// CLASS NAMES — keyframes live in globals.css. Written as constants so the
// renderer and the stylesheet can only agree, never drift.
// ---------------------------------------------------------------------------

/** A branch ribbon growing out of its hub (scaleX from the hub end + fade). */
export const BRANCH_GROWTH_CLASS = 'twin-river-branch-grow';
/** A fact row fading and sliding its last few px into place. */
export const ROW_GROWTH_CLASS = 'twin-river-row-grow';
/** The one-shot emphasis a toggled hub takes — the click's tactile answer. */
export const TAP_CLASS = 'twin-river-tap';

// ---------------------------------------------------------------------------
// TIMINGS — the tuning surface. A smoke-test tuning round touches only this
// block; nothing below reads a number that is not named here.
// ---------------------------------------------------------------------------

/** Nominal delay between two consecutive rows, in ms (the plan's "index × 20-30
 *  ms"). Actual pitch is this OR the spread cap below, whichever is smaller. */
export const ROW_STAGGER_MS = 24;

/** Ceiling on the whole stagger, in ms. A lane with 60 rows would otherwise
 *  cascade for a second and a half; past that a "growth" reads as a wait. The
 *  pitch compresses instead of the cascade lengthening — bounded by
 *  construction, which is also what keeps the cleanup timer bounded. */
export const CASCADE_SPREAD_MS = 600;

/** Jitter amplitude as a FRACTION of the row pitch. Strictly below 1 on purpose:
 *  at 0.4 a row's delay can never reach its successor's, so per-row delays are
 *  STRICTLY INCREASING at any row count — the cascade always reads downstream,
 *  never as a shuffle. */
export const CASCADE_JITTER_FRACTION = 0.4;

/** How long one row's settle runs, in ms. */
export const ROW_GROWTH_MS = 420;
/** How long one branch's draw-out runs, in ms. A hair longer than the row it
 *  carries, so the row lands ON an already-arrived branch. */
export const BRANCH_GROWTH_MS = 460;
/** The hub tap — deliberately the shortest thing here: a click needs an answer,
 *  not a performance. */
export const TAP_MS = 200;

/** Slack added before the canvas strips the cascade classes, so a class is never
 *  removed out from under an animation that is still painting its last frame.
 *  Same discipline as DENDRITE_PULSE_MS sitting above its CSS duration. */
export const CASCADE_CLEAR_MARGIN_MS = 90;

// ---------------------------------------------------------------------------
// THE STAGGER
// ---------------------------------------------------------------------------

/** Per-row pitch for a lane of `rowCount` rows — ROW_STAGGER_MS until the whole
 *  cascade would outrun CASCADE_SPREAD_MS, then compressed to fit. */
export function cascadeStaggerMs(rowCount: number): number {
  const rows = Number.isFinite(rowCount) && rowCount > 1 ? Math.floor(rowCount) : 2;
  return Math.min(ROW_STAGGER_MS, CASCADE_SPREAD_MS / (rows - 1));
}

/**
 * The delay this row's growth waits before it starts, in ms.
 *
 * `index * pitch` is the cascade; the id-hashed fraction of a pitch on top is
 * what stops N branches leaving the same hub in lockstep — the mockup's own
 * reason for jittering, and the reason it is a HASH rather than a random number
 * (a re-render must reproduce the same cascade, and Math.random is forbidden
 * here). Never negative, and strictly increasing in `index`.
 */
export function cascadeDelayMs(index: number, id: string, rowCount: number): number {
  const pitch = cascadeStaggerMs(rowCount);
  const row = Number.isFinite(index) && index > 0 ? Math.floor(index) : 0;
  const jitter = ((hash32(id) % 1000) / 1000) * pitch * CASCADE_JITTER_FRACTION;
  return Math.round((row * pitch + jitter) * 10) / 10;
}

/**
 * How long the whole cascade lasts for the biggest lane in it — i.e. when every
 * cascade class may safely be stripped. `rowCounts` is empty for a collapse (or
 * for a lane that opened empty), which leaves just the hub tap.
 */
export function cascadeWindowMs(rowCounts: readonly number[]): number {
  let longest = TAP_MS;
  for (const count of rowCounts) {
    // Non-finite is skipped, not merely non-positive: an Infinity here would
    // multiply against a zero pitch and produce a NaN window — i.e. a timeout
    // that never fires, which IS the permanent-animation bug this phase named.
    if (!Number.isFinite(count) || count <= 0) continue;
    // The UPPER BOUND of cascadeDelayMs for this lane — the last row, jittered
    // as late as any hash could put it. Bounding rather than hashing the row
    // that happens to be last is what makes the window cover EVERY row.
    const pitch = cascadeStaggerMs(count);
    longest = Math.max(longest, (count - 1) * pitch + pitch * CASCADE_JITTER_FRACTION + BRANCH_GROWTH_MS);
  }
  return longest + CASCADE_CLEAR_MARGIN_MS;
}
