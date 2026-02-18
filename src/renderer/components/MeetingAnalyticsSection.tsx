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
export function getSpeakerColor(speaker: string): typeof SPEAKER_COLORS[0] {
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

export default function MeetingAnalyticsSection({
  meetingId,
  isCompleted,
}: MeetingAnalyticsSectionProps) {
  const analytics = useMeetingStore(s => s.analytics);
  const analyticsLoading = useMeetingStore(s => s.analyticsLoading);
  const diarizing = useMeetingStore(s => s.diarizing);
  const diarizationError = useMeetingStore(s => s.diarizationError);
  const loadAnalytics = useMeetingStore(s => s.loadAnalytics);
  const diarizeMeeting = useMeetingStore(s => s.diarizeMeeting);

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
      <h3 className="text-sm font-medium text-surface-700 dark:text-surface-300 mb-2 flex items-center gap-1.5">
        <BarChart3 size={14} />
        Meeting Analytics
      </h3>

      <div className="bg-surface-100/50 dark:bg-surface-800/50 border border-surface-200 dark:border-surface-700 rounded-lg p-3 space-y-4">
        {/* Top stats row */}
        <div className="grid grid-cols-4 gap-3 text-center">
          <div>
            <div className="flex items-center justify-center gap-1 text-surface-400 text-xs mb-1">
              <Clock size={12} />
              Duration
            </div>
            <div className="text-surface-800 dark:text-surface-200 text-sm font-medium">
              {formatDurationLong(analytics.durationMs)}
            </div>
          </div>
          <div>
            <div className="text-surface-400 text-xs mb-1">Segments</div>
            <div className="text-surface-800 dark:text-surface-200 text-sm font-medium">
              {analytics.totalSegments.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-surface-400 text-xs mb-1">Words</div>
            <div className="text-surface-800 dark:text-surface-200 text-sm font-medium">
              {analytics.totalWords.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-surface-400 text-xs mb-1">WPM</div>
            <div className="text-surface-800 dark:text-surface-200 text-sm font-medium">
              {analytics.wordsPerMinute}
            </div>
          </div>
        </div>

        {/* Speaker breakdown */}
        {analytics.hasDiarization ? (
          <div>
            <div className="flex items-center gap-1.5 text-xs text-surface-400 mb-2">
              <Users size={12} />
              Speaker Breakdown
            </div>
            <div className="space-y-2">
              {analytics.speakers.map((spkr) => {
                const color = getSpeakerColor(spkr.speaker);
                return (
                  <div key={spkr.speaker}>
                    <div className="flex items-center justify-between text-xs mb-0.5">
                      <span className={`font-medium ${color.text}`}>{spkr.speaker}</span>
                      <span className="text-surface-400">
                        {spkr.talkTimePercent}% &middot; {spkr.wordCount.toLocaleString()} words &middot; {formatDurationLong(spkr.talkTimeMs)}
                      </span>
                    </div>
                    <div className="h-2 bg-surface-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${color.bar} rounded-full transition-all`}
                        style={{ width: `${spkr.talkTimePercent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-1.5 text-xs text-surface-400 mb-2">
              <Users size={12} />
              Speaker Data
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-surface-500">
                Speaker data not available.
              </span>
              <button
                onClick={() => diarizeMeeting(meetingId)}
                disabled={diarizing}
                className="text-xs text-primary-400 hover:text-primary-300 disabled:opacity-50 flex items-center gap-1"
              >
                {diarizing ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    Identifying speakers...
                  </>
                ) : (
                  'Identify Speakers'
                )}
              </button>
            </div>
            {diarizationError && (
              <p className="text-xs text-red-400 mt-1">{diarizationError}</p>
            )}
          </div>
        )}

        {/* Action item counts */}
        {analytics.actionItemCounts.total > 0 && (
          <div>
            <div className="flex items-center gap-1.5 text-xs text-surface-400 mb-2">
              <MessageSquare size={12} />
              Action Items
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-surface-700 dark:text-surface-300">
                Total: <strong className="text-surface-800 dark:text-surface-200">{analytics.actionItemCounts.total}</strong>
              </span>
              {analytics.actionItemCounts.pending > 0 && (
                <span className="text-amber-400">
                  Pending: {analytics.actionItemCounts.pending}
                </span>
              )}
              {analytics.actionItemCounts.approved > 0 && (
                <span className="text-emerald-400">
                  Approved: {analytics.actionItemCounts.approved}
                </span>
              )}
              {analytics.actionItemCounts.dismissed > 0 && (
                <span className="text-surface-500">
                  Dismissed: {analytics.actionItemCounts.dismissed}
                </span>
              )}
              {analytics.actionItemCounts.converted > 0 && (
                <span className="text-blue-400">
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
