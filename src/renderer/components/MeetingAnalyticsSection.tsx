// === FILE PURPOSE ===
// Meeting analytics section — shows duration, word count, speaker breakdown,
// action item summary, and the two speaker triggers: "Identify Speakers"
// (diarization — writes labels) and "Resolve Names" (label -> name map).
//
// === DEPENDENCIES ===
// react, lucide-react, meetingStore, MeetingAnalytics type

import { useEffect, useState, type ReactNode } from 'react';
import { BarChart3, Users, Clock, MessageSquare, Loader2 } from 'lucide-react';
import { useMeetingStore } from '../stores/meetingStore';
import { ConfirmDialog } from './ConfirmDialog';

interface MeetingAnalyticsSectionProps {
  meetingId: string;
  isCompleted: boolean;
  /** Speaker LABEL -> display NAME (SPEAKER.1). Analytics is keyed on the raw
   *  label — this only changes what is SHOWN, never how a speaker is counted or
   *  coloured, so renaming can never recolour or re-bucket a speaker. */
  speakerNames?: Record<string, string> | null;
}

/**
 * What a RE-run has to be honest about, matched to what the code actually does
 * (speakerDiarizationService -> meetingService.updateSegmentSpeakers): the
 * provider's labels are written over the existing ones on every segment it finds
 * speech in — which includes the `Me` labels a two-channel recording produces —
 * while a segment it finds no words for keeps whatever label it has.
 *
 * The name map is a SEPARATE column and is never touched here. It is keyed by
 * LABEL, though, so a name stays attached to its label rather than to a person:
 * if the new pass assigns "Speaker 2" to someone else, the old name rides along
 * and wants checking. Saying so is the point of the confirm.
 */
const REDIARIZE_CONFIRM =
  'The provider re-labels the transcript: existing speaker labels are overwritten wherever it recognises speech, including the "Me" labels from two-channel recording. Segments it finds no speech in keep their current label.\n\n' +
  'The names you gave speakers are NOT overwritten. They stay attached to their labels, so check them afterwards in case the new pass numbers the speakers differently.';

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

/**
 * One stat tile. `min-w-0` + `truncate` on the value is the fix for the clipped
 * word count: without it a long number overflowed its tile silently instead of
 * shrinking or eliding. `tabular-nums` keeps the four tiles optically aligned.
 */
function StatTile({
  label,
  value,
  icon,
  accent = false,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="min-w-0 bg-surface-100/50 dark:bg-surface-950/50 rounded-xl p-3 border border-[var(--color-border)]">
      <div className="flex items-center justify-center gap-1.5 font-hud text-[0.625rem] text-[var(--color-text-muted)] mb-1">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div
        title={value}
        className={`font-data text-lg font-bold tracking-tight text-center tabular-nums truncate ${
          accent ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-primary)]'
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * The diarization trigger. Stays available AFTER labels exist (SPEAKER.1) — it
 * used to vanish the moment any label was written, which left a bad pass with no
 * way to re-run it. A re-run is confirmed, because it overwrites labels; a first
 * run has nothing to overwrite and goes straight through.
 */
function IdentifySpeakersButton({ meetingId, hasLabels }: { meetingId: string; hasLabels: boolean }) {
  const diarizing = useMeetingStore((s) => s.diarizing);
  const diarizeMeeting = useMeetingStore((s) => s.diarizeMeeting);
  const [confirming, setConfirming] = useState(false);

  const run = () => {
    setConfirming(false);
    void diarizeMeeting(meetingId);
  };

  return (
    <>
      <button
        onClick={() => (hasLabels ? setConfirming(true) : run())}
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
      <ConfirmDialog
        open={confirming}
        title="Re-run speaker identification?"
        message={REDIARIZE_CONFIRM}
        confirmLabel="Re-identify"
        onConfirm={run}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

/**
 * The name-resolution trigger — the caller for `meeting:resolve-speaker-names`.
 * Only offered once labels EXIST (there is nothing to resolve otherwise), which
 * is the same `analytics.hasDiarization` signal the rest of this block reads.
 *
 * No confirm, unlike its sibling: resolution never overwrites an existing entry
 * (speakerNameService keeps the user's name as the last word), so there is
 * nothing to warn about. Failure and "found nothing" are deliberately the SAME
 * outcome to the user — AI-RESIL.1's rule is that a failed resolution degrades
 * to no names, never to a wrong one, and neither case gives the user anything to
 * act on beyond trying again.
 */
function ResolveNamesButton({
  meetingId,
  speakerNames,
}: {
  meetingId: string;
  speakerNames?: Record<string, string> | null;
}) {
  const resolveSpeakerNames = useMeetingStore((s) => s.resolveSpeakerNames);
  const diarizing = useMeetingStore((s) => s.diarizing);
  const [resolving, setResolving] = useState(false);
  const [noneResolved, setNoneResolved] = useState(false);

  const run = async () => {
    setResolving(true);
    setNoneResolved(false);
    // Counted BEFORE the await: this prop is the map the user is looking at now,
    // and the store swaps it for the new one while the call is in flight.
    const before = Object.keys(speakerNames ?? {}).length;
    const map = await resolveSpeakerNames(meetingId);
    setResolving(false);
    setNoneResolved(!map || Object.keys(map).length <= before);
  };

  return (
    <>
      {noneResolved && (
        <span role="status" className="text-sm font-medium text-surface-500">
          No names resolved
        </span>
      )}
      <button
        onClick={() => void run()}
        // Diarization rewrites the very labels this resolves against.
        disabled={resolving || diarizing}
        className="bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
      >
        {resolving ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            Resolving...
          </>
        ) : (
          'Resolve Names'
        )}
      </button>
    </>
  );
}

/** One speaker's row. Colour is keyed on the LABEL (`spkr.speaker`); only the
 *  text shown is the mapped name, so a rename never recolours the bar. */
function SpeakerRow({ label, name, talkTimePercent, wordCount, talkTimeMs }: SpeakerRowProps) {
  const color = getSpeakerColor(label);
  return (
    <div className="group">
      <div className="flex flex-wrap items-end justify-between text-sm mb-2 gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`px-2 py-0.5 rounded text-xs font-bold ${color.bg.replace('bg-', 'bg-').replace('-500', '-500/10')} ${color.text}`}
          >
            {name}
          </span>
          <span className="text-surface-600 dark:text-surface-300 font-medium">{talkTimePercent}%</span>
        </div>
        <span className="text-surface-400 text-xs font-medium">
          {wordCount.toLocaleString()} words &middot; {formatDurationLong(talkTimeMs)}
        </span>
      </div>
      <div className="h-2.5 bg-surface-100 dark:bg-surface-800 rounded-full overflow-hidden border border-surface-200 dark:border-surface-700/50">
        <div
          className={`h-full ${color.bg} rounded-full transition-all duration-1000 ease-out`}
          style={{ width: `${talkTimePercent}%` }}
        />
      </div>
    </div>
  );
}

interface SpeakerRowProps {
  label: string;
  name: string;
  talkTimePercent: number;
  wordCount: number;
  talkTimeMs: number;
}

export default function MeetingAnalyticsSection({
  meetingId,
  isCompleted,
  speakerNames,
}: MeetingAnalyticsSectionProps) {
  const analytics = useMeetingStore((s) => s.analytics);
  const analyticsLoading = useMeetingStore((s) => s.analyticsLoading);
  const diarizationError = useMeetingStore((s) => s.diarizationError);
  const loadAnalytics = useMeetingStore((s) => s.loadAnalytics);

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
        {/* Top stats row. `@xl/rail:` — NOT `md:` — because these tiles live in
            the right rail: a viewport breakpoint forced 4 columns into ~332px on
            any wide window, which is what truncated "Segments" and clipped the
            word count. Four columns only once the rail itself is wide enough. */}
        <div className="grid grid-cols-2 @xl/rail:grid-cols-4 gap-3 text-center">
          <StatTile
            label="Duration"
            value={formatDurationLong(analytics.durationMs)}
            accent
            icon={<Clock size={13} />}
          />
          <StatTile label="Segments" value={analytics.totalSegments.toLocaleString()} />
          <StatTile label="Words" value={analytics.totalWords.toLocaleString()} />
          <StatTile label="WPM" value={String(analytics.wordsPerMinute)} />
        </div>

        {/* Speaker breakdown. The trigger lives OUTSIDE the has/has-not branch
            (SPEAKER.1) so a re-run is always reachable. */}
        <div className="pt-2 border-t border-surface-100 dark:border-surface-700/50 mt-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-surface-700 dark:text-surface-300">
              <Users size={16} className="text-surface-400" />
              {analytics.hasDiarization ? 'Speaker Breakdown' : 'Speaker Data'}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {!analytics.hasDiarization && <span className="text-sm font-medium text-surface-500">Not available</span>}
              {analytics.hasDiarization && <ResolveNamesButton meetingId={meetingId} speakerNames={speakerNames} />}
              <IdentifySpeakersButton meetingId={meetingId} hasLabels={analytics.hasDiarization} />
            </div>
          </div>
          {analytics.hasDiarization && (
            <div className="space-y-4">
              {analytics.speakers.map((spkr) => (
                <SpeakerRow
                  key={spkr.speaker}
                  label={spkr.speaker}
                  name={speakerNames?.[spkr.speaker] ?? spkr.speaker}
                  talkTimePercent={spkr.talkTimePercent}
                  wordCount={spkr.wordCount}
                  talkTimeMs={spkr.talkTimeMs}
                />
              ))}
            </div>
          )}
          {diarizationError && (
            <p className="text-sm text-red-500 dark:text-red-400 mt-2 bg-red-50 dark:bg-red-500/10 p-2 rounded-md">
              {diarizationError}
            </p>
          )}
        </div>

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
