// === FILE PURPOSE ===
// Brain canvas tab (V3.2 Task 3) — the real, live Brain panel shared between
// SessionWorkspace and LiveModeOverlay (both mount this ONE component). Owns:
//   - the "This session / Everything" scope toggle (default: session scope),
//   - loading that scope's tree via brainStore.load (cache-or-fetch per scope,
//     so toggling back and forth is instant),
//   - a friendly empty state for a session that hasn't produced anything yet
//     (distinct from BrainMindMap's own generic "no tree" placeholder),
//   - fitting the map to view once when the tab first mounts, and
//   - recording brainStore.activeScopeKey (V3.2 Task 4) so useBrainLiveSync
//     keeps refreshing/off-canvas-badging this scope even after this panel
//     unmounts (the user switching to Board/Transcript).
// Entity-click ROUTING is intentionally NOT owned here — each host passes its
// own `onOpenEntity` (mirrors ActivityFeed's host-supplied `onSelectTab`), since
// only the host knows whether a real navigation or an in-canvas tab switch is
// appropriate. `resolveBrainOpenTarget` (below) is the one bit of resolution
// logic both hosts share: a BrainNode only carries its OWN entity id, so a
// card/column's project id must be looked up via boardStore.allCards (the same
// global lookup CommandPalette already uses for its card jump-to-board links).
//
// === DEPENDENCIES ===
// react, lucide-react, brainStore, BrainMindMap (Task 2), shared brain types
import { useCallback, useEffect, useRef, useState } from 'react';
import { Network } from 'lucide-react';
import { useBrainStore, scopeKeyFor } from '../stores/brainStore';
import BrainMindMap, { type BrainMindMapHandle } from './BrainMindMap';
import BrainInspector from './BrainInspector';
import type { BrainNode, BrainNodeType, BrainScope } from '../../shared/types';

type BrainScopeChoice = 'session' | 'workspace';

/** Minimal shape BrainTabPanel/hosts need out of boardStore.allCards — a card's
 *  containing column and project. Structural (not imported from boardStore) so
 *  this file doesn't need to know boardStore's internal row type name. */
export interface BrainCardLookup {
  id: string;
  columnId: string;
  projectId: string;
}

export type BrainOpenTarget =
  | { kind: 'session'; meetingId: string }
  | { kind: 'board'; projectId: string; cardId?: string }
  | { kind: 'none' };

/**
 * Resolve a BrainMindMap node click into a concrete navigation target. Shared by
 * both hosts so the card/column -> project lookup (via the globally-loaded
 * boardStore.allCards) isn't duplicated. Pure — hosts decide what to actually DO
 * with the result (real navigate vs. in-canvas Board-tab switch).
 */
export function resolveBrainOpenTarget(
  arg: { type: BrainNodeType; entityId: string },
  allCards: BrainCardLookup[],
): BrainOpenTarget {
  switch (arg.type) {
    case 'session':
      return { kind: 'session', meetingId: arg.entityId };
    case 'project':
      return { kind: 'board', projectId: arg.entityId };
    case 'card': {
      const card = allCards.find((c) => c.id === arg.entityId);
      return card ? { kind: 'board', projectId: card.projectId, cardId: card.id } : { kind: 'none' };
    }
    case 'column': {
      // Every column node in the tree has >=1 card (empty columns are pruned by
      // buildBrainTree), so any card sharing its columnId resolves the project.
      const card = allCards.find((c) => c.columnId === arg.entityId);
      return card ? { kind: 'board', projectId: card.projectId } : { kind: 'none' };
    }
    default:
      // decision/question have no standalone destination — never fabricate one.
      return { kind: 'none' };
  }
}

/** Find a node by id anywhere in a tree, or null. A live-growth refresh replaces
 *  the whole tree object, so the pinned node must be RE-RESOLVED against the new
 *  tree rather than left pointing at the stale object — otherwise payload-driven
 *  subviews (Column/Project render node.children directly) freeze at pin time and
 *  never reflect live growth. Returns null when the pinned node is gone → close. */
function findNode(root: BrainNode, id: string): BrainNode | null {
  const stack: BrainNode[] = [root];
  while (stack.length > 0) {
    const current = stack.pop() as BrainNode;
    if (current.id === id) return current;
    for (const child of current.children) stack.push(child);
  }
  return null;
}

export interface BrainTabPanelProps {
  /** The session's own id — required to build session scope ({ meetingId }).
   *  Undefined only for a not-yet-created session; the panel falls back to the
   *  friendly bare-session message rather than attempting to load. */
  meetingId?: string;
  /** The session's linked project, if any (may be null) — scope context threaded
   *  from the host alongside meetingId. */
  projectId?: string | null;
  /** Host-specific handling for a node click with a resolved entityId — each
   *  host supplies its own navigate-vs-in-canvas behavior. */
  onOpenEntity: (arg: { type: BrainNodeType; entityId: string }) => void;
}

/**
 * The map + in-canvas Inspector (Inspector-card story), split out of BrainTabPanel
 * so the panel shell stays a thin scope-toggle/loader. Owns the mind-map imperative
 * ref (fit-once-on-mount), and the PINNED inspector state: a node click pins the
 * node and hands the inspector CONTENT to BrainMindMap as `pinnedPanel`, which pops
 * it out of the node as an anchored card (BrainMindMap owns positioning); the click
 * also one-shot-pans the node into a clear region. The pin is dropped when the scope
 * changes under us OR a live-growth refresh removes the pinned node — both handled
 * DURING RENDER (React's adjust-state-on-change pattern) so there's no synchronous
 * setState-in-effect.
 */
function BrainCanvas({
  scopeKey,
  meetingId,
  onOpenEntity,
}: {
  scopeKey: string;
  meetingId?: string;
  onOpenEntity: (arg: { type: BrainNodeType; entityId: string }) => void;
}) {
  const tree = useBrainStore((s) => s.scopes[scopeKey]?.tree ?? null);
  const setInspectorOpen = useBrainStore((s) => s.setInspectorOpen);
  const mindMapRef = useRef<BrainMindMapHandle>(null);
  const hasFitRef = useRef(false);
  const [inspectNode, setInspectNode] = useState<BrainNode | null>(null);
  const [prevScopeKey, setPrevScopeKey] = useState(scopeKey);
  const [prevTree, setPrevTree] = useState(tree);

  // Scope toggled under us -> the pinned node belongs to the old scope; drop it.
  if (scopeKey !== prevScopeKey) {
    setPrevScopeKey(scopeKey);
    setInspectNode(null);
  }
  // The tree object was REPLACED (a live-growth refresh): re-resolve the pinned node
  // from the new tree by id so payload-driven subviews (Column/Project) reflect
  // growth — or drop it if it's gone. Guarded on an actual tree-identity change so
  // the freshly-clicked node isn't churned on the same render it was pinned.
  if (tree !== prevTree) {
    setPrevTree(tree);
    if (inspectNode) setInspectNode(tree ? findNode(tree.root, inspectNode.id) : null);
  }

  // Fit-to-view once, the first time this scope's tree becomes available.
  useEffect(() => {
    if (hasFitRef.current || !tree) return;
    hasFitRef.current = true;
    mindMapRef.current?.fit();
  }, [tree]);

  // Publish inspector-open as a global flag so LiveModeOverlay's Esc-to-minimize
  // yields while the card is open (else one Esc closes the card AND minimizes the
  // whole live overlay). Cleared when the card closes or this panel unmounts.
  useEffect(() => {
    setInspectorOpen(inspectNode !== null);
    return () => setInspectorOpen(false);
  }, [inspectNode, setInspectorOpen]);

  const handleInspect = useCallback((node: BrainNode) => {
    // Pin + open the card WHERE the node already is — do NOT auto-pan the view.
    // The card is anchored to the node; moving the viewport on click is disorienting
    // (the user repositions the map themselves when they want to).
    setInspectNode(node);
  }, []);

  return (
    // Relative host: the anchored inspector card + connector are positioned
    // absolutely by BrainMindMap over this container (it never resizes the svg).
    <div className="relative flex-1 flex min-h-0">
      <BrainMindMap
        ref={mindMapRef}
        scopeKey={scopeKey}
        onOpenEntity={onOpenEntity}
        onInspect={handleInspect}
        pinnedId={inspectNode?.id ?? null}
        pinnedPanel={
          inspectNode && (
            <BrainInspector
              node={inspectNode}
              meetingId={meetingId}
              onOpenEntity={onOpenEntity}
              onInspectNode={handleInspect}
              onClose={() => setInspectNode(null)}
            />
          )
        }
      />
    </div>
  );
}

export default function BrainTabPanel({ meetingId, projectId, onOpenEntity }: BrainTabPanelProps) {
  const [scopeChoice, setScopeChoice] = useState<BrainScopeChoice>('session');
  const load = useBrainStore((s) => s.load);
  const setActiveScope = useBrainStore((s) => s.setActiveScope);

  const scope: BrainScope | null = scopeChoice === 'workspace' ? 'workspace' : meetingId ? { meetingId } : null;
  const scopeKey = scope ? scopeKeyFor(scope) : null;
  const tree = useBrainStore((s) => (scopeKey ? (s.scopes[scopeKey]?.tree ?? null) : null));

  // Load (cache-or-fetch) whenever the active scope changes, and record it as the
  // scope useBrainLiveSync (Task 4) keeps live-refreshing in the background — NOT
  // cleared on unmount, so growth still badges the Brain tab while another canvas
  // tab is being viewed. Depends on primitives only — `scope` is a fresh object
  // every render for session scope, so it is reconstructed inside the effect
  // rather than used as a dep.
  useEffect(() => {
    const activeScope: BrainScope | null = scopeChoice === 'workspace' ? 'workspace' : meetingId ? { meetingId } : null;
    setActiveScope(activeScope ? scopeKeyFor(activeScope) : null);
    if (!activeScope) return;
    void load(activeScope);
  }, [scopeChoice, meetingId, load, setActiveScope]);

  // A bare session — no meetingId yet, or a loaded tree whose root has produced
  // nothing (no linked project, no cards, no decisions/questions) — gets the
  // friendly "grows as this session produces work" message INSTEAD of a mind map
  // that would otherwise render as a single lonely root bubble. Workspace scope
  // never hits this (its root always has content once anything exists at all).
  const bareSession =
    scopeChoice === 'session' && (scopeKey === null || (tree !== null && tree.root.children.length === 0));

  return (
    <div
      role="tabpanel"
      id="panel-brain"
      aria-labelledby="tab-brain"
      className="flex-1 flex flex-col min-h-0"
      data-project-id={projectId ?? undefined}
    >
      <div className="shrink-0 flex items-center justify-end px-4 py-2">
        <div
          role="group"
          aria-label="Brain scope"
          className="inline-flex rounded-lg border border-[var(--color-border)] p-0.5"
        >
          <button
            type="button"
            aria-pressed={scopeChoice === 'session'}
            onClick={() => setScopeChoice('session')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              scopeChoice === 'session'
                ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent)]'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            This session
          </button>
          <button
            type="button"
            aria-pressed={scopeChoice === 'workspace'}
            onClick={() => setScopeChoice('workspace')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              scopeChoice === 'workspace'
                ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent)]'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            Everything
          </button>
        </div>
      </div>

      {bareSession ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-16 px-6">
          <div className="w-16 h-16 rounded-2xl bg-[var(--color-accent-subtle)] border border-[var(--color-border-accent)] flex items-center justify-center mb-5">
            <Network size={28} className="text-[var(--color-accent-dim)]" />
          </div>
          <h3 className="text-lg font-medium text-[var(--color-text-primary)] mb-1.5">Brain</h3>
          <p className="text-sm text-[var(--color-text-secondary)] max-w-sm">
            The brain grows as this session produces work.
          </p>
        </div>
      ) : (
        scopeKey && <BrainCanvas scopeKey={scopeKey} meetingId={meetingId} onOpenEntity={onOpenEntity} />
      )}
    </div>
  );
}
