// === FILE PURPOSE ===
// Step 4 of the orchestrated Digital Twin "Deep interview" flow (V3.3.5): the OPTIONAL
// "also fold in my meeting history?" offer, shown after the gap interview synthesizes.
// It only presents the choice — the parent runs the consent check (twin:research-history-info)
// and mining (twin:research-history), showing the reused cloud-consent dialog when the
// mining model is a cloud model. Either way nothing is saved: the merged draft goes to
// the wizard's editable review.
//
// === DEPENDENCIES ===
// react (implicit), lucide-react.

import { History, ChevronRight } from 'lucide-react';

export interface DeepHistoryStepProps {
  /** User wants to fold in meeting history (parent handles the consent check + mining). */
  onUseHistory: () => void;
  /** User declined — go straight to the editable review with what we have. */
  onSkip: () => void;
  /** Ref to the "Use my history" trigger, so the cloud-consent dialog can restore focus
   *  here on close (the trigger unmounts during the consent check and remounts alongside
   *  the dialog). */
  useHistoryButtonRef?: React.RefObject<HTMLButtonElement | null>;
}

export default function DeepHistoryStep({ onUseHistory, onSkip, useHistoryButtonRef }: DeepHistoryStepProps) {
  return (
    <div className="space-y-3 rounded-lg border border-[var(--color-border-accent)] bg-[var(--color-accent-muted)]/20 p-4">
      <div className="flex items-center gap-2">
        <History size={16} className="text-[var(--color-accent)] shrink-0" />
        <h4 className="text-sm font-medium text-[var(--color-text-primary)]">Also use your meeting history?</h4>
      </div>
      <p className="text-sm text-[var(--color-text-secondary)] break-words">
        We can mine your recent meetings, briefs, projects, and cards to fill any remaining gaps. You&apos;ll see
        exactly what would be read — and confirm first if a cloud model is configured. This step is optional.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          ref={useHistoryButtonRef}
          type="button"
          onClick={onUseHistory}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg font-medium text-sm bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white transition-all"
        >
          Use my history
          <ChevronRight size={16} />
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          Skip — go to review
        </button>
      </div>
    </div>
  );
}
