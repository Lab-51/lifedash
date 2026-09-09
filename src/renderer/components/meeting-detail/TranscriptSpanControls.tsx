// === FILE PURPOSE ===
// The span-selection affordances TranscriptSection renders (TRANS-COV.1 Task
// 5) — split into its own file so TranscriptSection.tsx stays under this
// repo's file-size guideline. Three pieces:
//   - `useSpanFromProps` — mirrors a host-supplied span deep link (e.g. a
//     coverage-badge gap click) into local pendingSpan state, the same
//     during-render idiom TranscriptSection's own `initialSearch` uses;
//   - `SuspectSpansChip` — the header chip cycling through suspect spans;
//   - `SpanRedoPanel` — the manual mm:ss entry + the mounted RetranscribeControl.
// All three SELF-GATE on their own props (early `return null`) rather than
// making the caller wrap them in a JSX `&&` — TranscriptSection sits close to
// this repo's complexity ceiling (15) and is not in eslint.config.mjs's
// COMPLEXITY_BASELINE, so pushing branching into these functions' own bodies
// keeps the caller's own complexity flat (the established idiom — see
// SessionSummaryTab's SessionIntelligence/IntelligenceBlock split).
//
// === DEPENDENCIES ===
// react, lucide-react (AlertTriangle — already the app's warning glyph),
// ./RetranscribeControl, shared/transcription/suspectDetector, shared types.

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import RetranscribeControl, { type PendingSpan } from './RetranscribeControl';
import type { SuspectSpan } from '../../../shared/transcription/suspectDetector';
import type { MeetingWithTranscript, RetranscribedSpan, TranscriptSegment } from '../../../shared/types';

/** "mm:ss" -> ms, or null when it doesn't parse. Minutes may run past 59 (a
 *  long meeting); seconds must be 00-59. */
function parseMmSs(input: string): number | null {
  const match = input.trim().match(/^(\d{1,4}):([0-5]\d)$/);
  if (!match) return null;
  return (Number(match[1]) * 60 + Number(match[2])) * 1000;
}

function spanKey(start: number | undefined, end: number | undefined): string | undefined {
  return start != null && end != null ? `${start}-${end}` : undefined;
}

/**
 * During-render adjustment: mirrors a host-supplied span deep link into
 * `onArrive` exactly once per distinct (start, end) pair. A hook rather than
 * inline code so its branching lands in ITS OWN function, not the caller's.
 */
export function useSpanFromProps(
  initialStart: number | undefined,
  initialEnd: number | undefined,
  onArrive: (span: PendingSpan) => void,
): void {
  const [applied, setApplied] = useState(spanKey(initialStart, initialEnd));
  const key = spanKey(initialStart, initialEnd);
  if (key !== applied) {
    setApplied(key);
    if (initialStart != null && initialEnd != null) onArrive({ startMs: initialStart, endMs: initialEnd });
  }
}

/** Header chip cycling through suspect spans. */
export function SuspectSpansChip({
  open,
  spans,
  cycleIndex,
  onSelect,
}: {
  open: boolean;
  spans: SuspectSpan[];
  cycleIndex: number;
  onSelect: (span: SuspectSpan) => void;
}) {
  if (!open || spans.length === 0) return null;
  const span = spans[cycleIndex % spans.length];
  return (
    <button
      type="button"
      onClick={() => onSelect(span)}
      title="Cycle through transcript spans that may need a second look"
      className="flex items-center gap-1 text-[0.625rem] font-semibold text-amber-400 hover:text-amber-300 transition-colors"
    >
      <AlertTriangle size={11} aria-hidden="true" />
      {spans.length} suspect span{spans.length !== 1 ? 's' : ''}
    </button>
  );
}

/** The manual "redo a span" entry + the mounted RetranscribeControl — a
 *  completed-meeting-only, host-opted-in affordance. */
export function SpanRedoPanel({
  open,
  meeting,
  pendingSpan,
  onSelectSpan,
  onRetranscribed,
}: {
  open: boolean;
  meeting: MeetingWithTranscript;
  pendingSpan: PendingSpan | null;
  onSelectSpan: (span: PendingSpan | null) => void;
  onRetranscribed?: (segments: TranscriptSegment[], note: RetranscribedSpan) => void;
}) {
  const [manualStart, setManualStart] = useState('');
  const [manualEnd, setManualEnd] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);

  if (!open || meeting.status !== 'completed' || !onRetranscribed) return null;

  const applyManualSpan = () => {
    const startMs = parseMmSs(manualStart);
    const endMs = parseMmSs(manualEnd);
    if (startMs === null || endMs === null || endMs <= startMs) {
      setManualError('Enter mm:ss start and end, with end after start.');
      return;
    }
    setManualError(null);
    onSelectSpan({ startMs, endMs });
  };

  return (
    <div className="mt-3 space-y-2 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-secondary)]">
        <span>Redo a span:</span>
        <input
          type="text"
          aria-label="Span start (mm:ss)"
          placeholder="mm:ss"
          value={manualStart}
          onChange={(e) => setManualStart(e.target.value)}
          className="w-16 bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] rounded px-1.5 py-0.5"
        />
        <span>–</span>
        <input
          type="text"
          aria-label="Span end (mm:ss)"
          placeholder="mm:ss"
          value={manualEnd}
          onChange={(e) => setManualEnd(e.target.value)}
          className="w-16 bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] rounded px-1.5 py-0.5"
        />
        <button type="button" onClick={applyManualSpan} className="text-[var(--color-accent)] hover:underline">
          Select
        </button>
      </div>
      {manualError && <p className="text-xs text-red-400">{manualError}</p>}
      {pendingSpan && (
        <RetranscribeControl
          meetingId={meeting.id}
          segments={meeting.segments}
          pendingSpan={pendingSpan}
          onApplied={(segments, note) => {
            onRetranscribed(segments, note);
            onSelectSpan(null);
          }}
        />
      )}
    </div>
  );
}
