// === FILE PURPOSE ===
// One row in the Twin Memory ledger (V3.4 Task 3): the fact text, a category
// chip, a "learned in <session>" provenance link, and a one-tap Forget action.
// Pure presentational — TwinMemoryPanel owns data loading, the forget/undo round
// trip, and session-title resolution; this component only renders what it's given.
//
// === DEPENDENCIES ===
// lucide-react, shared/types/twin (TwinFact)

import { X } from 'lucide-react';
import type { TwinFact } from '../../../shared/types/twin';

const CATEGORY_LABEL: Record<TwinFact['category'], string> = {
  person: 'Person',
  project: 'Project',
  preference: 'Preference',
  domain: 'Domain',
  commitment: 'Commitment',
};

export interface TwinMemoryFactRowProps {
  fact: TwinFact;
  /** Resolved session title, or the graceful fallback ("a past session") when it
   *  can't be resolved / the session no longer exists. Never a raw id. */
  sessionLabel: string;
  /** True when fact.sourceMeetingId is a real id worth navigating to. */
  sessionLinkable: boolean;
  onOpenSession: () => void;
  onForget: () => void;
}

export default function TwinMemoryFactRow({
  fact,
  sessionLabel,
  sessionLinkable,
  onOpenSession,
  onForget,
}: TwinMemoryFactRowProps) {
  return (
    <li className="hud-panel clip-corner-cut-sm px-4 py-3 flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-[var(--color-text-primary)] break-words">{fact.fact}</p>
        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
          <span
            aria-label={`Category: ${CATEGORY_LABEL[fact.category]}`}
            className="px-2 py-0.5 rounded-full text-[0.6875rem] font-medium bg-[var(--color-accent-subtle)] text-[var(--color-accent)] border border-[var(--color-border-accent)]"
          >
            {CATEGORY_LABEL[fact.category]}
          </span>
          {sessionLinkable ? (
            <button
              type="button"
              onClick={onOpenSession}
              className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] underline decoration-dotted transition-colors"
            >
              learned in {sessionLabel}
            </button>
          ) : (
            <span className="text-xs text-[var(--color-text-muted)]">learned in {sessionLabel}</span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onForget}
        aria-label={`Forget: ${fact.fact}`}
        title="Forget this fact"
        className="flex items-center gap-1 px-2 py-1 rounded-md text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/10 text-xs transition-colors shrink-0"
      >
        <X size={13} />
        Forget
      </button>
    </li>
  );
}
