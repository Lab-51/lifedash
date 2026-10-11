// === FILE PURPOSE ===
// The Memory tab's Forgotten list (TWIN-LOOP.2 Task 3). Forget is reversible by
// design; this is where the user sees what they forgot and either brings a fact back
// (Restore) or makes it final (Delete permanently — one fact, or all of them).
//
// Deleting permanently erases the fact's text; main keeps only a one-way fingerprint
// so the twin never learns that fact again (twinMemoryService.purgeFact). Both deletes
// go through the app's ConfirmDialog, and its copy says plainly that backups made
// before now still contain the text — a purge cannot reach into a backup file.
//
// Focus: ConfirmDialog focuses its confirm button on open (the app-wide pattern).
// Cancel hands focus back to the button that opened it; a completed restore or
// delete removes that button's row, so focus lands on this list's heading instead.
//
// === DEPENDENCIES ===
// react, lucide-react, ConfirmDialog, shared/types (TwinFact)

import { useCallback, useEffect, useRef, useState } from 'react';
import { Trash2, Undo2 } from 'lucide-react';
import { ConfirmDialog } from '../ConfirmDialog';
import type { TwinFact } from '../../../shared/types';

const BACKUP_NOTE = 'Backups made before now still contain the text.';
const LOAD_ERROR = 'Could not load forgotten facts.';
const RESTORE_ERROR = 'Could not restore that fact — please try again.';
const PURGE_ERROR = 'Could not delete that fact permanently — it may already be gone.';
const PURGE_ALL_ERROR = 'Could not delete the forgotten facts — please try again.';

/** One round trip; a missing bridge or a sync throw becomes a rejection. */
function fetchForgotten(): Promise<TwinFact[]> {
  return Promise.resolve().then(() => window.electronAPI.twinMemoryListForgotten());
}

/**
 * The forgotten facts (never purged ones — main excludes those), loaded while the
 * Memory tab is on screen. `facts` is null until the first load lands, so a count
 * is never shown before it is known. `reload` is called by the host after anything
 * that changes the list (a forget, an undo, a restore or a delete).
 */
export function useForgottenFacts(active: boolean): {
  facts: TwinFact[] | null;
  loadError: boolean;
  reload: () => Promise<void>;
} {
  const [facts, setFacts] = useState<TwinFact[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const reload = useCallback(async () => {
    try {
      const rows = await fetchForgotten();
      setFacts(rows);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  // Inline .then (not reload()) so no state is set synchronously inside the effect;
  // `live` drops a reply that lands after the tab was left or the host unmounted.
  useEffect(() => {
    if (!active) return;
    let live = true;
    void fetchForgotten().then(
      (rows) => {
        if (!live) return;
        setFacts(rows);
        setLoadError(false);
      },
      () => {
        if (live) setLoadError(true);
      },
    );
    return () => {
      live = false;
    };
  }, [active]);

  return { facts, loadError, reload };
}

type PendingConfirm = { kind: 'one'; fact: TwinFact } | { kind: 'all'; count: number };

export interface TwinForgottenListProps {
  facts: TwinFact[] | null;
  loadError: boolean;
  /** Called after a successful restore or delete: reload this list (and, for a
   *  restore, the graph the fact returns to). */
  onChanged: (restored: boolean) => Promise<void>;
}

export default function TwinForgottenList({ facts, loadError, onChanged }: TwinForgottenListProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const askConfirm = (next: PendingConfirm) => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPending(next);
  };

  const cancelConfirm = () => {
    setPending(null);
    openerRef.current?.focus();
  };

  /** Runs one mutation; on success the list reloads and focus moves to the heading,
   *  because the row (and the button that started this) is gone. */
  const run = async (action: () => Promise<boolean>, failure: string, restored: boolean) => {
    setBusy(true);
    try {
      const ok = await action();
      setError(ok ? null : failure);
      await onChanged(restored && ok);
      headingRef.current?.focus();
    } catch {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    const current = pending;
    setPending(null);
    if (!current) return;
    if (current.kind === 'one') {
      void run(() => window.electronAPI.twinMemoryPurge(current.fact.id), PURGE_ERROR, false);
    } else {
      void run(async () => (await window.electronAPI.twinMemoryPurgeAllForgotten()) >= 0, PURGE_ALL_ERROR, false);
    }
  };

  const restore = (fact: TwinFact) =>
    void run(async () => (await window.electronAPI.twinMemoryRestore(fact.id)) !== null, RESTORE_ERROR, true);

  return (
    <section
      id="twin-forgotten-list"
      aria-labelledby="twin-forgotten-heading"
      className="shrink-0 hud-panel clip-corner-cut-sm p-4 flex flex-col gap-3 min-w-0"
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3
            id="twin-forgotten-heading"
            ref={headingRef}
            tabIndex={-1}
            className="text-sm font-medium text-[var(--color-text-primary)] outline-none"
          >
            Forgotten facts
          </h3>
          <p className="text-xs text-[var(--color-text-secondary)] break-words">
            Forgotten facts are not used and are not learned again. Restore one, or delete it permanently.
          </p>
        </div>
        {facts && facts.length > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => askConfirm({ kind: 'all', count: facts.length })}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-red-500/40 text-red-400 hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            <Trash2 size={13} />
            Delete all forgotten permanently
          </button>
        )}
      </div>

      {(error || loadError) && (
        <p role="alert" className="text-sm text-red-400 break-words">
          {error ?? LOAD_ERROR}
        </p>
      )}

      <ForgottenRows
        facts={facts}
        busy={busy}
        onRestore={restore}
        onDelete={(f) => askConfirm({ kind: 'one', fact: f })}
      />

      <ConfirmDialog
        open={pending !== null}
        title={pending?.kind === 'all' ? 'Delete all forgotten facts permanently?' : 'Delete this fact permanently?'}
        message={confirmMessage(pending)}
        confirmLabel="Delete permanently"
        variant="danger"
        onConfirm={confirm}
        onCancel={cancelConfirm}
      >
        {pending?.kind === 'one' && (
          <blockquote className="mb-6 max-h-32 overflow-y-auto break-words border-l-2 border-[var(--color-border)] pl-3 text-sm text-[var(--color-text-primary)]">
            {pending.fact.fact}
          </blockquote>
        )}
      </ConfirmDialog>
    </section>
  );
}

function confirmMessage(pending: PendingConfirm | null): string {
  if (pending?.kind === 'all') {
    const what = pending.count === 1 ? 'The 1 forgotten fact' : `All ${pending.count} forgotten facts`;
    return `${what} will be erased from the twin's memory and cannot be restored. The twin keeps only a one-way fingerprint so it never learns them again. ${BACKUP_NOTE}`;
  }
  return `This fact will be erased from the twin's memory and cannot be restored. The twin keeps only a one-way fingerprint so it never learns it again. ${BACKUP_NOTE}`;
}

function ForgottenRows({
  facts,
  busy,
  onRestore,
  onDelete,
}: {
  facts: TwinFact[] | null;
  busy: boolean;
  onRestore: (fact: TwinFact) => void;
  onDelete: (fact: TwinFact) => void;
}) {
  if (!facts) return null;
  if (facts.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">Nothing is forgotten.</p>;
  }
  return (
    <ul aria-label="Forgotten facts" className="flex flex-col gap-2 max-h-80 overflow-y-auto min-w-0">
      {facts.map((fact) => (
        <li
          key={fact.id}
          className="flex items-start gap-3 px-3 py-2 rounded-lg border border-[var(--color-border)] min-w-0"
        >
          <p className="min-w-0 flex-1 text-sm text-[var(--color-text-primary)] break-words">{fact.fact}</p>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              disabled={busy}
              onClick={() => onRestore(fact)}
              aria-label={`Restore: ${fact.fact}`}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Undo2 size={13} />
              Restore
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onDelete(fact)}
              aria-label={`Delete permanently: ${fact.fact}`}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Trash2 size={13} />
              Delete permanently
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
