// === FILE PURPOSE ===
// In-brain Inspector (Inspector-card story) — the CONTENT of the node-anchored card
// that BrainMindMap pops out of a clicked node (BrainMindMap owns the POSITIONING +
// connector; this owns the CONTENT). Clicking a Brain node opens THIS instead of
// navigating the underlying page (which, under the live overlay, opened "in the
// background"). It renders a plain card block — header (type label + title + ✕),
// an "Open full page →" action, and a scrolling body that dispatches to a per-type
// subview REUSING the existing detail components (session → meeting-detail stack;
// card → card-detail sub-sections; project/column/decision/question → lightweight
// real detail). It does NOT position itself (no drawer/bottom-sheet) — the parent
// PinnedCard wrapper sets left/top/width; this fills that width and caps its own
// height (max-h) with internal scroll for rich content. Full navigation is the
// explicit "Open full page →" button, wired to the host's onOpenEntity.
//
// ACCESSIBILITY: labelled region, focus moves in on open and restores on close, Esc
// / close button dismiss (Esc ignored while typing in an input, matching
// CardDetailModal; and skipped when a nested layer already handled it).
//
// === DEPENDENCIES ===
// react, lucide-react, brain-inspector/* subviews, shared brain types

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import SessionInspector from './brain-inspector/SessionInspector';
import CardInspector from './brain-inspector/CardInspector';
import {
  ProjectInspector,
  ColumnInspector,
  SuggestionInspector,
  EntityInspector,
} from './brain-inspector/EntityInspectors';
import type { BrainNode, BrainNodeType } from '../../shared/types';

const TYPE_LABEL: Record<BrainNodeType, string> = {
  workspace: 'Workspace',
  project: 'Project',
  group: 'Group',
  column: 'Column',
  session: 'Session',
  card: 'Card',
  decision: 'Decision',
  question: 'Question',
  person: 'Person',
  topic: 'Topic',
};

export interface BrainInspectorProps {
  /** The pinned node whose detail is shown. entityId is non-null (BrainMindMap
   *  only fires onInspect for openable nodes). */
  node: BrainNode;
  /** Session-scope meeting id — resolves decision/question suggestions and gives
   *  those types a real "Open session →" destination. */
  meetingId?: string;
  /** Host-supplied navigation ("Open full page →" / accepted-entity links). */
  onOpenEntity: (arg: { type: BrainNodeType; entityId: string }) => void;
  /** In-canvas drill — re-target the inspector to a related node (e.g. a column's
   *  card row) without leaving the Brain. */
  onInspectNode: (node: BrainNode) => void;
  /** Dismiss (close button / Esc / host). Clears the pin in BrainTabPanel. */
  onClose: () => void;
}

/** The explicit "Open full page →" affordance for a node — decision/question have
 *  no standalone destination, so they fall back to opening their parent session. */
function fullPageAction(
  node: BrainNode,
  meetingId: string | undefined,
): { label: string; arg: { type: BrainNodeType; entityId: string } } | null {
  switch (node.type) {
    case 'session':
      return { label: 'Open session page →', arg: { type: 'session', entityId: node.entityId! } };
    case 'card':
      return { label: 'Open card →', arg: { type: 'card', entityId: node.entityId! } };
    case 'project':
    case 'column':
      return { label: 'Open board →', arg: { type: node.type, entityId: node.entityId! } };
    case 'decision':
    case 'question':
      return meetingId ? { label: 'Open session →', arg: { type: 'session', entityId: meetingId } } : null;
    default:
      return null;
  }
}

function InspectorBody({ node, meetingId, onOpenEntity, onInspectNode }: Omit<BrainInspectorProps, 'onClose'>) {
  switch (node.type) {
    case 'session':
      return <SessionInspector meetingId={node.entityId!} />;
    case 'card':
      return <CardInspector cardId={node.entityId!} fallbackLabel={node.label} />;
    case 'project':
      return <ProjectInspector node={node} />;
    case 'column':
      return <ColumnInspector node={node} onInspectNode={onInspectNode} />;
    case 'decision':
    case 'question':
      return <SuggestionInspector node={node} meetingId={meetingId} onOpenEntity={onOpenEntity} />;
    case 'person':
    case 'topic':
      return <EntityInspector node={node} onOpenEntity={onOpenEntity} />;
    default:
      return <p className="text-sm text-[var(--color-text-secondary)]">{node.label}</p>;
  }
}

export default function BrainInspector({ node, meetingId, onOpenEntity, onInspectNode, onClose }: BrainInspectorProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Move focus into the card on open; restore it to the previously-focused element
  // (typically the map node's button) when the card closes/unmounts, so keyboard
  // users aren't dumped back to the top of the document.
  useEffect(() => {
    const prevFocused = document.activeElement as HTMLElement | null;
    containerRef.current?.focus();
    return () => prevFocused?.focus?.();
  }, []);

  // Esc dismisses — but not while typing in a sub-section input (comments, etc.),
  // and not if a nested layer already handled it (e.g. the convert-action modal's
  // focus trap called preventDefault). The overlay's Esc-to-minimize is separately
  // gated on brainStore.inspectorOpen, so this never also minimizes Live Mode.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const openAction = fullPageAction(node, meetingId);

  return (
    // Plain card CONTENT — the parent PinnedCard wrapper owns position + width; this
    // fills that width and caps its own height with an internally-scrolling body.
    <div
      ref={containerRef}
      data-testid="brain-inspector"
      role="region"
      aria-label={`${TYPE_LABEL[node.type]} details`}
      tabIndex={-1}
      className="flex flex-col w-full max-h-[60vh] rounded-xl bg-[var(--color-chrome)] border border-[var(--color-border)] shadow-2xl outline-none overflow-hidden"
    >
      <div className="shrink-0 flex items-start justify-between gap-2 px-4 pt-3.5 pb-3 border-b border-[var(--color-border)]">
        <div className="min-w-0">
          <span className="font-hud text-[0.625rem] tracking-widest uppercase text-[var(--color-accent-dim)]">
            {TYPE_LABEL[node.type]}
          </span>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{node.label}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="shrink-0 p-1.5 rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {openAction && (
        <div className="shrink-0 px-4 py-2.5 border-b border-[var(--color-border)]">
          <button
            type="button"
            onClick={() => onOpenEntity(openAction.arg)}
            className="text-xs font-medium text-[var(--color-accent)] hover:underline"
          >
            {openAction.label}
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <InspectorBody node={node} meetingId={meetingId} onOpenEntity={onOpenEntity} onInspectNode={onInspectNode} />
      </div>
    </div>
  );
}
