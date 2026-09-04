// Transcript viewer — searchable segment list with copy buttons,
// timestamp display, and speaker color coding.
//
// Collapsed by default (BRAIN-UX.1 Task 5): the transcript is reference
// material, while the brief/actions/chat are the primary reading surface. The
// header row is the toggle; search + copy controls and the segment list only
// exist while open. A deep link that passes `initialSearch` opens the section
// so search results never land on a closed panel.

import { useState, type RefObject } from 'react';
import { Search, Copy, Check, X, ChevronRight } from 'lucide-react';
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
  /**
   * Commit a speaker rename (SPEAKER.1); `null` clears the name back to the raw
   * label. OPTIONAL and passed by the host rather than read from meetingStore on
   * purpose — the Brain inspector renders this section for a meeting the host
   * page does not own, and reaching into the global store here would
   * cross-contaminate it exactly as MeetingAnalyticsSection would. Omitted =
   * read-only speaker chips.
   */
  onRenameSpeaker?: (label: string, name: string | null) => void | Promise<void>;
}

/**
 * One speaker chip: the mapped NAME when there is one, the raw label otherwise,
 * click (or Enter/Space on the button) to rename in place. Colour is keyed on the
 * LABEL, never the name, so renaming a speaker never recolours them.
 */
function SpeakerChip({
  label,
  display,
  className,
  onRename,
}: {
  label: string;
  display: string;
  className: string;
  onRename?: (label: string, name: string | null) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(display);

  if (!onRename) return <span className={className}>[{display}]</span>;

  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        value={draft}
        aria-label={`Name for speaker ${label}`}
        maxLength={80}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            setEditing(false);
            void onRename(label, draft.trim() || null);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(display);
            setEditing(false);
          }
        }}
        className="bg-surface-50 dark:bg-surface-950 border border-[var(--color-border-accent)] rounded text-xs px-1 py-0 mr-1.5 w-28 focus:outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      title={`Rename speaker ${label}`}
      aria-label={`Rename speaker ${display}`}
      onClick={() => {
        setDraft(display);
        setEditing(true);
      }}
      className={`${className} hover:underline`}
    >
      [{display}]
    </button>
  );
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

/** The open section's body: the empty/no-match states, or the segment list itself. */
function TranscriptBody({
  meeting,
  filteredSegments,
  transcriptSearch,
  searchQuery,
  transcriptEndRef,
  onRenameSpeaker,
}: {
  meeting: MeetingWithTranscript;
  filteredSegments: MeetingWithTranscript['segments'];
  transcriptSearch: string;
  searchQuery: string;
  transcriptEndRef: RefObject<HTMLDivElement | null>;
  onRenameSpeaker?: (label: string, name: string | null) => void | Promise<void>;
}) {
  const speakerNames = meeting.speakerNames ?? {};
  if (meeting.segments.length === 0) {
    return (
      <div className="text-center py-12 bg-surface-50 dark:bg-surface-800/20 rounded-xl border border-dashed border-surface-200 dark:border-surface-700 text-surface-500 text-sm">
        {meeting.status === 'recording' ? 'Transcription in progress...' : 'No transcript available'}
      </div>
    );
  }

  if (filteredSegments.length === 0) {
    return (
      <div className="text-center py-10 bg-surface-50 dark:bg-surface-800/20 rounded-xl border border-dashed border-surface-200 dark:border-surface-700 text-surface-500 text-sm">
        No segments match &ldquo;{transcriptSearch}&rdquo;
      </div>
    );
  }

  return (
    // Prose reads in the app's body font; font-data stays on timestamps only.
    <div className="max-h-80 overflow-y-auto rounded-xl bg-surface-100/50 dark:bg-surface-950/50 border border-[var(--color-border)] p-4 space-y-3 font-sans">
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
                <SpeakerChip
                  label={segment.speaker}
                  display={speakerNames[segment.speaker] ?? segment.speaker}
                  className={`${speakerColor.text} font-medium text-xs mr-1.5`}
                  onRename={onRenameSpeaker}
                />
              )}
              {searchQuery ? highlightText(segment.content, transcriptSearch) : segment.content}
            </p>
          </div>
        );
      })}
      <div ref={transcriptEndRef} />
    </div>
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
  onRenameSpeaker,
}: TranscriptSectionProps) {
  const [transcriptSearch, setTranscriptSearch] = useState(initialSearch ?? '');
  // Open only when the host deep-linked into a search — otherwise start collapsed.
  const [open, setOpen] = useState(Boolean(initialSearch));

  const searchQuery = transcriptSearch.trim().toLowerCase();
  const filteredSegments = searchQuery
    ? meeting.segments.filter((s) => s.content.toLowerCase().includes(searchQuery))
    : meeting.segments;

  const copyTranscript = () => {
    const text = meeting.segments
      .map((s) => {
        const ts = `[${formatTimestamp(s.startTime)}]`;
        // The copied transcript reads with NAMES too — same render-time map.
        const speaker = s.speaker ? ` [${meeting.speakerNames?.[s.speaker] ?? s.speaker}]` : '';
        return `${ts}${speaker} ${s.content}`;
      })
      .join('\n');
    onCopy('transcript', text);
  };

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="shrink-0">
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex items-center gap-1.5 font-hud text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors"
          >
            <ChevronRight
              size={13}
              className={`transition-transform shrink-0 ${open ? 'rotate-90' : ''}`}
              aria-hidden="true"
            />
            Transcript
            {meeting.segments.length > 0 && (
              <span className="text-surface-500">
                {searchQuery
                  ? `(${filteredSegments.length} of ${meeting.segments.length})`
                  : `(${meeting.segments.length} segment${meeting.segments.length !== 1 ? 's' : ''})`}
              </span>
            )}
          </button>
        </h3>
        <div className="flex items-center gap-3">
          {/* Copy buttons */}
          {open && meeting.segments.length > 0 && (
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
          {open && meeting.segments.length > 0 && (
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

      {open && (
        <TranscriptBody
          meeting={meeting}
          filteredSegments={filteredSegments}
          transcriptSearch={transcriptSearch}
          searchQuery={searchQuery}
          transcriptEndRef={transcriptEndRef}
          onRenameSpeaker={onRenameSpeaker}
        />
      )}
    </div>
  );
}
