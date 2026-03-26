// === FILE PURPOSE ===
// Reusable dismissible feature tip — shows an explanation of how a page/feature works.
// Persists dismissal in localStorage. Provides a "How does it work?" button to restore.
// Uses useSyncExternalStore so FeatureTip and FeatureTip.Button share state instantly.

import { useCallback, useSyncExternalStore, type ReactNode } from 'react';
import { Info, X, HelpCircle } from 'lucide-react';

// ---------------------------------------------------------------------------
// Shared state — allows FeatureTip and FeatureTip.Button with the same ID
// to stay in sync without a wrapping context provider.
// ---------------------------------------------------------------------------

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

function storageKey(id: string) {
  return `feature-tip-dismissed:${id}`;
}

function isDismissed(id: string): boolean {
  return localStorage.getItem(storageKey(id)) === '1';
}

function setDismissed(id: string, value: boolean) {
  if (value) {
    localStorage.setItem(storageKey(id), '1');
  } else {
    localStorage.removeItem(storageKey(id));
  }
  // Notify all subscribers for this ID
  listeners.get(id)?.forEach((fn) => fn());
}

function subscribe(id: string, listener: Listener): () => void {
  if (!listeners.has(id)) listeners.set(id, new Set());
  listeners.get(id)!.add(listener);
  return () => {
    listeners.get(id)?.delete(listener);
    if (listeners.get(id)?.size === 0) listeners.delete(id);
  };
}

/** Hook that returns the current dismissed state for a tip ID. */
function useTipDismissed(id: string): boolean {
  const sub = useCallback((cb: Listener) => subscribe(id, cb), [id]);
  const snap = useCallback(() => isDismissed(id), [id]);
  return useSyncExternalStore(sub, snap);
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

interface FeatureTipProps {
  /** Unique ID for localStorage persistence. */
  id: string;
  /** Bold title shown at the start of the tip. */
  title: string;
  /** Tip body content — can include JSX. */
  children: ReactNode;
  /** Optional max width class. Defaults to max-w-2xl. */
  maxWidth?: string;
}

/** Dismissible info banner. Pair with <FeatureTip.Button id="same-id" />. */
export default function FeatureTip({ id, title, children, maxWidth = 'max-w-2xl' }: FeatureTipProps) {
  const dismissed = useTipDismissed(id);

  if (dismissed) return null;

  return (
    <div
      className={`flex items-start gap-3 p-3 mt-3 mb-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-chrome)] text-sm text-[var(--color-text-secondary)] ${maxWidth}`}
    >
      <Info size={16} className="shrink-0 mt-0.5 text-[var(--color-accent)]" />
      <div className="flex-1">
        <span className="font-medium text-[var(--color-text-primary)]">{title}: </span>
        {children}
      </div>
      <button
        onClick={() => setDismissed(id, true)}
        className="cursor-pointer shrink-0 p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
        aria-label="Dismiss tip"
      >
        <X size={14} />
      </button>
    </div>
  );
}

/** "How does it work?" button — only renders when the tip is dismissed. */
FeatureTip.Button = function FeatureTipButton({ id }: { id: string }) {
  const dismissed = useTipDismissed(id);

  if (!dismissed) return null;

  return (
    <button
      onClick={() => setDismissed(id, false)}
      className="cursor-pointer shrink-0 flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)] transition-colors"
      title="Show feature guide"
    >
      <HelpCircle size={14} />
      How does it work?
    </button>
  );
};
