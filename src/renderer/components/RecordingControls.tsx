// === FILE PURPOSE ===
// Recording control panel -- start/stop recording with meeting title input.
// Shows a title input + start button when idle, or a stop button + elapsed
// timer + audio level meter when recording is active.
//
// === DEPENDENCIES ===
// react, lucide-react (Mic, Square, Loader2), recordingStore, audioCaptureService

import { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Square, X, Loader2, Trash2, FolderOpen, FileText, Globe } from 'lucide-react';
import { ConfirmDialog } from './ConfirmDialog';
import { useRecordingStore } from '../stores/recordingStore';
import { useMeetingStore } from '../stores/meetingStore';
import { useProjectStore } from '../stores/projectStore';
import { MEETING_TEMPLATES, TRANSCRIPTION_LANGUAGES } from '../../shared/types';
import type { MeetingTemplateType } from '../../shared/types';
import HudSelect from './HudSelect';
import AudioLevelMeter from './AudioLevelMeter';
import { suggestMeetingTitle } from '../../shared/utils/meetingTitle';
import { toast } from '../hooks/useToast';
import {
  SETTING_AUTO_STOP_MINUTES,
  DEFAULT_AUTO_STOP_MINUTES,
  INACTIVITY_COUNTDOWN_SECONDS,
  clampAutoStopMinutes,
} from '../../shared/types/recording';

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
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

/** Short "X ago" relative timestamp for the project recency hint. */
function shortRelativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** Returns a short label for the transcription backend. */
function backendBadge(backend: string): { label: string; color: string } | null {
  switch (backend) {
    case 'metal':
    case 'vulkan':
    case 'cuda':
      return { label: 'GPU', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' };
    case 'cpu':
      return { label: 'CPU', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' };
    case 'deepgram':
      return { label: 'Deepgram', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' };
    case 'assemblyai':
      return { label: 'AssemblyAI', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' };
    default:
      return null;
  }
}

/** Progress UI shown while the recording is being processed (saving + transcribing). */
function ProcessingProgressPanel() {
  const progress = useRecordingStore((s) => s.processingProgress);

  // Determine phase text, progress percent, and whether to show indeterminate animation
  let phaseText: string;
  let percent: number;
  let indeterminate = false;
  let badge: { label: string; color: string } | null = null;

  if (!progress) {
    // Fallback: isProcessing is true but no granular progress yet
    phaseText = 'Processing recording...';
    percent = 0;
    indeterminate = true;
  } else {
    switch (progress.phase) {
      case 'saving-audio':
        phaseText = 'Saving audio file...';
        percent = progress.percentComplete;
        indeterminate = true;
        break;
      case 'transcribing':
        phaseText = `Transcribing segment ${progress.currentSegment} of ${progress.totalSegments}...`;
        percent = progress.percentComplete;
        badge = backendBadge(progress.backendUsed);
        break;
      case 'finalizing':
        phaseText = 'Wrapping up...';
        percent = 95;
        break;
      default:
        phaseText = 'Processing...';
        percent = progress.percentComplete;
    }
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse" />
        <span className="text-sm font-medium text-amber-400">Processing recording</span>
      </div>

      {/* Phase text + backend badge */}
      <div className="flex items-center gap-2">
        <Loader2 size={14} className="text-surface-400 animate-spin shrink-0" />
        <span className="text-sm text-surface-400">{phaseText}</span>
        {badge && (
          <span className={`text-[0.625rem] font-medium px-1.5 py-0.5 rounded border ${badge.color}`}>
            {badge.label}
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="bg-surface-800 rounded-full h-2 overflow-hidden">
          {indeterminate ? (
            <div className="h-2 rounded-full bg-amber-500/60 animate-pulse w-full" />
          ) : (
            <div
              className="bg-amber-500 rounded-full h-2 transition-all duration-300"
              style={{ width: `${Math.min(percent, 100)}%` }}
            />
          )}
        </div>
        {!indeterminate && (
          <div className="text-right">
            <span className="text-xs text-surface-500">{Math.round(percent)}%</span>
          </div>
        )}
      </div>
    </div>
  );
}

interface RecordingControlsProps {
  hasModel?: boolean | null;
}

export default function RecordingControls({ hasModel }: RecordingControlsProps) {
  const isRecording = useRecordingStore((s) => s.isRecording);
  const isProcessing = useRecordingStore((s) => s.isProcessing);
  const liveModeMinimized = useRecordingStore((s) => s.liveModeMinimized);
  const inactivityState = useRecordingStore((s) => s.inactivityState);
  const keepRecording = useRecordingStore((s) => s.keepRecording);
  const elapsed = useRecordingStore((s) => s.elapsed);
  const error = useRecordingStore((s) => s.error);
  const starting = useRecordingStore((s) => s.starting);
  const includeMic = useRecordingStore((s) => s.includeMic);
  const completedMeetingId = useRecordingStore((s) => s.completedMeetingId);
  const clearCompletedMeetingId = useRecordingStore((s) => s.clearCompletedMeetingId);
  const startRecording = useRecordingStore((s) => s.startRecording);
  const stopRecording = useRecordingStore((s) => s.stopRecording);
  const cancelRecording = useRecordingStore((s) => s.cancelRecording);
  const setIncludeMic = useRecordingStore((s) => s.setIncludeMic);
  const deleteMeeting = useMeetingStore((s) => s.deleteMeeting);
  const meetings = useMeetingStore((s) => s.meetings);
  const lastCompletedMeeting = meetings.find((m) => m.status === 'completed' && m.endedAt);
  const createProject = useProjectStore((s) => s.createProject);
  const [projectsWithRecency, setProjectsWithRecency] = useState<
    Array<{ id: string; name: string; archived: boolean; lastRecordedAt: string | null }>
  >([]);
  const sortedProjects = projectsWithRecency
    .filter((p) => !p.archived)
    .slice()
    .sort((a, b) => {
      const aTime = a.lastRecordedAt ? new Date(a.lastRecordedAt).getTime() : 0;
      const bTime = b.lastRecordedAt ? new Date(b.lastRecordedAt).getTime() : 0;
      if (aTime !== bTime) return bTime - aTime;
      return a.name.localeCompare(b.name);
    });
  const [title, setTitle] = useState(suggestMeetingTitle);
  const [selectedTemplate, setSelectedTemplate] = useState<MeetingTemplateType>('none');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedLanguage, setSelectedLanguage] = useState<string>('en');
  const [activeModelName, setActiveModelName] = useState<string | null>(null);
  const [transcriptionProvider, setTranscriptionProvider] = useState<string>('local');
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

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

  // Load projects with last-recorded recency for the smart dropdown.
  // Default to the most-recent project if any. Falls back to "(no project)".
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await window.electronAPI.getProjectsWithRecency();
        if (cancelled) return;
        setProjectsWithRecency(rows);
        const top = rows
          .filter((p) => !p.archived)
          .slice()
          .sort((a, b) => {
            const aT = a.lastRecordedAt ? new Date(a.lastRecordedAt).getTime() : 0;
            const bT = b.lastRecordedAt ? new Date(b.lastRecordedAt).getTime() : 0;
            return bT - aT;
          })[0];
        if (top && top.lastRecordedAt) {
          setSelectedProjectId(top.id);
        }
      } catch {
        // Non-critical — dropdown will fall back to empty + "(no project)"
      }
    })();
    return () => {
      cancelled = true;
    };
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

  // GUARD.1 Task 2 — observer for the inactivity countdown starting (recordingStore's
  // onWarn transition). This component is always mounted during recording, so it owns
  // the IPC/toast side effects the store deliberately stays free of (Session Decisions).
  // Depends only on inactivityState (not inactivitySecondsLeft) so it fires exactly
  // once per countdown episode, never on the per-second tick.
  useEffect(() => {
    if (inactivityState !== 'countdown') return;

    // Minimized path: the full-screen banner isn't visible, so surface a toast with
    // the same "Keep recording" escape hatch. Kept up for the whole countdown window
    // so it doesn't disappear before the auto-stop it's warning about.
    if (liveModeMinimized) {
      toast(
        'No audio detected — still recording?',
        'info',
        { label: 'Keep recording', onClick: keepRecording },
        INACTIVITY_COUNTDOWN_SECONDS * 1000,
      );
    }

    // Desktop notification fires once per episode regardless of minimized state —
    // an OS-level alert the user may see even when LifeDash isn't the focused window.
    void (async () => {
      let minutes = DEFAULT_AUTO_STOP_MINUTES;
      try {
        const raw = await window.electronAPI.getSetting(SETTING_AUTO_STOP_MINUTES);
        minutes = clampAutoStopMinutes(parseInt(raw ?? '', 10));
      } catch {
        // Settings unavailable — fall back to the default in the notification copy.
      }
      await window.electronAPI.notificationShow(
        'Still recording?',
        `No audio for ${minutes} minutes — LifeDash will stop the recording in 2 minutes.`,
      );
    })();
    // liveModeMinimized/keepRecording are read at the moment the countdown starts —
    // deliberately excluded so a later minimize/restore mid-countdown can't re-fire this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inactivityState]);

  // Detect an UNATTENDED auto-stop: the countdown was running and it AND the recording
  // both ended together (vs. "Keep recording" / audio resuming, which clear the
  // countdown while isRecording stays true). Explains the stop to a returning user —
  // the normal stopRecording flow already covers the separate "Meeting processed" toast.
  const prevGuardRef = useRef({ inactivityState, isRecording });
  useEffect(() => {
    const prev = prevGuardRef.current;
    prevGuardRef.current = { inactivityState, isRecording };
    if (prev.inactivityState === 'countdown' && inactivityState === 'idle' && prev.isRecording && !isRecording) {
      toast('Recording auto-stopped after inactivity — session saved', 'info', undefined, 6000);
    }
  }, [inactivityState, isRecording]);

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
          <ProcessingProgressPanel />
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
                Last: {lastCompletedMeeting.title} —{' '}
                {formatLastDuration(lastCompletedMeeting.startedAt, lastCompletedMeeting.endedAt!)}
              </p>
            )}
            <HudSelect
              value={selectedProjectId}
              onChange={(v) => setSelectedProjectId(v)}
              placeholder="(no project)"
              icon={FolderOpen}
              disabled={starting}
              options={[
                { value: '', label: '(no project)', description: 'Auto-detect when stopped' },
                ...sortedProjects.map((p) => {
                  const recency = shortRelativeTime(p.lastRecordedAt);
                  return {
                    value: p.id,
                    label: p.name,
                    description: recency ?? 'No recordings yet',
                  };
                }),
              ]}
              onCreateNew={{
                label: '+ New project',
                placeholder: 'Project name',
                onSubmit: async (name) => {
                  const project = await createProject({ name });
                  // Refresh the recency list so the new project appears
                  try {
                    const rows = await window.electronAPI.getProjectsWithRecency();
                    setProjectsWithRecency(rows);
                  } catch {
                    // Non-critical
                  }
                  return project.id;
                },
              }}
            />
            <HudSelect
              value={selectedTemplate}
              onChange={(v) => setSelectedTemplate(v as MeetingTemplateType)}
              icon={FileText}
              disabled={starting}
              options={MEETING_TEMPLATES.map((t) => ({ value: t.type, label: t.name, description: t.description }))}
            />
            <HudSelect
              value={selectedLanguage}
              onChange={(v) => handleLanguageChange(v)}
              icon={Globe}
              disabled={starting}
              options={TRANSCRIPTION_LANGUAGES.map((lang) => ({ value: lang.code, label: lang.label }))}
            />
            {showModelWarning && (
              <p className="text-xs text-amber-400">
                {'\u26A0'} Current model is English-only. Download a multilingual model in Settings to transcribe other
                languages.
              </p>
            )}
            {selectedTemplate !== 'none' && (
              <div className="text-xs text-surface-400 space-y-0.5">
                <span className="font-medium">Suggested agenda:</span>
                {MEETING_TEMPLATES.find((t) => t.type === selectedTemplate)?.agenda.map((item, i) => (
                  <div key={i}>
                    {'\u2022'} {item}
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => setIncludeMic(!includeMic)}
              disabled={starting}
              className={`flex items-center gap-2 w-full rounded-lg px-3 py-2 text-sm
                        border transition-colors
                        ${
                          includeMic
                            ? 'bg-surface-800 border-primary-600 text-surface-800 dark:text-surface-200'
                            : 'bg-surface-100 dark:bg-surface-900 border-surface-300 dark:border-surface-600 text-surface-500'
                        }
                        disabled:opacity-50 disabled:cursor-not-allowed
                        hover:border-primary-500`}
            >
              {includeMic ? <Mic size={16} /> : <MicOff size={16} />}
              <span className="text-xs">{includeMic ? 'Microphone on' : 'Microphone off'}</span>
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
              <p className="text-xs text-amber-400">No Whisper model — recordings won't have transcription.</p>
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
              <span className="text-lg font-data text-[var(--color-accent)] text-glow">{formatElapsed(elapsed)}</span>
            </div>
            {/* Render exactly one visible meter: the full-screen LiveModeOverlay owns
                it while active, so this sidebar instance only mounts when Live Mode is
                minimized. Conditional mounting also re-registers audioCaptureService's
                single onAudioLevel callback on minimize, so this meter shows live levels
                instead of freezing on the overlay meter's last value. */}
            {(!isRecording || liveModeMinimized) && <AudioLevelMeter />}
            <div className="flex gap-2">
              <button
                onClick={handleStop}
                className="flex-1 flex items-center justify-center gap-2 bg-surface-700
                         hover:bg-surface-600 text-surface-800 dark:text-surface-200 rounded-lg px-3 py-2
                         text-sm font-medium transition-colors"
              >
                <Square size={14} />
                Stop & Save
              </button>
              <button
                onClick={() => setCancelConfirmOpen(true)}
                className="flex items-center justify-center gap-2 bg-transparent border border-surface-600
                         hover:border-red-500 hover:text-red-400 text-surface-400 rounded-lg px-3 py-2
                         text-sm transition-colors"
                title="Cancel recording without saving"
              >
                <X size={14} />
                Cancel
              </button>
            </div>
          </div>
        )}
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
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
      <ConfirmDialog
        open={cancelConfirmOpen}
        title="Cancel Recording"
        message="Cancel this recording? It will not be saved or processed."
        confirmLabel="Cancel Recording"
        variant="danger"
        onConfirm={async () => {
          setCancelConfirmOpen(false);
          await cancelRecording();
        }}
        onCancel={() => setCancelConfirmOpen(false)}
      />
    </>
  );
}
