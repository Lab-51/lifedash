// === FILE PURPOSE ===
// Displays a meeting brief (AI-generated summary) for a single meeting.
// Shows a loading state while generating, parsed summary content when available,
// or a generate button for completed meetings without a brief.
//
// === DEPENDENCIES ===
// react, lucide-react (Loader2, Sparkles), MeetingBrief type

import { AlertTriangle, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { useMeetingStore } from '../stores/meetingStore';
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

/** Render a single line of the brief summary based on its prefix. */
function renderLine(line: string, idx: number) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('## ')) {
    return (
      <h4 key={idx} className="font-semibold text-surface-800 dark:text-surface-200 mt-3 mb-1">
        {trimmed.slice(3)}
      </h4>
    );
  }

  if (trimmed.startsWith('- ')) {
    return (
      <p key={idx} className="ml-4 text-surface-700 dark:text-surface-300 text-sm">
        <span className="mr-1.5">&bull;</span>
        {trimmed.slice(2)}
      </p>
    );
  }

  return (
    <p key={idx} className="text-surface-700 dark:text-surface-300 text-sm">
      {trimmed}
    </p>
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
        <div className="hud-panel rounded-lg p-3">
          <div>{brief.summary.split('\n').map(renderLine)}</div>
          <div className="flex items-center justify-between mt-3">
            <p className="text-xs text-surface-500">{formatBriefDate(brief.createdAt)}</p>
            <button
              onClick={onGenerate}
              className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1 px-2 py-1 rounded hover:bg-primary-500/10 transition-colors"
              title="Regenerate brief"
            >
              <RefreshCw size={12} />
              Regenerate
            </button>
          </div>
        </div>
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
