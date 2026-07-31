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
//   - EntityInspector (V3.4 + BRAIN-UX.1 Task 4): a person/topic entity's fact
//     profile (entityListFacts — per-fact source-session provenance link +
//     one-tap entityForgetFact, optimistic-removed and restored on error), a
//     user-initiated "Analyze past sessions" button (entityAnalyzeHistory,
//     handles the Task-1 not-implemented stub AND a rejected/typed no-model
//     failure from Task 3 with actionable copy), and the sessions it is linked
//     to (from the payload node's session children). Each session NAVIGATES via
//     the host's onOpenEntity ("this person/topic showed up across these
//     sessions" / "learn more about this fact").
//
// === DEPENDENCIES ===
// react, projectStore, listLiveSuggestions IPC, entityListFacts/entityForgetFact/
// entityAnalyzeHistory IPC (window.electronAPI), shared brain + live-suggestion +
// twin (EntityFact) types

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, Loader2, X } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import type { BrainNode, BrainNodeType, EntityFact, LiveSuggestion } from '../../../shared/types';

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

// --- Entity (person / topic) — V3.4 semantic layer, BRAIN-UX.1 Task 4 adds the
//     per-entity fact profile (provenance + forget) + on-demand history analysis.

type AnalyzeState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'result'; minedMeetings: number; newFacts: number }
  | { kind: 'error'; message: string };

/** Actionable copy for a rejected `entityAnalyzeHistory` call. Task 3's real
 *  no-model rejection is `NO_MODEL_ERROR_MESSAGE` in entityFactService.ts —
 *  "No AI provider configured for learning. Go to Settings to add one." —
 *  thrown across the IPC boundary (Electron wraps it in "Error invoking remote
 *  method ..."), which is why this matches on "model" OR "provider" rather than
 *  importing the main-process constant (the frozen `AnalyzeEntityHistoryResult`
 *  union has no room for a 'skipped' arm, so a rejection is the only channel).
 *  Anything else gets an honest generic failure message. */
function analyzeRejectionMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : '';
  return /model|provider/i.test(raw)
    ? 'No model is assigned for this task. Assign one in Settings, then try again.'
    : 'Could not analyze past sessions. Try again later.';
}

/** The per-entity learned-facts list: loading/error/honest-empty states, plus
 *  per-fact source-session provenance + one-tap forget. Split out of
 *  EntityInspector purely to keep that component's cyclomatic complexity down. */
function EntityFactsSection({
  factsState,
  facts,
  onOpenEntity,
  onForget,
}: {
  factsState: 'loading' | 'ready' | 'error';
  facts: EntityFact[];
  onOpenEntity: (arg: { type: BrainNodeType; entityId: string }) => void;
  onForget: (factId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-hud text-[0.625rem] tracking-widest uppercase text-[var(--color-accent-dim)]">
        Learned facts
      </span>
      {factsState === 'loading' && (
        <p role="status" className="text-xs text-[var(--color-text-muted)] animate-pulse">
          Loading facts…
        </p>
      )}
      {factsState === 'error' && (
        <p className="text-xs text-[var(--color-text-muted)]">Could not load learned facts.</p>
      )}
      {factsState === 'ready' && facts.length === 0 && (
        <p className="text-xs text-[var(--color-text-muted)]">
          No facts learned yet — recorded meetings will add facts automatically, or analyze past sessions below.
        </p>
      )}
      {factsState === 'ready' && facts.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {facts.map((fact) => (
            <li
              key={fact.id}
              className="min-w-0 flex flex-col gap-1.5 px-2.5 py-2 rounded-md border border-[var(--color-border)]"
            >
              <p className="text-sm text-[var(--color-text-secondary)] break-words">{fact.content}</p>
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => onOpenEntity({ type: 'session', entityId: fact.sourceMeetingId })}
                  className="min-w-0 truncate text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)] underline decoration-dotted transition-colors"
                >
                  {fact.sourceMeetingTitle ?? 'Open source session'}
                </button>
                <button
                  type="button"
                  onClick={() => onForget(fact.id)}
                  aria-label={`Forget: ${fact.content}`}
                  title="Forget this fact"
                  className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/10 text-xs transition-colors"
                >
                  <X size={13} />
                  Forget
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The "Analyze past sessions" affordance: in-flight/result/error states. Split
 *  out of EntityInspector purely to keep that component's cyclomatic complexity
 *  down (mirrors EntityFactsSection above). */
function AnalyzeHistorySection({ analyzeState, onAnalyze }: { analyzeState: AnalyzeState; onAnalyze: () => void }) {
  return (
    <div className="flex flex-col gap-1.5 pt-1 border-t border-[var(--color-border)]">
      <button
        type="button"
        onClick={onAnalyze}
        disabled={analyzeState.kind === 'loading'}
        className="self-start inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-accent)] hover:underline disabled:opacity-60 disabled:cursor-not-allowed disabled:no-underline"
      >
        {analyzeState.kind === 'loading' && <Loader2 size={13} className="animate-spin" />}
        Analyze past sessions
      </button>
      {analyzeState.kind === 'loading' && (
        <p role="status" className="text-xs text-[var(--color-text-muted)]">
          Analyzing past sessions can take a while on a local model.
        </p>
      )}
      {analyzeState.kind === 'result' && (
        <p className="text-xs text-[var(--color-text-secondary)]">
          {analyzeState.minedMeetings} session{analyzeState.minedMeetings === 1 ? '' : 's'} analyzed,{' '}
          {analyzeState.newFacts} new fact{analyzeState.newFacts === 1 ? '' : 's'}
        </p>
      )}
      {analyzeState.kind === 'error' && <p className="text-xs text-red-400 break-words">{analyzeState.message}</p>}
    </div>
  );
}

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
  const entityId = node.entityId!; // BrainMindMap only fires onInspect for openable (non-null) nodes.

  const [factsState, setFactsState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [facts, setFacts] = useState<EntityFact[]>([]);
  const [analyzeState, setAnalyzeState] = useState<AnalyzeState>({ kind: 'idle' });

  // Cancelled-flag pattern (mirrors SuggestionInspector below) — guards setState
  // after unmount for both the mount-time load and the button-triggered refresh.
  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, [entityId]);

  const loadFacts = useCallback(async () => {
    setFactsState('loading');
    try {
      const list = await window.electronAPI.entityListFacts(entityId);
      if (cancelledRef.current) return;
      setFacts(list);
      setFactsState('ready');
    } catch {
      if (!cancelledRef.current) setFactsState('error');
    }
  }, [entityId]);

  useEffect(() => {
    void loadFacts(); // eslint-disable-line react-hooks/set-state-in-effect -- mount-time load, same pattern as useDatabaseStatus
  }, [loadFacts]);

  const handleForget = async (factId: string) => {
    const previous = facts;
    setFacts((current) => current.filter((f) => f.id !== factId)); // optimistic
    try {
      await window.electronAPI.entityForgetFact(factId);
    } catch {
      if (!cancelledRef.current) setFacts(previous); // restore on error
    }
  };

  const handleAnalyze = async () => {
    setAnalyzeState({ kind: 'loading' });
    try {
      const result = await window.electronAPI.entityAnalyzeHistory(entityId);
      if (cancelledRef.current) return;
      if (result.status === 'not-implemented') {
        setAnalyzeState({ kind: 'error', message: result.error ?? 'Analyze past sessions is not implemented yet.' });
        return;
      }
      setAnalyzeState({ kind: 'result', minedMeetings: result.minedMeetings, newFacts: result.newFacts });
      void loadFacts(); // refresh the list with anything newly mined
    } catch (error) {
      if (!cancelledRef.current) setAnalyzeState({ kind: 'error', message: analyzeRejectionMessage(error) });
    }
  };

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

      <EntityFactsSection
        factsState={factsState}
        facts={facts}
        onOpenEntity={onOpenEntity}
        onForget={(factId) => void handleForget(factId)}
      />

      <AnalyzeHistorySection analyzeState={analyzeState} onAnalyze={() => void handleAnalyze()} />

      {sessions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="font-hud text-[0.625rem] tracking-widest uppercase text-[var(--color-accent-dim)]">
            Linked sessions
          </span>
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
        </div>
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
