// === FILE PURPOSE ===
// ONE ROW of the riverbank memory canvas (TWIN-READ.2 Task 2): a fact's soma
// with its short title beside it, and — this is the point — ONE CONTROL, not two.
//
// >>> THE WHOLE ROW IS THE CONTROL. <<< The soma and the title are a single
// tabbable `role="button"` whose accessible name is the fact's FULL sentence
// (TWIN-READ.1's parity decision: the caption is a caption, but a screen-reader
// user must never be asked to forget a memory they were only read two words of).
// A transparent hit rect spans the row so the target is the row's height, not a
// 5px disc and a line of 11px glyphs — the forget action lives behind this
// control, and a target you have to aim at is an accessibility problem.
//
// TITLES ONLY (TWIN-READ.2 user decision 2): the row wears `labelFor()`'s short
// caption and nothing else. The full sentence lives in the pinned card, and
// CLICK is the reveal — TWIN-READ.1's hover-swaps-to-full-text is retired on
// this surface. That is what makes one-row-per-fact legible at 15 rows: the row
// width never changes on hover, so nothing can push its neighbours around.
//
// NO MEASUREMENT ANYWHERE: the title is one line of an already-capped label
// (factLabel.ts caps at 40 chars), so it needs no wrap and no width query.
// jsdom implements neither getBBox nor getComputedTextLength, so every width
// this canvas needs is a deterministic character estimate —
// riverCanvasModel.estimatedTitleWidth, shared with the fit-to-view box.
//
// MOTION — one of three states, and never two at once (both write `animation`,
// and the loser would be silently dropped):
//   * ARRIVING (`entering`) — the `brain-node-enter` bloom, inline, exactly as
//     the tiered canvas played it.
//   * GROWING — the cascade class plus this row's own stagger delay.
//   * AT REST — no class, no style, nothing scheduled.
// The animation goes on an INNER <g> because the outer one carries the
// positioning `transform` ATTRIBUTE, which a CSS transform would override.
//
// >>> CATEGORY-SCOPED ATTENTION (TWIN-READ.2 Task 4) LIVES ON THE OUTER <g>,
// NEVER THE INNER ONE. <<< That is a THIRD reason the outer/inner split above
// exists, not just the transform-attribute one: `opacity` here is a plain SVG
// ATTRIBUTE (a normal-cascade value), and the inner group is the row's ONE
// animation slot (bloom XOR growth). Keeping attention on a DIFFERENT element
// than the one that ever carries an `animation` means a lingering fill-mode
// there could never have this value to override even by accident — the named
// trap of this phase, structurally out of reach rather than merely avoided.
// See riverAttention.ts and TwinMemoryGraph.test.tsx's fill-mode regression.
//
// >>> THE SOMA TAP-ON-ATTEND — Task 3's nested-<g> pattern, copied. <<< A tap
// animation must not land on the growth/bloom slot either (same "one
// `animation` property" problem), so it gets its OWN group ONE LEVEL DEEPER,
// wrapping just <TwinMemorySoma> — exactly the pattern
// TwinMemoryRiverStructure.tsx's hub already uses for its own (click-
// triggered) tap. This one piggybacks on the EXISTING pulse signal
// (`tapped` = "the last touched id is THIS row") rather than adding a second
// one-shot mechanism: no new state, no new timer, and it inherits the pulse's
// own reduced-motion gate for free (a gated pulse never fires, so `tapped` is
// never true under reduced motion either).
//
// === DEPENDENCIES ===
// react (types), TwinMemorySoma, riverLayout (FACT_RADIUS/TITLE_OFFSET_X),
// riverCanvasModel (title metrics), riverMotion (cascade + tap classes),
// synapticVisuals (attention transition class), graphVisuals (halo props),
// shared twin types

import { LABEL_HALO_PROPS } from '../brain-graph/graphVisuals';
import { FACT_RADIUS, ROW_PITCH, TITLE_OFFSET_X } from './riverLayout';
import { ROW_TITLE_FONT_PX, estimatedTitleWidth } from './riverCanvasModel';
import TwinMemorySoma from './TwinMemorySoma';
import { ROW_GROWTH_CLASS, TAP_CLASS } from './riverMotion';
import { ATTENTION_TRANSITION_CLASS } from './synapticVisuals';
import type { TwinGraphNode } from '../../../shared/types';

/** The one-shot entrance for a newly-learned fact, reusing globals.css's
 *  existing `brain-node-enter` keyframes rather than inventing a parallel one.
 *  NO fill-mode: a lingering fill would pin opacity:1 and silently defeat the
 *  attention dimming layered on top of it. */
const ENTRANCE_STYLE: React.CSSProperties = {
  animation: 'brain-node-enter 300ms ease-out',
  transformBox: 'fill-box',
  transformOrigin: 'center',
};

export interface TwinMemoryRiverRowProps {
  node: TwinGraphNode;
  /** Row centre, in layout space. */
  x: number;
  y: number;
  /** The SHORT caption, already resolved through `labelFor()` by the caller —
   *  never re-derived here (TWIN-READ.1 (a): one accessor, one place). */
  title: string;
  /** The FULL sentence — this control's accessible name. */
  fullText: string;
  /** Hovered, focused or pinned: brighter rings and an accent membrane. */
  highlighted: boolean;
  /** Category-scoped attention (TWIN-READ.2 Task 4): this row's own opacity —
   *  1 (attended or nothing attended), ~0.55 (same-category sibling), ~0.25
   *  (every other category). PERSISTS under reduced motion; only the ease
   *  below and the pulse are gated. Never `aria-hidden`, never untabbable —
   *  decoration only. */
  attentionOpacity: number;
  /** The one-shot soma emphasis on attend — see the file header. */
  tapped: boolean;
  /** Gates the ~150ms opacity EASE only; the opacity value itself never
   *  changes because of this flag (dimming is state, not motion). */
  reducedMotion: boolean;
  /** This memory arrived in the last refresh. Marked regardless of motion
   *  preference, so the state stays observable when nothing animates. */
  entering: boolean;
  /** Play the arrival bloom (false under reduced motion). */
  animateEntrance: boolean;
  /** ms this row waits before growing in, or null when it is not growing. */
  growthDelayMs: number | null;
  onHover: (id: string | null) => void;
  onFocusChange: (id: string | null) => void;
  onActivate: (node: TwinGraphNode, viaKeyboard: boolean) => void;
}

/** One memory as a row: soma, title, and a hit target spanning both. */
export default function TwinMemoryRiverRow({
  node,
  x,
  y,
  title,
  fullText,
  highlighted,
  attentionOpacity,
  tapped,
  reducedMotion,
  entering,
  animateEntrance,
  growthDelayMs,
  onHover,
  onFocusChange,
  onActivate,
}: TwinMemoryRiverRowProps) {
  // Exactly one animation may own the inner group's `animation` property. An
  // arrival wins: a fact that just landed is the more informative event, and a
  // row cannot meaningfully bloom and grow in at the same time.
  const growing = !animateEntrance && growthDelayMs !== null;
  const style = animateEntrance ? ENTRANCE_STYLE : growing ? { animationDelay: `${growthDelayMs}ms` } : undefined;
  const outerClassName = reducedMotion
    ? 'cursor-pointer outline-none'
    : `cursor-pointer outline-none ${ATTENTION_TRANSITION_CLASS}`;

  return (
    <g
      data-node-id={node.id}
      data-node-type={node.type}
      data-tier={node.tier}
      data-category={node.category ?? undefined}
      data-row=""
      data-entering={entering || undefined}
      role="button"
      tabIndex={0}
      aria-label={`Learned fact: ${fullText}`}
      transform={`translate(${x},${y})`}
      opacity={attentionOpacity}
      className={outerClassName}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onFocusChange(node.id)}
      onBlur={() => onFocusChange(null)}
      onMouseDown={(event) => event.stopPropagation()} // a row click never pans the canvas
      onClick={() => onActivate(node, false)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onActivate(node, true);
      }}
    >
      <g className={growing ? ROW_GROWTH_CLASS : undefined} style={style}>
        {/* The hit target: the row's own band, so the pointer never has to find
            a 5px disc. Transparent rather than fill="none", which takes no
            pointer events at all. */}
        <rect
          data-row-hit=""
          x={-FACT_RADIUS - 6}
          y={-ROW_PITCH / 2}
          width={TITLE_OFFSET_X + estimatedTitleWidth(title) + FACT_RADIUS + 12}
          height={ROW_PITCH}
          fill="transparent"
        />
        {/* One level INSIDE the growth/bloom slot, wrapping just the soma — see
            the file header's "THE SOMA TAP-ON-ATTEND" note for why this cannot
            share the slot above it. */}
        <g className={tapped ? TAP_CLASS : undefined}>
          <TwinMemorySoma type={node.type} radius={FACT_RADIUS} glow="dim" highlighted={highlighted} shimmer={false} />
        </g>
        <text
          data-row-title=""
          x={TITLE_OFFSET_X}
          y={0}
          textAnchor="start"
          dominantBaseline="central"
          fontSize={ROW_TITLE_FONT_PX}
          fontWeight={500}
          fill="var(--color-text-primary)"
          aria-hidden="true"
          className="pointer-events-none"
          {...LABEL_HALO_PROPS}
        >
          {title}
        </text>
      </g>
    </g>
  );
}
