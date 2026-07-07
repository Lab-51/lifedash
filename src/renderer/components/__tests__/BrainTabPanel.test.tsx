// @vitest-environment jsdom
// === FILE PURPOSE ===
// BrainTabPanel (V3.2 Task 3): scope toggle, IPC loading via brainStore, the
// bare-session empty state, fit-to-view-on-mount, and onOpenEntity pass-through.
// BrainMindMap itself (layout/d3/crossLinks) is covered by BrainMindMap.test.tsx —
// here it's mocked to a minimal forwardRef stub so these tests stay scoped to
// BrainTabPanel's own responsibilities.

import { forwardRef, useImperativeHandle } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { BrainNode, BrainNodeType, BrainTree } from '../../../shared/types';

const fitSpy = vi.fn();
const panSpy = vi.fn();

// Nodes the mock mind map / inspector hand back — both ids exist in the mock tree
// so BrainTabPanel's "keep-open only while the pinned node still exists" guard
// doesn't immediately close the inspector.
const PROJECT_NODE: BrainNode = {
  id: 'project:p1',
  type: 'project',
  label: 'Project Alpha',
  entityId: 'p1',
  childCount: 0,
  children: [],
};
const SESSION_NODE: BrainNode = {
  id: 'session:m1',
  type: 'session',
  label: 'Weekly Sync',
  entityId: 'm1',
  childCount: 1,
  children: [],
};

vi.mock('../BrainMindMap', () => ({
  default: forwardRef(function MockBrainMindMap(
    props: {
      scopeKey: string;
      onOpenEntity: (arg: { type: string; entityId: string }) => void;
      onInspect?: (node: BrainNode) => void;
      pinnedId?: string | null;
      // Inspector-card story: the inspector is now handed to BrainMindMap as the
      // node-anchored card CONTENT (positioning is BrainMindMap's job), so the mock
      // must render it — this is where the BrainInspector under test appears.
      pinnedPanel?: React.ReactNode;
    },
    ref: React.Ref<{ fit: () => void; panToNode: (id: string) => void }>,
  ) {
    useImperativeHandle(ref, () => ({ fit: fitSpy, panToNode: panSpy }));
    return (
      <div data-testid="mock-mindmap" data-scope-key={props.scopeKey} data-pinned-id={props.pinnedId ?? ''}>
        <button onClick={() => props.onOpenEntity({ type: 'card', entityId: 'card-1' })}>open-card</button>
        <button onClick={() => props.onInspect?.(PROJECT_NODE)}>inspect-project</button>
        {props.pinnedPanel}
      </div>
    );
  }),
}));

// Mock the inspector to keep these tests scoped to BrainTabPanel's wiring (pin
// state, pan, open/close, onOpenEntity forwarding, in-canvas drill). The real
// inspector's per-type reuse is covered by BrainInspector.test.tsx.
vi.mock('../BrainInspector', () => ({
  default: (props: {
    node: BrainNode;
    onOpenEntity: (arg: { type: BrainNodeType; entityId: string }) => void;
    onInspectNode: (node: BrainNode) => void;
    onClose: () => void;
  }) => (
    <div data-testid="mock-inspector" data-node-id={props.node.id}>
      <button onClick={() => props.onOpenEntity({ type: props.node.type, entityId: props.node.entityId! })}>
        open-full
      </button>
      <button onClick={() => props.onInspectNode(SESSION_NODE)}>drill</button>
      <button onClick={props.onClose}>close-inspector</button>
    </div>
  ),
}));

vi.stubGlobal('electronAPI', {
  buildBrainTree: vi.fn(),
});

const { useBrainStore, scopeKeyFor } = await import('../../stores/brainStore');
const { default: BrainTabPanel } = await import('../BrainTabPanel');

function n(id: string, entityId: string | null, children: BrainNode[] = []): BrainNode {
  return {
    id,
    type: children.length > 0 ? 'project' : 'card',
    label: id,
    entityId,
    childCount: children.length,
    children,
  };
}

function sessionTree(children: BrainNode[] = []): BrainTree {
  return { root: n('session:m1', 'm1', children), crossLinks: [] };
}

function workspaceTree(children: BrainNode[] = []): BrainTree {
  return { root: n('workspace', null, children), crossLinks: [] };
}

describe('BrainTabPanel', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    fitSpy.mockClear();
    panSpy.mockClear();
    useBrainStore.setState({ scopes: {} });
  });

  it('renders the mind map for the default session scope, keyed to the meeting', async () => {
    vi.mocked(window.electronAPI.buildBrainTree).mockResolvedValue(sessionTree([n('project:p1', 'p1')]));
    render(<BrainTabPanel meetingId="m1" projectId={null} onOpenEntity={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId('mock-mindmap')).toBeInTheDocument());
    expect(screen.getByTestId('mock-mindmap')).toHaveAttribute('data-scope-key', scopeKeyFor({ meetingId: 'm1' }));
    expect(window.electronAPI.buildBrainTree).toHaveBeenCalledWith({ meetingId: 'm1' });
  });

  it('shows the bare-session empty state when the session has produced nothing yet', async () => {
    vi.mocked(window.electronAPI.buildBrainTree).mockResolvedValue(sessionTree([])); // root, no children
    render(<BrainTabPanel meetingId="m1" projectId={null} onOpenEntity={vi.fn()} />);

    expect(await screen.findByText('The brain grows as this session produces work.')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-mindmap')).toBeNull();
  });

  it('shows the bare-session empty state immediately when there is no meetingId yet', () => {
    render(<BrainTabPanel meetingId={undefined} projectId={null} onOpenEntity={vi.fn()} />);

    expect(screen.getByText('The brain grows as this session produces work.')).toBeInTheDocument();
    expect(window.electronAPI.buildBrainTree).not.toHaveBeenCalled();
  });

  it('toggling to "Everything" swaps to workspace scope and caches it (no refetch on toggling back)', async () => {
    vi.mocked(window.electronAPI.buildBrainTree).mockImplementation((scope) =>
      Promise.resolve(
        scope === 'workspace' ? workspaceTree([n('project:p1', 'p1')]) : sessionTree([n('project:p1', 'p1')]),
      ),
    );
    render(<BrainTabPanel meetingId="m1" projectId={null} onOpenEntity={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('mock-mindmap')).toHaveAttribute('data-scope-key', 'session:m1'));

    fireEvent.click(screen.getByRole('button', { name: 'Everything' }));
    await waitFor(() => expect(screen.getByTestId('mock-mindmap')).toHaveAttribute('data-scope-key', 'workspace'));

    fireEvent.click(screen.getByRole('button', { name: 'This session' }));
    await waitFor(() => expect(screen.getByTestId('mock-mindmap')).toHaveAttribute('data-scope-key', 'session:m1'));

    // Both scopes were fetched exactly once each — toggling back and forth never re-fetches.
    expect(window.electronAPI.buildBrainTree).toHaveBeenCalledTimes(2);
  });

  it("preserves each scope's expansion independently across toggling", async () => {
    vi.mocked(window.electronAPI.buildBrainTree).mockImplementation((scope) =>
      Promise.resolve(
        scope === 'workspace' ? workspaceTree([n('project:p1', 'p1')]) : sessionTree([n('project:p1', 'p1')]),
      ),
    );
    render(<BrainTabPanel meetingId="m1" projectId={null} onOpenEntity={vi.fn()} />);
    await waitFor(() => expect(window.electronAPI.buildBrainTree).toHaveBeenCalledWith({ meetingId: 'm1' }));

    useBrainStore.getState().toggleExpansion('session:m1', 'project:p1');
    expect(useBrainStore.getState().scopes['session:m1'].expanded.has('project:p1')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Everything' }));
    await waitFor(() => expect(window.electronAPI.buildBrainTree).toHaveBeenCalledWith('workspace'));

    fireEvent.click(screen.getByRole('button', { name: 'This session' }));

    // Session scope's manually-toggled expansion survived the round trip.
    expect(useBrainStore.getState().scopes['session:m1'].expanded.has('project:p1')).toBe(true);
  });

  it('marks the active scope button with aria-pressed', async () => {
    vi.mocked(window.electronAPI.buildBrainTree).mockResolvedValue(sessionTree([n('project:p1', 'p1')]));
    render(<BrainTabPanel meetingId="m1" projectId={null} onOpenEntity={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'This session' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Everything' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('forwards onOpenEntity calls from the mind map to the host-supplied handler', async () => {
    vi.mocked(window.electronAPI.buildBrainTree).mockResolvedValue(sessionTree([n('project:p1', 'p1')]));
    const onOpenEntity = vi.fn();
    render(<BrainTabPanel meetingId="m1" projectId={null} onOpenEntity={onOpenEntity} />);

    await waitFor(() => expect(screen.getByTestId('mock-mindmap')).toBeInTheDocument());
    fireEvent.click(screen.getByText('open-card'));

    expect(onOpenEntity).toHaveBeenCalledWith({ type: 'card', entityId: 'card-1' });
  });

  it('fits the map to view once the tree is available on mount', async () => {
    vi.mocked(window.electronAPI.buildBrainTree).mockResolvedValue(sessionTree([n('project:p1', 'p1')]));
    render(<BrainTabPanel meetingId="m1" projectId={null} onOpenEntity={vi.fn()} />);

    await waitFor(() => expect(fitSpy).toHaveBeenCalledTimes(1));
  });

  it('never leaves the tab blank when the IPC load rejects', async () => {
    vi.mocked(window.electronAPI.buildBrainTree).mockRejectedValue(new Error('ipc down'));
    render(<BrainTabPanel meetingId="m1" projectId={null} onOpenEntity={vi.fn()} />);

    // No crash, no perpetual spinner — the panel (scope toggle) is still there.
    await waitFor(() => expect(window.electronAPI.buildBrainTree).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'This session' })).toBeInTheDocument();
    expect(fitSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // In-brain Inspector (Inspector story) — a node click INSPECTS in-canvas
  // -------------------------------------------------------------------------
  async function renderWithMap(onOpenEntity = vi.fn()) {
    vi.mocked(window.electronAPI.buildBrainTree).mockResolvedValue(sessionTree([n('project:p1', 'p1')]));
    render(<BrainTabPanel meetingId="m1" projectId={null} onOpenEntity={onOpenEntity} />);
    await waitFor(() => expect(screen.getByTestId('mock-mindmap')).toBeInTheDocument());
    return onOpenEntity;
  }

  it('a node click OPENS the inspector and does NOT navigate (onOpenEntity untouched)', async () => {
    const onOpenEntity = await renderWithMap();
    expect(screen.queryByTestId('mock-inspector')).toBeNull();

    fireEvent.click(screen.getByText('inspect-project'));

    expect(screen.getByTestId('mock-inspector')).toHaveAttribute('data-node-id', 'project:p1');
    expect(onOpenEntity).not.toHaveBeenCalled(); // opening the inspector never navigates
  });

  it('pins the clicked node (fed back to the map) WITHOUT auto-panning the view', async () => {
    await renderWithMap();
    expect(screen.getByTestId('mock-mindmap')).toHaveAttribute('data-pinned-id', '');

    fireEvent.click(screen.getByText('inspect-project'));

    expect(screen.getByTestId('mock-mindmap')).toHaveAttribute('data-pinned-id', 'project:p1');
    // The card anchors to the node in place — clicking must NOT move the viewport.
    expect(panSpy).not.toHaveBeenCalled();
  });

  it('the inspector\'s "Open full page" fires the host-supplied onOpenEntity (both hosts share this)', async () => {
    const onOpenEntity = await renderWithMap();
    fireEvent.click(screen.getByText('inspect-project'));

    fireEvent.click(screen.getByText('open-full'));

    expect(onOpenEntity).toHaveBeenCalledWith({ type: 'project', entityId: 'p1' });
  });

  it('closing the inspector dismisses it and clears the pin', async () => {
    await renderWithMap();
    fireEvent.click(screen.getByText('inspect-project'));
    expect(screen.getByTestId('mock-inspector')).toBeInTheDocument();

    fireEvent.click(screen.getByText('close-inspector'));

    expect(screen.queryByTestId('mock-inspector')).toBeNull();
    expect(screen.getByTestId('mock-mindmap')).toHaveAttribute('data-pinned-id', '');
  });

  it('re-targets the inspector in-canvas (drill) without navigating', async () => {
    const onOpenEntity = await renderWithMap();
    fireEvent.click(screen.getByText('inspect-project'));
    expect(screen.getByTestId('mock-inspector')).toHaveAttribute('data-node-id', 'project:p1');

    fireEvent.click(screen.getByText('drill')); // -> SESSION_NODE (in tree)

    expect(screen.getByTestId('mock-inspector')).toHaveAttribute('data-node-id', 'session:m1');
    expect(screen.getByTestId('mock-mindmap')).toHaveAttribute('data-pinned-id', 'session:m1');
    expect(onOpenEntity).not.toHaveBeenCalled();
  });

  it('a scope-toggle change dismisses the inspector', async () => {
    vi.mocked(window.electronAPI.buildBrainTree).mockImplementation((scope) =>
      Promise.resolve(
        scope === 'workspace' ? workspaceTree([n('project:p1', 'p1')]) : sessionTree([n('project:p1', 'p1')]),
      ),
    );
    render(<BrainTabPanel meetingId="m1" projectId={null} onOpenEntity={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('mock-mindmap')).toBeInTheDocument());

    fireEvent.click(screen.getByText('inspect-project'));
    expect(screen.getByTestId('mock-inspector')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Everything' }));
    await waitFor(() => expect(screen.getByTestId('mock-mindmap')).toHaveAttribute('data-scope-key', 'workspace'));

    expect(screen.queryByTestId('mock-inspector')).toBeNull();
  });
});
