// === FILE PURPOSE ===
// The transcript's own honesty about itself (TRANS-COV.1 Task 5) — turns a
// meeting's coverage record + suspect-span count (coverageVerdict.ts, Task 3)
// into one small badge: a quiet check when every window is accounted for, a
// warning with an expandable list of gaps when it isn't, and a muted note when
// the meeting predates coverage tracking at all. Clicking a gap hands its
// bounds to the host via `onShowSpan` — this component never navigates or
// knows what a "span" means to the rest of the app.
//
// === DEPENDENCIES ===
// lucide-react (Check/AlertTriangle — the app's established check/warning
// glyphs; EvidenceChip.tsx documents AlertTriangle as the shared one), ./utils
// (formatTimestamp), shared/transcription/coverageVerdict (pure, renderer-safe).

import { useState } from 'react';
import { Check, AlertTriangle } from 'lucide-react';
import { formatTimestamp } from './utils';
import { coverageVerdict } from '../../../shared/transcription/coverageVerdict';
import type { CoverageGap, TranscriptionCoverage } from '../../../shared/types';

interface CoverageBadgeProps {
  coverage: TranscriptionCoverage | null;
  suspectCount: number;
  onShowSpan: (startMs: number, endMs: number) => void;
}

function GapRow({ gap, onShowSpan }: { gap: CoverageGap; onShowSpan: (startMs: number, endMs: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onShowSpan(gap.startMs, gap.endMs)}
      className="flex items-center gap-1.5 text-[11px] text-left text-amber-300 hover:text-amber-200 hover:underline w-full"
    >
      <span className="font-data shrink-0">
        {formatTimestamp(gap.startMs)}–{formatTimestamp(gap.endMs)}
      </span>
      <span className="text-amber-400/70 shrink-0">{gap.channel}</span>
      <span className="text-amber-400/70 truncate">{gap.reason}</span>
    </button>
  );
}

export default function CoverageBadge({ coverage, suspectCount, onShowSpan }: CoverageBadgeProps) {
  const [expanded, setExpanded] = useState(false);
  const { verdict, reasons } = coverageVerdict(coverage, suspectCount);
  const title = reasons.join(' ');

  if (verdict === 'unknown') {
    return (
      <span className="text-[var(--color-text-muted)] text-xs">
        coverage unknown (recorded before coverage tracking)
      </span>
    );
  }

  if (verdict === 'complete') {
    return (
      <span
        className="inline-flex items-center gap-1 text-[var(--color-text-muted)] text-xs"
        title={title || 'Every window was transcribed.'}
      >
        <Check size={12} aria-hidden="true" />
        Complete
      </span>
    );
  }

  const label = verdict === 'recovered' ? 'Recovered after an abnormal stop' : 'Partial';
  const gaps = coverage?.gaps ?? [];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        title={title}
        className="inline-flex items-center gap-1 text-amber-400 text-xs hover:text-amber-300 transition-colors"
      >
        <AlertTriangle size={12} aria-hidden="true" />
        {label}
      </button>
      {expanded && gaps.length > 0 && (
        <div className="absolute z-20 top-full left-0 mt-1 min-w-[220px] max-h-48 overflow-y-auto bg-white dark:bg-surface-900 border border-[var(--color-border)] rounded-lg shadow-lg p-2 space-y-1">
          {gaps.map((gap, i) => (
            <GapRow key={i} gap={gap} onShowSpan={onShowSpan} />
          ))}
        </div>
      )}
    </div>
  );
}
