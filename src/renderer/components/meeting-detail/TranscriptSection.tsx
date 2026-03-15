// Transcript viewer — searchable segment list with copy buttons,
// timestamp display, and speaker color coding.

import { useState, type RefObject } from 'react';
import { Search, Copy, Check, X } from 'lucide-react';
import { getSpeakerColor } from '../MeetingAnalyticsSection';
import { formatTimestamp } from './utils';
import type { MeetingWithTranscript } from '../../../shared/types';

interface TranscriptSectionProps {
  meeting: MeetingWithTranscript;
  transcriptEndRef: RefObject<HTMLDivElement | null>;
  initialSearch?: string;
  onCopySummary: () => void;
  onCopyActions: () => void;
  copiedField: string | null;
  onCopy: (field: string, text: string) => void;
}

function highlightText(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} className="bg-yellow-500/30 text-yellow-200 rounded-sm px-0.5">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function CopyBtn({
  field,
  label,
  onClick,
  disabled,
  copiedField,
}: {
  field: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  copiedField: string | null;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1 text-xs text-surface-400 hover:text-surface-800 dark:text-surface-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      title={label}
    >
      {copiedField === field ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
      <span className="hidden sm:inline">{copiedField === field ? 'Copied!' : label}</span>
    </button>
  );
}

export default function TranscriptSection({
  meeting,
  transcriptEndRef,
  initialSearch,
  onCopySummary,
  onCopyActions,
  copiedField,
  onCopy,
}: TranscriptSectionProps) {
  const [transcriptSearch, setTranscriptSearch] = useState(initialSearch ?? '');

  const searchQuery = transcriptSearch.trim().toLowerCase();
  const filteredSegments = searchQuery
    ? meeting.segments.filter((s) => s.content.toLowerCase().includes(searchQuery))
    : meeting.segments;

  const copyTranscript = () => {
    const text = meeting.segments
      .map((s) => {
        const ts = `[${formatTimestamp(s.startTime)}]`;
        const speaker = s.speaker ? ` [${s.speaker}]` : '';
        return `${ts}${speaker} ${s.content}`;
      })
      .join('\n');
    onCopy('transcript', text);
  };

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="font-hud text-xs text-[var(--color-text-secondary)] shrink-0">
          Transcript
          {meeting.segments.length > 0 && (
            <span className="ml-2 text-surface-500">
              {searchQuery
                ? `(${filteredSegments.length} of ${meeting.segments.length})`
                : `(${meeting.segments.length} segment${meeting.segments.length !== 1 ? 's' : ''})`}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-3">
          {/* Copy buttons */}
          {meeting.segments.length > 0 && (
            <div className="flex items-center gap-2">
              <CopyBtn field="transcript" label="Transcript" onClick={copyTranscript} copiedField={copiedField} />
              <CopyBtn
                field="summary"
                label="Summary"
                onClick={onCopySummary}
                disabled={!meeting.brief}
                copiedField={copiedField}
              />
              <CopyBtn
                field="actions"
                label="Actions"
                onClick={onCopyActions}
                disabled={meeting.actionItems.length === 0}
                copiedField={copiedField}
              />
            </div>
          )}
          {/* Search input */}
          {meeting.segments.length > 0 && (
            <div className="relative">
              <Search
                size={12}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none"
              />
              <input
                type="text"
                value={transcriptSearch}
                onChange={(e) => setTranscriptSearch(e.target.value)}
                placeholder="Search..."
                className="bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] hover:border-[var(--color-border-accent)] rounded-lg text-xs text-[var(--color-text-primary)] pl-7 pr-6 py-1 w-32 focus:outline-none focus:border-[var(--color-accent-dim)] placeholder:text-[var(--color-text-muted)] transition-colors"
              />
              {transcriptSearch && (
                <button
                  onClick={() => setTranscriptSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {meeting.segments.length === 0 ? (
        <div className="text-center py-12 bg-surface-50 dark:bg-surface-800/20 rounded-xl border border-dashed border-surface-200 dark:border-surface-700 text-surface-500 text-sm">
          {meeting.status === 'recording' ? 'Transcription in progress...' : 'No transcript available'}
        </div>
      ) : filteredSegments.length === 0 ? (
        <div className="text-center py-10 bg-surface-50 dark:bg-surface-800/20 rounded-xl border border-dashed border-surface-200 dark:border-surface-700 text-surface-500 text-sm">
          No segments match &ldquo;{transcriptSearch}&rdquo;
        </div>
      ) : (
        <div className="max-h-80 overflow-y-auto rounded-xl bg-surface-100/50 dark:bg-surface-950/50 border border-[var(--color-border)] p-4 space-y-3 font-data">
          {filteredSegments.map((segment) => {
            const speakerColor = segment.speaker ? getSpeakerColor(segment.speaker) : null;
            return (
              <div
                key={segment.id}
                className="flex gap-4 text-sm hover:bg-[var(--color-border)]/30 p-2 -mx-2 rounded-lg transition-colors"
              >
                <span className="font-data text-xs text-[var(--color-accent-dim)] pt-0.5 shrink-0 w-12 text-right">
                  {formatTimestamp(segment.startTime)}
                </span>
                <p className="text-surface-800 dark:text-surface-200 flex-1 leading-relaxed">
                  {segment.speaker && speakerColor && (
                    <span className={`${speakerColor.text} font-medium text-xs mr-1.5`}>[{segment.speaker}]</span>
                  )}
                  {searchQuery ? highlightText(segment.content, transcriptSearch) : segment.content}
                </p>
              </div>
            );
          })}
          <div ref={transcriptEndRef} />
        </div>
      )}
    </div>
  );
}
