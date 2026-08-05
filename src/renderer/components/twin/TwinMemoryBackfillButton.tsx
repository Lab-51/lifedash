// === FILE PURPOSE ===
// The visible trigger for TWIN-READ.1 Task 1's label backfill — the one action
// that turns existing facts' DERIVED fallback labels into real LLM-written ones.
// Task 1 built and tested `backfillFactLabels()` and its `twin:memory-backfill-
// labels` channel but deliberately shipped no UI; this is that UI.
//
// WHY IT IS A SEPARATE COMPONENT and not another button inside TwinMemoryGraph:
// the graph host is about the safety triad, and this action has its own async
// state (in-flight, outcome message). Keeping it here means the triad's file
// does not grow a third concern. It renders in the graph's HEADER chrome and
// deliberately sits AFTER the pause switch in DOM order, so the kill-switch's
// distance from the start of the tab sequence does not change.
//
// >>> HONEST ABOUT THE OUTCOME — the whole point of the copy below. <<<
// The backfill is a typed no-op when learning is PAUSED or no model is
// configured; a fact with no stored label still renders via the derived fallback
// (shared/twin/factLabel.ts), so a skipped backfill is a quality regression, not
// a breakage. Saying nothing in those cases would look like a dead button, so
// every branch of BackfillFactLabelsResult says what actually happened —
// including "the model labelled none of them". One call labels one bounded
// chunk, so `remaining > 0` invites another run rather than pretending it
// finished.
//
// The forced refresh afterwards exists because a relabel changes node LABELS
// while every node id stays the same — a change the store's id-diff cannot see
// (see twinMemoryGraphStore.refresh's doc).
//
// === DEPENDENCIES ===
// react, lucide-react, twinMemoryGraphStore, window.electronAPI.twinMemoryBackfillLabels

import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { useTwinMemoryGraphStore } from '../../stores/twinMemoryGraphStore';
import type { BackfillFactLabelsResult } from '../../../shared/types';

const FAILED_MESSAGE = 'Could not improve labels — please try again.';

/** "1 label" / "3 labels" — the counts are user-facing, so they read as English. */
function labelCount(n: number): string {
  return `${n} label${n === 1 ? '' : 's'}`;
}

/** Plain language for every branch of the result, including the two no-ops. */
export function backfillMessageFor(result: BackfillFactLabelsResult): string {
  if (result.status === 'skipped') {
    if (result.reason === 'paused') return 'Learning is paused — resume it to improve labels.';
    if (result.reason === 'no-model') return 'No AI model is configured, so labels are unchanged.';
    return 'Nothing was changed.';
  }
  if (result.remaining > 0) {
    return result.labeled > 0
      ? `Improved ${labelCount(result.labeled)} — ${result.remaining} to go. Run it again to continue.`
      : `No labels could be improved this time — ${result.remaining} still to go.`;
  }
  return result.labeled > 0 ? `Improved ${labelCount(result.labeled)}.` : 'Every fact already has a label.';
}

/** Small, unobtrusive header action: one bounded backfill chunk per press. */
export default function TwinMemoryBackfillButton() {
  const refresh = useTwinMemoryGraphStore((s) => s.refresh);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const run = async (): Promise<void> => {
    setRunning(true);
    setMessage(null);
    try {
      const result = await window.electronAPI.twinMemoryBackfillLabels();
      setMessage(backfillMessageFor(result));
      // Only when something actually changed on disk — a forced refetch is the
      // only way the new labels reach the canvas (node ids never change).
      if (result.status === 'ok' && result.labeled > 0) await refresh(true);
    } catch {
      setMessage(FAILED_MESSAGE);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1 min-w-0">
      <button
        type="button"
        onClick={() => void run()}
        disabled={running}
        title="Ask the local model for a short label for facts that don't have one yet"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:border-[var(--color-border-accent)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {running ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
        {running ? 'Improving…' : 'Improve labels'}
      </button>
      {message && (
        <p
          role="status"
          className="max-w-[15rem] text-right text-[0.6875rem] text-[var(--color-text-muted)] break-words"
        >
          {message}
        </p>
      )}
    </div>
  );
}
