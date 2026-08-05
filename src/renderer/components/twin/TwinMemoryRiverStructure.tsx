// === FILE PURPOSE ===
// The riverbank's two NON-ROW nodes (TWIN-READ.2 Task 2): a lane's HUB with its
// heading, and the TWIN CORE. Split out of the canvas so that file stays
// composition rather than markup.
//
// >>> THE HUB IS THE DISCLOSURE CONTROL, AND ONLY THAT. <<< It is a real
// `role="button"` with `aria-expanded` and a count inside its accessible name,
// so a screen-reader user knows what opening it will reveal. Activating it
// toggles its lane and never opens the inspector — one control doing two
// unrelated things is what makes `aria-expanded` a lie.
//
// >>> ATTENUATION APPLIES TO CHROME, NEVER TO A CONTROL. <<< A shut lane's
// HEADING recedes (depth as attention, TWIN-READ.1 Task 4) but its HUB does not:
// the hub is the only route to that lane's facts, and dimming a live control to
// a third of its contrast is an accessibility regression dressed up as depth.
// The heading is `aria-hidden` scenery — the hub carries the accessible name.
//
// >>> CATEGORY-SCOPED ATTENTION (TWIN-READ.2 Task 4) IS A SEPARATE AXIS THAT
// DOES cover the hub. <<< Unlike the collapsed-lane attenuation above, a hub
// (and its heading) DOES recede to the dim level when a DIFFERENT category is
// attended — the plan's own table says so explicitly. The two rules COMPOUND
// by multiplication on the heading (both apply to the same `<text>`) rather
// than one replacing the other; see `attentionOpacity`'s own doc comment.
// Neither rule ever touches focusability, the accessible name, or
// `aria-hidden` — opacity only, on a hub that stays a real control at every
// level.
//
// THE TWIN CORE never dims and never toggles: it is "you", the source every path
// starts from. It is also the ONLY node that may shimmer, and only while all
// three of the canvas's gates hold — see TwinMemoryRiverCanvas.
//
// === DEPENDENCIES ===
// react (types), TwinMemorySoma, TwinMemoryNodeLabel, riverMotion (tap class),
// riverCanvasModel (heading offset), synapticVisuals (attenuation + attention),
// graphVisuals

import { LABEL_HALO_PROPS, TWIN_GRAPH_TYPE_LABEL, laneHeading } from '../brain-graph/graphVisuals';
import { HUB_LABEL_FONT_PX, HUB_LABEL_OFFSET_X } from './riverCanvasModel';
import type { RiverHubPosition } from './riverLayout';
import { TAP_CLASS } from './riverMotion';
import TwinMemoryNodeLabel, { fullTextOf } from './TwinMemoryNodeLabel';
import TwinMemorySoma from './TwinMemorySoma';
import { ATTENTION_TRANSITION_CLASS, COLLAPSED_LANE_OPACITY, EXPANDED_LANE_OPACITY } from './synapticVisuals';
import type { TwinGraphNode } from '../../../shared/types';

/** Distance from the twin core's centre to its caption's baseline. Mockup:
 *  `y = twinY + 36`. */
const TWIN_LABEL_OFFSET_Y = 36;

/** Enter/Space -> activate, matching native button semantics for SVG controls. */
export function onButtonKey(handler: () => void) {
  return (event: React.KeyboardEvent): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handler();
    }
  };
}

export interface TwinMemoryRiverHubProps {
  hub: RiverHubPosition;
  /** Hovered, focused or pinned: brighter rings and an accent membrane. */
  highlighted: boolean;
  /** This hub was just toggled — play the one-shot tap. */
  tapped: boolean;
  /** Category-scoped attention (TWIN-READ.2 Task 4): this hub's own opacity,
   *  and a MULTIPLIER on the heading's existing collapsed/expanded chrome
   *  opacity — two independent rules compounding on one element. 1 (own
   *  category, or nothing attended) or ~0.25 (every other category); never
   *  ~0.55 — an anchor is read as a whole, not as a sibling. Persists under
   *  reduced motion; opacity only, never focusability or the accessible
   *  name. */
  attentionOpacity: number;
  /** Gates the ~150ms opacity EASE only. */
  reducedMotion: boolean;
  onToggle: (hubId: string, category: string) => void;
  onHover: (id: string | null) => void;
  onFocusChange: (id: string | null) => void;
}

/** A lane's heading (scenery) and its hub (control). */
export function TwinMemoryRiverHub({
  hub,
  highlighted,
  tapped,
  attentionOpacity,
  reducedMotion,
  onToggle,
  onHover,
  onFocusChange,
}: TwinMemoryRiverHubProps) {
  const noun = hub.count === 1 ? 'learned fact' : 'learned facts';
  const toggle = (): void => onToggle(hub.id, hub.category);
  const transitionClass = reducedMotion ? '' : ` ${ATTENTION_TRANSITION_CLASS}`;

  return (
    <>
      <text
        data-lane-region={hub.category}
        data-lane-expanded={hub.open || undefined}
        x={hub.x - HUB_LABEL_OFFSET_X}
        y={hub.y}
        textAnchor="end"
        dominantBaseline="central"
        fontSize={HUB_LABEL_FONT_PX}
        fontWeight={600}
        fill="var(--color-text-secondary)"
        opacity={(hub.open ? EXPANDED_LANE_OPACITY : COLLAPSED_LANE_OPACITY) * attentionOpacity}
        aria-hidden="true"
        // `font-hud` is the app's own heading treatment (display face, tracked,
        // uppercased) and renders what the mockup's tracked uppercase heading
        // does — as a CSS transform, so the DOM text stays readable prose for a
        // test and for anything that ever needs to match on it.
        className={`pointer-events-none font-hud${transitionClass}`}
        {...LABEL_HALO_PROPS}
      >
        {laneHeading(hub.category)}
        {/* The count is not part of the tracked heading — mockup: `.count`
            re-sets letter-spacing to 0 so "· 2" reads as one token. */}
        <tspan fill="var(--color-text-muted)" letterSpacing="0">
          {' '}
          · {hub.count}
        </tspan>
      </text>
      <g
        data-node-id={hub.id}
        data-node-type="category"
        data-tier={1}
        data-category={hub.category}
        role="button"
        tabIndex={0}
        aria-expanded={hub.open}
        aria-label={`${TWIN_GRAPH_TYPE_LABEL.category}: ${laneHeading(hub.category)}, ${hub.count} ${noun}`}
        transform={`translate(${hub.x},${hub.y})`}
        opacity={attentionOpacity}
        className={`cursor-pointer outline-none${transitionClass}`}
        onMouseEnter={() => onHover(hub.id)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onFocusChange(hub.id)}
        onBlur={() => onFocusChange(null)}
        onMouseDown={(event) => event.stopPropagation()} // a hub click never pans the canvas
        onClick={toggle}
        onKeyDown={onButtonKey(toggle)}
      >
        <g className={tapped ? TAP_CLASS : undefined}>
          <TwinMemorySoma type="category" radius={hub.radius} glow="soft" highlighted={highlighted} shimmer={false} />
          {/* The count sits INSIDE the hub, as the mockup draws it: a lane's size
              is legible without also reading its heading. */}
          <text
            data-hub-count=""
            x={0}
            y={0}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={10}
            fontWeight={700}
            fill={hub.open ? 'var(--color-chrome)' : 'var(--color-primary-300)'}
            aria-hidden="true"
            className="pointer-events-none"
          >
            {hub.count}
          </text>
        </g>
      </g>
    </>
  );
}

export interface TwinMemoryRiverCoreProps {
  node: TwinGraphNode;
  x: number;
  y: number;
  radius: number;
  highlighted: boolean;
  /** Grant the core shimmer — true only here, and only while all three of the
   *  canvas's gates hold. Never widened. */
  shimmer: boolean;
  onHover: (id: string | null) => void;
  onFocusChange: (id: string | null) => void;
  onActivate: (node: TwinGraphNode, viaKeyboard: boolean) => void;
}

/** "You" — captioned beneath itself, exactly as the mockup places it. */
export function TwinMemoryRiverCore({
  node,
  x,
  y,
  radius,
  highlighted,
  shimmer,
  onHover,
  onFocusChange,
  onActivate,
}: TwinMemoryRiverCoreProps) {
  return (
    <g
      data-node-id={node.id}
      data-node-type="twin"
      data-tier={node.tier}
      role="button"
      tabIndex={0}
      aria-label={`${TWIN_GRAPH_TYPE_LABEL.twin}: ${fullTextOf(node)}`}
      transform={`translate(${x},${y})`}
      className="cursor-pointer outline-none"
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onFocusChange(node.id)}
      onBlur={() => onFocusChange(null)}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={() => onActivate(node, false)}
      onKeyDown={onButtonKey(() => onActivate(node, true))}
    >
      <TwinMemorySoma type="twin" radius={radius} glow="bright" highlighted={highlighted} shimmer={shimmer} />
      <TwinMemoryNodeLabel node={node} offsetY={TWIN_LABEL_OFFSET_Y} revealed={false} emphasised />
    </g>
  );
}
