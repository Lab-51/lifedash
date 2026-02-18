// === FILE PURPOSE ===
// Displays a meeting brief (AI-generated summary) for a single meeting.
// Shows a loading state while generating, parsed summary content when available,
// or a generate button for completed meetings without a brief.
//
// === DEPENDENCIES ===
// react, lucide-react (Loader2, Sparkles), MeetingBrief type

import { Loader2, Sparkles } from 'lucide-react';
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
  brief,
  isCompleted,
  generatingBrief,
  onGenerate,
}: BriefSectionProps) {
  return (
    <div>
      <h3 className="text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">Brief</h3>

      {generatingBrief && (
        <div className="flex items-center gap-2 text-amber-400 text-sm">
          <Loader2 size={16} className="animate-spin" />
          Generating brief...
        </div>
      )}

      {brief && !generatingBrief && (
        <div className="bg-surface-100/50 dark:bg-surface-800/50 border border-surface-200 dark:border-surface-700 rounded-lg p-3">
          <div>{brief.summary.split('\n').map(renderLine)}</div>
          <p className="text-xs text-surface-500 mt-3">
            {formatBriefDate(brief.createdAt)}
          </p>
        </div>
      )}

      {!brief && !generatingBrief && isCompleted && (
        <button
          onClick={onGenerate}
          className="text-sm text-primary-400 hover:text-primary-300 flex items-center gap-1.5"
        >
          <Sparkles size={14} />
          Generate Brief
        </button>
      )}

      {!brief && !generatingBrief && !isCompleted && (
        <p className="text-sm text-surface-500">
          Complete the recording to generate a brief
        </p>
      )}
    </div>
  );
}
