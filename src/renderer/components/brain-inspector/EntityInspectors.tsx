// === FILE PURPOSE ===
// In-brain Inspector — the lightweight subviews that need no heavy reuse:
//   - ProjectInspector: name/color/description (projectStore) + child-branch
//     counts straight from the brain payload node. "Open board →" lives in the
//     shell. Does NOT embed the heavy EmbeddedBoard.
//   - ColumnInspector: the column label + its child card rows (already in the
//     payload). Each row RE-TARGETS the inspector to that card (in-canvas drill).
//   - SuggestionInspector: decision/question detail, loaded via listLiveSuggestions
//     filtered to the node's entityId (the live_suggestions row id). Falls back to
//     the payload label when the meeting/suggestion can't be resolved — never fakes.
//   - EntityInspector (V3.4): a person/topic entity + the sessions it is linked to
//     (from the payload node's session children). Each session NAVIGATES via the
//     host's onOpenEntity ("this person/topic showed up across these sessions").
//
// === DEPENDENCIES ===
// react, projectStore, listLiveSuggestions IPC, shared brain + live-suggestion types

import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import type { BrainNode, BrainNodeType, LiveSuggestion } from '../../../shared/types';

// --- Project ---------------------------------------------------------------
export function ProjectInspector({ node }: { node: BrainNode }) {
  const project = useProjectStore((s) => s.projects.find((p) => p.id === node.entityId));
  return (
    <div data-testid="brain-inspector-project" className="flex flex-col gap-4">
      <div className="flex items-start gap-2.5">
        <span
          className="mt-1 w-3 h-3 rounded-full shrink-0"
          style={{ backgroundColor: project?.color ?? 'var(--color-primary-500)' }}
        />
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-[var(--color-text-primary)] break-words">
            {project?.name ?? node.label}
          </h3>
          {project?.description && (
            <p className="text-sm text-[var(--color-text-secondary)] mt-1 break-words">{project.description}</p>
          )}
        </div>
      </div>

      {node.children.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="font-hud text-[0.625rem] tracking-widest uppercase text-[var(--color-accent-dim)]">
            Contents
          </span>
          <ul className="flex flex-col gap-1">
            {node.children.map((child) => (
              <li
                key={child.id}
                className="flex items-center justify-between text-sm text-[var(--color-text-secondary)] px-2.5 py-1.5 rounded-md border border-[var(--color-border)]"
              >
                <span className="truncate">{child.label}</span>
                <span className="text-xs font-data text-[var(--color-text-muted)] shrink-0 ml-2">
                  {child.childCount}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// --- Column ----------------------------------------------------------------
export function ColumnInspector({ node, onInspectNode }: { node: BrainNode; onInspectNode: (n: BrainNode) => void }) {
  const cards = node.children.filter((c) => c.type === 'card');
  return (
    <div data-testid="brain-inspector-column" className="flex flex-col gap-3">
      <div>
        <h3 className="text-base font-semibold text-[var(--color-text-primary)] break-words">{node.label}</h3>
        <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
          {cards.length} card{cards.length === 1 ? '' : 's'}
        </p>
      </div>
      <ul className="flex flex-col gap-1">
        {cards.map((card) => (
          <li key={card.id}>
            <button
              type="button"
              onClick={() => onInspectNode(card)}
              className="group w-full flex items-center justify-between gap-2 text-left text-sm text-[var(--color-text-secondary)] px-2.5 py-2 rounded-md border border-[var(--color-border)] hover:border-[var(--color-border-accent)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              <span className="truncate">{card.label}</span>
              <ChevronRight
                size={14}
                className="shrink-0 text-[var(--color-text-muted)] group-hover:text-[var(--color-accent)]"
              />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Entity (person / topic) — V3.4 semantic layer -------------------------
export function EntityInspector({
  node,
  onOpenEntity,
}: {
  node: BrainNode;
  onOpenEntity: (arg: { type: BrainNodeType; entityId: string }) => void;
}) {
  // The entity node branches to the sessions it is linked to (payload children).
  const sessions = node.children.filter((c) => c.type === 'session');
  const kindLabel = node.type === 'person' ? 'Person' : 'Topic';
  return (
    <div data-testid="brain-inspector-entity" className="flex flex-col gap-3">
      <div>
        <span className="text-[0.625rem] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--color-accent-subtle)] text-[var(--color-accent)]">
          {kindLabel}
        </span>
        <h3 className="text-base font-semibold text-[var(--color-text-primary)] mt-1 break-words">{node.label}</h3>
        <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
          Linked to {sessions.length} session{sessions.length === 1 ? '' : 's'}
        </p>
      </div>
      {sessions.length > 0 && (
        <ul className="flex flex-col gap-1">
          {sessions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onOpenEntity({ type: 'session', entityId: s.entityId! })}
                className="group w-full flex items-center justify-between gap-2 text-left text-sm text-[var(--color-text-secondary)] px-2.5 py-2 rounded-md border border-[var(--color-border)] hover:border-[var(--color-border-accent)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                <span className="truncate">{s.label}</span>
                <ChevronRight
                  size={14}
                  className="shrink-0 text-[var(--color-text-muted)] group-hover:text-[var(--color-accent)]"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- Decision / Question ---------------------------------------------------
const STATUS_STYLE: Record<string, string> = {
  proposed: 'bg-blue-500/20 text-blue-500',
  accepted: 'bg-emerald-500/20 text-emerald-500',
  dismissed: 'bg-surface-500/20 text-[var(--color-text-muted)]',
};

export function SuggestionInspector({
  node,
  meetingId,
  onOpenEntity,
}: {
  node: BrainNode;
  meetingId?: string;
  onOpenEntity: (arg: { type: BrainNodeType; entityId: string }) => void;
}) {
  const [suggestion, setSuggestion] = useState<LiveSuggestion | null>(null);
  // With no meeting to resolve against we start 'ready' (zero-fetch, show the
  // payload label) — lazy init avoids a synchronous setState inside the effect.
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(() => (meetingId ? 'loading' : 'ready'));

  useEffect(() => {
    if (!meetingId) return; // nothing to fetch; the payload label is already shown
    let cancelled = false;
    window.electronAPI
      .listLiveSuggestions(meetingId)
      .then((list) => {
        if (cancelled) return;
        setSuggestion(list.find((s) => s.id === node.entityId) ?? null);
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [meetingId, node.entityId]);

  const status = suggestion?.status;
  return (
    <div data-testid="brain-inspector-suggestion" className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[0.625rem] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--color-accent-subtle)] text-[var(--color-accent)]">
          {node.type === 'decision' ? 'Decision' : 'Question'}
        </span>
        {status && (
          <span className={`text-[0.625rem] font-bold uppercase px-1.5 py-0.5 rounded ${STATUS_STYLE[status] ?? ''}`}>
            {status}
          </span>
        )}
      </div>

      {/* Real payload label always available even with no fetch — never fabricated. */}
      <h3 className="text-base font-semibold text-[var(--color-text-primary)] break-words">
        {suggestion?.title ?? node.label}
      </h3>

      {suggestion?.description && (
        <p className="text-sm text-[var(--color-text-secondary)] break-words whitespace-pre-wrap">
          {suggestion.description}
        </p>
      )}

      {state === 'loading' && <p className="text-xs text-[var(--color-text-muted)] animate-pulse">Loading detail…</p>}
      {state === 'error' && <p className="text-xs text-[var(--color-text-muted)]">Could not load the full detail.</p>}

      {suggestion?.acceptedCardId && (
        <button
          type="button"
          onClick={() => onOpenEntity({ type: 'card', entityId: suggestion.acceptedCardId! })}
          className="self-start text-xs font-medium text-[var(--color-accent)] hover:underline"
        >
          Open accepted card →
        </button>
      )}
      {suggestion?.acceptedProjectId && (
        <button
          type="button"
          onClick={() => onOpenEntity({ type: 'project', entityId: suggestion.acceptedProjectId! })}
          className="self-start text-xs font-medium text-[var(--color-accent)] hover:underline"
        >
          Open accepted project →
        </button>
      )}
    </div>
  );
}
