// === FILE PURPOSE ===
// The STRUCTURE the twin memory graph draws behind its nodes (TWIN-GRAPH.2
// Task 3): one labelled region per category lane, plus the tier rails that name
// what each depth means. This is the answer to "it looked too much like Obsidian,
// not structured enough" — the tiers and lanes are chrome you can read, not an
// emergent property of a force blob.
//
// Every coordinate comes from the layout's OWN TieredGeometry (ForceLayout.
// getGeometry()) and tieredLayout's exported band constants — never from a second
// computeLanes() call here, so the regions drawn can never drift from the regions
// the simulation actually clamps to.
//
// A lane's floor is data-driven because tier 2 has NO lower bound by design (a
// crowded lane grows arbitrarily far downward rather than deadlocking against a
// ceiling), so the region has to follow its deepest fact. `laneBottomsOf` is the
// single derivation for that, shared with the canvas's per-frame paint.
//
// DEPTH BY ATTENUATION (TWIN-READ.1 Task 4): a region whose lane is closed
// recedes to COLLAPSED_LANE_OPACITY while the open ones come forward, so the
// canvas reads as attention rather than as five equally-weighted boxes. It is
// applied HERE, to the scenery, and never to the hub that opens the lane —
// opacity is decoration, and dimming a live control to a third of its contrast
// would be an accessibility regression dressed up as depth.
//
// Purely presentational and aria-hidden: it is scenery for the nodes, which carry
// the accessible names themselves.
//
// === DEPENDENCIES ===
// tieredLayout (geometry + band constants), graphVisuals (lane headings),
// synapticVisuals (attenuation constants)

import { laneHeading } from '../brain-graph/graphVisuals';
import {
  TIER_BAND_HALF_HEIGHT,
  TIER_GAP,
  tierCenterY,
  type Lane,
  type TieredGeometry,
} from '../brain-graph/tieredLayout';
import { COLLAPSED_LANE_OPACITY, EXPANDED_LANE_OPACITY, LANE_REGION_FILL_OPACITY } from './synapticVisuals';

/** Clear air above the hub band, inside the region — where the heading sits. */
const LANE_HEADER_HEIGHT = 44;
/** Clear air below the deepest fact, so the region never crops a node. */
const LANE_FLOOR_PAD = 40;
/** Gap between the leftmost lane and the tier rail labels. */
const TIER_LABEL_GAP = 18;

/** What each depth MEANS, in the user's words. Index = tier. */
export const TIER_LABELS: readonly string[] = ['You', 'Categories', 'Learned facts'];

/** A node as this module reads it — the four fields the chrome needs. */
export interface LaneChromeNode {
  category: string | null;
  y: number;
  radius: number;
}

/** Deepest drawn edge per lane (y + radius), so a region's floor follows its
 *  content. Lanes with no facts fall back to their hub band. Pure. */
export function laneBottomsOf(nodes: readonly LaneChromeNode[]): Map<string, number> {
  const bottoms = new Map<string, number>();
  for (const node of nodes) {
    if (!node.category) continue;
    const bottom = node.y + node.radius;
    const current = bottoms.get(node.category);
    if (current === undefined || bottom > current) bottoms.set(node.category, bottom);
  }
  return bottoms;
}

/** Top edge of every lane region — one tier band above the hubs. */
export function laneTopY(): number {
  return tierCenterY(1) - TIER_BAND_HALF_HEIGHT - LANE_HEADER_HEIGHT;
}

/** Region height for a lane whose deepest content sits at `bottom`. Always
 *  positive: an empty lane still draws down to its hub band. */
export function laneHeightFor(bottom: number | undefined): number {
  const floor = Math.max(bottom ?? tierCenterY(1), tierCenterY(1) + TIER_BAND_HALF_HEIGHT) + LANE_FLOOR_PAD;
  return floor - laneTopY();
}

/** Outer x/width of a lane's drawn region. `min`/`max` are already inset by
 *  LANE_PADDING, so the drawn box is re-expanded to leave a visible gutter. */
function laneBox(lane: Lane, laneWidth: number): { x: number; width: number } {
  const width = Math.max(lane.max - lane.min, 0) + Math.min(laneWidth * 0.25, 24);
  return { x: lane.center - width / 2, width };
}

interface TwinMemoryLaneChromeProps {
  geometry: TieredGeometry;
  /** Deepest y per lane, from laneBottomsOf — the per-frame paint keeps the
   *  rendered rects in step while the simulation is still hot. */
  laneBottoms: ReadonlyMap<string, number>;
  /** Facts currently in each lane, for the heading count. */
  laneCounts: ReadonlyMap<string, number>;
  /** Lanes the user has opened. Drives DEPTH BY ATTENUATION (TWIN-READ.1 Task
   *  4): a closed region recedes, the open ones come forward, and the canvas
   *  reads as attention rather than as five equal boxes. Default-empty so the
   *  chrome still renders for a caller that does not track disclosure. */
  expandedLanes?: ReadonlySet<string>;
}

/** No lanes open — a module const so the default prop is a STABLE reference. */
const NO_EXPANDED: ReadonlySet<string> = new Set<string>();

/** Labelled category regions + the tier rails. Drawn beneath everything else. */
export default function TwinMemoryLaneChrome({
  geometry,
  laneBottoms,
  laneCounts,
  expandedLanes = NO_EXPANDED,
}: TwinMemoryLaneChromeProps) {
  const top = laneTopY();
  const left = -geometry.width / 2;
  const right = geometry.width / 2;

  return (
    <g aria-hidden="true" className="pointer-events-none">
      {/* Tier rails: a dashed rule between two bands, and the name of the depth. */}
      {[0, 1].map((tier) => (
        <line
          key={`rail-${tier}`}
          x1={left - TIER_LABEL_GAP}
          x2={right}
          y1={tierCenterY(tier) + TIER_GAP / 2}
          y2={tierCenterY(tier) + TIER_GAP / 2}
          stroke="var(--color-border)"
          strokeWidth={1}
          strokeDasharray="4 6"
          opacity={0.7}
        />
      ))}
      {TIER_LABELS.map((label, tier) => (
        <text
          key={`tier-${label}`}
          data-tier-label={tier}
          x={left - TIER_LABEL_GAP}
          y={tierCenterY(tier)}
          textAnchor="end"
          dominantBaseline="central"
          fontSize={11}
          fontWeight={600}
          letterSpacing="0.08em"
          fill="var(--color-text-muted)"
        >
          {label.toUpperCase()}
        </text>
      ))}

      {/* One labelled region per POPULATED category. */}
      {geometry.order.map((key) => {
        const lane = geometry.lanes.get(key);
        if (!lane) return null;
        const { x, width } = laneBox(lane, geometry.laneWidth);
        const count = laneCounts.get(key) ?? 0;
        const expanded = expandedLanes.has(key);
        return (
          // Attenuation lives on the SCENERY, never on the hub that opens the
          // lane: the hub is a real control, and dimming a control to a third of
          // its contrast is an accessibility regression dressed up as depth.
          <g
            key={`lane-${key}`}
            data-lane-region={key}
            data-lane-expanded={expanded || undefined}
            opacity={expanded ? EXPANDED_LANE_OPACITY : COLLAPSED_LANE_OPACITY}
          >
            <rect
              data-lane-key={key}
              x={x}
              y={top}
              width={width}
              height={laneHeightFor(laneBottoms.get(key))}
              rx={14}
              fill="var(--color-accent)"
              fillOpacity={expanded ? LANE_REGION_FILL_OPACITY.expanded : LANE_REGION_FILL_OPACITY.collapsed}
              stroke={expanded ? 'var(--color-border-accent)' : 'var(--color-border)'}
              strokeWidth={1}
            />
            <text
              x={lane.center}
              y={top + 22}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={12}
              fontWeight={600}
              fill="var(--color-text-secondary)"
            >
              {laneHeading(key)}
              <tspan fill="var(--color-text-muted)"> · {count}</tspan>
            </text>
          </g>
        );
      })}
    </g>
  );
}
