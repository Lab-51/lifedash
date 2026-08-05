// === FILE PURPOSE ===
// THE RIVERBANK CANVAS (TWIN-READ.2 Task 2) — the twin on the left, one category
// hub per lane down the middle, and ONE ROW PER FACT on the right. It replaces
// the tiered force-simulation canvas on the Memory tab; TwinMemoryGraphCanvas
// stays in the tree, unreferenced, exactly as BrainMindMap and TwinMemoryPanel
// do (that file is 969 lines and lint-frozen — this one is built BESIDE it out
// of the same small modules rather than edited down from it).
//
// THE DESIGN CONTRACT IS THE MOCKUP: .planning/design/twin-memory-layout-
// variants.html (?v=riverbank). Its `renderRiverbank()` is where the geometry,
// the interaction grammar and the visual details all come from.
//
// >>> WHY THE FORCE SIMULATION RETIRED HERE. <<<
// Riverbank positions are closed-form arithmetic (riverLayout.ts): fixed columns,
// vertical allocation proportional to visible rows. There is nothing left for a
// simulation to settle, so "zero idle rAF/timers" stops being a discipline this
// component enforces and becomes a property of its shape — THERE IS NO FRAME
// LOOP IN THIS FILE AT ALL. d3-force is untouched and still serves the retained
// canvases. `data-settled` is reported as a constant `true` because the question
// it answers ("is the layout at rest?") has exactly one answer here; dropping it
// would only move that statement out of the DOM.
//
// >>> THE GROWTH CASCADE — the organic feel, made deterministic. <<<
// The user's instruction was explicit: *"make sure we keep the organic feel in
// terms of animation, clicks etc. Don't want to lose that."* Retiring the
// simulation removed the settle motion that made this graph feel alive, so that
// motion is REPLACED, not deleted. The vocabulary (stagger in riverMotion.ts,
// state in useGrowthCascade.ts, keyframes in globals.css):
//
//   * EXPAND — a lane's contents do not appear, they GROW. Each branch ribbon
//     scales out of its hub (a ribbon's own left edge IS its hub, so `scaleX`
//     about `transform-origin: left` is a hub-origin reveal) and its row fades
//     and slides its last few px into place. STAGGERED PER ROW: index × pitch
//     plus an id-hashed fraction of a pitch — deterministic, never Math.random,
//     and strictly increasing, so the cascade always reads downstream. The ease
//     is the mockup's springy `cubic-bezier(.22,1,.36,1)`: grown, not slid.
//   * MOUNT — a lane already open on the first render plays that cascade once,
//     so arriving at the tab is a growth too, not a paint.
//   * COLLAPSE — faster and un-staggered: the toggled hub takes a one-shot tap
//     and that is all, because a collapsing lane's rows LEAVE THE DOM (that is
//     what makes cost scale with what is open), so nothing is left to animate.
//   * CLICK — every hub toggle answers with that same tap, and touching any node
//     fires the existing activation pulse.
//   * ARRIVAL — a row blooms via `brain-node-enter`; its OWN branch grows too
//     (TWIN-READ.2 Task 5's judgement call: yes, wire it — the tiered canvas
//     bloomed row+edge together, and a static ribbon under a growing row read
//     as scenery, not as a fact arriving). Zero delay, the SAME class the
//     cascade above uses; never a trunk, never under reduced motion.
//   * IDLE — only the core shimmer, three gates.
//
// NO PERSISTENT FILL-MODES ANYWHERE. A lingering `forwards`/`both` fill pins its
// final value forever and an animation beats a normal declaration, which is how
// a "finished" enter animation silently defeats the attention dimming Task 4
// layers on top — the mockup caught exactly that bug. The cascade classes use
// `backwards` (which applies BEFORE the animation and nothing after it), and
// useGrowthCascade strips every one of them once its bounded window elapses. On
// `prefers-reduced-motion` no cascade class and no delay is rendered at all —
// absent, not paused.
//
// >>> FRAMING: d3-zoom, with the layout following the CONTAINER's width. <<<
// The existing zoom/pan wiring is lifted rather than replaced by the mockup's
// scroll model, because it is proven here (including the jsdom trap — d3's
// viewBox-reading default extent is not implemented there) and because
// GraphPinnedCardLayer already anchors the inspector card through a
// `ZoomTransform`, so Task 3 inherits a working anchor instead of a scroll-sync
// problem. The mockup's READABILITY is kept by other means: the layout is
// computed against the measured container width, so the default framing is 1:1
// and a title renders at its design size — panning is this tall canvas's scroll,
// and "Fit to view" is there when the whole river is what you want. A resize
// re-runs the layout, which is free here: the tiered canvas refused to re-lane
// on resize only because that meant reheating a simulation.
//
// >>> WHAT CARRIES OVER UNCHANGED. <<< Progressive disclosure (the store's
// expandedLanes; a collapsed lane's facts absent from layout AND DOM, never
// CSS-hidden; multiple lanes open at once; counts always from the FULL payload).
// The hub is the disclosure control and only that. Every row and hub is a real
// tabbable control with an accessible name. The safety triad and the inspector's
// contract belong to the host and are untouched.
//
// >>> THE PINNED CARD (TWIN-READ.2 Task 3) — reuse, not rebuild. <<<
// `GraphPinnedCardLayer` + `TwinMemoryInspector` are the app's OWN pinned
// inspector, already wired here since Task 2; this task only adapted the
// ANCHOR and the UNPIN grammar, both additive:
//   * riverCanvasModel.anchorsOf gives a ROW an asymmetric `rightExtent`
//     (soma through soma + estimated title width, the SAME deterministic
//     estimate the row's own `[data-row-hit]` rect uses) so the card clears
//     the title it was opened FROM instead of covering it. GraphPinnedCard's
//     `AnchoredNode` widened to carry that field — optional, so its other
//     consumer (BrainMemoryGraph) is unaffected.
//   * UNPIN: Esc already worked (TwinMemoryInspector's own handler, via the
//     host's onClose). Neither this canvas nor BrainMemoryGraph had an
//     EMPTY-CANVAS-CLICK unpin before — this task adds it fresh, here:
//     `handleCanvasClick` fires `onUnpin` unless the click landed on (or
//     inside) a `role="button"` control, which is every row/hub/twin core —
//     so opening or moving a pin can never immediately close itself in the
//     same click's bubble.
//   * ORGANIC TOUCH: the connector LINE draws out of the row toward the card
//     rather than appearing (GraphPinnedCard's `animateConnector` — a pure-
//     arithmetic `Math.hypot` sweep, never `getTotalLength()`), gated by
//     reduced motion here and re-keyed per `pinnedId` so it replays on every
//     pin, not only the first. The card's OWN position never animates —
//     only the connector.
//
// >>> CATEGORY-SCOPED ATTENTION (TWIN-READ.2 Task 4) — riverAttention.ts, not
// here. <<< This file only resolves the single "attended" id (hovered ??
// focused ?? pinned) and hands it to `computeRiverAttentionLevels`, which
// does the actual scoping (only a FACT drives it — hovering/focusing/pinning
// a hub or the twin resolves to neutral, mirroring the mockup's own
// `[data-fact]`-only wiring). Kept out of this file on purpose: it is
// exactly the kind of pure derivation riverLayout.ts/riverCanvasModel.ts
// already model, and this component is close to its 500-line ceiling.
//
// === DEPENDENCIES ===
// react, d3-zoom + d3-selection, riverLayout (geometry), riverCanvasModel (view
// model), riverAttention (attention levels), useGrowthCascade (the cascade),
// TwinMemoryRiverRow, TwinMemoryRiverDendrite, TwinMemoryRiverStructure,
// GraphPinnedCard (reused), useDocumentVisible, synapticVisuals, shared twin
// types

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import GraphPinnedCardLayer from '../brain-graph/GraphPinnedCard';
import { useDocumentVisible } from '../../hooks/useDocumentVisible';
import { computeRiverLayout } from './riverLayout';
import { anchorsOf, contentBoxOf, riverEdgesOf, rowModelsOf } from './riverCanvasModel';
import { computeRiverAttentionLevels } from './riverAttention';
import { useGrowthCascade } from './useGrowthCascade';
import { useRiverFraming } from './useRiverFraming';
import TwinMemoryRiverDendrite, { TwinMemoryRiverDendriteDefs, type RiverPulse } from './TwinMemoryRiverDendrite';
import TwinMemoryRiverRow from './TwinMemoryRiverRow';
import { TwinMemoryRiverCore, TwinMemoryRiverHub } from './TwinMemoryRiverStructure';
import { fullTextOf, restLabelOf } from './TwinMemoryNodeLabel';
import { ATTENTION_OPACITY, DENDRITE_PULSE_MS, GRAPH_SURFACE_CLASS } from './synapticVisuals';
import type { TwinGraphNode, TwinMemoryGraph } from '../../../shared/types';

const FIT_BUTTON_CLASS =
  'absolute top-3 right-3 z-10 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[var(--color-accent-subtle)] border border-[var(--color-border-accent)] text-[var(--color-accent)] hover:border-[var(--color-accent-dim)]';

/** Read the OS reduced-motion preference reactively; guards jsdom/no-matchMedia.
 *  A local copy rather than a shared hook, matching the three canvases that each
 *  already carry one — the alternative is editing retained files. */
function readReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(readReducedMotion);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (): void => setReduced(mq.matches);
    handler();
    mq.addEventListener?.('change', handler);
    return () => mq.removeEventListener?.('change', handler);
  }, []);
  return reduced;
}

/**
 * All three gates on the phase's ONE sanctioned idle animation, in one place:
 * the Memory tab is on screen, the window is visible, and the user has not asked
 * for reduced motion. Any one false and the shimmer class is simply NOT RENDERED
 * — not paused, because a class that survives its gate is a permanent GPU tenant
 * that no rAF/interval counter can see.
 */
function useCoreShimmerAllowed(active: boolean, reducedMotion: boolean): boolean {
  const documentVisible = useDocumentVisible();
  return active && documentVisible && !reducedMotion;
}

export interface TwinMemoryRiverCanvasProps {
  /** The ledger graph, or null while it loads. */
  graph: TwinMemoryGraph | null;
  /** Node ids that arrived in the last refresh (bloom once, then re-freeze). */
  entering: ReadonlySet<string>;
  /** Category lanes currently OPEN. Empty is the default: everything collapsed. */
  expandedLanes: ReadonlySet<string>;
  /** Fired when a lane hub is activated by click or Enter/Space. */
  onToggleLane: (category: string) => void;
  /** Fired when a row or the twin core is activated. `viaKeyboard` is true for
   *  Enter/Space, which is what lets the host move focus into the inspector —
   *  the forget action must be reachable WITHOUT a pointer. */
  onInspect: (node: TwinGraphNode, viaKeyboard: boolean) => void;
  pinnedId?: string | null;
  /** Inspector CONTENT for the pinned node; this component owns POSITIONING. */
  pinnedPanel?: React.ReactNode;
  /** Unpins the card. Esc already reaches this via the inspector's own
   *  handler; this is the EMPTY-CANVAS-CLICK half of the grammar — the host
   *  owns `pinnedId`, so unpinning is just another way to ask for it back. */
  onUnpin?: () => void;
  /** Whether the Memory tab is the one on screen. The component stays MOUNTED
   *  either way, so this is the only thing that can stop the core shimmer. */
  active?: boolean;
}

export default function TwinMemoryRiverCanvas({
  graph,
  entering,
  expandedLanes,
  onToggleLane,
  onInspect,
  pinnedId,
  pinnedPanel,
  onUnpin,
  active = true,
}: TwinMemoryRiverCanvasProps) {
  const reducedMotion = usePrefersReducedMotion();
  const shimmerCore = useCoreShimmerAllowed(active, reducedMotion);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  /** Kept SEPARATE from hoveredId: keyboard focus attends a row exactly as a
   *  hover does, without a Tab press counting as a deliberate hover. */
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [pulse, setPulse] = useState<RiverPulse | null>(null);
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseSeqRef = useRef(0);

  // --- THE LAYOUT: pure arithmetic over (payload, disclosure, width). No
  // simulation, no seeding, no carried-over positions to preserve.
  const layout = useMemo(
    () => computeRiverLayout(graph, expandedLanes, viewportWidth),
    [graph, expandedLanes, viewportWidth],
  );
  const rows = useMemo(() => rowModelsOf(layout, graph), [layout, graph]);
  const edges = useMemo(() => riverEdgesOf(layout), [layout]);
  // Built from `rows`, not `layout.facts` — see anchorsOf's own header for why,
  // and for the asymmetric rightExtent that is this task's own anchor fix.
  const anchors = useMemo(() => anchorsOf(layout, rows), [layout, rows]);
  const twinNode = graph?.nodes.find((node) => node.type === 'twin') ?? null;
  const hasContent = layout.hubs.length > 0;

  // --- CATEGORY-SCOPED ATTENTION (TWIN-READ.2 Task 4): hovered ?? focused ??
  // pinned, resolved against the rendered rows so only a FACT drives the dim
  // wave — see riverAttention.ts's header for the full rationale and why one
  // id -> level map answers rows, hubs, headings and edges alike.
  const attention = useMemo(
    () => computeRiverAttentionLevels(hoveredId, focusedId, pinnedId ?? null, layout.hubs, rows),
    [hoveredId, focusedId, pinnedId, layout.hubs, rows],
  );
  const attentionOpacityOf = (id: string): number => ATTENTION_OPACITY[attention.get(id) ?? 'lit'];

  const cascade = useGrowthCascade(expandedLanes, rows, reducedMotion);
  const contentBox = useMemo(() => contentBoxOf(layout, rows), [layout, rows]);
  const { zoomTransform, fitToView } = useRiverFraming(svgRef, contentBox, hasContent);

  // --- Measure the container, so the layout's columns match the real width and
  // the default framing is 1:1. ResizeObserver is event-driven (no rAF, no
  // polling) and absent in jsdom — hence the bail, which leaves the layout on
  // riverLayout's own reference width.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = (): void => setViewportWidth(svg.clientWidth || 0);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  // --- THE ACTIVATION PULSE. Interaction-triggered and self-terminating: one
  // timeout, one node, nothing left behind. A `setTimeout` rather than the
  // `animationend` event on purpose — animationend can simply never arrive (a
  // hidden tab, a suppressed animation), and a pulse class that outlived its
  // animation would be a permanent GPU tenant.
  const triggerPulse = useCallback(
    (id: string | null): void => {
      if (reducedMotion || !id) return;
      pulseSeqRef.current += 1;
      setPulse({ id, seq: pulseSeqRef.current });
      if (pulseTimerRef.current !== null) clearTimeout(pulseTimerRef.current);
      pulseTimerRef.current = setTimeout(() => {
        pulseTimerRef.current = null;
        setPulse(null);
      }, DENDRITE_PULSE_MS);
    },
    [reducedMotion],
  );

  // Unmounting mid-pulse must not leave a timer holding a setState.
  useEffect(
    () => () => {
      if (pulseTimerRef.current !== null) clearTimeout(pulseTimerRef.current);
    },
    [],
  );

  // --- HUB PULSE FOR A COLLAPSED-LANE ARRIVAL (TWIN-READ.1 Task 5, carried
  // over). A fact whose lane is shut never reaches the layout, so nothing about
  // it would otherwise be seen: pulse its hub instead, on the one connection a
  // collapsed lane still draws (twin -> hub). Deps are [entering, graph] ONLY —
  // reading expandedLanes here rather than depending on it means toggling an
  // unrelated lane later cannot replay a stale pulse. NEVER auto-expands: an
  // arrival must not yank the view from under someone reading something else.
  useEffect(() => {
    if (entering.size === 0 || !graph) return;
    for (const node of graph.nodes) {
      if (node.type !== 'fact' || !node.category || !entering.has(node.id)) continue;
      if (!expandedLanes.has(node.category)) {
        triggerPulse(`category:${node.category}`);
        break; // one live pulse at a time — see triggerPulse's single-slot state
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entering, graph]);

  const handleHover = useCallback(
    (id: string | null): void => {
      setHoveredId(id);
      triggerPulse(id);
    },
    [triggerPulse],
  );

  const handleActivateNode = useCallback(
    (node: TwinGraphNode, viaKeyboard: boolean): void => {
      triggerPulse(node.id);
      onInspect(node, viaKeyboard);
    },
    [onInspect, triggerPulse],
  );

  /** A hub toggles its lane and never opens the inspector. */
  const handleToggle = useCallback(
    (hubId: string, category: string): void => {
      triggerPulse(hubId);
      onToggleLane(category);
    },
    [onToggleLane, triggerPulse],
  );

  /** EMPTY-CANVAS CLICK unpins. Every row, hub and the twin core is a real
   *  `role="button"` control, so a click that landed on (or inside) one is,
   *  by construction, a control activating — never the empty river, a
   *  decorative ribbon or a lane heading. Checking for that ancestor (rather
   *  than e.g. `event.target === svg`) is what stops a row's OWN click from
   *  also closing the pin it just opened as the same event bubbles here. */
  const handleCanvasClick = useCallback(
    (event: React.MouseEvent<SVGSVGElement>): void => {
      const target = event.target as Element | null;
      if (target?.closest('[role="button"]')) return;
      onUnpin?.();
    },
    [onUnpin],
  );

  const droppedCount = graph?.droppedCount ?? 0;

  return (
    <div
      data-testid="twin-memory-graph-canvas"
      data-layout="river"
      data-reduced-motion={reducedMotion}
      // Constant by construction: the layout is arithmetic, so it is never
      // mid-settle. See the header — this is a statement, not a state.
      data-settled="true"
      className={`relative flex-1 min-h-0 overflow-hidden ${GRAPH_SURFACE_CLASS}`}
    >
      {hasContent && (
        <button type="button" onClick={fitToView} className={FIT_BUTTON_CLASS}>
          Fit to view
        </button>
      )}

      {/* The <svg> ALWAYS mounts so the d3-zoom attach effect binds on the first
          commit, even while the graph is still loading over IPC. onClick is the
          empty-canvas-click unpin — every control inside stops it reaching here
          via handleCanvasClick's role="button" ancestor check, never via
          stopPropagation (which would also blind d3-zoom's own pan gesture). */}
      <svg
        ref={svgRef}
        role="img"
        aria-label="Twin memory graph — the twin, its memory categories, and every learned fact"
        width="100%"
        height="100%"
        className="block w-full h-full touch-none select-none"
        onClick={handleCanvasClick}
      >
        <TwinMemoryRiverDendriteDefs />
        {hasContent && (
          <g transform={zoomTransform.toString()}>
            <g data-river-edges="">
              {/* A branch grows too when its OWN fact just arrived into an
                  already-open lane — zero delay, the cascade's own class,
                  never a trunk (TWIN-READ.2 Task 5's judgement call). */}
              {edges.map((edge) => (
                <TwinMemoryRiverDendrite
                  key={edge.key}
                  edge={edge}
                  pulse={pulse}
                  growthDelayMs={
                    cascade.delays?.get(edge.toId) ??
                    (!reducedMotion && edge.kind === 'hub-fact' && entering.has(edge.toId) ? 0 : null)
                  }
                  attentionOpacity={attentionOpacityOf(edge.toId)}
                  reducedMotion={reducedMotion}
                />
              ))}
            </g>
            {layout.hubs.map((hub) => (
              <TwinMemoryRiverHub
                key={hub.id}
                hub={hub}
                highlighted={hub.id === hoveredId || hub.id === pinnedId}
                tapped={cascade.tappedHubId === hub.id}
                attentionOpacity={attentionOpacityOf(hub.id)}
                reducedMotion={reducedMotion}
                onToggle={handleToggle}
                onHover={handleHover}
                onFocusChange={setFocusedId}
              />
            ))}
            {rows.map((row) => (
              <TwinMemoryRiverRow
                key={row.node.id}
                node={row.node}
                x={row.x}
                y={row.y}
                title={restLabelOf(row.node)}
                fullText={fullTextOf(row.node)}
                highlighted={row.node.id === hoveredId || row.node.id === focusedId || row.node.id === pinnedId}
                attentionOpacity={attentionOpacityOf(row.node.id)}
                tapped={pulse?.id === row.node.id}
                reducedMotion={reducedMotion}
                entering={entering.has(row.node.id)}
                animateEntrance={!reducedMotion && entering.has(row.node.id)}
                growthDelayMs={cascade.delays?.get(row.node.id) ?? null}
                onHover={handleHover}
                onFocusChange={setFocusedId}
                onActivate={handleActivateNode}
              />
            ))}
            {twinNode && (
              <TwinMemoryRiverCore
                node={twinNode}
                x={layout.twin.x}
                y={layout.twin.y}
                radius={layout.twin.radius}
                highlighted={twinNode.id === hoveredId || twinNode.id === focusedId || twinNode.id === pinnedId}
                shimmer={shimmerCore}
                onHover={handleHover}
                onFocusChange={setFocusedId}
                onActivate={handleActivateNode}
              />
            )}
          </g>
        )}
      </svg>

      {/* Re-keyed per pin so the connector's draw-in (animateConnector) plays
          fresh on every pin and re-pin, not only the very first — a genuine
          remount, the same trick TwinMemoryRiverDendrite's own pulse path
          uses (`key={pulse-${seq}}`) to restart a CSS animation whose class
          name string never changes, and here also to guarantee a freshly
          mounted line reads its own --connector-length rather than relying
          on a running animation to notice the custom property changed. */}
      <GraphPinnedCardLayer
        key={pinnedId ?? 'unpinned'}
        pinnedId={pinnedId}
        panel={pinnedPanel}
        nodes={anchors}
        zoomTransform={zoomTransform}
        svgRef={svgRef}
        animateConnector={!reducedMotion}
      />

      {/* Cap honesty: facts dropped by the main-side node cap are NEVER silently
          truncated — they are counted on screen. */}
      {droppedCount > 0 && (
        <div
          data-testid="twin-memory-graph-dropped"
          title="Least-prominent memories beyond the display cap"
          className="absolute bottom-3 left-3 z-10 px-2.5 py-1 rounded-lg text-xs font-medium bg-[var(--color-chrome)] border border-[var(--color-border)] text-[var(--color-text-secondary)] overflow-hidden break-words"
        >
          +{droppedCount} not shown
        </div>
      )}

      {!hasContent && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--color-text-secondary)]">
          Loading your twin&rsquo;s memory…
        </div>
      )}
    </div>
  );
}
