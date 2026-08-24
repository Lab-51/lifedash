// @vitest-environment jsdom
// === FILE PURPOSE ===
// Renderer tests for EntityInspector, focused on the "Merge into…" action
// (ENTITY-NAME.1 Task 3) — the fact/analyze-history triad it sits beside is
// already covered end-to-end via BrainInspector.test.tsx; this suite grounds
// EntityInspector in isolation (its own new __tests__ directory) and then
// proves:
//   - the picker only ever shows what entity:merge-candidates returns, scoped
//     to the SOURCE's own id — that scoping is how the SERVER
//     (entityFactService.listMergeCandidates) excludes both the source itself
//     and every other-kind entity; nothing here re-filters;
//   - the confirm step is a REAL gate (picking a target alone never calls
//     entity:merge) with the exact required copy;
//   - every step is keyboard-reachable via plain button focus + Enter, like
//     the rest of the triad's affordances;
//   - a successful merge re-points this card to the survivor (new header,
//     facts reloaded for the new id) and refreshes cached Brain scopes; a
//     FAILED merge never silently re-points.

import { it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import type { BrainNode, BrainTree } from '../../../../shared/types';

const entityListFacts = vi.fn().mockResolvedValue([]);
const entityForgetFact = vi.fn().mockResolvedValue(undefined);
const entityAnalyzeHistory = vi.fn().mockResolvedValue({
  status: 'not-implemented',
  error: 'Analyze past sessions is not implemented yet.',
  minedMeetings: 0,
  newFacts: 0,
  skippedMeetings: 0,
});
const entityMergeCandidates = vi.fn();
const entityMerge = vi.fn();
const emptyTree: BrainTree = {
  root: { id: 'workspace', type: 'workspace', label: 'Workspace', entityId: null, childCount: 0, children: [] },
  crossLinks: [],
};
const buildBrainTree = vi.fn().mockResolvedValue(emptyTree);

vi.stubGlobal('electronAPI', {
  entityListFacts,
  entityForgetFact,
  entityAnalyzeHistory,
  entityMergeCandidates,
  entityMerge,
  buildBrainTree,
});

const { EntityInspector } = await import('../EntityInspectors');
const { useBrainStore } = await import('../../../stores/brainStore');

function node(overrides: Partial<BrainNode> = {}): BrainNode {
  return {
    id: 'entity:e1',
    type: 'person',
    label: 'Original Person',
    entityId: 'e1',
    childCount: 0,
    children: [],
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  entityListFacts.mockResolvedValue([]);
  buildBrainTree.mockResolvedValue(emptyTree);
  useBrainStore.setState({ scopes: {}, activeScopeKey: null, inspectorOpen: false });
});

it('shows the entity kind, label, and its learned facts once loaded', async () => {
  entityListFacts.mockResolvedValueOnce([
    {
      id: 'f1',
      entityId: 'e1',
      content: 'Owns the Q3 rollout.',
      sourceMeetingId: 'm1',
      sourceMeetingTitle: 'Sync',
      createdAt: '2026-01-01T00:00:00Z',
    },
  ]);
  render(<EntityInspector node={node()} onOpenEntity={vi.fn()} />);

  expect(screen.getByText('Person')).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 3, name: 'Original Person' })).toBeInTheDocument();
  expect(await screen.findByText('Owns the Q3 rollout.')).toBeInTheDocument();
});

it('disables "Merge into…" until facts finish loading, so the confirm step never discloses a stale count', async () => {
  let resolveFacts!: (value: unknown[]) => void;
  entityListFacts.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveFacts = resolve;
    }),
  );
  render(<EntityInspector node={node()} onOpenEntity={vi.fn()} />);

  expect(screen.getByRole('button', { name: /merge into/i })).toBeDisabled();
  resolveFacts([]);
  await waitFor(() => expect(screen.getByRole('button', { name: /merge into/i })).not.toBeDisabled());
});

it('opens a same-kind picker scoped to the source id, showing exactly the server-returned candidates', async () => {
  entityMergeCandidates.mockResolvedValueOnce([
    { id: 'p2', name: 'Blythe Okafor', factCount: 3 },
    { id: 'p3', name: 'Corvin Adeyemi', factCount: 0 },
  ]);
  const user = userEvent.setup();
  render(<EntityInspector node={node()} onOpenEntity={vi.fn()} />);

  const mergeButton = await screen.findByRole('button', { name: /merge into/i });
  await waitFor(() => expect(mergeButton).not.toBeDisabled());
  await user.click(mergeButton);

  // Scoped to the SOURCE's own id — this is what lets the server exclude the
  // source itself and every other-kind entity; the renderer never re-filters.
  expect(entityMergeCandidates).toHaveBeenCalledWith('e1');

  const picker = await screen.findByRole('group', { name: 'Merge into…' });
  expect(within(picker).getByText('Blythe Okafor')).toBeInTheDocument();
  expect(within(picker).getByText('Corvin Adeyemi')).toBeInTheDocument();
  // Never the source's own name — a self-merge must not even be selectable.
  expect(within(picker).queryByText('Original Person')).not.toBeInTheDocument();
  // Nothing beyond the cancel (X) button + the two server-returned candidates.
  expect(within(picker).getAllByRole('button')).toHaveLength(3);
});

it('shows an honest empty state when there is nothing else of this kind to merge into', async () => {
  entityMergeCandidates.mockResolvedValueOnce([]);
  const user = userEvent.setup();
  render(<EntityInspector node={node()} onOpenEntity={vi.fn()} />);

  await user.click(await screen.findByRole('button', { name: /merge into/i }));
  expect(await screen.findByText('Nothing else of this kind to merge into yet.')).toBeInTheDocument();
});

it('gates the merge behind an explicit confirm step with the exact required copy — picking a target alone never calls entity:merge', async () => {
  entityListFacts.mockResolvedValueOnce([
    { id: 'f1', entityId: 'e1', content: 'Fact one.', sourceMeetingId: 'm1', createdAt: '2026-01-01T00:00:00Z' },
    { id: 'f2', entityId: 'e1', content: 'Fact two.', sourceMeetingId: 'm2', createdAt: '2026-01-02T00:00:00Z' },
  ]);
  entityMergeCandidates.mockResolvedValueOnce([{ id: 'p2', name: 'Blythe Okafor', factCount: 3 }]);
  const oneSession = node({
    children: [{ id: 'session:m1', type: 'session', label: 'Sync 1', entityId: 'm1', childCount: 0, children: [] }],
  });
  const user = userEvent.setup();
  render(<EntityInspector node={oneSession} onOpenEntity={vi.fn()} />);

  await user.click(await screen.findByRole('button', { name: /merge into/i }));
  await user.click(await screen.findByText('Blythe Okafor'));

  expect(entityMerge).not.toHaveBeenCalled();
  expect(screen.getByText('Merge Original Person into Blythe Okafor?')).toBeInTheDocument();
  expect(
    screen.getByText('Moves 2 facts and 1 session link onto Blythe Okafor; this cannot be undone.'),
  ).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Merge' }));
  expect(entityMerge).toHaveBeenCalledWith({ sourceId: 'e1', targetId: 'p2' });
});

it('is keyboard-reachable end to end: focus + Enter opens the picker and selects a candidate', async () => {
  entityMergeCandidates.mockResolvedValueOnce([{ id: 'p2', name: 'Blythe Okafor', factCount: 0 }]);
  const user = userEvent.setup();
  render(<EntityInspector node={node()} onOpenEntity={vi.fn()} />);

  const mergeButton = await screen.findByRole('button', { name: /merge into/i });
  await waitFor(() => expect(mergeButton).not.toBeDisabled());
  mergeButton.focus();
  expect(mergeButton).toHaveFocus();
  await user.keyboard('{Enter}');

  const candidateButton = await screen.findByRole('button', { name: /Blythe Okafor/ });
  candidateButton.focus();
  expect(candidateButton).toHaveFocus();
  await user.keyboard('{Enter}');

  expect(await screen.findByRole('button', { name: 'Merge' })).toBeInTheDocument();
});

it('shows a typed merge failure inline and never silently re-points on a failed merge', async () => {
  entityMergeCandidates.mockResolvedValueOnce([{ id: 'p2', name: 'Blythe Okafor', factCount: 0 }]);
  entityMerge.mockResolvedValueOnce({
    status: 'error',
    message: 'mergeEntityInto: refusing to merge across kinds (person into topic)',
  });
  const user = userEvent.setup();
  render(<EntityInspector node={node()} onOpenEntity={vi.fn()} />);

  await user.click(await screen.findByRole('button', { name: /merge into/i }));
  await user.click(await screen.findByText('Blythe Okafor'));
  await user.click(screen.getByRole('button', { name: 'Merge' }));

  expect(
    await screen.findByText('mergeEntityInto: refusing to merge across kinds (person into topic)'),
  ).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 3, name: 'Original Person' })).toBeInTheDocument();
});

it('re-points the inspector to the survivor on a successful merge, and refreshes cached Brain scopes', async () => {
  entityMergeCandidates.mockResolvedValueOnce([{ id: 'p2', name: 'Blythe Okafor', factCount: 3 }]);
  entityMerge.mockResolvedValueOnce({ status: 'ok', survivorId: 'p2', factsRepointed: 2, linksMerged: 1 });
  entityListFacts.mockResolvedValueOnce([]); // initial load, for the source
  entityListFacts.mockResolvedValueOnce([
    { id: 'f9', entityId: 'p2', content: 'Owns onboarding.', sourceMeetingId: 'm9', createdAt: '2026-01-03T00:00:00Z' },
  ]); // reload after the swap, for the survivor

  // A cached workspace scope, so the "refresh the tree" half is observable.
  useBrainStore.setState({
    scopes: {
      workspace: { tree: emptyTree, expanded: new Set(), selection: null, entering: new Set(), newCounts: {} },
    },
    activeScopeKey: 'workspace',
  });

  const user = userEvent.setup();
  render(<EntityInspector node={node()} onOpenEntity={vi.fn()} />);

  await user.click(await screen.findByRole('button', { name: /merge into/i }));
  await user.click(await screen.findByText('Blythe Okafor'));
  await user.click(screen.getByRole('button', { name: 'Merge' }));

  // Re-points: header swaps to the survivor's name; the source's is gone.
  expect(await screen.findByRole('heading', { level: 3, name: 'Blythe Okafor' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { level: 3, name: 'Original Person' })).not.toBeInTheDocument();

  // Facts reload for the SURVIVOR — loadFacts re-fires because activeEntityId changed.
  expect(entityListFacts).toHaveBeenLastCalledWith('p2');
  expect(await screen.findByText('Owns onboarding.')).toBeInTheDocument();

  // "Refresh the tree": every cached scope gets refetched.
  await waitFor(() => expect(buildBrainTree).toHaveBeenCalledWith('workspace'));

  // The picker itself is gone and the trigger is back, ready for a further merge.
  expect(screen.queryByRole('group', { name: 'Merge into…' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /merge into/i })).toBeInTheDocument();
});
