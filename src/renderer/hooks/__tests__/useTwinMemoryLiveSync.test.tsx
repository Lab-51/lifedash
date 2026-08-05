// === FILE PURPOSE ===
// useTwinMemoryLiveSync + the shared services/twinMemoryLiveSync debounce
// (TWIN-GRAPH.2 Task 4) — the twin-side sibling to useBrainLiveSync, proven
// here to be scope-FILTERED (a card/project change must NOT refetch the twin
// graph) and to close the exact gap Task 3 left open: a fact learned while
// the user is already on the Memory tab now schedules a refresh instead of
// waiting for a tab-activation edge.

// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';

let dataChangedCb: ((data: { scope: string; projectId?: string }) => void) | null = null;
vi.stubGlobal('electronAPI', {
  onDataChanged: vi.fn((cb: (data: { scope: string; projectId?: string }) => void) => {
    dataChangedCb = cb;
    return () => {
      dataChangedCb = null;
    };
  }),
});

const { useTwinMemoryGraphStore, NO_ENTERING_NODES } = await import('../../stores/twinMemoryGraphStore');
const { useTwinMemoryLiveSync } = await import('../useTwinMemoryLiveSync');
const { scheduleTwinMemoryRefresh } = await import('../../services/twinMemoryLiveSync');

function Harness() {
  useTwinMemoryLiveSync();
  return null;
}

describe('useTwinMemoryLiveSync / services/twinMemoryLiveSync (TWIN-GRAPH.2 Task 4 live growth)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    dataChangedCb = null;
    useTwinMemoryGraphStore.setState({
      graph: null,
      entering: NO_ENTERING_NODES,
      refresh: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces a burst of twin-memory data:changed events into a single refresh', () => {
    useTwinMemoryGraphStore.setState({ graph: { nodes: [], edges: [], droppedCount: 0 } });
    render(<Harness />);
    expect(dataChangedCb).toBeTypeOf('function');

    dataChangedCb!({ scope: 'twin-memory' });
    dataChangedCb!({ scope: 'twin-memory' });
    dataChangedCb!({ scope: 'twin-memory' });
    expect(useTwinMemoryGraphStore.getState().refresh).not.toHaveBeenCalled(); // inside the debounce window

    vi.advanceTimersByTime(300);
    expect(useTwinMemoryGraphStore.getState().refresh).toHaveBeenCalledTimes(1);
  });

  it('ignores a data:changed broadcast for a DIFFERENT scope — cards/projects must not refetch the twin graph', () => {
    useTwinMemoryGraphStore.setState({ graph: { nodes: [], edges: [], droppedCount: 0 } });
    render(<Harness />);

    dataChangedCb!({ scope: 'cards', projectId: 'p1' });
    dataChangedCb!({ scope: 'projects' });
    vi.advanceTimersByTime(300);

    expect(useTwinMemoryGraphStore.getState().refresh).not.toHaveBeenCalled();
  });

  it('does NOT refetch before the Memory tab has loaded this session (graph still null)', () => {
    render(<Harness />);
    dataChangedCb!({ scope: 'twin-memory' });
    vi.advanceTimersByTime(300);

    expect(useTwinMemoryGraphStore.getState().refresh).not.toHaveBeenCalled();
  });

  it('cancels a pending refresh on unmount — no refresh fires after the hook is gone', () => {
    useTwinMemoryGraphStore.setState({ graph: { nodes: [], edges: [], droppedCount: 0 } });
    const { unmount } = render(<Harness />);

    dataChangedCb!({ scope: 'twin-memory' });
    unmount();
    vi.advanceTimersByTime(300);

    expect(useTwinMemoryGraphStore.getState().refresh).not.toHaveBeenCalled();
  });

  it('a direct scheduleTwinMemoryRefresh() call shares the SAME debounce as data:changed', () => {
    useTwinMemoryGraphStore.setState({ graph: { nodes: [], edges: [], droppedCount: 0 } });
    render(<Harness />);

    scheduleTwinMemoryRefresh();
    dataChangedCb!({ scope: 'twin-memory' }); // overlapping, within the same window

    vi.advanceTimersByTime(300);

    expect(useTwinMemoryGraphStore.getState().refresh).toHaveBeenCalledTimes(1);
  });
});
