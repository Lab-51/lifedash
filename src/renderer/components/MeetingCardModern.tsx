// === FILE PURPOSE ===
// Meeting card — displays a meeting summary in the meetings grid.
// Uses HUD design system tokens and patterns consistent with KanbanCard and Ideas cards.

import { memo, useState, useEffect, useRef } from 'react';
import { Mic, Clock, CheckCircle2, Loader2, ListChecks, Trash2, Calendar, FileText, AlertCircle } from 'lucide-react';
import type { Meeting, Project } from '../../shared/types';
import { MEETING_TEMPLATES } from '../../shared/types';
import { useProjectStore } from '../stores/projectStore';
import { useMeetingStore } from '../stores/meetingStore';
import { toast } from '../hooks/useToast';

interface MeetingCardModernProps {
  meeting: Meeting;
  projectName?: string;
  projectColor?: string;
  actionItemCount?: number;
  onClick: () => void;
  onDelete?: () => void;
}

const STATUS_STYLES: Record<string, { label: string; className: string; icon: typeof Mic }> = {
  recording: {
    label: 'Live',
    className: 'bg-rose-500/15 text-rose-400 border border-rose-500/30',
    icon: Mic,
  },
  processing: {
    label: 'Processing',
    className: 'bg-[var(--color-warm)]/10 text-[var(--color-warm)] border border-[var(--color-warm-dim)]/30',
    icon: Loader2,
  },
  completed: {
    label: 'Done',
    className: 'bg-[var(--color-accent)]/10 text-[var(--color-accent)] border border-[var(--color-accent-muted)]',
    icon: CheckCircle2,
  },
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function formatDuration(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return 'Running...';
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  if (min === 0) return `< 1m`;
  return `${min}m`;
}

const MeetingCardModern = memo(function MeetingCardModern({
  meeting,
  projectName,
  projectColor,
  actionItemCount,
  onClick,
  onDelete,
}: MeetingCardModernProps) {
  const status = STATUS_STYLES[meeting.status] || STATUS_STYLES.completed;
  const StatusIcon = status.icon;
  const hasActions = actionItemCount != null && actionItemCount > 0;
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const allProjects = useProjectStore((s) => s.projects);
  const reassignFromUnassigned = useMeetingStore((s) => s.reassignFromUnassigned);
  const refreshUnreviewedCount = useMeetingStore((s) => s.refreshUnreviewedCount);
  // projects:list excludes system projects already, so this is safe to use directly
  const eligibleProjects: Project[] = allProjects.filter((p) => !p.archived);

  useEffect(() => {
    if (!showProjectPicker) return;
    const handleClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowProjectPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showProjectPicker]);

  const handlePickProject = async (projectId: string) => {
    if (reassigning) return;
    setReassigning(true);
    try {
      await reassignFromUnassigned(meeting.id, projectId);
      await refreshUnreviewedCount();
      setShowProjectPicker(false);
      toast('Cards moved to chosen project', 'success');
    } catch {
      toast('Failed to reassign cards', 'error');
    } finally {
      setReassigning(false);
    }
  };

  return (
    <div
      onClick={onClick}
      className={`group relative flex flex-col hud-panel clip-corner-cut-sm p-5 transition-all cursor-pointer hover:shadow-[0_0_12px_rgba(62,232,228,0.1)] ${
        meeting.status === 'recording'
          ? 'ring-2 ring-rose-500/20 !border-rose-500/30'
          : hasActions
            ? '!border-[var(--color-warm-dim)] hover:!border-[var(--color-warm)]'
            : 'hover:!border-[var(--color-accent-dim)]'
      }`}
    >
      {/* Hover-reveal top gradient border */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[var(--color-accent)] to-transparent opacity-0 group-hover:opacity-60 transition-opacity duration-700" />

      {/* Top row: status & action item badges */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 font-data text-[0.6875rem] text-[var(--color-text-muted)]">
          <Calendar size={12} />
          {formatDate(meeting.createdAt)}
          <span className="node-point-sm" />
          <Clock size={12} />
          {formatDuration(meeting.startedAt, meeting.endedAt)}
        </div>
        <div className="flex items-center gap-1.5">
          {hasActions && (
            <span className="flex items-center gap-1 text-[0.625rem] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded-md">
              <ListChecks size={11} /> {actionItemCount}
            </span>
          )}
          <span
            className={`flex items-center gap-1 text-[0.625rem] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md ${status.className}`}
          >
            <StatusIcon
              size={11}
              className={
                meeting.status === 'recording' ? 'animate-pulse' : meeting.status === 'processing' ? 'animate-spin' : ''
              }
            />
            {status.label}
          </span>
        </div>
      </div>

      {/* Title */}
      <h3 className="text-base font-bold text-[var(--color-text-primary)] truncate mb-1 leading-snug">
        {meeting.title || 'Untitled Meeting'}
      </h3>

      {/* Footer Tags */}
      <div className="mt-auto pt-3 border-t border-[var(--color-border)] flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          {meeting.unassignedPending ? (
            <div className="relative" ref={pickerRef}>
              <button
                data-testid="meeting-unassigned-pill"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowProjectPicker((prev) => !prev);
                }}
                disabled={reassigning}
                className="flex items-center gap-1 text-[0.625rem] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-md hover:bg-amber-500/20 transition-colors disabled:opacity-60"
              >
                <AlertCircle size={10} />
                Unassigned — set project?
              </button>
              {showProjectPicker && (
                <div
                  className="absolute bottom-full left-0 mb-1 z-30 min-w-[200px] max-h-64 overflow-y-auto bg-white dark:bg-surface-900 border border-[var(--color-border)] rounded-lg shadow-lg py-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  {eligibleProjects.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-[var(--color-text-muted)]">No projects available</div>
                  ) : (
                    eligibleProjects.map((p) => (
                      <button
                        key={p.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handlePickProject(p.id);
                        }}
                        disabled={reassigning}
                        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-surface-100 dark:hover:bg-surface-800 hover:text-[var(--color-text-primary)] transition-colors text-left disabled:opacity-50"
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: p.color || '#6366f1' }}
                        />
                        <span className="truncate">{p.name}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          ) : projectName ? (
            <span className="flex items-center gap-1.5 text-[0.625rem] font-semibold text-[var(--color-text-secondary)] bg-[var(--color-accent-subtle)]/40 border border-[var(--color-border)] px-2 py-0.5 rounded-md truncate max-w-[140px]">
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: projectColor || '#6366f1' }}
              />
              {projectName}
            </span>
          ) : (
            <span className="text-[0.625rem] text-[var(--color-text-muted)]">No project</span>
          )}

          {meeting.template && meeting.template !== 'none' && (
            <span className="flex items-center gap-1 text-[0.625rem] text-[var(--color-text-muted)] bg-[var(--color-accent-subtle)]/20 border border-[var(--color-border)] px-2 py-0.5 rounded-md">
              <FileText size={10} />
              {MEETING_TEMPLATES.find((t) => t.type === meeting.template)?.name ?? meeting.template}
            </span>
          )}
        </div>

        {/* Delete Action (Hover only) */}
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="opacity-0 group-hover:opacity-100 p-1.5 text-[var(--color-text-muted)] hover:text-red-400 rounded-md hover:bg-red-500/10 transition-all shrink-0"
            title="Delete meeting"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
});

export default MeetingCardModern;
