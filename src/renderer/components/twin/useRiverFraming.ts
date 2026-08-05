// === FILE PURPOSE ===
// FRAMING for the riverbank canvas (TWIN-READ.2 Task 2): the d3-zoom wiring, the
// default 1:1 view, and "Fit to view". Split out of TwinMemoryRiverCanvas so
// that file reads as composition; this is the only place the canvas talks to d3.
//
// >>> WHY d3-zoom AND NOT THE MOCKUP'S SCROLLER. <<<
// The mockup scrolls a tall SVG. This lifts the tiered canvas's zoom/pan wiring
// instead, for two reasons that are about this codebase rather than about taste:
// the wiring is proven here (including the jsdom trap below), and
// GraphPinnedCardLayer already anchors the inspector card through a
// `ZoomTransform` — so the pinned card keeps working rather than needing a
// scroll-sync of its own.
//
// The mockup's READABILITY is kept by different means: the caller computes its
// layout against the measured container width, so the DEFAULT framing is 1:1 and
// a row title renders at its design size. Panning IS this tall canvas's scroll;
// zoom is there when you want the whole river at once, and so is the button.
//
// TWO TRAPS THIS FILE ANSWERS, both already paid for once in this project:
//   * d3-zoom's DEFAULT extent reads the element's viewBox, which jsdom does not
//     implement — it throws. An explicit `.extent()` is mandatory, not tidiness.
//   * AUTO-FRAMING MUST STOP once the user has framed the view themselves.
//     d3 leaves `sourceEvent` null for transforms we apply ourselves, which is
//     how a user gesture is told apart from our own re-framing.
//
// Nothing here schedules a frame or a timer: zoom is event-driven, and applying
// a transform is synchronous (a d3 TRANSITION would schedule — we never use one).
//
// === DEPENDENCIES ===
// react, d3-selection, d3-zoom

import { useCallback, useEffect, useRef, useState } from 'react';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';

const FALLBACK_W = 900;
const FALLBACK_H = 600;
/** A river with several open lanes grows arbitrarily tall, so the zoom-out end
 *  has to reach far enough for "Fit to view" to frame it, not clamp short. */
const SCALE_EXTENT: [number, number] = [0.06, 2.5];
/** Fraction of the viewport a FITTED river fills (a little breathing room). */
const FIT_FILL = 0.9;

/** The box framing has to cover, in layout space. */
export interface ContentBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RiverFraming {
  /** The live transform, for the content group and the pinned-card anchors. */
  zoomTransform: ZoomTransform;
  /** Frame the whole river — the explicit button. */
  fitToView: () => void;
}

/**
 * @param svgRef  the canvas's `<svg>`, which must mount on the first commit
 * @param box     the content box; a new one re-frames unless the user has taken
 *                over the view
 * @param enabled false while there is nothing to frame (no payload yet)
 */
export function useRiverFraming(
  svgRef: React.RefObject<SVGSVGElement | null>,
  box: ContentBox,
  enabled: boolean,
): RiverFraming {
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const userFramedRef = useRef(false);
  const [zoomTransform, setZoomTransform] = useState<ZoomTransform>(zoomIdentity);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent(SCALE_EXTENT)
      .extent((): [[number, number], [number, number]] => [
        [0, 0],
        [svg.clientWidth || FALLBACK_W, svg.clientHeight || FALLBACK_H],
      ])
      .on('zoom', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        if (event.sourceEvent) userFramedRef.current = true;
        setZoomTransform(event.transform);
      });
    zoomRef.current = behavior;
    const selection = select(svg);
    selection.call(behavior);
    return () => {
      selection.on('.zoom', null);
      zoomRef.current = null;
    };
  }, [svgRef]);

  const applyTransform = useCallback(
    (transform: ZoomTransform): void => {
      const svg = svgRef.current;
      const behavior = zoomRef.current;
      if (!svg || !behavior) return;
      select(svg).call(behavior.transform, transform);
    },
    [svgRef],
  );

  const fitToView = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const viewW = svg.clientWidth || FALLBACK_W;
    const viewH = svg.clientHeight || FALLBACK_H;
    const k = Math.min(
      SCALE_EXTENT[1],
      Math.max(SCALE_EXTENT[0], FIT_FILL * Math.min(viewW / box.width, viewH / box.height)),
    );
    applyTransform(
      zoomIdentity
        .translate((viewW - box.width * k) / 2 - box.x * k, (viewH - box.height * k) / 2 - box.y * k)
        .scale(k),
    );
  }, [applyTransform, box, svgRef]);

  // The DEFAULT framing: 1:1, content centred when it fits and top-anchored when
  // it does not. Deliberately NOT fitToView — fitting a tall river shrinks its
  // titles to nothing, which is the readability problem this whole phase exists
  // to fix.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !enabled || userFramedRef.current) return;
    const viewH = svg.clientHeight || FALLBACK_H;
    applyTransform(zoomIdentity.translate(0, Math.max(0, (viewH - box.height) / 2) - box.y));
  }, [applyTransform, box, enabled, svgRef]);

  return { zoomTransform, fitToView };
}
