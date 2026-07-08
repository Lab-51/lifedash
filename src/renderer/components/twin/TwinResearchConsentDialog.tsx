// === FILE PURPOSE ===
// Digital Twin "Build from my history" CLOUD-CONSENT dialog (V3.3.5 — Task 3).
// Shown ONLY when the resolved mining model is a cloud model (local models never
// prompt). It states, in plain terms, exactly what would leave the machine — the
// counts from the consent descriptor (meeting excerpts, briefs, projects, cards)
// and the provider it would be sent to — and requires an explicit Confirm before
// any run. This is a per-run gate with NO remember-me (a locked session decision):
// every cloud run shows it again.
//
// Accessibility: a labelled modal dialog (role="dialog", aria-modal) with a focus
// trap, Escape-to-cancel, and an overlay-click cancel. Focus opens on Cancel — the
// safe default for an action that sends data off-device.
//
// === DEPENDENCIES ===
// react, lucide-react, shared/types/twin (TwinResearchHistoryInfo).

import { useCallback, useEffect, useId, useRef } from 'react';
import { ShieldAlert } from 'lucide-react';
import type { TwinResearchHistoryInfo } from '../../../shared/types/twin';

export interface TwinResearchConsentDialogProps {
  /** The consent descriptor — counts + provider — computed with NO model call. */
  info: TwinResearchHistoryInfo;
  /** User agreed: run the (cloud) mining pass. */
  onConfirm: () => void;
  /** User declined or dismissed: nothing is sent. */
  onCancel: () => void;
  /**
   * The element that opened the dialog. Focus is restored to it when the dialog
   * closes (Escape / Cancel / Confirm), per WCAG 2.4.3 — so keyboard users are not
   * dumped to <body>. Falls back to whatever had focus at open time if omitted.
   */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}

/** "N thing" / "N things" — omit entirely when the count is zero. */
function countLabel(n: number, singular: string): string | null {
  if (n <= 0) return null;
  return `${n} ${n === 1 ? singular : `${singular}s`}`;
}

/** A human list of exactly what would be sent, e.g. "3 meeting excerpts, 1 brief and 5 cards". */
function summarize(info: TwinResearchHistoryInfo): string {
  const parts = [
    countLabel(info.excerptCount, 'meeting excerpt'),
    countLabel(info.briefCount, 'brief'),
    countLabel(info.projectCount, 'project'),
    countLabel(info.cardCount, 'card'),
  ].filter((p): p is string => p !== null);

  if (parts.length === 0) return 'your meeting history';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export default function TwinResearchConsentDialog({
  info,
  onConfirm,
  onCancel,
  returnFocusRef,
}: TwinResearchConsentDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();

  // Open focus on the safe (non-sending) action, and restore focus to the opener on
  // close so keyboard/SR users keep their place (WCAG 2.4.3). The opener element is
  // stable for the dialog's lifetime, so capture it at mount and use that captured
  // value in cleanup (avoids reading a possibly-changed ref inside the cleanup).
  useEffect(() => {
    const restoreTo = returnFocusRef?.current ?? (document.activeElement as HTMLElement | null);
    cancelRef.current?.focus();
    return () => {
      restoreTo?.focus?.();
    };
  }, [returnFocusRef]);

  // Escape cancels; Tab is trapped between the dialog's focusable controls.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button');
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onCancel],
  );

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onKeyDown={handleKeyDown}
        className="bg-[var(--color-chrome)] border border-[var(--color-border)] rounded-xl shadow-2xl p-6 max-w-md w-full mx-4"
      >
        <div className="flex items-start gap-2.5 mb-3">
          <ShieldAlert size={18} className="text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
          <h3 id={titleId} className="text-sm font-semibold text-[var(--color-text-primary)]">
            Send your history to a cloud model?
          </h3>
        </div>

        <p id={descId} className="text-sm text-[var(--color-text-secondary)] mb-4 break-words">
          Building your twin from history will send{' '}
          <span className="text-[var(--color-text-primary)]">{summarize(info)}</span> to{' '}
          <span className="text-[var(--color-text-primary)] font-medium">{info.providerLabel}</span>. This data leaves
          your machine. Nothing is sent until you confirm, and you will be asked again every time.
        </p>

        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-subtle)] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 text-sm rounded-lg bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white transition-colors"
          >
            Send &amp; build
          </button>
        </div>
      </div>
    </div>
  );
}
