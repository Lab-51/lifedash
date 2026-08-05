// === FILE PURPOSE ===
// THE GROWTH CASCADE CONTROLLER (TWIN-READ.2 Task 2) — the hook that decides
// WHEN a lane grows, WHICH rows are growing and for HOW LONG the classes may
// stay on them. The stagger arithmetic and the class names live in
// riverMotion.ts; the rendering lives in the row/dendrite components; this is
// the only piece that holds state.
//
// >>> WHY IT IS A HOOK AND NOT TEN LINES IN THE CANVAS. <<<
// It is the phase's centre of gravity. The user's requirement was explicit —
// *"make sure we keep the organic feel in terms of animation, clicks etc. Don't
// want to lose that."* — and retiring the force simulation deleted the settle
// motion that used to provide it. Isolating the replacement means the rule that
// matters ("nothing animated survives its own window") is stated once, in one
// place, where a later task cannot quietly widen it.
//
// THE THREE TRIGGERS, all interaction- or arrival-driven, never idle:
//   1. A LANE OPENS — its rows and branches grow, staggered.
//   2. THE FIRST RENDER with a lane already open — the MOUNT SETTLE. Growth,
//      but no tap: nothing was clicked.
//   3. A LANE CLOSES — no rows are left to animate (disclosure removes them from
//      the DOM outright), so only the toggled hub's tap plays. That IS the
//      "collapse reverses faster and un-staggered" half of the vocabulary.
//
// >>> AND THE ONE RULE THAT MAKES IT SAFE: IT ALWAYS ENDS. <<< One timeout, set
// to the cascade's own bounded window, clears the whole thing — so after the
// window no element carries a cascade class at all, and nothing can override the
// attention opacity layered on top of it later. Reduced motion never starts a
// cascade in the first place: no class, no delay, no timer.
//
// === DEPENDENCIES ===
// react, riverMotion (stagger + window), riverCanvasModel (row models)

import { useEffect, useMemo, useRef, useState } from 'react';
import { cascadeDelayMs, cascadeWindowMs } from './riverMotion';
import type { RiverRowModel } from './riverCanvasModel';

/** A cascade in flight. `seq` exists so a lane re-opened after its classes were
 *  stripped starts a genuinely new cascade rather than reusing a spent one. */
interface CascadeState {
  lanes: ReadonlySet<string>;
  /** Hub node id, or null for a mount settle (nothing was clicked). */
  tappedHubId: string | null;
  seq: number;
}

export interface GrowthCascade {
  /** ms each growing row — and its branch, which grows with it — waits before
   *  starting, keyed by fact node id. Null when nothing is growing. */
  delays: ReadonlyMap<string, number> | null;
  /** The hub playing its one-shot tap, or null. */
  tappedHubId: string | null;
}

/** Nothing growing — a module const so the returned object is a stable
 *  reference while the canvas sits idle. */
const AT_REST: GrowthCascade = { delays: null, tappedHubId: null };

/**
 * @param expandedLanes the disclosure state, straight from the store
 * @param rows          the rows currently rendered (post-commit, so a lane that
 *                      just opened is already in here)
 * @param reducedMotion when true this hook is inert, by design
 */
export function useGrowthCascade(
  expandedLanes: ReadonlySet<string>,
  rows: readonly RiverRowModel[],
  reducedMotion: boolean,
): GrowthCascade {
  const [cascade, setCascade] = useState<CascadeState | null>(null);
  const seqRef = useRef(0);
  /** The lanes as of the previous render — null until the first effect run,
   *  which is exactly how a lane that opens ALREADY expanded gets its settle. */
  const previousLanesRef = useRef<ReadonlySet<string> | null>(null);

  // --- What just changed. Deliberately keyed on the disclosure state alone: a
  // graph refresh must NOT replay a cascade for lanes that were already open.
  useEffect(() => {
    const previous = previousLanesRef.current;
    previousLanesRef.current = expandedLanes;
    if (reducedMotion) return;
    const opened = [...expandedLanes].filter((category) => !previous?.has(category));
    const closed = previous ? [...previous].filter((category) => !expandedLanes.has(category)) : [];
    if (opened.length === 0 && closed.length === 0) return;
    const toggled = previous === null ? null : (opened[0] ?? closed[0] ?? null);
    seqRef.current += 1;
    setCascade({
      lanes: new Set(opened),
      tappedHubId: toggled === null ? null : `category:${toggled}`,
      seq: seqRef.current,
    });
  }, [expandedLanes, reducedMotion]);

  // --- ...and the promise that it ends. The window is computed from the rows
  // actually on screen, so it always covers the last row's delay plus its
  // animation. Re-running when `rows` changes simply re-arms it, which is the
  // right answer if a refresh lands mid-cascade.
  useEffect(() => {
    if (!cascade) return;
    const rowCounts = [...cascade.lanes].map((category) => rows.filter((row) => row.category === category).length);
    const timer = setTimeout(() => setCascade(null), cascadeWindowMs(rowCounts));
    return () => clearTimeout(timer);
  }, [cascade, rows]);

  return useMemo(() => {
    if (!cascade) return AT_REST;
    const delays = new Map<string, number>();
    for (const row of rows) {
      if (!cascade.lanes.has(row.category)) continue;
      delays.set(row.node.id, cascadeDelayMs(row.index, row.node.id, row.laneRows));
    }
    return { delays, tappedHubId: cascade.tappedHubId };
  }, [cascade, rows]);
}
