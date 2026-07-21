// === FILE PURPOSE ===
// Cloud-transcription CONSENT dialog (GUARD.1 — Task 4). Shown when the user
// switches transcription FROM local Whisper TO a cloud provider (Deepgram /
// AssemblyAI). It states, in plain terms, that meeting audio will leave the
// machine and be sent to the named provider's servers, and requires an explicit
// confirm before the switch persists. Declining keeps the selection on local.
//
// Unlike TwinResearchConsentDialog (a per-RUN gate), this is a per-provider-SWITCH
// gate: consenting once persists the cloud provider until the user switches again —
// this is a settings change, not a per-recording action.
//
// Accessibility (mirrors TwinResearchConsentDialog): a labelled modal
// (role="dialog", aria-modal) with a focus trap, Escape-to-cancel, overlay-click
// cancel, focus opening on the safe (Cancel) action, and focus restored to the
// opener on close (WCAG 2.4.3).
//
// === DEPENDENCIES ===
// react, lucide-react.

import { useCallback, useEffect, useId, useRef } from 'react';
import { ShieldAlert } from 'lucide-react';

/** Human labels for the cloud providers this dialog gates. */
const PROVIDER_LABELS: Record<'deepgram' | 'assemblyai', string> = {
  deepgram: 'Deepgram',
  assemblyai: 'AssemblyAI',
};

export interface CloudTranscriptionConsentDialogProps {
  /** The cloud provider the user is switching to. */
  provider: 'deepgram' | 'assemblyai';
  /** User agreed: persist the cloud provider selection. */
  onConfirm: () => void;
  /** User declined or dismissed: selection stays on local. */
  onCancel: () => void;
  /**
   * The element that opened the dialog. Focus is restored to it when the dialog
   * closes (Escape / Cancel / Confirm), per WCAG 2.4.3. Falls back to whatever had
   * focus at open time if omitted.
   */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}

export default function CloudTranscriptionConsentDialog({
  provider,
  onConfirm,
  onCancel,
  returnFocusRef,
}: CloudTranscriptionConsentDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();
  const label = PROVIDER_LABELS[provider];

  // Open focus on the safe (non-sending) action, and restore focus to the opener on
  // close so keyboard/SR users keep their place (WCAG 2.4.3). Capture the opener at
  // mount and use that captured value in cleanup.
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
            Send meeting audio to {label}?
          </h3>
        </div>

        <p id={descId} className="text-sm text-[var(--color-text-secondary)] mb-4 break-words">
          Switching to <span className="text-[var(--color-text-primary)] font-medium">{label}</span> means your meeting
          audio will be sent to {label}&rsquo;s servers for transcription. This audio leaves your machine. Local
          (Whisper) keeps every recording on-device. Nothing is sent until you confirm. See the &ldquo;Meeting
          Recordings&rdquo; section of the Privacy Policy for details.
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
            Send to {label}
          </button>
        </div>
      </div>
    </div>
  );
}
