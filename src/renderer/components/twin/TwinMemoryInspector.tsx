// === FILE PURPOSE ===
// The node inspector for the twin memory graph (TWIN-GRAPH.2 Task 3) — and the
// home of two thirds of the twin's LOCKED safety triad now that the graph has
// replaced TwinMemoryPanel's list:
//
//   * PROVENANCE. A fact always states where it was learned. The title arrives
//     inline on the graph payload (Task 1 joined it), so there is no second round
//     trip and no id lookup: `sourceMeetingTitle` when the session still exists,
//     the honest "a past session" fallback when it does not. NEVER a raw id,
//     NEVER a fabricated title. The link is offered whenever a real
//     `sourceMeetingId` survives, even if the title could not be resolved.
//   * ONE-TAP FORGET. A real <button> in the card — not a hover-only affordance —
//     so it is reachable by keyboard from the node that opened this card. The
//     host owns the IPC call, the optimistic removal and the undo snackbar.
//
// Content only: the parent GraphPinnedCardLayer owns position and width, exactly
// as BrainInspector sits inside the same wrapper. Styling and Escape-to-close
// mirror that component so the two inspectors feel like one idea.
//
// === DEPENDENCIES ===
// react, lucide-react, graphVisuals (type/category labels), TwinMemoryNodeLabel
// (the shared full-text accessor), shared twin types

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { TWIN_CATEGORY_LABEL, TWIN_GRAPH_TYPE_LABEL, laneHeading } from '../brain-graph/graphVisuals';
import { fullTextOf } from './TwinMemoryNodeLabel';
import type { TwinGraphNode } from '../../../shared/types';

/** Shown when a fact's source session is gone (schema SET NULLs it — a learned
 *  fact outlives the deletion of its source session) or was never recorded. */
export const FALLBACK_SESSION_LABEL = 'a past session';

export interface TwinMemoryInspectorProps {
  node: TwinGraphNode;
  /** Facts inside this node's scope — its category for a hub, the whole ledger
   *  for the twin core. Ignored for a fact node. */
  scopeFactCount: number;
  /** Move focus into the card on mount. True only when the node was activated
   *  from the KEYBOARD, so a mouse user's focus is never yanked. The card region
   *  itself is focused, never the destructive action. */
  autoFocus: boolean;
  onForget: () => void;
  onOpenSession: (meetingId: string) => void;
  onClose: () => void;
}

export default function TwinMemoryInspector({
  node,
  scopeFactCount,
  autoFocus,
  onForget,
  onOpenSession,
  onClose,
}: TwinMemoryInspectorProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoFocus) containerRef.current?.focus();
  }, [autoFocus]);

  // Escape closes — same guard BrainInspector uses so a text field's own Escape
  // handling is never stolen.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      ref={containerRef}
      data-testid="twin-memory-inspector"
      role="region"
      aria-label={`${TWIN_GRAPH_TYPE_LABEL[node.type]} details`}
      tabIndex={-1}
      className="flex flex-col w-full max-h-[60vh] rounded-xl bg-[var(--color-chrome)] border border-[var(--color-border)] shadow-2xl outline-none overflow-hidden"
    >
      <div className="shrink-0 flex items-start justify-between gap-2 px-4 pt-3.5 pb-3 border-b border-[var(--color-border)]">
        <span className="font-hud text-[0.625rem] tracking-widest uppercase text-[var(--color-accent-dim)] mt-0.5">
          {TWIN_GRAPH_TYPE_LABEL[node.type]}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="shrink-0 p-1.5 rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4 space-y-3">
        {node.type === 'fact' ? (
          <FactBody node={node} onOpenSession={onOpenSession} />
        ) : (
          <ScopeBody node={node} scopeFactCount={scopeFactCount} />
        )}
      </div>

      {node.type === 'fact' && (
        <div className="shrink-0 px-4 py-3 border-t border-[var(--color-border)]">
          <button
            type="button"
            onClick={onForget}
            aria-label={`Forget: ${node.label}`}
            title="Forget this fact"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <X size={13} />
            Forget
          </button>
        </div>
      )}
    </div>
  );
}

/** A learned fact: the text, its category, and where it came from. */
function FactBody({ node, onOpenSession }: { node: TwinGraphNode; onOpenSession: (meetingId: string) => void }) {
  const meetingId = node.sourceMeetingId ?? null;
  // The title is only ever the one the payload joined in — never invented, and
  // never the id as a stand-in for a name.
  const label = node.sourceMeetingTitle?.trim() || FALLBACK_SESSION_LABEL;

  return (
    <>
      {/* THE WHOLE FACT, never its caption. `node.label` became a 2-4 word label
          in TWIN-READ.1 Task 1, which silently shrank this paragraph — the one a
          user reads before pressing Forget below. Read through the same
          fullTextOf() accessor the graph captions use, so there is exactly one
          rule for "the text behind a node" and a payload with no `text` field
          still degrades to the label rather than to blank. */}
      <p className="text-sm text-[var(--color-text-primary)] break-words overflow-hidden">{fullTextOf(node)}</p>
      <div className="flex items-center gap-2 flex-wrap">
        {node.category && (
          <span
            aria-label={`Category: ${TWIN_CATEGORY_LABEL[node.category]}`}
            className="px-2 py-0.5 rounded-full text-[0.6875rem] font-medium bg-[var(--color-accent-subtle)] text-[var(--color-accent)] border border-[var(--color-border-accent)]"
          >
            {TWIN_CATEGORY_LABEL[node.category]}
          </span>
        )}
        {meetingId ? (
          <button
            type="button"
            onClick={() => onOpenSession(meetingId)}
            className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] underline decoration-dotted transition-colors break-words text-left"
          >
            learned in {label}
          </button>
        ) : (
          <span className="text-xs text-[var(--color-text-muted)] break-words">learned in {label}</span>
        )}
      </div>
    </>
  );
}

/** The twin core or a category hub — structure, not a memory: no forget action,
 *  because there is nothing here to forget. */
function ScopeBody({ node, scopeFactCount }: { node: TwinGraphNode; scopeFactCount: number }) {
  const heading = node.type === 'category' && node.category ? laneHeading(node.category) : node.label;
  const noun = scopeFactCount === 1 ? 'learned fact' : 'learned facts';
  return (
    <>
      <p className="text-sm font-semibold text-[var(--color-text-primary)] break-words overflow-hidden">{heading}</p>
      <p className="text-xs text-[var(--color-text-secondary)] break-words">
        {node.type === 'twin'
          ? `${scopeFactCount} ${noun} across your whole memory. Every one of them is listed under a category below, sourced to the session it came from, and one-tap forgettable.`
          : `${scopeFactCount} ${noun} in this category.`}
      </p>
    </>
  );
}
