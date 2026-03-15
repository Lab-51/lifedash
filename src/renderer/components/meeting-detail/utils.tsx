// Meeting detail utility functions — formatters, markdown export, and prep rendering helpers.

import type { MeetingWithTranscript } from '../../../shared/types';
import { MEETING_TEMPLATES } from '../../../shared/types';

export const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  recording: { label: 'Recording', className: 'bg-red-500/15 text-red-400' },
  processing: { label: 'Processing', className: 'bg-amber-500/15 text-amber-400' },
  completed: { label: 'Completed', className: 'bg-emerald-500/15 text-emerald-400' },
};

export function formatTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60)
    .toString()
    .padStart(2, '0');
  const sec = (totalSec % 60).toString().padStart(2, '0');
  return `${min}:${sec}`;
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatDuration(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return 'In progress';
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}s`;
  return `${min}m ${sec}s`;
}

export function formatTimestampHMS(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const hrs = Math.floor(totalSec / 3600)
    .toString()
    .padStart(2, '0');
  const min = Math.floor((totalSec % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const sec = (totalSec % 60).toString().padStart(2, '0');
  return `${hrs}:${min}:${sec}`;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

/** Simple markdown renderer for prep briefing text: ## headings, - bullets, plain text. */
export function renderPrepLine(line: string, idx: number): React.ReactNode {
  const trimmed = line.trim();
  if (!trimmed) return <div key={idx} className="h-1" />;

  if (trimmed.startsWith('## ')) {
    return (
      <p key={idx} className="text-xs font-semibold text-surface-800 dark:text-surface-200 mt-2 mb-0.5">
        {trimmed.slice(3)}
      </p>
    );
  }

  if (trimmed.startsWith('# ')) {
    return (
      <p key={idx} className="text-xs font-bold text-surface-900 dark:text-surface-100 mt-2 mb-0.5">
        {trimmed.slice(2)}
      </p>
    );
  }

  if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
    return (
      <p key={idx} className="text-xs text-surface-700 dark:text-surface-300 pl-3">
        <span className="text-surface-500 mr-1">{'\u2022'}</span>
        {trimmed.slice(2)}
      </p>
    );
  }

  return (
    <p key={idx} className="text-xs text-surface-700 dark:text-surface-300">
      {trimmed}
    </p>
  );
}

export function formatMeetingAsMarkdown(meeting: MeetingWithTranscript, projectName: string | undefined): string {
  const lines: string[] = [];

  lines.push(`# ${meeting.title}`);
  lines.push('');

  const dateTime = new Date(meeting.startedAt);
  lines.push(
    `**Date:** ${dateTime.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} at ${dateTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`,
  );

  if (meeting.endedAt) {
    const ms = new Date(meeting.endedAt).getTime() - dateTime.getTime();
    const minutes = Math.round(ms / 60000);
    lines.push(`**Duration:** ${minutes} minute${minutes !== 1 ? 's' : ''}`);
  }

  if (meeting.template && meeting.template !== 'none') {
    const tmpl = MEETING_TEMPLATES.find((t) => t.type === meeting.template);
    if (tmpl) lines.push(`**Template:** ${tmpl.name}`);
  }

  if (projectName) {
    lines.push(`**Project:** ${projectName}`);
  }

  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(meeting.brief?.summary ?? 'No summary generated.');

  lines.push('');
  lines.push('## Action Items');
  lines.push('');
  if (meeting.actionItems.length === 0) {
    lines.push('No action items.');
  } else {
    for (const item of meeting.actionItems) {
      const checkbox = item.status === 'converted' ? '[x]' : item.status === 'dismissed' ? '[~]' : '[ ]';
      lines.push(`- ${checkbox} ${item.description}`);
    }
  }

  lines.push('');
  lines.push('## Transcript');
  lines.push('');
  if (meeting.segments.length === 0) {
    lines.push('No transcript available.');
  } else {
    for (const seg of meeting.segments) {
      const ts = `[${formatTimestampHMS(seg.startTime)}]`;
      const speaker = seg.speaker ? ` [${seg.speaker}]` : '';
      lines.push(`${ts}${speaker} ${seg.content}`);
    }
  }

  return lines.join('\n');
}
