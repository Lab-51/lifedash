// === FILE PURPOSE ===
// Accessible "fact forgotten" undo snackbar for the Twin Memory ledger (V3.4 Task
// 3). Deliberately its own small component (not the app's global toast) so it can
// own precise focus management: the triggering "Forget" button no longer exists
// once a fact is removed from the list, so focus is moved onto Undo the instant
// this mounts, and the ~5s auto-expiry (or an explicit undo) hands focus back to
// the caller via onExpire/onUndo. Mirrors the focus-on-mount discipline used by
// DeepInterviewStep / TwinResearchConsentDialog elsewhere in the Twin flows.
//
// === DEPENDENCIES ===
// react, lucide-react

import { useEffect, useRef } from 'react';
import { Undo2 } from 'lucide-react';

const AUTO_DISMISS_MS = 5000;

export interface TwinMemoryUndoSnackbarProps {
  /** The forgotten fact's own text, shown in the message. */
  factText: string;
  onUndo: () => void;
  /** Fired when the ~5s window elapses without an undo. */
  onExpire: () => void;
}

export default function TwinMemoryUndoSnackbar({ factText, onUndo, onExpire }: TwinMemoryUndoSnackbarProps) {
  const undoRef = useRef<HTMLButtonElement>(null);

  // Focus the Undo action the moment the snackbar appears — the row (and its
  // Forget button) that triggered this is already gone from the DOM.
  useEffect(() => {
    undoRef.current?.focus();
  }, []);

  // Auto-dismiss after ~5s; a fresh instance (keyed by fact id by the caller)
  // gets its own timer, so this only needs to run once per mount.
  useEffect(() => {
    const timer = setTimeout(onExpire, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className="hud-panel clip-corner-cut-sm px-4 py-2.5 flex items-center gap-3 flex-wrap"
    >
      <span className="text-sm text-[var(--color-text-primary)] break-words">
        Forgot: <span className="text-[var(--color-text-secondary)]">&ldquo;{factText}&rdquo;</span>
      </span>
      <button
        ref={undoRef}
        type="button"
        onClick={onUndo}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-sm font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] transition-colors shrink-0"
      >
        <Undo2 size={14} />
        Undo
      </button>
    </div>
  );
}
