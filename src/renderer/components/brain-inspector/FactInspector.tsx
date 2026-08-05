// === FILE PURPOSE ===
// In-brain Inspector subview for a MEMORY-GRAPH FACT node (TWIN-GRAPH.1 Task 4).
// Serves BOTH fact ledgers — `entityFact` (entity_facts, a HARD delete) and
// `twinFact` (twin_facts, a soft status flip) — because from the graph's point of
// view they are the same shape of memory: a sentence, where it came from, and a
// one-tap Forget.
//
// Before this, clicking a fact node was a deliberate no-op (Task 3 refused to
// open an empty card). This closes that gap:
//   - the full fact content (never the truncated canvas label),
//   - a category chip for twin facts, resolved over the EXISTING `twin:memory-list`
//     channel and simply omitted when it can't be resolved — never guessed,
//   - provenance: "learned in <session>", read straight off the graph's own
//     provenance edge (zero extra IPC) and linked through the host's onOpenEntity,
//   - for entity facts, an in-canvas drill to the entity the fact is about,
//   - Forget, matching the X-icon affordance EntityInspectors/TwinMemoryFactRow
//     already established.
//
// FORGET IS OPTIMISTIC BUT NOT BLIND: this component only ASKS (via `onForget`).
// The host runs memoryGraphStore.forgetNode, which removes the node + its edges
// immediately, calls the real IPC channel, and restores the graph if that call
// fails — surfacing the failure back here through `forgetError`. A forget that
// silently failed would look like data loss.
//
// === DEPENDENCIES ===
// react, lucide-react, window.electronAPI.twinMemoryList, shared brain + twin types

import { useEffect, useRef, useState } from 'react';
import { ChevronRight, X } from 'lucide-react';
import type { BrainNode, BrainNodeType, TwinFactCategory } from '../../../shared/types';

/** A memory-graph fact node. Deliberately NOT a `BrainNode`: `BrainNodeType` is a
 *  closed union consumed by several exhaustive Records main-side, and widening it
 *  for a renderer-only concern would break them. The inspector shell accepts the
 *  union of the two instead. */
export interface FactInspectorNode {
  /** Graph node id (`entity-fact:<id>` / `twin-fact:<id>`). */
  id: string;
  type: 'entityFact' | 'twinFact';
  /** The fact's full content — brainGraphService puts it here untruncated. */
  label: string;
  /** entity_facts.id or twin_facts.id — the parameter the forget channels take. */
  recordId: string;
}

/** What the inspector shell can display: a classic tree node, or a fact node. */
export type BrainInspectorNode = BrainNode | FactInspectorNode;

export function isFactNode(node: BrainInspectorNode): node is FactInspectorNode {
  return node.type === 'entityFact' || node.type === 'twinFact';
}

/** A fact's neighbours, resolved from the graph payload the canvas already has —
 *  no extra IPC, and structurally impossible to disagree with what's on screen. */
export interface FactRelations {
  /** The entity this fact is attributed to (entity facts only), as a BrainNode so
   *  the inspector can re-target itself to it. Null when there is no such edge. */
  entity: BrainNode | null;
  /** The session this fact was learned in, from the provenance edge. */
  session: { meetingId: string; title: string } | null;
}

const CATEGORY_LABEL: Record<TwinFactCategory, string> = {
  person: 'Person',
  project: 'Project',
  preference: 'Preference',
  domain: 'Domain',
  commitment: 'Commitment',
};

/** Resolve a twin fact's category over the existing ledger channel. Returns null
 *  for entity facts (they have no category), while the lookup is in flight, and
 *  whenever the fact isn't in the list — an absent chip is honest, a guessed one
 *  is not. */
function useTwinFactCategory(node: FactInspectorNode): TwinFactCategory | null {
  const [category, setCategory] = useState<TwinFactCategory | null>(null);
  const [shownFor, setShownFor] = useState(node.id);
  const cancelledRef = useRef(false);

  // Re-targeted to a different fact: drop the stale chip DURING RENDER (React's
  // adjust-state-on-change pattern), never with a synchronous setState inside the
  // effect — that cascades renders and this repo lints it as an error.
  if (node.id !== shownFor) {
    setShownFor(node.id);
    setCategory(null);
  }

  useEffect(() => {
    if (node.type !== 'twinFact') return; // entity facts have no category
    cancelledRef.current = false;
    window.electronAPI
      .twinMemoryList()
      .then((facts) => {
        if (cancelledRef.current) return;
        setCategory(facts.find((f) => f.id === node.recordId)?.category ?? null);
      })
      .catch(() => {
        /* No chip rather than a wrong one. */
      });
    return () => {
      cancelledRef.current = true;
    };
  }, [node.type, node.recordId]);

  return category;
}

export interface FactInspectorProps {
  node: FactInspectorNode;
  /** Graph-derived neighbours. Absent means the canvas couldn't resolve any. */
  relations?: FactRelations;
  /** Host navigation — used for the "learned in <session>" provenance link. */
  onOpenEntity: (arg: { type: BrainNodeType; entityId: string }) => void;
  /** In-canvas drill to the entity this fact is about. */
  onInspectNode: (node: BrainNode) => void;
  /** Ask the host to forget this fact (optimistic removal + rollback live there). */
  onForget: (node: FactInspectorNode) => void;
  /** Set by the host when the forget round-trip FAILED and the graph was rolled
   *  back, so the user is told rather than left thinking the memory is gone. */
  forgetError?: string | null;
}

export default function FactInspector({
  node,
  relations,
  onOpenEntity,
  onInspectNode,
  onForget,
  forgetError,
}: FactInspectorProps) {
  const category = useTwinFactCategory(node);
  const entity = relations?.entity ?? null;
  const session = relations?.session ?? null;

  return (
    <div data-testid="brain-inspector-fact" className="flex flex-col gap-3 min-w-0">
      {category && (
        <span
          aria-label={`Category: ${CATEGORY_LABEL[category]}`}
          className="self-start px-2 py-0.5 rounded-full text-[0.6875rem] font-medium bg-[var(--color-accent-subtle)] text-[var(--color-accent)] border border-[var(--color-border-accent)]"
        >
          {CATEGORY_LABEL[category]}
        </span>
      )}

      <p className="text-sm text-[var(--color-text-primary)] overflow-hidden break-words whitespace-pre-wrap">
        {node.label}
      </p>

      {session ? (
        <button
          type="button"
          onClick={() => onOpenEntity({ type: 'session', entityId: session.meetingId })}
          className="self-start min-w-0 max-w-full truncate text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] underline decoration-dotted transition-colors"
        >
          learned in {session.title}
        </button>
      ) : (
        <span className="text-xs text-[var(--color-text-muted)]">Source session not in this view.</span>
      )}

      {entity && (
        <div className="flex flex-col gap-1.5">
          <span className="font-hud text-[0.625rem] tracking-widest uppercase text-[var(--color-accent-dim)]">
            About
          </span>
          <button
            type="button"
            onClick={() => onInspectNode(entity)}
            className="group w-full flex items-center justify-between gap-2 text-left text-sm text-[var(--color-text-secondary)] px-2.5 py-2 rounded-md border border-[var(--color-border)] hover:border-[var(--color-border-accent)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <span className="truncate">{entity.label}</span>
            <ChevronRight
              size={14}
              className="shrink-0 text-[var(--color-text-muted)] group-hover:text-[var(--color-accent)]"
            />
          </button>
        </div>
      )}

      <div className="flex flex-col gap-1.5 pt-1 border-t border-[var(--color-border)]">
        <button
          type="button"
          onClick={() => onForget(node)}
          aria-label={`Forget: ${node.label}`}
          title="Forget this memory"
          className="self-start flex items-center gap-1 px-2 py-1 rounded-md text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/10 text-xs transition-colors"
        >
          <X size={13} />
          Forget
        </button>
        {forgetError && (
          <p role="alert" className="text-xs text-red-400 overflow-hidden break-words">
            {forgetError}
          </p>
        )}
      </div>
    </div>
  );
}
