// === FILE PURPOSE ===
// Settings section for the V3.4 local semantic index (AI & Models tab). Shows
// backfill progress ("Semantic index: 412 / 1,900"), whether embedding runs
// locally or via a cloud provider, and surfaces the non-blocking model-mismatch
// "rebuild?" affordance. Backfill is idempotent/resumable/skippable — the buttons
// just kick main-process jobs and poll embedding:status for progress.
//
// The embedding bridge methods are part of the typed ElectronAPI, so this section
// uses window.electronAPI directly — no local cast.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Database, RefreshCw, AlertTriangle, Info, X } from 'lucide-react';
import type { EmbeddingStatus } from '../../../shared/types';

const api = window.electronAPI;

export default function SemanticIndexSection() {
  const [status, setStatus] = useState<EmbeddingStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.getEmbeddingStatus());
    } catch {
      // Non-fatal — leave the last known status in place.
    }
  }, []);

  // Initial load + poll while a backfill/rebuild is running.
  useEffect(() => {
    void refresh();
    pollRef.current = setInterval(() => void refresh(), 1500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refresh]);

  const runBackfill = async () => {
    setBusy(true);
    try {
      await api.startEmbeddingBackfill();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const rebuild = async () => {
    setBusy(true);
    try {
      await api.rebuildEmbeddingIndex();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async () => {
    await api.dismissEmbeddingBackfill();
    await refresh();
  };

  if (!status) return null;

  const { indexed, total, running, route, mismatch, backfillDismissed } = status;
  const pending = total - indexed;
  const pct = total > 0 ? Math.round((indexed / total) * 100) : 0;

  return (
    <section className="hud-panel-accent clip-corner-cut-sm p-6">
      <div className="mb-4">
        <div className="flex items-center gap-3 mb-1">
          <Database size={16} className="text-[var(--color-accent)]" />
          <span className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent-dim)]">
            Semantic Index
          </span>
          <div className="h-px flex-1 bg-gradient-to-r from-[var(--color-accent)] to-transparent opacity-30" />
        </div>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Local vector index over your briefs, transcripts, and cards — powers semantic search and Twin memory.
        </p>
      </div>

      {/* Route: never leaves the device unless the user explicitly picks a cloud model */}
      {route === null ? (
        <p className="mb-4 flex items-start gap-1.5 text-xs text-amber-400">
          <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            No embedding model configured. Assign a local model to the Embedding task in Model Assignments above.
          </span>
        </p>
      ) : (
        <p className="mb-4 flex items-start gap-1.5 text-xs text-[var(--color-text-secondary)]">
          <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            Indexing via <span className="text-[var(--color-accent)]">{route.providerName}</span>{' '}
            {route.isLocal ? '(on-device)' : '(cloud — bulk content leaves your machine)'}.
          </span>
        </p>
      )}

      {/* Progress */}
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="text-[var(--color-text-primary)]">
          Semantic index: {indexed.toLocaleString()} / {total.toLocaleString()}
        </span>
        <span className="text-[var(--color-text-muted)] font-data">{running ? 'Indexing…' : `${pct}%`}</span>
      </div>
      <div className="h-1.5 bg-[var(--color-border)] rounded-full overflow-hidden">
        <div className="h-full bg-[var(--color-accent)] rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>

      {/* Mismatch → rebuild affordance (non-blocking) */}
      {mismatch && (
        <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-300">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <div className="flex-1">
              <p>
                Index was built with <span className="font-data">{mismatch.stored}</span>, current model is{' '}
                <span className="font-data">{mismatch.current}</span>. Rebuild to avoid mixing vector spaces.
              </p>
              <button
                onClick={rebuild}
                disabled={busy}
                className="mt-2 flex items-center gap-1.5 border border-amber-500/50 hover:border-amber-500 text-amber-300 px-3 py-1.5 text-xs transition-all disabled:opacity-50"
              >
                <RefreshCw size={13} className={busy ? 'animate-spin' : ''} />
                Rebuild index
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Backfill CTA — idempotent/skippable */}
      {route !== null && pending > 0 && !mismatch && (
        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={runBackfill}
            disabled={busy || running}
            className="flex items-center gap-1.5 border border-[var(--color-accent-dim)] hover:border-[var(--color-accent)] text-[var(--color-accent)] hover:shadow-[0_0_12px_var(--color-chrome-glow)] disabled:opacity-50 px-3 py-1.5 text-sm transition-all"
          >
            <RefreshCw size={14} className={running ? 'animate-spin' : ''} />
            {running ? 'Indexing…' : `Index ${pending.toLocaleString()} remaining`}
          </button>
          {!backfillDismissed && (
            <button
              onClick={dismiss}
              className="flex items-center gap-1.5 text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] text-sm transition-colors"
            >
              <X size={14} />
              Dismiss
            </button>
          )}
        </div>
      )}
    </section>
  );
}
