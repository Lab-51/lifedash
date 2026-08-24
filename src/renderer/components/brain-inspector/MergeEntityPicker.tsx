// === FILE PURPOSE ===
// The "Merge into…" picker + confirm step for EntityInspector (ENTITY-NAME.1
// Task 3) — extracted to its own file purely to keep EntityInspectors.tsx under
// its 500-line ceiling. Two steps, both rendered INLINE (no modal/portal,
// matching EntityInspector's other local-state affordances):
//   1. browsing  — same-kind candidates from entity:merge-candidates, which
//      already excludes the source and every other-kind entity SERVER-SIDE.
//      Nothing here re-filters — that server-side exclusion IS the picker's
//      safety boundary, alongside mergeEntityInto's own guards on the actual
//      merge call.
//   2. confirming — explicit counts + "cannot be undone" before entity:merge
//      actually runs. This step is not decoration: the phase ships with NO
//      undo, and this text is the entire safety argument for that (see
//      entityNameFoldSweep.ts's file header and the phase's session decisions).
// Reports the survivor back to the caller via onMerged; never touches the
// Brain tree/store itself — that's the caller's job (refresh + re-point).
//
// === DEPENDENCIES ===
// react, lucide-react, entityMergeCandidates/entityMerge IPC (window.electronAPI),
// shared EntityMergeCandidate type

import { useEffect, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import type { EntityMergeCandidate } from '../../../shared/types';

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'browsing' }
  | { kind: 'confirming'; target: EntityMergeCandidate }
  | { kind: 'merging'; target: EntityMergeCandidate }
  | { kind: 'merge-error'; target: EntityMergeCandidate; message: string };

export interface MergeEntityPickerProps {
  sourceId: string;
  sourceName: string;
  /** The source's OWN current fact/session-link counts — what the confirm step
   *  discloses as "moves N facts and M session links", supplied by the caller
   *  from state it already has loaded rather than re-fetched here. */
  factCount: number;
  linkCount: number;
  onCancel: () => void;
  onMerged: (result: { survivorId: string; survivorName: string }) => void;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export default function MergeEntityPicker({
  sourceId,
  sourceName,
  factCount,
  linkCount,
  onCancel,
  onMerged,
}: MergeEntityPickerProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [candidates, setCandidates] = useState<EntityMergeCandidate[]>([]);

  // Guards a setState after unmount (e.g. the host re-pins to an unrelated node
  // mid-fetch) — mirrors EntityInspector's own cancelledRef pattern. The merge
  // itself can't be interrupted this way in normal use: the cancel (X) button is
  // disabled for the whole 'merging' phase, so a user can't unmount mid-flight.
  const cancelledRef = useRef(false);
  useEffect(
    () => () => {
      cancelledRef.current = true;
    },
    [],
  );

  useEffect(() => {
    window.electronAPI
      .entityMergeCandidates(sourceId)
      .then((list) => {
        if (!cancelledRef.current) {
          setCandidates(list);
          setPhase({ kind: 'browsing' });
        }
      })
      .catch(() => {
        if (!cancelledRef.current) setPhase({ kind: 'error', message: 'Could not load entities to merge into.' });
      });
  }, [sourceId]);

  const confirmMerge = async (target: EntityMergeCandidate) => {
    setPhase({ kind: 'merging', target });
    try {
      const result = await window.electronAPI.entityMerge({ sourceId, targetId: target.id });
      if (result.status === 'error') {
        if (!cancelledRef.current) setPhase({ kind: 'merge-error', target, message: result.message });
        return;
      }
      onMerged({ survivorId: result.survivorId, survivorName: target.name });
    } catch {
      if (!cancelledRef.current) setPhase({ kind: 'merge-error', target, message: 'Could not merge. Try again.' });
    }
  };

  const merging = phase.kind === 'merging';

  return (
    <div
      role="group"
      aria-label="Merge into…"
      className="flex flex-col gap-2 p-2.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-hud text-[0.625rem] tracking-widest uppercase text-[var(--color-accent-dim)]">
          Merge into…
        </span>
        <button
          type="button"
          onClick={onCancel}
          disabled={merging}
          aria-label="Cancel merge"
          className="shrink-0 p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <X size={13} />
        </button>
      </div>

      {phase.kind === 'loading' && (
        <p role="status" className="text-xs text-[var(--color-text-muted)] flex items-center gap-1.5">
          <Loader2 size={12} className="animate-spin" /> Loading entities…
        </p>
      )}

      {phase.kind === 'error' && <p className="text-xs text-[var(--color-text-muted)]">{phase.message}</p>}

      {phase.kind === 'browsing' && candidates.length === 0 && (
        <p className="text-xs text-[var(--color-text-muted)]">Nothing else of this kind to merge into yet.</p>
      )}

      {phase.kind === 'browsing' && candidates.length > 0 && (
        <ul className="flex flex-col gap-1 max-h-48 overflow-y-auto">
          {candidates.map((candidate) => (
            <li key={candidate.id}>
              <button
                type="button"
                onClick={() => setPhase({ kind: 'confirming', target: candidate })}
                className="w-full flex items-center justify-between gap-2 text-left text-sm text-[var(--color-text-secondary)] px-2 py-1.5 rounded-md border border-[var(--color-border)] hover:border-[var(--color-border-accent)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                <span className="min-w-0 truncate break-words">{candidate.name}</span>
                <span className="shrink-0 text-xs font-data text-[var(--color-text-muted)]">
                  {plural(candidate.factCount, 'fact')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {(phase.kind === 'confirming' || phase.kind === 'merging' || phase.kind === 'merge-error') && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-[var(--color-text-secondary)] break-words">
            Merge {sourceName} into {phase.target.name}?
          </p>
          <p className="text-xs text-[var(--color-text-muted)] break-words">
            Moves {plural(factCount, 'fact')} and {plural(linkCount, 'session link')} onto {phase.target.name}; this
            cannot be undone.
          </p>
          {phase.kind === 'merge-error' && <p className="text-xs text-red-400 break-words">{phase.message}</p>}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPhase({ kind: 'browsing' })}
              disabled={merging}
              className="text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void confirmMerge(phase.target)}
              disabled={merging}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-red-400 hover:text-red-300 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {merging && <Loader2 size={12} className="animate-spin" />}
              {merging ? 'Merging…' : 'Merge'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
