// === FILE PURPOSE ===
// Modern Meeting Card Component
// Displays a meeting summary with enterprise-grade styling.

import { memo } from 'react';
import { Mic, Clock, CheckCircle2, Loader2, ListChecks, Trash2, Calendar, User, FileText } from 'lucide-react';
import type { Meeting } from '../../shared/types';
import { MEETING_TEMPLATES } from '../../shared/types';

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
        className: 'bg-rose-500/10 text-rose-500',
        icon: Mic,
    },
    processing: {
        label: 'Processing',
        className: 'bg-[var(--color-warm)]/10 text-[var(--color-warm)]',
        icon: Loader2,
    },
    completed: {
        label: 'Done',
        className: 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]',
        icon: CheckCircle2,
    },
};

function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric'
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

const MeetingCardModern = memo(function MeetingCardModern({ meeting, projectName, projectColor, actionItemCount, onClick, onDelete }: MeetingCardModernProps) {
    const status = STATUS_STYLES[meeting.status] || STATUS_STYLES.completed;
    const StatusIcon = status.icon;

    return (
        <div
            onClick={onClick}
            className={`group relative flex flex-col hud-panel clip-corner-cut-sm p-5 transition-all cursor-pointer hover:shadow-lg ${meeting.status === 'recording'
                    ? 'ring-2 ring-rose-500/20 !border-rose-500/30'
                    : actionItemCount && actionItemCount > 0
                        ? '!border-[var(--color-warm-dim)] hover:!border-[var(--color-warm)]'
                        : 'hover:!border-[var(--color-border-accent)]'
                }`}
        >
            {/* Hover-reveal top gradient border */}
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[var(--color-accent)] to-transparent opacity-0 group-hover:opacity-60 transition-opacity duration-700" />

            {/* Date Badge */}
            <div className="absolute top-5 right-5 flex items-center gap-2">
                {actionItemCount != null && actionItemCount > 0 && (
                    <span className="flex items-center gap-1 text-[10px] font-bold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-1 rounded-full">
                        <ListChecks size={12} /> {actionItemCount}
                    </span>
                )}
                <span className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full ${status.className}`}>
                    <StatusIcon size={12} className={meeting.status === 'recording' ? 'animate-pulse' : ''} />
                    {status.label}
                </span>
            </div>

            {/* Main Content */}
            <div className="mb-4 pr-32">
                <h3 className="text-lg font-bold text-[var(--color-text-primary)] truncate mb-1">
                    {meeting.title || 'Untitled Meeting'}
                </h3>
                <div className="flex items-center gap-2 font-data text-xs text-[var(--color-text-secondary)]">
                    <Calendar size={12} />
                    {formatDate(meeting.createdAt)}
                    <span className="node-point-sm" />
                    <Clock size={12} />
                    {formatDuration(meeting.startedAt, meeting.endedAt)}
                </div>
            </div>

            {/* Footer Tags */}
            <div className="mt-auto pt-4 border-t border-[var(--color-border)] flex items-center justify-between">
                <div className="flex items-center gap-2">
                    {projectName ? (
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-surface-700 dark:text-surface-300 bg-surface-100 dark:bg-surface-800 px-2.5 py-1 rounded-md">
                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: projectColor || '#6366f1' }} />
                            {projectName}
                        </span>
                    ) : (
                        <span className="text-xs text-surface-400 italic">No Project</span>
                    )}

                    {meeting.template && meeting.template !== 'none' && (
                        <span className="flex items-center gap-1.5 text-xs text-surface-500 bg-surface-50 dark:bg-surface-800/50 px-2 py-1 rounded-md border border-surface-100 dark:border-surface-700/50">
                            <FileText size={12} />
                            {MEETING_TEMPLATES.find(t => t.type === meeting.template)?.name ?? meeting.template}
                        </span>
                    )}
                </div>

                {/* Delete Action (Hover only) */}
                {onDelete && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onDelete(); }}
                        className="opacity-0 group-hover:opacity-100 p-1.5 text-surface-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-all"
                        title="Delete meeting"
                    >
                        <Trash2 size={14} />
                    </button>
                )}
            </div>
        </div>
    );
});

export default MeetingCardModern;
