// === FILE PURPOSE ===
// One NODE BODY in the twin memory graph, drawn as a soma (TWIN-READ.1 Task 4):
// a filled core inside two concentric low-alpha rings.
//
// WHY LAYERED ALPHA AND NOT A FILTER: `feGaussianBlur` is the obvious way to
// glow an SVG node and the wrong one here — it is a per-frame filter pass, and
// this canvas can hold hundreds of nodes on the same GPU that is simultaneously
// running local Whisper transcription and a local LLM. Two extra `<circle>`s at
// 7% and 16% alpha cost one composite each and read the same. The plan forbids
// per-node blur explicitly; this is the substitute, not a compromise.
//
// The ring RADII are driven by the node's already-computed glow tier
// (`GLOW_HALO_PX[node.glow]`, from prominence.ts) so a livelier memory blooms
// wider. Nothing here re-derives prominence.
//
// >>> THE CORE SHIMMER — the phase's ONE sanctioned idle animation. <<<
// It is a CSS class on the twin core's OUTER RING only: not the core disc (which
// would wobble the node's apparent size), not the label, and not any other node.
// The gate is entirely the caller's — see TwinMemoryGraphCanvas, which grants it
// only while the Memory tab is on screen AND the window is visible AND the user
// has not asked for reduced motion. Widening that scope is the one change this
// file must never accumulate: a permanent animation loop on every node is
// exactly the GPU cost the graph's simulate-then-freeze rule exists to prevent.
//
// === DEPENDENCIES ===
// graphVisuals (palette + glow tables — read only), synapticVisuals (ring
// geometry, shimmer class name), prominence (GlowTier type), shared twin types

import { GLOW_HALO_PX, GLOW_OPACITY, TWIN_GRAPH_TYPE_COLOR } from '../brain-graph/graphVisuals';
import type { GlowTier } from '../brain-graph/prominence';
import { CORE_SHIMMER_CLASS, somaRingsFor } from './synapticVisuals';
import type { TwinGraphNodeType } from '../../../shared/types';

export interface TwinMemorySomaProps {
  type: TwinGraphNodeType;
  /** From prominence.ts, via the LayoutNode — never recomputed here. */
  radius: number;
  glow: GlowTier;
  /** Hovered or inspected: brighter rings and an accent membrane. */
  highlighted: boolean;
  /** Grant the core shimmer. Only ever true for the twin core, and only while
   *  the caller's visibility + reduced-motion gate allows it. */
  shimmer: boolean;
}

/** A node body: outer bloom ring, inner ring, filled core. */
export default function TwinMemorySoma({ type, radius, glow, highlighted, shimmer }: TwinMemorySomaProps) {
  const color = TWIN_GRAPH_TYPE_COLOR[type];
  const rings = somaRingsFor(radius, GLOW_HALO_PX[glow], highlighted);

  return (
    <>
      {rings.map((ring) => (
        <circle
          key={ring.key}
          data-soma-ring={ring.key}
          className={shimmer && ring.key === 'outer' ? CORE_SHIMMER_CLASS : undefined}
          r={ring.r}
          fill={color}
          opacity={ring.opacity}
        />
      ))}
      <circle
        data-soma-core=""
        r={radius}
        fill={`color-mix(in srgb, ${color} 55%, var(--color-chrome))`}
        fillOpacity={GLOW_OPACITY[glow]}
        stroke={highlighted ? 'var(--color-accent)' : color}
        strokeWidth={highlighted ? 2.5 : 1.25}
      />
    </>
  );
}
