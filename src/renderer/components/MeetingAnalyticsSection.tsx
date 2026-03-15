// === FILE PURPOSE ===
// Meeting analytics section — shows duration, word count, speaker breakdown,
// action item summary, and "Identify Speakers" diarization trigger.
//
// === DEPENDENCIES ===
// react, lucide-react, meetingStore, MeetingAnalytics type

import { useEffect } from 'react';
import { BarChart3, Users, Clock, MessageSquare, Loader2 } from 'lucide-react';
import { useMeetingStore } from '../stores/meetingStore';

interface MeetingAnalyticsSectionProps {
  meetingId: string;
  isCompleted: boolean;
}

// Speaker color palette — consistent between transcript labels and analytics bars
const SPEAKER_COLORS = [
  { bg: 'bg-blue-500', text: 'text-blue-400', bar: 'bg-blue-500/70' },
  { bg: 'bg-emerald-500', text: 'text-emerald-400', bar: 'bg-emerald-500/70' },
  { bg: 'bg-amber-500', text: 'text-amber-400', bar: 'bg-amber-500/70' },
  { bg: 'bg-purple-500', text: 'text-purple-400', bar: 'bg-purple-500/70' },
  { bg: 'bg-rose-500', text: 'text-rose-400', bar: 'bg-rose-500/70' },
  { bg: 'bg-cyan-500', text: 'text-cyan-400', bar: 'bg-cyan-500/70' },
];

/** Get color scheme for a speaker label. Exported for reuse in transcript display. */
export function getSpeakerColor(speaker: string): (typeof SPEAKER_COLORS)[0] {
  // Extract number from "Speaker N" to get consistent colors
  const match = speaker.match(/(\d+)$/);
  const index = match ? (parseInt(match[1], 10) - 1) % SPEAKER_COLORS.length : 0;
  return SPEAKER_COLORS[index];
}

/** Format milliseconds as "Xh Ym Zs" or "Ym Zs" or "Zs" */
function formatDurationLong(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export default function MeetingAnalyticsSection({ meetingId, isCompleted }: MeetingAnalyticsSectionProps) {
  const analytics = useMeetingStore((s) => s.analytics);
  const analyticsLoading = useMeetingStore((s) => s.analyticsLoading);
  const diarizing = useMeetingStore((s) => s.diarizing);
  const diarizationError = useMeetingStore((s) => s.diarizationError);
  const loadAnalytics = useMeetingStore((s) => s.loadAnalytics);
  const diarizeMeeting = useMeetingStore((s) => s.diarizeMeeting);

  // Load analytics on mount
  useEffect(() => {
    if (isCompleted) {
      loadAnalytics(meetingId);
    }
  }, [meetingId, isCompleted, loadAnalytics]);

  if (!isCompleted) return null;

  if (analyticsLoading && !analytics) {
    return (
      <div>
        <h3 className="text-sm font-medium text-surface-700 dark:text-surface-300 mb-2 flex items-center gap-1.5">
          <BarChart3 size={14} />
          Meeting Analytics
        </h3>
        <div className="flex items-center gap-2 text-surface-400 text-sm">
          <Loader2 size={14} className="animate-spin" />
          Loading analytics...
        </div>
      </div>
    );
  }

  if (!analytics) return null;

  return (
    <div>
      <h3 className="font-hud text-xs text-[var(--color-accent)] text-glow mb-4 flex items-center gap-2">
        <BarChart3 size={16} />
        Meeting Analytics
      </h3>

      <div className="hud-panel clip-corner-cut-sm p-5 space-y-6">
        {/* Top stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          <div className="bg-surface-100/50 dark:bg-surface-950/50 rounded-xl p-3 border border-[var(--color-border)]">
            <div className="flex items-center justify-center gap-1.5 font-hud text-[0.625rem] text-[var(--color-text-muted)] mb-1">
              <Clock size={14} />
              Duration
            </div>
            <div className="font-data text-[var(--color-accent)] text-xl font-bold tracking-tight text-center">
              {formatDurationLong(analytics.durationMs)}
            </div>
          </div>
          <div className="bg-surface-100/50 dark:bg-surface-950/50 rounded-xl p-3 border border-[var(--color-border)]">
            <div className="font-hud text-[0.625rem] text-[var(--color-text-muted)] mb-1 text-center">Segments</div>
            <div className="font-data text-[var(--color-text-primary)] text-xl font-bold tracking-tight text-center">
              {analytics.totalSegments.toLocaleString()}
            </div>
          </div>
          <div className="bg-surface-100/50 dark:bg-surface-950/50 rounded-xl p-3 border border-[var(--color-border)]">
            <div className="font-hud text-[0.625rem] text-[var(--color-text-muted)] mb-1 text-center">Words</div>
            <div className="font-data text-[var(--color-text-primary)] text-xl font-bold tracking-tight text-center">
              {analytics.totalWords.toLocaleString()}
            </div>
          </div>
          <div className="bg-surface-100/50 dark:bg-surface-950/50 rounded-xl p-3 border border-[var(--color-border)]">
            <div className="font-hud text-[0.625rem] text-[var(--color-text-muted)] mb-1 text-center">WPM</div>
            <div className="font-data text-[var(--color-text-primary)] text-xl font-bold tracking-tight text-center">
              {analytics.wordsPerMinute}
            </div>
          </div>
        </div>

        {/* Speaker breakdown */}
        {analytics.hasDiarization ? (
          <div className="pt-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-surface-700 dark:text-surface-300 mb-4">
              <Users size={16} className="text-surface-400" />
              Speaker Breakdown
            </div>
            <div className="space-y-4">
              {analytics.speakers.map((spkr) => {
                const color = getSpeakerColor(spkr.speaker);
                return (
                  <div key={spkr.speaker} className="group">
                    <div className="flex flex-wrap items-end justify-between text-sm mb-2 gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-bold ${color.bg.replace('bg-', 'bg-').replace('-500', '-500/10')} ${color.text}`}
                        >
                          {spkr.speaker}
                        </span>
                        <span className="text-surface-600 dark:text-surface-300 font-medium">
                          {spkr.talkTimePercent}%
                        </span>
                      </div>
                      <span className="text-surface-400 text-xs font-medium">
                        {spkr.wordCount.toLocaleString()} words &middot; {formatDurationLong(spkr.talkTimeMs)}
                      </span>
                    </div>
                    <div className="h-2.5 bg-surface-100 dark:bg-surface-800 rounded-full overflow-hidden border border-surface-200 dark:border-surface-700/50">
                      <div
                        className={`h-full ${color.bg} rounded-full transition-all duration-1000 ease-out`}
                        style={{ width: `${spkr.talkTimePercent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="pt-2 border-t border-surface-100 dark:border-surface-700/50 mt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-surface-700 dark:text-surface-300">
                <Users size={16} className="text-surface-400" />
                Speaker Data
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-surface-500">Not available</span>
                <button
                  onClick={() => diarizeMeeting(meetingId)}
                  disabled={diarizing}
                  className="bg-primary-50 dark:bg-primary-500/10 text-primary-600 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-500/20 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {diarizing ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      Identifying...
                    </>
                  ) : (
                    'Identify Speakers'
                  )}
                </button>
              </div>
            </div>
            {diarizationError && (
              <p className="text-sm text-red-500 dark:text-red-400 mt-2 bg-red-50 dark:bg-red-500/10 p-2 rounded-md">
                {diarizationError}
              </p>
            )}
          </div>
        )}

        {/* Action item counts */}
        {analytics.actionItemCounts.total > 0 && (
          <div className="pt-6 border-t border-surface-100 dark:border-surface-700/50 mt-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-surface-700 dark:text-surface-300 mb-3">
              <MessageSquare size={16} className="text-surface-400" />
              Action Items Profile
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="bg-surface-100 dark:bg-surface-700 text-surface-800 dark:text-surface-200 text-xs font-bold px-3 py-1.5 rounded-lg border border-surface-200 dark:border-surface-600">
                Total: {analytics.actionItemCounts.total}
              </span>
              {analytics.actionItemCounts.pending > 0 && (
                <span className="bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-bold px-3 py-1.5 rounded-lg border border-amber-200 dark:border-amber-500/20">
                  Pending: {analytics.actionItemCounts.pending}
                </span>
              )}
              {analytics.actionItemCounts.approved > 0 && (
                <span className="bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-bold px-3 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-500/20">
                  Approved: {analytics.actionItemCounts.approved}
                </span>
              )}
              {analytics.actionItemCounts.dismissed > 0 && (
                <span className="bg-surface-100 dark:bg-surface-800 text-surface-500 dark:text-surface-400 text-xs font-bold px-3 py-1.5 rounded-lg border border-surface-200 dark:border-surface-700">
                  Dismissed: {analytics.actionItemCounts.dismissed}
                </span>
              )}
              {analytics.actionItemCounts.converted > 0 && (
                <span className="bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-bold px-3 py-1.5 rounded-lg border border-blue-200 dark:border-blue-500/20">
                  Converted: {analytics.actionItemCounts.converted}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
