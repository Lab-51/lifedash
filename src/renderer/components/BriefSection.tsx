// === FILE PURPOSE ===
// Displays a meeting brief (AI-generated summary) for a single meeting.
// Shows a loading state while generating, parsed summary content when available,
// or a generate button for completed meetings without a brief.
//
// === DEPENDENCIES ===
// react, lucide-react (Loader2, Sparkles), MeetingBrief type, ./briefLines (the
// shared line renderer, BRIEF-QUAL.2), ./BriefFullNotes (the "Full notes"
// disclosure, BRIEF-QUAL.2)

import { AlertTriangle, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { useMeetingStore } from '../stores/meetingStore';
import { renderLine } from './briefLines';
import BriefFullNotes from './BriefFullNotes';
import type { MeetingBrief } from '../../shared/types';

interface BriefSectionProps {
  meetingId: string;
  brief: MeetingBrief | null;
  isCompleted: boolean;
  generatingBrief: boolean;
  onGenerate: () => void;
}

/** Format a date string into a short relative/absolute label. */
function formatBriefDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return 'Generated just now';
  if (diffMin < 60) return `Generated ${diffMin}m ago`;

  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `Generated ${diffHrs}h ago`;

  return `Generated ${date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;
}

/** The rendered brief body once one exists — summary lines, generated-at date,
 *  and the Regenerate control (with the participants-edited hint, BRIEF-QUAL.1
 *  Task 4). Split out purely to keep BriefSection's own cyclomatic complexity
 *  under the project's lint ceiling (CODE-Q.1b). */
function BriefContent({
  brief,
  participantsEdited,
  onGenerate,
}: {
  brief: MeetingBrief;
  participantsEdited: boolean;
  onGenerate: () => void;
}) {
  return (
    <div className="hud-panel rounded-lg p-3">
      <div className="overflow-hidden break-words">{brief.summary.split('\n').map(renderLine)}</div>
      {brief.structure && <BriefFullNotes structure={brief.structure} />}
      <div className="flex items-center justify-between mt-3 gap-2">
        <p className="text-xs text-surface-500">{formatBriefDate(brief.createdAt)}</p>
        <div className="flex items-center gap-2">
          {participantsEdited && <span className="text-xs text-amber-400">Participants changed</span>}
          <button
            onClick={onGenerate}
            className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1 px-2 py-1 rounded hover:bg-primary-500/10 transition-colors shrink-0"
            title="Regenerate brief"
          >
            <RefreshCw size={12} />
            Regenerate
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BriefSection({
  meetingId,
  brief,
  isCompleted,
  generatingBrief,
  onGenerate,
}: BriefSectionProps) {
  const briefError = useMeetingStore((s) => s.briefErrors[meetingId]);
  const clearBriefError = useMeetingStore((s) => s.clearBriefError);
  const participantsEdited = useMeetingStore((s) => s.participantsEditedAfterBrief[meetingId]);

  return (
    <div>
      <h3 className="font-hud text-xs text-[var(--color-text-secondary)] mb-2">Brief</h3>

      {generatingBrief && (
        <div className="flex items-center gap-2 text-amber-400 text-sm">
          <Loader2 size={16} className="animate-spin" />
          Generating brief...
        </div>
      )}

      {brief && !generatingBrief && (
        <BriefContent brief={brief} participantsEdited={!!participantsEdited} onGenerate={onGenerate} />
      )}

      {briefError && !generatingBrief && !brief && (
        <div className="rounded-lg p-3 bg-red-500/10 border border-red-500/20">
          <div className="flex items-start gap-2 mb-2">
            <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
            <span className="text-sm font-medium text-amber-300">Brief generation failed</span>
          </div>
          <details className="mb-3">
            <summary className="text-xs text-surface-500 cursor-pointer">Details</summary>
            <pre className="text-xs text-surface-400 mt-1 whitespace-pre-wrap break-words">{briefError}</pre>
          </details>
          <div className="flex gap-2">
            <button
              onClick={onGenerate}
              className="text-xs px-2 py-1 rounded bg-primary-500/20 text-primary-300 hover:bg-primary-500/30"
            >
              Retry
            </button>
            <button
              onClick={() => clearBriefError(meetingId)}
              className="text-xs px-2 py-1 rounded text-surface-400 hover:text-surface-300"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {!briefError && !brief && !generatingBrief && isCompleted && (
        <button
          onClick={onGenerate}
          className="text-sm text-primary-400 hover:text-primary-300 flex items-center gap-1.5"
        >
          <Sparkles size={14} />
          Generate Brief
        </button>
      )}

      {!briefError && !brief && !generatingBrief && !isCompleted && (
        <p className="text-sm text-surface-500">Complete the recording to generate a brief</p>
      )}
    </div>
  );
}
