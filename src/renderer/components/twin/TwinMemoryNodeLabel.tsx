// === FILE PURPOSE ===
// The caption under a twin-memory graph node (TWIN-READ.1 Task 3) — and the
// answer to the report that started this phase: *"it's still pretty bad with the
// text being as it is."*
//
// THE ROOT ERROR WAS TREATING A FACT AS A LABEL. `twinFacts.fact` is a sentence;
// the renderer used to chop it at 34 characters and lay the fragment out on one
// line, which is long enough to collide with the neighbouring node and too short
// to mean anything. So:
//
//   * AT REST a node wears its SHORT label — the LLM-written one Task 1 stores,
//     resolved through the SAME shared `labelFor()` accessor every other surface
//     reads, so an unlabelled fact degrades to the derived fallback and NEVER
//     renders blank. It is wrapped, not truncated: two lines of LABEL_LINE_CHARS
//     comfortably hold factLabel.ts's 40-character ceiling, so no stored label
//     can be cut.
//   * ON REVEAL (hover / keyboard focus / inspected) the node shows the FULL
//     fact, wrapped across up to LABEL_FOCUS_MAX_LINES. The document, not a
//     fragment of it.
//
// >>> WHY <tspan> AND NOT <foreignObject> — SPIKED, NOT ASSUMED. <<<
// There was zero foreignObject precedent in this renderer, so it was measured
// before being designed around. Under this project's jsdom 29 a React-rendered
// <foreignObject> DOES mount correctly (SVG namespace, XHTML-namespaced children,
// survives re-render) — but every measurement of its content returns zero
// (offsetWidth/Height, scrollWidth/Height, getBoundingClientRect all 0), because
// jsdom has no layout engine. A wrap that happens inside foreignObject is
// therefore INVISIBLE to a test: you can assert the text is present, never that
// it wrapped. The same spike found SVG text measurement entirely absent —
// getBBox / getComputedTextLength / getSubStringLength are not functions on
// jsdom's SVGElement. <tspan> plus a deterministic CHARACTER budget is the only
// strategy that behaves identically in the app and in a test, which is what lets
// the tests assert real line breaks. It also keeps the halo native: `paint-order`
// is an SVG-text property, and inside a foreignObject the label would be HTML and
// would need a hand-rolled duplicate-shadow instead.
//
// NO MOTION. The rest -> full swap is instant, deliberately: an animated reveal
// would need a reduced-motion carve-out, and the phase's one sanctioned idle
// animation belongs to Task 4's core shimmer. Nothing here schedules a frame.
//
// === DEPENDENCIES ===
// graphVisuals (halo + wrap helpers), shared factLabel accessor, shared twin types

import {
  LABEL_FOCUS_LINE_CHARS,
  LABEL_FOCUS_MAX_LINES,
  LABEL_HALO_PROPS,
  LABEL_LINE_CHARS,
  LABEL_LINE_HEIGHT,
  LABEL_MAX_LINES,
  wrapLabelLines,
} from '../brain-graph/graphVisuals';
import { labelFor } from '../../../shared/twin/factLabel';
import type { TwinGraphNode } from '../../../shared/types';

/** The fields a label needs — narrower than TwinGraphNode so the helpers below
 *  stay unit-testable without building a whole node. */
export type LabelableNode = Pick<TwinGraphNode, 'label'> & { text?: string };

/**
 * The FULL text behind a node: the fact sentence for a fact node, the label
 * itself for structure (a hub has nothing longer to reveal). Falls back to the
 * label whenever `text` is missing or blank, so a payload from before the field
 * existed still renders.
 */
export function fullTextOf(node: LabelableNode): string {
  return node.text?.trim() || node.label;
}

/**
 * The SHORT caption a node wears at rest. Resolved through the ONE shared
 * `labelFor()` accessor rather than a second derivation: a blank/whitespace
 * stored label falls back to the derived short form of the full text, which is
 * the guarantee that a fact never renders blank.
 */
export function restLabelOf(node: LabelableNode): string {
  return labelFor({ fact: fullTextOf(node), label: node.label });
}

export interface TwinMemoryNodeLabelProps {
  node: LabelableNode;
  /** Distance from the node's centre to the first baseline. */
  offsetY: number;
  /** Show the full text instead of the resting caption — hovered, focused or
   *  inspected. */
  revealed: boolean;
  /** Structure (core, hubs) is set heavier than a leaf fact. */
  emphasised: boolean;
}

/** One node's caption: wrapped `<tspan>` lines with a native knockout halo. */
export default function TwinMemoryNodeLabel({ node, offsetY, revealed, emphasised }: TwinMemoryNodeLabelProps) {
  const lines = revealed
    ? wrapLabelLines(fullTextOf(node), LABEL_FOCUS_LINE_CHARS, LABEL_FOCUS_MAX_LINES)
    : wrapLabelLines(restLabelOf(node), LABEL_LINE_CHARS, LABEL_MAX_LINES);

  // Nothing to say beats an empty <text> box sitting in the hit-test tree.
  if (lines.length === 0) return null;

  return (
    <text
      data-label-mode={revealed ? 'full' : 'rest'}
      x={0}
      y={offsetY}
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={11}
      fontWeight={emphasised ? 600 : 500}
      fill="var(--color-text-primary)"
      aria-hidden="true"
      className="pointer-events-none"
      {...LABEL_HALO_PROPS}
    >
      {lines.map((line, index) => (
        <tspan key={`${index}:${line}`} x={0} dy={index === 0 ? 0 : LABEL_LINE_HEIGHT}>
          {line}
        </tspan>
      ))}
    </text>
  );
}
