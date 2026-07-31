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
import { Mic, Info, X, ArrowDownWideNarrow, Sparkles, Calendar, RefreshCw } from 'lucide-react';
import type { CalendarEvent } from '../../shared/types/calendar';
import { CALENDAR_LOOKAHEAD_HOURS } from '../../shared/types/calendar';
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

// Ribbon qualification window: an event qualifies when it starts within the next
// 15 min OR started less than 10 min ago (still joinable / in progress).
const RIBBON_UPCOMING_MINUTES = 15;
const RIBBON_IN_PROGRESS_MINUTES = 10;

/** Human copy for the ribbon based on how far off the event start is. */
function ribbonTiming(startsAt: string): { label: string; inProgress: boolean } {
  const diffMin = (new Date(startsAt).getTime() - Date.now()) / 60000;
  if (diffMin < 0) return { label: 'in progress', inProgress: true };
  const n = Math.round(diffMin);
  return { label: n <= 0 ? 'starting now' : `starts in ${n} min`, inProgress: false };
}

/** Row-level "when" label — the day now lives in the group header above the row. */
function formatEventWhen(startsAt: string): string {
  const d = new Date(startsAt);
  const diffMin = (d.getTime() - Date.now()) / 60000;
  if (diffMin < 0) return 'in progress';
  if (diffMin < 60) return `in ${Math.max(1, Math.round(diffMin))} min`;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Midnight-of-day epoch, so day grouping ignores clock time. */
function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Day-group header for the upcoming list: Today / Tomorrow / weekday name within
 * the next week, else a short date (the window is 7 days, so the date is a fallback
 * for events sitting exactly on the far edge).
 */
function formatEventDayGroup(startsAt: string): string {
  const d = new Date(startsAt);
  const dayDiff = Math.round((startOfDay(d) - startOfDay(new Date())) / 86_400_000);
  if (dayDiff <= 0) return 'Today';
  if (dayDiff === 1) return 'Tomorrow';
  if (dayDiff < 7) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** Max events shown in the upcoming-meetings list (keeps the home view compact). */
const UPCOMING_LIST_LIMIT = 12;

/** One day bucket of the upcoming-meetings list. */
interface UpcomingDayGroup {
  label: string;
  events: CalendarEvent[];
}

/**
 * The persistent agenda panel (CAL-UX.1). Rendered whenever a calendar is connected,
 * so an empty 7-day window shows an empty state instead of the section disappearing.
 * NEVER auto-records — every row needs an explicit click.
 */
function UpcomingAgenda({
  groups,
  onStart,
  onRefresh,
  refreshing,
  refreshError,
}: {
  groups: UpcomingDayGroup[];
  onStart: (event: CalendarEvent) => void;
  onRefresh: () => void;
  refreshing: boolean;
  refreshError: string | null;
}) {
  return (
    <div className="px-8 mb-4">
      <div className="rounded-xl border border-[var(--color-border)] bg-surface-50/60 dark:bg-surface-900/40 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--color-border)]">
          <Calendar size={14} className="text-[var(--color-accent-dim)]" />
          <span className="font-hud text-[0.6875rem] tracking-widest uppercase text-[var(--color-accent-dim)]">
            Upcoming meetings
          </span>
          <button
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh calendar"
            title="Sync now with your calendar"
            className="ml-auto shrink-0 p-1 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-accent)]
                   hover:bg-surface-100/80 dark:hover:bg-surface-800/80 transition-colors disabled:opacity-60"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : undefined} />
          </button>
        </div>
        {refreshError && (
          <p className="px-4 py-1.5 border-b border-[var(--color-border)] text-xs text-red-400">{refreshError}</p>
        )}
        {groups.length === 0 ? (
          <p className="px-4 py-3 text-xs text-[var(--color-text-muted)]">No meetings in the next 7 days.</p>
        ) : (
          groups.map((group) => (
            <div key={group.label}>
              <p className="px-4 py-1.5 border-b border-[var(--color-border)] bg-surface-100/60 dark:bg-surface-900/60 font-hud text-[0.625rem] tracking-widest uppercase text-[var(--color-text-muted)]">
                {group.label}
              </p>
              <ul>
                {group.events.map((ev) => (
                  <li
                    key={ev.id}
                    className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--color-border)] last:border-b-0"
                  >
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <p className="text-sm text-[var(--color-text-primary)] truncate">{ev.title}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{formatEventWhen(ev.startsAt)}</p>
                    </div>
                    <button
                      onClick={() => onStart(ev)}
                      aria-label={`Start recording for ${ev.title}`}
                      className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium
                             bg-[var(--color-accent-muted)] hover:bg-[var(--color-accent-dim)] text-[var(--color-accent)]
                             border border-[var(--color-border-accent)] transition-colors"
                    >
                      <Mic size={13} />
                      Record
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

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
  // Calendar ribbon state (Phase G Task 4): cached upcoming events, per-event
  // dismissals, and the event chosen to prefill the recorder.
  const [upcomingEvents, setUpcomingEvents] = useState<CalendarEvent[]>([]);
  const [dismissedEventIds, setDismissedEventIds] = useState<Set<string>>(new Set());
  const [prefillEvent, setPrefillEvent] = useState<CalendarEvent | undefined>(undefined);
  // CAL-UX.1: true when at least one provider is connected — keeps the agenda
  // section on screen (with an empty state) even when the window has no events.
  const [calendarConnected, setCalendarConnected] = useState(false);

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

  // Calendar ribbon + agenda (Phase G Task 4, widened in CAL-UX.1): load the cached
  // events for the shared lookahead window AND the connection status on mount, then
  // refresh both whenever the poller pushes 'calendar:events-updated'. Guarded so the
  // page still works if the calendar API is unavailable (older preload / tests).
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      window.electronAPI
        .getCalendarStatus?.()
        .then((statuses) => {
          if (!cancelled) setCalendarConnected(statuses.some((s) => s.connected));
        })
        .catch(() => {
          // Non-critical — fall back to "not connected" (list-only rendering).
        });
      if (!window.electronAPI.getUpcomingCalendarEvents) return;
      window.electronAPI
        .getUpcomingCalendarEvents(CALENDAR_LOOKAHEAD_HOURS)
        .then((events) => {
          if (!cancelled) setUpcomingEvents(events);
        })
        .catch(() => {
          // Non-critical — leave the ribbon hidden on error.
        });
    };
    refresh();
    const unsubscribe = window.electronAPI.onCalendarEventsUpdated?.(refresh);
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
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

  // The single event the ribbon should surface: the earliest non-dismissed cached
  // event inside the qualification window. upcomingEvents is already start-ordered.
  const ribbonEvent = useMemo(() => {
    return upcomingEvents.find((ev) => {
      if (dismissedEventIds.has(ev.id)) return false;
      const diffMin = (new Date(ev.startsAt).getTime() - Date.now()) / 60000;
      return diffMin <= RIBBON_UPCOMING_MINUTES && diffMin > -RIBBON_IN_PROGRESS_MINUTES;
    });
  }, [upcomingEvents, dismissedEventIds]);

  // The always-visible upcoming-meetings list: cached events for the whole lookahead
  // window, excluding the one already surfaced in the ribbon and any dismissed,
  // capped for a compact view.
  const upcomingList = useMemo(() => {
    return upcomingEvents
      .filter((ev) => !dismissedEventIds.has(ev.id) && ev.id !== ribbonEvent?.id)
      .slice(0, UPCOMING_LIST_LIMIT);
  }, [upcomingEvents, dismissedEventIds, ribbonEvent]);

  // Day buckets for the list (events are already start-ordered, so consecutive rows
  // sharing a label belong to the same day group).
  const upcomingGroups = useMemo(() => {
    const groups: UpcomingDayGroup[] = [];
    for (const ev of upcomingList) {
      const label = formatEventDayGroup(ev.startsAt);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.events.push(ev);
      else groups.push({ label, events: [ev] });
    }
    return groups;
  }, [upcomingList]);

  // Ribbon "Start recording": open the recorder prefilled with this event.
  const handleStartFromEvent = useCallback((event: CalendarEvent) => {
    setPrefillEvent(event);
    setShowControls(true);
  }, []);

  // Manual agenda refresh: poll-now mirrors the calendar (replace-based in main, so
  // events deleted upstream disappear too); the events-updated push reloads the list.
  const [refreshingCalendar, setRefreshingCalendar] = useState(false);
  const [calendarRefreshError, setCalendarRefreshError] = useState<string | null>(null);
  const handleRefreshCalendar = useCallback(() => {
    if (!window.electronAPI.pollCalendarNow) return;
    setRefreshingCalendar(true);
    setCalendarRefreshError(null);
    window.electronAPI
      .pollCalendarNow()
      .catch(() => setCalendarRefreshError('Refresh failed — check your calendar connection in Settings.'))
      .finally(() => setRefreshingCalendar(false));
  }, []);

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
              <RecordingControls hasModel={hasModel} initialCalendarEvent={prefillEvent} />
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

      {/* Calendar upcoming-event ribbon (Phase G Task 4) — one-click prefilled
          recording. Hidden while recording (the recorder is already the focus) and
          when no cached event qualifies. NEVER auto-records — explicit click only. */}
      {!isRecording && ribbonEvent && (
        <div className="px-8 mb-4">
          <div className="p-4 rounded-xl bg-[var(--color-accent-subtle)] border border-[var(--color-border-accent)] flex items-center gap-3">
            <Calendar size={18} className="text-[var(--color-accent)] shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                {'📅'} {ribbonEvent.title} — {ribbonTiming(ribbonEvent.startsAt).label}
              </p>
            </div>
            <button
              onClick={() => handleStartFromEvent(ribbonEvent)}
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                       bg-[var(--color-accent-muted)] hover:bg-[var(--color-accent-dim)] text-[var(--color-accent)]
                       border border-[var(--color-border-accent)] transition-colors"
            >
              <Mic size={14} />
              Start recording
            </button>
            <button
              onClick={() => setDismissedEventIds((prev) => new Set(prev).add(ribbonEvent.id))}
              aria-label="Dismiss upcoming event"
              className="shrink-0 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Upcoming meetings list (Phase G follow-on, CAL-UX.1) — persistent whenever a
          calendar is connected: it keeps its header and shows an empty state rather than
          vanishing when the 7-day window holds no events. Rows are grouped by day and
          exclude the event already shown in the ribbon above. Hidden while recording
          (the recorder is the focus). NEVER auto-records — explicit click only. */}
      {!isRecording && (calendarConnected || upcomingList.length > 0) && (
        <UpcomingAgenda
          groups={upcomingGroups}
          onStart={handleStartFromEvent}
          onRefresh={handleRefreshCalendar}
          refreshing={refreshingCalendar}
          refreshError={calendarRefreshError}
        />
      )}

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
