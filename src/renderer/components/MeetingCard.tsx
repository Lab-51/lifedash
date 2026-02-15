// === FILE PURPOSE ===
// Meeting card component — displays a single meeting in the meetings list.
// Shows title, date, duration, status badge, and optional project name.

import { memo } from 'react';
import { Mic, Clock, CheckCircle2, Loader2, ListChecks, Trash2 } from 'lucide-react';
import type { Meeting } from '../../shared/types';
import { MEETING_TEMPLATES } from '../../shared/types';

interface MeetingCardProps {
  meeting: Meeting;
  projectName?: string;
  projectColor?: string;
  actionItemCount?: number;
  onClick: () => void;
  onDelete?: () => void;
}

const STATUS_STYLES: Record<string, { label: string; className: string; icon: typeof Mic }> = {
  recording: {
    label: 'Recording',
    className: 'bg-red-500/15 text-red-400',
    icon: Mic,
  },
  processing: {
    label: 'Processing',
    className: 'bg-amber-500/15 text-amber-400',
    icon: Loader2,
  },
  completed: {
    label: 'Completed',
    className: 'bg-emerald-500/15 text-emerald-400',
    icon: CheckCircle2,
  },
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  });
}

function formatDuration(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return 'In progress';
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}s`;
  return `${min}m ${sec}s`;
}

const MeetingCard = memo(function MeetingCard({ meeting, projectName, projectColor, actionItemCount, onClick, onDelete }: MeetingCardProps) {
  const status = STATUS_STYLES[meeting.status] || STATUS_STYLES.completed;
  const StatusIcon = status.icon;

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      className="w-full text-left p-4 bg-surface-800 border border-surface-700 rounded-lg
                 hover:border-surface-600 transition-colors group relative cursor-pointer"
    >
      {onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-surface-700
                     text-surface-500 hover:text-red-400 transition-all"
          title="Delete meeting"
        >
          <Trash2 size={14} />
        </button>
      )}

      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-surface-100 truncate">
          {meeting.title}
        </h3>
        <div className="flex items-center gap-2 shrink-0">
          {actionItemCount != null && actionItemCount > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-surface-400">
              <ListChecks size={12} />
              {actionItemCount}
            </span>
          )}
          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${status.className}`}>
            <StatusIcon size={12} className={meeting.status === 'recording' ? 'animate-pulse' : ''} />
            {status.label}
          </span>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-3 text-xs text-surface-400">
        <span>{formatDate(meeting.startedAt)}</span>
        <span>{formatTime(meeting.startedAt)}</span>
        <span className="flex items-center gap-1">
          <Clock size={12} />
          {formatDuration(meeting.startedAt, meeting.endedAt)}
        </span>
      </div>

      {(projectName || (meeting.template && meeting.template !== 'none')) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {projectName && (
            <span className="text-xs bg-primary-600/10 text-primary-400 px-2 py-0.5 rounded-full flex items-center gap-1.5">
              {projectColor && (
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: projectColor }}
                />
              )}
              {projectName}
            </span>
          )}
          {meeting.template && meeting.template !== 'none' && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-surface-700 text-surface-300">
              {MEETING_TEMPLATES.find(t => t.type === meeting.template)?.name ?? meeting.template}
            </span>
          )}
        </div>
      )}
    </div>
  );
});

export default MeetingCard;
