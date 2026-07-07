// === FILE PURPOSE ===
// Sessions Home — the app's default route (V3.1 session-centric pivot).
// Adapted from the former MeetingsModern: same list internals (sort, recording
// controls, meeting cards, detail modal), plus a pinned live-session card while
// recording. This is the only browse surface — no separate Library. The former
// local title-only filter box is now SessionSearch (Task 6) -- a debounced,
// full-text search across sessions/cards/projects that navigates to a result
// rather than filtering this page's grid in place.

import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Mic, Info, X, ArrowDownWideNarrow, Sparkles } from 'lucide-react';
import EmptyFeatureState from './EmptyFeatureState';
import HudSelect from './HudSelect';
import { useMeetingStore } from '../stores/meetingStore';
import { useRecordingStore } from '../stores/recordingStore';
import { useProjectStore } from '../stores/projectStore';
import RecordingControls from '../components/RecordingControls';
import MeetingCardModern from '../components/MeetingCardModern';
import LoadingSpinner from '../components/LoadingSpinner';
import HudBackground from './HudBackground';
import { ConfirmDialog } from './ConfirmDialog';
import FeatureTip from './FeatureTip';
import LiveSessionPin from './LiveSessionPin';
import SessionSearch from './SessionSearch';

type SortOption = 'newest' | 'oldest' | 'title';

export default function SessionsHome() {
  const meetings = useMeetingStore((s) => s.meetings);
  const loading = useMeetingStore((s) => s.loading);
  const error = useMeetingStore((s) => s.error);
  const loadMeetings = useMeetingStore((s) => s.loadMeetings);
  const deleteMeeting = useMeetingStore((s) => s.deleteMeeting);
  const actionItemCounts = useMeetingStore((s) => s.actionItemCounts);
  const loadActionItemCounts = useMeetingStore((s) => s.loadActionItemCounts);
  const isRecording = useRecordingStore((s) => s.isRecording);
  const liveMeetingId = useRecordingStore((s) => s.meetingId);
  const liveElapsed = useRecordingStore((s) => s.elapsed);
  const restoreLiveMode = useRecordingStore((s) => s.restoreLiveMode);
  const completedMeetingId = useRecordingStore((s) => s.completedMeetingId);
  const clearCompletedMeetingId = useRecordingStore((s) => s.clearCompletedMeetingId);
  const projects = useProjectStore((s) => s.projects);
  const loadProjects = useProjectStore((s) => s.loadProjects);
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [deleteMeetingConfirm, setDeleteMeetingConfirm] = useState<{ id: string; title: string } | null>(null);
  const prevIsRecording = useRef(isRecording);
  const [hasModel, setHasModel] = useState<boolean | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [showControls, setShowControls] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [showTurboBanner, setShowTurboBanner] = useState(false);

  // Legacy deep link: ?openMeeting=<id> (routed through /meetings) now redirects to
  // the routed session page. Preserves external bookmarks that predate /session/:id.
  useEffect(() => {
    const openMeetingId = searchParams.get('openMeeting');
    if (openMeetingId) {
      const tsSearch = searchParams.get('transcriptSearch');
      const query = tsSearch ? `?transcriptSearch=${encodeURIComponent(tsSearch)}` : '';
      navigate(`/session/${openMeetingId}${query}`, { replace: true });
    }
  }, [searchParams, navigate]);

  // Handle ?action=record — just clear the param (recording controls are always visible)
  // Handle ?action=record
  useEffect(() => {
    if (searchParams.get('action') === 'record') {
      setShowControls(true);
      searchParams.delete('action');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Load meetings and projects on mount
  useEffect(() => {
    loadMeetings();
    loadProjects();
  }, [loadMeetings, loadProjects]);

  // Load action item counts once meetings are available
  useEffect(() => {
    if (meetings.length > 0) {
      loadActionItemCounts();
    }
  }, [meetings.length, loadActionItemCounts]);

  // Check if whisper model is available
  useEffect(() => {
    window.electronAPI.hasWhisperModel().then(setHasModel);
  }, []);

  // Check whether to show the large-v3-turbo recommendation banner
  useEffect(() => {
    const TURBO_FILE = 'ggml-large-v3-turbo-q5_0.bin';
    const TURBO_LANGUAGES = new Set(['cs', 'sk', 'cs-mix', 'sk-mix', 'en-mix']);
    async function checkTurboBanner() {
      const [config, language, models, dismissed] = await Promise.all([
        window.electronAPI.transcriptionGetConfig(),
        window.electronAPI.getSetting('transcription:language'),
        window.electronAPI.getWhisperModels(),
        window.electronAPI.getSetting('ui:banner:turbo-recommendation:dismissed'),
      ]);
      if (
        config.type === 'local' &&
        language !== null &&
        TURBO_LANGUAGES.has(language) &&
        !models.some((m) => m.fileName === TURBO_FILE && m.available) &&
        dismissed !== 'true'
      ) {
        setShowTurboBanner(true);
      }
    }
    checkTurboBanner().catch(() => {
      // Non-critical: silently skip banner on error
    });
  }, []);

  // Refresh meetings list when recording stops
  useEffect(() => {
    if (prevIsRecording.current && !isRecording) {
      loadMeetings();
    }
    prevIsRecording.current = isRecording;
  }, [isRecording, loadMeetings]);

  // Auto-open the session page when a recording finishes processing. The
  // ?autoGenerate=1 flag tells SessionWorkspace to auto-generate brief + actions.
  useEffect(() => {
    if (completedMeetingId) {
      const meetingId = completedMeetingId;
      clearCompletedMeetingId();
      navigate(`/session/${meetingId}?autoGenerate=1`);
    }
  }, [completedMeetingId, clearCompletedMeetingId, navigate]);

  // Download whisper model
  const handleDownloadModel = async () => {
    setDownloading(true);
    const cleanup = window.electronAPI.onWhisperDownloadProgress((progress) => {
      setDownloadProgress(progress.percent);
    });
    try {
      await window.electronAPI.downloadWhisperModel('ggml-base.en.bin');
      setHasModel(true);
    } catch {
      // Download failed - user can retry
    } finally {
      setDownloading(false);
      cleanup();
    }
  };

  // Dismiss the turbo model recommendation banner
  const handleDismissTurboBanner = async () => {
    setShowTurboBanner(false);
    await window.electronAPI.setSetting('ui:banner:turbo-recommendation:dismissed', 'true');
  };

  // Build project name and color lookup maps
  const projectNameMap = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  const projectColorMap = useMemo(() => {
    const map = new Map<string, string>();
    projects.forEach((p) => map.set(p.id, p.color ?? '#6366f1'));
    return map;
  }, [projects]);

  // Pinned live-session lookup (mirrors LiveModeOverlay's title/project resolution)
  const liveMeeting = liveMeetingId ? meetings.find((m) => m.id === liveMeetingId) : undefined;
  const liveProject = liveMeeting?.projectId ? projects.find((p) => p.id === liveMeeting.projectId) : undefined;

  // Session rows navigate to the routed session page (/session/:id). The modal
  // is retired — the whole detail view is a full page now.
  const handleSessionRowClick = useCallback(
    (meetingId: string) => {
      navigate(`/session/${meetingId}`);
    },
    [navigate],
  );

  // Sort meetings (filtering is now SessionSearch's job — it navigates to a
  // result rather than filtering this grid in place; see Task 6).
  const sortedMeetings = useMemo(() => {
    return [...meetings].sort((a, b) => {
      if (sortBy === 'newest') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (sortBy === 'oldest') return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return a.title.localeCompare(b.title);
    });
  }, [meetings, sortBy]);

  if (loading && meetings.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-surface-50/50 dark:bg-surface-950 relative">
      <HudBackground />
      {/* HUD Header */}
      <div className="p-8 pb-4 shrink-0">
        <div className="flex items-center justify-between gap-4 mb-2">
          <div>
            <div className="flex items-center gap-4 mb-1">
              <span
                className="font-data text-[0.6875rem] tracking-[0.3em] text-[var(--color-accent)] text-glow"
                aria-hidden="true"
              >
                SYS.SESSIONS
              </span>
              <div className="h-px w-16 bg-gradient-to-l from-transparent to-[var(--color-accent)] opacity-40" />
            </div>
            <h1 className="font-hud text-2xl text-[var(--color-accent)] text-glow">Sessions</h1>
            <p className="text-[var(--color-text-secondary)] text-sm mt-1">Capture and analyze conversations.</p>
          </div>

          <div className="flex items-center gap-3">
            <FeatureTip.Button id="meetings" />
            <button
              onClick={() => setShowControls(!showControls)}
              disabled={isRecording}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
                showControls || isRecording
                  ? 'bg-[var(--color-accent-subtle)] border border-[var(--color-border-accent)] text-[var(--color-text-primary)] cursor-default'
                  : 'bg-[var(--color-accent-muted)] hover:bg-[var(--color-accent-dim)] text-[var(--color-accent)] border border-[var(--color-border-accent)] shadow-md hover:shadow-lg'
              }`}
            >
              {isRecording ? (
                <>
                  <div className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
                  <span>Recording...</span>
                </>
              ) : showControls ? (
                <>
                  <X size={18} />
                  <span>Close Recorder</span>
                </>
              ) : (
                <>
                  <Mic size={18} />
                  <span>New Recording</span>
                </>
              )}
            </button>
          </div>
        </div>

        <FeatureTip id="meetings" title="How meeting intelligence works">
          Record any meeting by capturing system audio — works with Zoom, Teams, Google Meet, or any app. Audio is
          transcribed in real-time using Whisper (local) or cloud providers. After recording, AI generates a summary and
          extracts action items that you can convert into project cards with one click.
        </FeatureTip>

        <div className="mb-6" />
        {/* Collapsible Recording Area */}
        {(showControls || isRecording) && (
          <div className="mb-8 animate-in fade-in slide-in-from-top-4 duration-300">
            <div className="max-w-2xl mx-auto shadow-2xl rounded-xl overflow-hidden ring-1 ring-surface-950/5">
              <RecordingControls hasModel={hasModel} />
            </div>
          </div>
        )}

        {/* Filters & Search Toolbar */}
        <div className="flex hud-panel p-1.5 rounded-xl items-center gap-2 mb-2">
          <SessionSearch />

          <div className="h-6 w-px bg-[var(--color-border)] mx-1" />

          <div className="w-[130px] shrink-0">
            <HudSelect
              value={sortBy}
              onChange={(v) => setSortBy(v as typeof sortBy)}
              icon={ArrowDownWideNarrow}
              compact
              options={[
                { value: 'newest', label: 'Newest' },
                { value: 'oldest', label: 'Oldest' },
                { value: 'title', label: 'A-Z' },
              ]}
            />
          </div>
        </div>
      </div>

      {hasModel === false && (
        <div className="px-8 mb-4">
          <div className="p-4 rounded-xl bg-[var(--color-accent-subtle)] border border-[var(--color-border-accent)] flex items-start gap-3">
            <Info size={18} className="text-[var(--color-accent)] mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-[var(--color-text-primary)]">Set up AI transcription</p>
              <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                Configure a transcription model in Settings to get AI-powered meeting summaries.
              </p>
              {downloading ? (
                <div className="mt-3 w-full max-w-xs">
                  <div className="h-1.5 bg-[var(--color-border)] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[var(--color-accent)] transition-all duration-300"
                      style={{ width: `${downloadProgress}%` }}
                    />
                  </div>
                  <p className="text-[0.625rem] text-[var(--color-accent)] mt-1 font-medium">
                    {downloadProgress}% Downloaded
                  </p>
                </div>
              ) : (
                <button
                  onClick={handleDownloadModel}
                  className="text-xs font-semibold text-[var(--color-accent)] hover:text-[var(--color-accent-dim)] mt-2 flex items-center gap-1"
                >
                  Download Model (74 MB)
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showTurboBanner && (
        <div className="px-8 mb-4">
          <div className="p-4 rounded-xl bg-[var(--color-accent-subtle)] border border-[var(--color-border-accent)] flex items-start gap-3">
            <Sparkles size={18} className="text-[var(--color-accent)] mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-[var(--color-text-primary)]">
                Better Czech/Slovak transcription available
              </p>
              <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                Download the large-v3-turbo model (~874 MB) in Settings → General → Transcription for much higher
                accuracy on Czech, Slovak, and mixed-language meetings.
              </p>
              <div className="flex items-center gap-4 mt-2">
                <button
                  onClick={() => navigate('/settings?tab=general')}
                  className="text-xs font-semibold text-[var(--color-accent)] hover:text-[var(--color-accent-dim)] flex items-center gap-1"
                >
                  Open Settings
                </button>
                <button
                  onClick={handleDismissTurboBanner}
                  className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="px-8 mb-4">
          <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        {/* Pinned live-session card — shown while recording, above the sessions list */}
        {isRecording && (
          <LiveSessionPin
            title={liveMeeting?.title ?? 'Live Session'}
            projectName={liveProject?.name}
            elapsed={liveElapsed}
            onReturnToLive={restoreLiveMode}
          />
        )}

        {sortedMeetings.length === 0 ? (
          <div className="mt-20">
            <EmptyFeatureState
              icon={Mic}
              title="Capture every meeting, privately"
              description="Record any meeting, get automatic transcripts and AI summaries, and push action items straight to your project board. Your recordings never leave your machine."
              benefits={[
                'Private — all audio stays on your device',
                'AI briefs and action items in seconds',
                'One-click push to project boards',
              ]}
              ctaLabel="Record Your First Meeting"
              ctaAction={() => setShowControls(true)}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {sortedMeetings.map((meeting) => (
              <MeetingCardModern
                key={meeting.id}
                meeting={meeting}
                projectName={meeting.projectId ? projectNameMap.get(meeting.projectId) : undefined}
                projectColor={meeting.projectId ? projectColorMap.get(meeting.projectId) : undefined}
                actionItemCount={actionItemCounts[meeting.id] || 0}
                onClick={() => handleSessionRowClick(meeting.id)}
                onDelete={() => setDeleteMeetingConfirm({ id: meeting.id, title: meeting.title })}
              />
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteMeetingConfirm}
        title="Delete Meeting"
        message={deleteMeetingConfirm ? `Delete "${deleteMeetingConfirm.title}"? This cannot be undone.` : ''}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          if (deleteMeetingConfirm) {
            deleteMeeting(deleteMeetingConfirm.id);
            setDeleteMeetingConfirm(null);
          }
        }}
        onCancel={() => setDeleteMeetingConfirm(null)}
      />
    </div>
  );
}
