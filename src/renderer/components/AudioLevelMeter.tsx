// === FILE PURPOSE ===
// Retro 90s equalizer-style audio-level visualisation (canvas). Subscribes to the
// capture service's single audio-level callback and renders per-bar levels with
// peak-hold decay, plus a "No audio detected" hint when silent. Extracted from
// RecordingControls so both the sidebar recording panel and the full-screen
// LiveModeOverlay (LIVE.2) can share one meter without forking it.
//
// GPU DISCIPLINE (LIVE.3): the meter settles deterministically to zero at silence
// (no per-frame randomness once quiet) and then PARKS — it stops scheduling rAF
// entirely instead of repainting an idle meter for the whole meeting. It resumes
// the instant audio returns via the onAudioLevel callback. While active, paints are
// capped to ~30fps. This removes the renderer's permanent-repaint waste; it does NOT
// touch the dominant local-first GPU cost (whisper.cpp + the local chat model).
//
// NOTE: audioCaptureService.onAudioLevel is a single-callback subscription
// (last registration wins). Keep only one *visible* meter mounted at a time —
// when the overlay is showing it is the foreground surface and registers last.

import { useState, useEffect, useRef } from 'react';
import { onAudioLevel } from '../services/audioCaptureService';

// --- Retro equalizer constants ---
export const EQ_BARS = 16;
const EQ_SEGMENTS = 10;
const EQ_BAR_GAP = 2; // px between bars
const EQ_SEG_GAP = 1; // px between segments

/** Below this level every dynamic quantity is treated as "silent" — the decay
 *  target collapses to 0 (no jitter) and, once everything is quiet, the loop parks. */
export const SILENCE_EPSILON = 0.01;

const PAINT_INTERVAL_MS = 33; // ~30fps paint cap while active

/** Green→Yellow→Red gradient based on segment position (0=bottom, 1=top). */
function eqSegmentColor(t: number): [number, number, number] {
  if (t <= 0.5) {
    const p = t / 0.5;
    return [
      Math.round(16 + (234 - 16) * p), // #10b981 → #eab308
      Math.round(185 + (179 - 185) * p),
      Math.round(129 + (8 - 129) * p),
    ];
  }
  const p = (t - 0.5) / 0.5;
  return [
    Math.round(234 + (239 - 234) * p), // #eab308 → #ef4444
    Math.round(179 + (68 - 179) * p),
    Math.round(8 + (68 - 8) * p),
  ];
}

/**
 * Per-bar target level for one animation step. Pure and deterministic: at silence
 * (`smoothLevel < SILENCE_EPSILON`) it returns 0 regardless of `randomOffset`, so
 * the meter can decay to a fixed empty state and park. Above silence it applies a
 * slight center bias plus the caller-supplied random offset, clamped to [0, 1].
 */
export function computeBarTarget(smoothLevel: number, barIndex: number, randomOffset: number): number {
  if (smoothLevel < SILENCE_EPSILON) return 0;
  const centerBias = 1 - (Math.abs(barIndex - EQ_BARS / 2) / (EQ_BARS / 2)) * 0.12;
  return Math.max(0, Math.min(1, smoothLevel * centerBias + randomOffset));
}

/** Retro 90s equalizer-style audio level visualisation (canvas). */
export default function AudioLevelMeter() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const latestLevel = useRef(0);
  const smoothLevel = useRef(0);
  const barLevels = useRef(new Float64Array(EQ_BARS));
  const peakLevels = useRef(new Float64Array(EQ_BARS));
  const peakHold = useRef(new Float64Array(EQ_BARS));
  const [isSilent, setIsSilent] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let tick = 0;
    let lastPaintTs = 0;
    let parked = false;

    // Advance the physics one frame: smoothing, per-bar rise/fall, peak-hold decay.
    const stepPhysics = () => {
      smoothLevel.current += (latestLevel.current - smoothLevel.current) * 0.25;
      for (let i = 0; i < EQ_BARS; i++) {
        const rand = (Math.random() - 0.5) * 0.18;
        const target = computeBarTarget(smoothLevel.current, i, rand);

        // Fast rise, slow fall per bar
        const diff = target - barLevels.current[i];
        barLevels.current[i] += diff * (diff > 0 ? 0.4 : 0.1);

        // Peak hold: freeze for ~30 frames then decay
        if (barLevels.current[i] > peakLevels.current[i]) {
          peakLevels.current[i] = barLevels.current[i];
          peakHold.current[i] = 30;
        } else if (peakHold.current[i] > 0) {
          peakHold.current[i]--;
        } else {
          peakLevels.current[i] = Math.max(0, peakLevels.current[i] - 0.015);
        }
      }
    };

    // True once level, smoothing and every bar/peak have decayed below silence —
    // the precondition for parking (nothing left to animate).
    const isSettled = () => {
      if (latestLevel.current >= SILENCE_EPSILON || smoothLevel.current >= SILENCE_EPSILON) return false;
      for (let i = 0; i < EQ_BARS; i++) {
        if (barLevels.current[i] >= SILENCE_EPSILON || peakLevels.current[i] >= SILENCE_EPSILON) return false;
      }
      return true;
    };

    // Paint the current bar/peak state to the canvas (DPR-aware).
    const drawFrame = () => {
      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
        canvas.width = cssW * dpr;
        canvas.height = cssH * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      ctx.clearRect(0, 0, cssW, cssH);

      const barW = (cssW - (EQ_BARS - 1) * EQ_BAR_GAP) / EQ_BARS;
      const segH = (cssH - (EQ_SEGMENTS - 1) * EQ_SEG_GAP) / EQ_SEGMENTS;

      for (let i = 0; i < EQ_BARS; i++) {
        const activeSegs = Math.floor(barLevels.current[i] * EQ_SEGMENTS);
        const peakSeg = Math.floor(peakLevels.current[i] * EQ_SEGMENTS) - 1;
        const x = i * (barW + EQ_BAR_GAP);

        for (let j = 0; j < EQ_SEGMENTS; j++) {
          const y = cssH - (j + 1) * segH - j * EQ_SEG_GAP;
          const active = j < activeSegs;
          const isPeak = j === peakSeg && peakSeg >= activeSegs && peakLevels.current[i] > 0.02;
          const [r, g, b] = eqSegmentColor(j / (EQ_SEGMENTS - 1));

          if (active) {
            ctx.fillStyle = `rgb(${r},${g},${b})`;
          } else if (isPeak) {
            ctx.fillStyle = `rgba(${r},${g},${b},0.75)`;
          } else {
            ctx.fillStyle = `rgba(${r},${g},${b},0.1)`;
          }

          ctx.fillRect(x, y, barW, segH);
        }
      }
    };

    const render = (ts: number) => {
      stepPhysics();

      // Throttle silent-state React update (~2 Hz)
      if (++tick % 30 === 0) {
        const nowSilent = smoothLevel.current < SILENCE_EPSILON;
        setIsSilent((prev) => (prev === nowSilent ? prev : nowSilent));
      }

      // Everything has settled to silence: paint one final empty frame and PARK —
      // stop scheduling rAF so the idle meter costs nothing until audio returns.
      if (isSettled()) {
        setIsSilent((prev) => (prev === true ? prev : true));
        drawFrame();
        parked = true;
        rafRef.current = null;
        return;
      }

      // ~30fps paint cap: skip the repaint (but keep physics + scheduling) when the
      // last paint was <33ms ago. Halves paint work during active speech.
      if (ts - lastPaintTs >= PAINT_INTERVAL_MS) {
        lastPaintTs = ts;
        drawFrame();
      }

      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);
    onAudioLevel((l) => {
      latestLevel.current = l;
      // Resume from a parked state the instant audio returns.
      if (parked && l >= SILENCE_EPSILON) {
        parked = false;
        lastPaintTs = 0;
        rafRef.current = requestAnimationFrame(render);
      }
    });

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      onAudioLevel(null);
    };
  }, []);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-surface-400">Audio Level</span>
        {isSilent && <span className="text-xs text-amber-400">No audio detected</span>}
      </div>
      <canvas ref={canvasRef} className="w-full rounded" style={{ height: '48px' }} />
    </div>
  );
}
