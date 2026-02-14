// === FILE PURPOSE ===
// Recording control panel -- start/stop recording with meeting title input.
// Shows a title input + start button when idle, or a stop button + elapsed
// timer + audio level meter when recording is active.
//
// === DEPENDENCIES ===
// react, lucide-react (Mic, Square, Loader2), recordingStore, audioCaptureService

import { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Square, Loader2 } from 'lucide-react';
import { useRecordingStore } from '../stores/recordingStore';
import { onAudioLevel } from '../services/audioCaptureService';
import { MEETING_TEMPLATES } from '../../shared/types';
import type { MeetingTemplateType } from '../../shared/types';

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// --- Retro equalizer constants ---
const EQ_BARS = 16;
const EQ_SEGMENTS = 10;
const EQ_BAR_GAP = 2;   // px between bars
const EQ_SEG_GAP = 1;   // px between segments

/** Green→Yellow→Red gradient based on segment position (0=bottom, 1=top). */
function eqSegmentColor(t: number): [number, number, number] {
  if (t <= 0.5) {
    const p = t / 0.5;
    return [
      Math.round(16 + (234 - 16) * p),   // #10b981 → #eab308
      Math.round(185 + (179 - 185) * p),
      Math.round(129 + (8 - 129) * p),
    ];
  }
  const p = (t - 0.5) / 0.5;
  return [
    Math.round(234 + (239 - 234) * p),    // #eab308 → #ef4444
    Math.round(179 + (68 - 179) * p),
    Math.round(8 + (68 - 8) * p),
  ];
}

/** Retro 90s equalizer-style audio level visualisation (canvas) */
function AudioLevelMeter() {
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
    const ctx = canvas.getContext('2d')!;
    let tick = 0;

    const render = () => {
      // Smooth interpolation toward target level
      smoothLevel.current += (latestLevel.current - smoothLevel.current) * 0.25;

      // Resize canvas to match CSS layout (DPR-aware)
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
        // Per-bar variation: slight center bias + randomness
        const centerBias = 1 - Math.abs(i - EQ_BARS / 2) / (EQ_BARS / 2) * 0.12;
        const rand = (Math.random() - 0.5) * 0.18;
        const target = Math.max(0, Math.min(1, smoothLevel.current * centerBias + rand));

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

      // Throttle silent-state React update (~2 Hz)
      if (++tick % 30 === 0) {
        const nowSilent = smoothLevel.current < 0.01;
        setIsSilent((prev) => (prev === nowSilent ? prev : nowSilent));
      }

      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);
    onAudioLevel((l) => { latestLevel.current = l; });

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      onAudioLevel(null);
    };
  }, []);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-surface-400">Audio Level</span>
        {isSilent && (
          <span className="text-xs text-amber-400">No audio detected</span>
        )}
      </div>
      <canvas
        ref={canvasRef}
        className="w-full rounded"
        style={{ height: '48px' }}
      />
    </div>
  );
}

export default function RecordingControls() {
  const {
    isRecording, isProcessing, elapsed, error, starting, includeMic,
    startRecording, stopRecording, setIncludeMic,
  } = useRecordingStore();
  const [title, setTitle] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<MeetingTemplateType>('none');

  const handleStart = async () => {
    if (!title.trim()) return;
    await startRecording(title.trim(), undefined, selectedTemplate);
    setTitle('');
    setSelectedTemplate('none');
  };

  const handleStop = async () => {
    await stopRecording();
  };

  return (
    <div className="bg-surface-800 rounded-xl border border-surface-700 p-4">
      {isProcessing ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse" />
            <span className="text-sm font-medium text-amber-400">Processing recording...</span>
          </div>
          <div className="flex items-center gap-2 text-surface-400">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm">Saving audio and finalizing transcript...</span>
          </div>
        </div>
      ) : !isRecording ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-surface-200">
            <Mic size={18} />
            <span className="text-sm font-medium">New Recording</span>
          </div>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Meeting title..."
            className="w-full bg-surface-900 border border-surface-600 rounded-lg px-3 py-2
                       text-sm text-surface-100 placeholder:text-surface-500
                       focus:outline-none focus:ring-1 focus:ring-primary-500"
            onKeyDown={(e) => e.key === 'Enter' && handleStart()}
            disabled={starting}
          />
          <select
            value={selectedTemplate}
            onChange={(e) => setSelectedTemplate(e.target.value as MeetingTemplateType)}
            className="w-full"
            disabled={starting}
          >
            {MEETING_TEMPLATES.map((t) => (
              <option key={t.type} value={t.type}>
                {t.name} — {t.description}
              </option>
            ))}
          </select>
          {selectedTemplate !== 'none' && (
            <div className="text-xs text-surface-400 space-y-0.5">
              <span className="font-medium">Suggested agenda:</span>
              {MEETING_TEMPLATES.find(t => t.type === selectedTemplate)?.agenda.map((item, i) => (
                <div key={i}>{'\u2022'} {item}</div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setIncludeMic(!includeMic)}
            disabled={starting}
            className={`flex items-center gap-2 w-full rounded-lg px-3 py-2 text-sm
                        border transition-colors
                        ${includeMic
                          ? 'bg-surface-800 border-primary-600 text-surface-200'
                          : 'bg-surface-900 border-surface-600 text-surface-500'}
                        disabled:opacity-50 disabled:cursor-not-allowed
                        hover:border-primary-500`}
          >
            {includeMic ? <Mic size={16} /> : <MicOff size={16} />}
            <span className="text-xs">
              {includeMic ? 'Microphone on' : 'Microphone off'}
            </span>
          </button>
          <button
            onClick={handleStart}
            disabled={!title.trim() || starting}
            className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500
                       disabled:bg-surface-700 disabled:text-surface-500
                       text-white rounded-lg px-3 py-2 text-sm font-medium
                       transition-colors"
          >
            {starting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <Mic size={16} />
                Start Recording
              </>
            )}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-sm font-medium text-red-400">Recording</span>
            </div>
            <span className="text-lg font-mono text-surface-200">
              {formatElapsed(elapsed)}
            </span>
          </div>
          <AudioLevelMeter />
          <button
            onClick={handleStop}
            className="w-full flex items-center justify-center gap-2 bg-surface-700
                       hover:bg-surface-600 text-surface-200 rounded-lg px-3 py-2
                       text-sm font-medium transition-colors"
          >
            <Square size={14} />
            Stop Recording
          </button>
        </div>
      )}
      {error && (
        <p className="mt-2 text-xs text-red-400">{error}</p>
      )}
    </div>
  );
}
