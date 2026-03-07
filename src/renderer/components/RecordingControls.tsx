// === FILE PURPOSE ===
// Recording control panel -- start/stop recording with meeting title input.
// Shows a title input + start button when idle, or a stop button + elapsed
// timer + audio level meter when recording is active.
//
// === DEPENDENCIES ===
// react, lucide-react (Mic, Square, Loader2), recordingStore, audioCaptureService

import { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Square, Loader2, Trash2, FolderOpen, FileText, Globe } from 'lucide-react';
import { ConfirmDialog } from './ConfirmDialog';
import { useRecordingStore } from '../stores/recordingStore';
import { useMeetingStore } from '../stores/meetingStore';
import { useProjectStore } from '../stores/projectStore';
import { onAudioLevel } from '../services/audioCaptureService';
import { MEETING_TEMPLATES, TRANSCRIPTION_LANGUAGES } from '../../shared/types';
import type { MeetingTemplateType } from '../../shared/types';
import HudSelect from './HudSelect';
import MeetingPrepSection from './MeetingPrepSection';

/** Generate a default meeting title with the current date and time. */
function suggestMeetingTitle(): string {
  const now = new Date();
  const date = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `Meeting - ${date}, ${time}`;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function formatLastDuration(startedAt: string, endedAt: string): string {
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  if (min === 0) return `${sec}s`;
  return `${min}m ${sec}s`;
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

interface RecordingControlsProps {
  hasModel?: boolean | null;
}

export default function RecordingControls({ hasModel }: RecordingControlsProps) {
  const isRecording = useRecordingStore(s => s.isRecording);
  const isProcessing = useRecordingStore(s => s.isProcessing);
  const elapsed = useRecordingStore(s => s.elapsed);
  const error = useRecordingStore(s => s.error);
  const starting = useRecordingStore(s => s.starting);
  const includeMic = useRecordingStore(s => s.includeMic);
  const completedMeetingId = useRecordingStore(s => s.completedMeetingId);
  const clearCompletedMeetingId = useRecordingStore(s => s.clearCompletedMeetingId);
  const startRecording = useRecordingStore(s => s.startRecording);
  const stopRecording = useRecordingStore(s => s.stopRecording);
  const setIncludeMic = useRecordingStore(s => s.setIncludeMic);
  const deleteMeeting = useMeetingStore(s => s.deleteMeeting);
  const meetings = useMeetingStore(s => s.meetings);
  const lastCompletedMeeting = meetings.find(m => m.status === 'completed' && m.endedAt);
  const projects = useProjectStore(s => s.projects);
  const activeProjects = projects.filter(p => !p.archived);
  const [title, setTitle] = useState(suggestMeetingTitle);
  const [selectedTemplate, setSelectedTemplate] = useState<MeetingTemplateType>('none');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedLanguage, setSelectedLanguage] = useState<string>('en');
  const [activeModelName, setActiveModelName] = useState<string | null>(null);
  const [transcriptionProvider, setTranscriptionProvider] = useState<string>('local');
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);

  // Load saved language, active model, and transcription provider on mount
  useEffect(() => {
    (async () => {
      try {
        const [savedLang, model, config] = await Promise.all([
          window.electronAPI.getSetting('transcription:language'),
          window.electronAPI.whisperGetActiveModel(),
          window.electronAPI.transcriptionGetConfig(),
        ]);
        if (savedLang) setSelectedLanguage(savedLang);
        setActiveModelName(model);
        if (config) setTranscriptionProvider(config.type);
      } catch {
        // Settings or model unavailable — keep defaults
      }
    })();
  }, []);

  // Re-check model when language changes
  useEffect(() => {
    (async () => {
      try {
        const model = await window.electronAPI.whisperGetActiveModel();
        setActiveModelName(model);
      } catch {
        // ignore
      }
    })();
  }, [selectedLanguage]);

  const handleLanguageChange = async (value: string) => {
    setSelectedLanguage(value);
    try {
      await window.electronAPI.setSetting('transcription:language', value);
    } catch {
      // Settings save failed — non-critical
    }
  };

  const isEnglishOnlyModel = activeModelName?.includes('.en') ?? false;
  const showModelWarning = transcriptionProvider === 'local' && isEnglishOnlyModel && selectedLanguage !== 'en';

  const handleStart = async () => {
    if (!title.trim()) return;
    await startRecording(title.trim(), selectedProjectId || undefined, selectedTemplate, selectedLanguage);
    setTitle(suggestMeetingTitle());
    setSelectedTemplate('none');
    setSelectedProjectId('');
  };

  const handleDiscard = () => {
    if (!completedMeetingId) return;
    setDiscardConfirmOpen(true);
  };

  const confirmDiscard = async () => {
    setDiscardConfirmOpen(false);
    if (!completedMeetingId) return;
    await deleteMeeting(completedMeetingId);
    clearCompletedMeetingId();
  };

  const handleStop = async () => {
    await stopRecording();
  };

  return (
    <>
    <div className="hud-panel clip-corner-cut-sm rounded-xl p-4">
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
          <div className="flex items-center gap-2 text-surface-800 dark:text-surface-200">
            <Mic size={18} />
            <span className="text-sm font-medium">New Recording</span>
          </div>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Meeting title..."
            className="w-full text-sm bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] rounded-lg px-3 py-2
                       text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)]
                       focus:outline-none focus:border-[var(--color-accent-dim)]"
            onKeyDown={(e) => e.key === 'Enter' && handleStart()}
            disabled={starting}
            autoFocus
          />
          {lastCompletedMeeting && (
            <p className="text-xs text-surface-500 -mt-1">
              Last: {lastCompletedMeeting.title} — {formatLastDuration(lastCompletedMeeting.startedAt, lastCompletedMeeting.endedAt!)}
            </p>
          )}
          <HudSelect
            value={selectedProjectId}
            onChange={(v) => setSelectedProjectId(v)}
            placeholder="No project (link later)"
            icon={FolderOpen}
            disabled={starting}
            options={[
              { value: '', label: 'No project (link later)' },
              ...activeProjects.map(p => ({ value: p.id, label: p.name })),
            ]}
          />
          <HudSelect
            value={selectedTemplate}
            onChange={(v) => setSelectedTemplate(v as MeetingTemplateType)}
            icon={FileText}
            disabled={starting}
            options={MEETING_TEMPLATES.map(t => ({ value: t.type, label: t.name, description: t.description }))}
          />
          <HudSelect
            value={selectedLanguage}
            onChange={(v) => handleLanguageChange(v)}
            icon={Globe}
            disabled={starting}
            options={TRANSCRIPTION_LANGUAGES.map(lang => ({ value: lang.code, label: lang.label }))}
          />
          {showModelWarning && (
            <p className="text-xs text-amber-400">
              {'\u26A0'} Current model is English-only. Download a multilingual model in Settings to transcribe other languages.
            </p>
          )}
          {selectedTemplate !== 'none' && (
            <div className="text-xs text-surface-400 space-y-0.5">
              <span className="font-medium">Suggested agenda:</span>
              {MEETING_TEMPLATES.find(t => t.type === selectedTemplate)?.agenda.map((item, i) => (
                <div key={i}>{'\u2022'} {item}</div>
              ))}
            </div>
          )}
          {selectedProjectId && (
            <MeetingPrepSection projectId={selectedProjectId} />
          )}
          <button
            type="button"
            onClick={() => setIncludeMic(!includeMic)}
            disabled={starting}
            className={`flex items-center gap-2 w-full rounded-lg px-3 py-2 text-sm
                        border transition-colors
                        ${includeMic
                          ? 'bg-surface-800 border-primary-600 text-surface-800 dark:text-surface-200'
                          : 'bg-surface-100 dark:bg-surface-900 border-surface-300 dark:border-surface-600 text-surface-500'}
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
                       disabled:bg-[var(--color-border)] disabled:text-[var(--color-text-muted)]
                       text-white rounded-lg px-3 py-2 text-sm font-medium
                       ring-2 ring-[var(--color-border-accent)]
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
          {hasModel === false && (
            <p className="text-xs text-amber-400">
              No Whisper model — recordings won't have transcription.
            </p>
          )}
          {completedMeetingId && (
            <button
              onClick={handleDiscard}
              className="w-full flex items-center justify-center gap-2 text-surface-500
                         hover:text-red-400 text-xs py-1 transition-colors"
            >
              <Trash2 size={12} />
              Discard last recording
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-sm font-medium text-red-400">Recording</span>
            </div>
            <span className="text-lg font-data text-[var(--color-accent)] text-glow">
              {formatElapsed(elapsed)}
            </span>
          </div>
          <AudioLevelMeter />
          <button
            onClick={handleStop}
            className="w-full flex items-center justify-center gap-2 bg-surface-700
                       hover:bg-surface-600 text-surface-800 dark:text-surface-200 rounded-lg px-3 py-2
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
    <ConfirmDialog
      open={discardConfirmOpen}
      title="Discard Recording"
      message="Discard this recording? The meeting and audio will be permanently deleted."
      confirmLabel="Discard"
      variant="danger"
      onConfirm={confirmDiscard}
      onCancel={() => setDiscardConfirmOpen(false)}
    />
    </>
  );
}
