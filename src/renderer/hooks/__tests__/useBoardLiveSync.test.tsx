// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Capture the data:changed callback the hook registers via the preload bridge.
// ---------------------------------------------------------------------------
let dataChangedCb: ((d: { scope: string; projectId?: string }) => void) | null = null;
vi.stubGlobal('electronAPI', {
  onDataChanged: vi.fn((cb: (d: { scope: string; projectId?: string }) => void) => {
    dataChangedCb = cb;
    return () => {
      dataChangedCb = null;
    };
  }),
});

const { useBoardStore } = await import('../../stores/boardStore');
const { useBoardLiveSync } = await import('../useBoardLiveSync');

function Harness() {
  useBoardLiveSync();
  return null;
}

describe('useBoardLiveSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    dataChangedCb = null;
    useBoardStore.setState({ project: null, loadBoard: vi.fn().mockResolvedValue(undefined) } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces a burst of events into a single refetch of the visible board', () => {
    const loadBoard = vi.fn().mockResolvedValue(undefined);
    useBoardStore.setState({ project: { id: 'proj-1' }, loadBoard } as never);

    render(<Harness />);
    expect(dataChangedCb).toBeTypeOf('function');

    // Three rapid mutations (e.g. auto-pushing several cards).
    dataChangedCb!({ scope: 'cards', projectId: 'proj-1' });
    dataChangedCb!({ scope: 'cards', projectId: 'proj-1' });
    dataChangedCb!({ scope: 'cards', projectId: 'proj-1' });
    expect(loadBoard).not.toHaveBeenCalled(); // still inside the debounce window

    vi.advanceTimersByTime(300);
    expect(loadBoard).toHaveBeenCalledTimes(1);
    expect(loadBoard).toHaveBeenCalledWith('proj-1');
  });

  it('ignores events targeting a different project than the visible board', () => {
    const loadBoard = vi.fn();
    useBoardStore.setState({ project: { id: 'proj-1' }, loadBoard } as never);

    render(<Harness />);
    dataChangedCb!({ scope: 'cards', projectId: 'proj-2' });
    vi.advanceTimersByTime(300);

    expect(loadBoard).not.toHaveBeenCalled();
  });

  it('does not refetch when no board is currently loaded', () => {
    const loadBoard = vi.fn();
    useBoardStore.setState({ project: null, loadBoard } as never);

    render(<Harness />);
    dataChangedCb!({ scope: 'cards', projectId: 'proj-1' });
    vi.advanceTimersByTime(300);

    expect(loadBoard).not.toHaveBeenCalled();
  });

  it('refetches the visible board when the event carries no projectId (safe fallback)', () => {
    const loadBoard = vi.fn();
    useBoardStore.setState({ project: { id: 'proj-1' }, loadBoard } as never);

    render(<Harness />);
    dataChangedCb!({ scope: 'cards' });
    vi.advanceTimersByTime(300);

    expect(loadBoard).toHaveBeenCalledWith('proj-1');
  });

  // Regression (finding #5): the debounced refetch must target whatever board is
  // visible WHEN THE TIMER FIRES, not the board that was loaded when the event
  // arrived. Otherwise navigating within the 300ms window reloads the OLD board
  // into the shared store and the wrong board renders persistently.
  it('refetches the CURRENT board, not the captured one, when the board changes mid-debounce', () => {
    const loadBoard = vi.fn();
    useBoardStore.setState({ project: { id: 'proj-1' }, loadBoard } as never);

    render(<Harness />);
    // Event arrives while proj-1 is visible → arms the debounce timer.
    dataChangedCb!({ scope: 'cards', projectId: 'proj-1' });

    // User navigates to proj-2 before the timer fires.
    useBoardStore.setState({ project: { id: 'proj-2' }, loadBoard } as never);

    vi.advanceTimersByTime(300);

    // The refetch targets the CURRENTLY-visible board (proj-2), never the stale proj-1.
    expect(loadBoard).toHaveBeenCalledTimes(1);
    expect(loadBoard).toHaveBeenCalledWith('proj-2');
    expect(loadBoard).not.toHaveBeenCalledWith('proj-1');
  });

  // Companion to the above: if the board is UNMOUNTED (no project) by fire time,
  // the timer must not resurrect a stale board into the store.
  it('does not refetch if the board was closed before the timer fires', () => {
    const loadBoard = vi.fn();
    useBoardStore.setState({ project: { id: 'proj-1' }, loadBoard } as never);

    render(<Harness />);
    dataChangedCb!({ scope: 'cards', projectId: 'proj-1' });

    useBoardStore.setState({ project: null, loadBoard } as never);
    vi.advanceTimersByTime(300);

    expect(loadBoard).not.toHaveBeenCalled();
  });
});
