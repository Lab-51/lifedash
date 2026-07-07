// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { BrainNode, BrainNodeType, BrainTree, CrossLink } from '../../../shared/types';
import BrainMindMap from '../BrainMindMap';
import { useBrainStore, computeDefaultExpansion, scopeKeyFor } from '../../stores/brainStore';

// jsdom has no matchMedia — the reduced-motion hook reads it. Default: not reduced.
const matchMediaMock = vi.fn((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));
Object.defineProperty(window, 'matchMedia', { writable: true, value: matchMediaMock });

// --- Fixture helpers --------------------------------------------------------
function n(
  id: string,
  type: BrainNodeType,
  label: string,
  entityId: string | null,
  children: BrainNode[] = [],
): BrainNode {
  return { id, type, label, entityId, childCount: children.length, children };
}

/** workspace > project > column(Backlog) > 2 cards. */
function workspaceFixture(): BrainTree {
  const root = n('workspace', 'workspace', 'Workspace', null, [
    n('project:p1', 'project', 'Project Alpha', 'p1', [
      n('column:col1', 'column', 'Backlog', 'col1', [
        n('card:card1', 'card', 'First card', 'card1'),
        n('card:card2', 'card', 'Second card', 'card2'),
      ]),
    ]),
  ]);
  return { root, crossLinks: [] };
}

/** workspace > project > {Sessions > session, column > card} with a provenance
 *  crossLink card->session. */
function crossLinkFixture(): BrainTree {
  const root = n('workspace', 'workspace', 'Workspace', null, [
    n('project:p1', 'project', 'Project Alpha', 'p1', [
      n('group:sessions:p1', 'group', 'Sessions', null, [n('session:s1', 'session', 'Kickoff', 's1')]),
      n('column:col1', 'column', 'Backlog', 'col1', [n('card:card1', 'card', 'First card', 'card1')]),
    ]),
  ]);
  const crossLinks: CrossLink[] = [{ fromId: 'card:card1', toId: 'session:s1', kind: 'provenance' }];
  return { root, crossLinks };
}

/** session scope where card:card1 appears twice (under the project column AND
 *  under "Cards created") — the same id at two positions. */
function doubleOccurrenceFixture(): BrainTree {
  const root = n('session:m1', 'session', 'Weekly Sync', 'm1', [
    n('group:project:m1', 'group', 'Project', null, [
      n('project:p1', 'project', 'Project Alpha', 'p1', [
        n('column:col1', 'column', 'Backlog', 'col1', [n('card:card1', 'card', 'Shared card', 'card1')]),
      ]),
    ]),
    n('group:cards:m1', 'group', 'Cards created', null, [n('card:card1', 'card', 'Shared card', 'card1')]),
  ]);
  return { root, crossLinks: [] };
}

/** workspace > project > column(Backlog) with `cardCount` direct card children —
 *  used to exercise the Task 5 huge-expansion guard (> 100 direct children). */
function heavyColumnFixture(cardCount: number): BrainTree {
  const cards = Array.from({ length: cardCount }, (_, i) => n(`card:c${i}`, 'card', `Card ${i}`, `c${i}`));
  const root = n('workspace', 'workspace', 'Workspace', null, [
    n('project:p1', 'project', 'Project Alpha', 'p1', [n('column:col1', 'column', 'Backlog', 'col1', cards)]),
  ]);
  return { root, crossLinks: [] };
}

/** Every node id that has children — used to force a fully-expanded layout. */
function allBranchIds(root: BrainNode): Set<string> {
  const ids = new Set<string>();
  const walk = (node: BrainNode): void => {
    if (node.children.length > 0) ids.add(node.id);
    node.children.forEach(walk);
  };
  walk(root);
  return ids;
}

const KEY = 'workspace';
const noop = (): void => {};

beforeEach(() => {
  cleanup();
  useBrainStore.setState({ scopes: {} });
  matchMediaMock.mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

// ---------------------------------------------------------------------------
// brainStore
// ---------------------------------------------------------------------------
describe('brainStore', () => {
  it('computeDefaultExpansion expands depth <= 1 (root + direct children), not deeper', () => {
    const { root } = workspaceFixture();
    const expanded = computeDefaultExpansion(root);
    expect(expanded.has('workspace')).toBe(true); // depth 0
    expect(expanded.has('project:p1')).toBe(true); // depth 1
    expect(expanded.has('column:col1')).toBe(false); // depth 2 — visible but collapsed
    expect(expanded.has('card:card1')).toBe(false); // depth 3 — hidden
  });

  it('setTree seeds default expansion and clears selection', () => {
    useBrainStore.getState().setTree(KEY, workspaceFixture());
    const scope = useBrainStore.getState().scopes[KEY];
    expect(scope.selection).toBeNull();
    expect(scope.expanded).toEqual(new Set(['workspace', 'project:p1']));
    expect(scope.tree).not.toBeNull();
  });

  it('toggleExpansion adds then removes a node id', () => {
    useBrainStore.getState().setTree(KEY, workspaceFixture());
    useBrainStore.getState().toggleExpansion(KEY, 'column:col1');
    expect(useBrainStore.getState().scopes[KEY].expanded.has('column:col1')).toBe(true);
    useBrainStore.getState().toggleExpansion(KEY, 'column:col1');
    expect(useBrainStore.getState().scopes[KEY].expanded.has('column:col1')).toBe(false);
  });

  it('keeps scopes isolated — toggling one does not touch another', () => {
    const wsKey = scopeKeyFor('workspace');
    const sessionKey = scopeKeyFor({ meetingId: 'm1' });
    useBrainStore.getState().setTree(wsKey, workspaceFixture());
    useBrainStore.getState().setTree(sessionKey, workspaceFixture());

    useBrainStore.getState().toggleExpansion(wsKey, 'column:col1');

    expect(useBrainStore.getState().scopes[wsKey].expanded.has('column:col1')).toBe(true);
    expect(useBrainStore.getState().scopes[sessionKey].expanded.has('column:col1')).toBe(false);
  });

  it('setSelection sets and clears the selected node id', () => {
    useBrainStore.getState().setTree(KEY, workspaceFixture());
    useBrainStore.getState().setSelection(KEY, 'project:p1');
    expect(useBrainStore.getState().scopes[KEY].selection).toBe('project:p1');
    useBrainStore.getState().setSelection(KEY, null);
    expect(useBrainStore.getState().scopes[KEY].selection).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// BrainMindMap
// ---------------------------------------------------------------------------
describe('BrainMindMap', () => {
  it('lays out only expanded branches (grandchildren collapsed by default)', () => {
    useBrainStore.getState().setTree(KEY, workspaceFixture());
    const { container } = render(<BrainMindMap scopeKey={KEY} onOpenEntity={noop} />);

    // Visible: workspace, project:p1, column:col1 — cards hidden (column collapsed).
    const nodes = container.querySelectorAll('[data-node-id]');
    expect(nodes.length).toBe(3);
    expect(container.querySelector('[data-node-id="column:col1"]')).not.toBeNull();
    expect(container.querySelector('[data-node-id="card:card1"]')).toBeNull();
  });

  it('shows the child-count label on a collapsed branch node', () => {
    useBrainStore.getState().setTree(KEY, workspaceFixture());
    render(<BrainMindMap scopeKey={KEY} onOpenEntity={noop} />);

    // column:col1 is collapsed and has 2 children.
    expect(screen.getByRole('button', { name: 'Expand Backlog (2)' })).toBeInTheDocument();
  });

  it('chevron toggle updates the store AND the rendered node set', () => {
    useBrainStore.getState().setTree(KEY, workspaceFixture());
    const { container } = render(<BrainMindMap scopeKey={KEY} onOpenEntity={noop} />);

    expect(container.querySelectorAll('[data-node-id]').length).toBe(3);

    fireEvent.click(screen.getByRole('button', { name: 'Expand Backlog (2)' }));

    // Store now marks the column expanded...
    expect(useBrainStore.getState().scopes[KEY].expanded.has('column:col1')).toBe(true);
    // ...and its two cards are laid out.
    expect(container.querySelectorAll('[data-node-id]').length).toBe(5);
    expect(container.querySelector('[data-node-id="card:card1"]')).not.toBeNull();
  });

  it('a node-label click fires onInspect with the node (inspector), NOT onOpenEntity', () => {
    // Inspector story: the click now opens the in-canvas inspector (onInspect);
    // onOpenEntity became the inspector's explicit "Open full page →" action.
    const onOpen = vi.fn();
    const onInspect = vi.fn();
    useBrainStore.getState().setTree(KEY, workspaceFixture());
    render(<BrainMindMap scopeKey={KEY} onOpenEntity={onOpen} onInspect={onInspect} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open Project Alpha' }));
    expect(onInspect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'project:p1', type: 'project', entityId: 'p1' }),
    );
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('falls back to onOpenEntity when no onInspect is wired', () => {
    const onOpen = vi.fn();
    useBrainStore.getState().setTree(KEY, workspaceFixture());
    render(<BrainMindMap scopeKey={KEY} onOpenEntity={onOpen} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open Project Alpha' }));
    expect(onOpen).toHaveBeenCalledWith({ type: 'project', entityId: 'p1' });
  });

  it('does not fire onInspect for a null-entityId node (workspace/group) — no "Open" button exists', () => {
    const onOpen = vi.fn();
    const onInspect = vi.fn();
    useBrainStore.getState().setTree(KEY, workspaceFixture());
    render(<BrainMindMap scopeKey={KEY} onOpenEntity={onOpen} onInspect={onInspect} />);

    // Root workspace node has entityId null — no "Open" button exists for it.
    expect(screen.queryByRole('button', { name: 'Open Workspace' })).toBeNull();
    expect(onInspect).not.toHaveBeenCalled();
  });

  it('keeps the pinned node highlighted (accent stroke) even with no hover selection', () => {
    useBrainStore.getState().setTree(KEY, workspaceFixture());
    const { container } = render(<BrainMindMap scopeKey={KEY} onOpenEntity={noop} pinnedId="project:p1" />);

    // A non-root node normally has strokeWidth 1.25; pinned lifts it to 2 (like selection).
    const rect = container.querySelector('[data-node-id="project:p1"] rect') as SVGRectElement;
    expect(rect).not.toBeNull();
    expect(rect.getAttribute('stroke-width')).toBe('2');
    // A non-pinned, non-root node stays at the default weight.
    const other = container.querySelector('[data-node-id="column:col1"] rect') as SVGRectElement;
    expect(other.getAttribute('stroke-width')).toBe('1.25');
  });

  it('renders a dashed crossLink overlay only while an involved node is selected', () => {
    useBrainStore.getState().setTree(KEY, crossLinkFixture());
    // Expand enough that both crossLink endpoints (card + session) are visible.
    useBrainStore.setState((s) => ({
      scopes: {
        ...s.scopes,
        [KEY]: {
          ...s.scopes[KEY],
          expanded: new Set([...s.scopes[KEY].expanded, 'group:sessions:p1', 'column:col1']),
        },
      },
    }));
    const { container } = render(<BrainMindMap scopeKey={KEY} onOpenEntity={noop} />);

    // Nothing selected -> no overlay.
    expect(container.querySelector('[data-testid="brain-crosslink"]')).toBeNull();

    // Hover the card -> selection set -> its provenance link to the session appears.
    fireEvent.mouseEnter(container.querySelector('[data-node-id="card:card1"]')!);
    const overlay = container.querySelector('[data-testid="brain-crosslink"]');
    expect(overlay).not.toBeNull();
    expect(overlay).toHaveAttribute('data-kind', 'provenance');

    // Leaving clears selection and removes the overlay.
    fireEvent.mouseLeave(container.querySelector('[data-node-id="card:card1"]')!);
    expect(container.querySelector('[data-testid="brain-crosslink"]')).toBeNull();
  });

  it('disables position transitions under prefers-reduced-motion', () => {
    matchMediaMock.mockImplementation((query: string) => ({
      matches: query.includes('reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    useBrainStore.getState().setTree(KEY, workspaceFixture());
    const { container } = render(<BrainMindMap scopeKey={KEY} onOpenEntity={noop} />);

    expect(container.querySelector('[data-testid="brain-mindmap"]')).toHaveAttribute('data-reduced-motion', 'true');
    const nodeGroup = container.querySelector('[data-node-id="workspace"]') as SVGGElement;
    expect(nodeGroup.style.transition).toBe('none');
  });

  it('renders the same id at two positions without duplicate-key collisions', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tree = doubleOccurrenceFixture();
    useBrainStore.getState().setTree(KEY, tree);
    useBrainStore.setState((s) => ({
      scopes: { ...s.scopes, [KEY]: { ...s.scopes[KEY], expanded: allBranchIds(tree.root) } },
    }));
    const { container } = render(<BrainMindMap scopeKey={KEY} onOpenEntity={noop} />);

    // Both occurrences of card:card1 are laid out (keyed by path, not raw id).
    expect(container.querySelectorAll('[data-node-id="card:card1"]').length).toBe(2);
    // No React "duplicate key" warning.
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('shows an empty state when the scope has no tree', () => {
    render(<BrainMindMap scopeKey="unset" onOpenEntity={noop} />);
    expect(screen.getByText('No graph to show yet.')).toBeInTheDocument();
  });

  it('mounts the <svg> even before the tree loads so d3-zoom binds on first open (drag regression)', () => {
    // Root cause of the "not draggable until re-click" bug: the empty/loading
    // state used to early-return a <div> with NO <svg>, so the once-per-mount
    // zoom-attach effect ran against a null ref and never re-ran when the tree
    // arrived. The <svg> (and svgRef) must always be present so zoom attaches on
    // the first commit. If this fails, panning is dead until a remount.
    const { container } = render(<BrainMindMap scopeKey="unset" onOpenEntity={noop} />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(screen.getByText('No graph to show yet.')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Task 4 — live growth: entrance animation + collapsed-ancestor "N new" badge
  // -------------------------------------------------------------------------
  it('applies the one-shot entrance style to a node marked "entering" (Task 4 live growth)', () => {
    useBrainStore.getState().setTree(KEY, workspaceFixture());
    useBrainStore.setState((s) => ({
      scopes: { ...s.scopes, [KEY]: { ...s.scopes[KEY], entering: new Set(['column:col1']) } },
    }));
    const { container } = render(<BrainMindMap scopeKey={KEY} onOpenEntity={noop} />);

    const inner = container.querySelector(
      '[data-node-id="column:col1"] [data-testid="brain-node-entering"]',
    ) as SVGGElement;
    expect(inner).not.toBeNull();
    expect(inner.style.animation).toContain('brain-node-enter');

    // A node NOT in the entering set gets no such treatment.
    expect(container.querySelector('[data-node-id="project:p1"] [data-testid="brain-node-entering"]')).toBeNull();
  });

  it('does not apply the entrance animation style under prefers-reduced-motion, even when marked entering', () => {
    matchMediaMock.mockImplementation((query: string) => ({
      matches: query.includes('reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    useBrainStore.getState().setTree(KEY, workspaceFixture());
    useBrainStore.setState((s) => ({
      scopes: { ...s.scopes, [KEY]: { ...s.scopes[KEY], entering: new Set(['column:col1']) } },
    }));
    const { container } = render(<BrainMindMap scopeKey={KEY} onOpenEntity={noop} />);

    const inner = container.querySelector(
      '[data-node-id="column:col1"] [data-testid="brain-node-entering"]',
    ) as SVGGElement;
    expect(inner.style.animation).toBe('');
  });

  it('shows the "N new" badge on a collapsed branch node with a newCounts entry (Task 4 live growth)', () => {
    useBrainStore.getState().setTree(KEY, workspaceFixture());
    useBrainStore.setState((s) => ({
      scopes: { ...s.scopes, [KEY]: { ...s.scopes[KEY], newCounts: { 'column:col1': 2 } } },
    }));
    const { container } = render(<BrainMindMap scopeKey={KEY} onOpenEntity={noop} />);

    const badge = container.querySelector('[data-node-id="column:col1"] [data-testid="brain-new-badge"]');
    expect(badge).not.toBeNull();
    expect(badge).toHaveTextContent('2');
    expect(screen.getByRole('button', { name: 'Expand Backlog (2, 2 new)' })).toBeInTheDocument();
  });

  it('hides the "N new" badge once that node is expanded', () => {
    useBrainStore.getState().setTree(KEY, workspaceFixture());
    useBrainStore.setState((s) => ({
      scopes: {
        ...s.scopes,
        [KEY]: {
          ...s.scopes[KEY],
          expanded: new Set([...s.scopes[KEY].expanded, 'column:col1']),
          newCounts: { 'column:col1': 2 },
        },
      },
    }));
    const { container } = render(<BrainMindMap scopeKey={KEY} onOpenEntity={noop} />);

    expect(container.querySelector('[data-node-id="column:col1"] [data-testid="brain-new-badge"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Inspector-card story — a node-anchored card (pinnedPanel) + connector
// ---------------------------------------------------------------------------
describe('BrainMindMap — node-anchored inspector card', () => {
  const panel = <div data-testid="pinned-content">Inspector content</div>;

  it('renders pinnedPanel in a node-anchored card, positioned from the node, with a connector', () => {
    useBrainStore.getState().setTree(KEY, workspaceFixture());
    const { container } = render(
      <BrainMindMap scopeKey={KEY} onOpenEntity={noop} pinnedId="project:p1" pinnedPanel={panel} />,
    );

    // The supplied CONTENT is rendered inside the anchored card...
    const card = container.querySelector('[data-testid="brain-pinned-card"]') as HTMLElement;
    expect(card).not.toBeNull();
    expect(screen.getByTestId('pinned-content')).toBeInTheDocument();

    // ...the card is absolutely positioned from the node (left/top set inline, and it
    // defaults to the RIGHT of the node so left is a positive on-screen coordinate)...
    expect(card.className).toContain('absolute');
    expect(parseFloat(card.style.left)).toBeGreaterThan(0);
    expect(card.style.top).not.toBe('');
    expect(card.style.width).toBe('320px');

    // ...and a connector line ties the card back to the node.
    const connector = container.querySelector('[data-testid="brain-pinned-connector"]') as SVGLineElement;
    expect(connector).not.toBeNull();
    expect(connector.getAttribute('x1')).not.toBeNull();
    expect(connector.getAttribute('y1')).not.toBeNull();
  });

  it('hides the card + connector when the pinned node is not in the current layout (no crash)', () => {
    // card:card1 lives under the collapsed-by-default column, so it is NOT laid out.
    useBrainStore.getState().setTree(KEY, workspaceFixture());
    const { container } = render(
      <BrainMindMap scopeKey={KEY} onOpenEntity={noop} pinnedId="card:card1" pinnedPanel={panel} />,
    );

    expect(container.querySelector('[data-testid="brain-pinned-card"]')).toBeNull();
    expect(container.querySelector('[data-testid="brain-pinned-connector"]')).toBeNull();
    expect(screen.queryByTestId('pinned-content')).toBeNull();
  });

  it('renders no card when pinnedPanel is omitted, even with a pinnedId', () => {
    useBrainStore.getState().setTree(KEY, workspaceFixture());
    const { container } = render(<BrainMindMap scopeKey={KEY} onOpenEntity={noop} pinnedId="project:p1" />);

    expect(container.querySelector('[data-testid="brain-pinned-card"]')).toBeNull();
    expect(container.querySelector('[data-testid="brain-pinned-connector"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Huge-expansion guard (Task 5) — > 100 DIRECT children asks before rendering
// ---------------------------------------------------------------------------
describe('BrainMindMap — huge-expansion guard (Task 5)', () => {
  it('asks via an inline "Show N nodes?" chip instead of expanding a node with > 100 direct children', () => {
    useBrainStore.getState().setTree(KEY, heavyColumnFixture(150));
    render(<BrainMindMap scopeKey={KEY} onOpenEntity={noop} />);

    fireEvent.click(screen.getByRole('button', { name: 'Expand Backlog (150)' }));

    // Not expanded yet — the guard intercepted the click; the real toggle never ran.
    expect(useBrainStore.getState().scopes[KEY].expanded.has('column:col1')).toBe(false);
    expect(screen.getByRole('button', { name: 'Show 150 nodes?' })).toBeInTheDocument();
  });

  it('confirming the chip performs the real expansion', () => {
    useBrainStore.getState().setTree(KEY, heavyColumnFixture(150));
    render(<BrainMindMap scopeKey={KEY} onOpenEntity={noop} />);

    fireEvent.click(screen.getByRole('button', { name: 'Expand Backlog (150)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show 150 nodes?' }));

    expect(useBrainStore.getState().scopes[KEY].expanded.has('column:col1')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Show 150 nodes?' })).toBeNull();
  });

  it('the confirm chip is keyboard-operable — Enter confirms just like a click', () => {
    useBrainStore.getState().setTree(KEY, heavyColumnFixture(150));
    render(<BrainMindMap scopeKey={KEY} onOpenEntity={noop} />);

    fireEvent.click(screen.getByRole('button', { name: 'Expand Backlog (150)' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Show 150 nodes?' }), { key: 'Enter' });

    expect(useBrainStore.getState().scopes[KEY].expanded.has('column:col1')).toBe(true);
  });

  it('a normal (small, <= 100 direct children) expansion is unaffected — no chip, toggles immediately', () => {
    useBrainStore.getState().setTree(KEY, workspaceFixture()); // column:col1 has 2 cards
    render(<BrainMindMap scopeKey={KEY} onOpenEntity={noop} />);

    fireEvent.click(screen.getByRole('button', { name: 'Expand Backlog (2)' }));

    expect(useBrainStore.getState().scopes[KEY].expanded.has('column:col1')).toBe(true);
    expect(screen.queryByRole('button', { name: /^Show \d+ nodes\?$/ })).toBeNull();
  });

  it('collapsing an already-expanded heavy node is never guarded (only expanding is)', () => {
    useBrainStore.getState().setTree(KEY, heavyColumnFixture(150));
    useBrainStore.setState((s) => ({
      scopes: {
        ...s.scopes,
        [KEY]: { ...s.scopes[KEY], expanded: new Set([...s.scopes[KEY].expanded, 'column:col1']) },
      },
    }));
    render(<BrainMindMap scopeKey={KEY} onOpenEntity={noop} />);

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Backlog' }));

    expect(useBrainStore.getState().scopes[KEY].expanded.has('column:col1')).toBe(false);
    expect(screen.queryByRole('button', { name: /^Show \d+ nodes\?$/ })).toBeNull();
  });
});
