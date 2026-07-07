// === FILE PURPOSE ===
// useBrainLiveSync + the shared services/brainLiveSync debounce (V3.2 Task 4).
// Mirrors useBoardLiveSync.test.tsx's conventions: fake timers, a captured
// data:changed callback via the stubbed preload bridge. Also covers the part
// useBoardLiveSync doesn't need — BOTH live-growth triggers (data:changed AND
// the liveSuggestionsStore accept seam, exercised here via scheduleBrainRefresh
// directly) sharing the SAME debounce, per the story's "one code path" rule.

// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';

let dataChangedCb: (() => void) | null = null;
vi.stubGlobal('electronAPI', {
  onDataChanged: vi.fn((cb: () => void) => {
    dataChangedCb = cb;
    return () => {
      dataChangedCb = null;
    };
  }),
});

const { useBrainStore } = await import('../../stores/brainStore');
const { useBrainLiveSync } = await import('../useBrainLiveSync');
const { scheduleBrainRefresh } = await import('../../services/brainLiveSync');

function Harness() {
  useBrainLiveSync();
  return null;
}

describe('useBrainLiveSync / services/brainLiveSync (Task 4 live growth)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    dataChangedCb = null;
    useBrainStore.setState({ scopes: {}, activeScopeKey: null, refresh: vi.fn().mockResolvedValue(undefined) });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces a burst of data:changed events into a single refresh of the active scope', () => {
    useBrainStore.getState().setActiveScope('workspace');

    render(<Harness />);
    expect(dataChangedCb).toBeTypeOf('function');

    dataChangedCb!();
    dataChangedCb!();
    dataChangedCb!();
    expect(useBrainStore.getState().refresh).not.toHaveBeenCalled(); // still inside the debounce window

    vi.advanceTimersByTime(300);
    expect(useBrainStore.getState().refresh).toHaveBeenCalledTimes(1);
    expect(useBrainStore.getState().refresh).toHaveBeenCalledWith('workspace');
  });

  it('does NOT refetch before the Brain tab has loaded this session (no active scope)', () => {
    render(<Harness />);
    dataChangedCb!();
    vi.advanceTimersByTime(300);

    expect(useBrainStore.getState().refresh).not.toHaveBeenCalled();
  });

  it('re-reads the active scope at fire time, not event time (mid-debounce scope switch)', () => {
    useBrainStore.getState().setActiveScope('workspace');
    render(<Harness />);

    dataChangedCb!(); // arms the debounce while 'workspace' is active
    useBrainStore.getState().setActiveScope('session:m1'); // user switches to a session scope

    vi.advanceTimersByTime(300);

    expect(useBrainStore.getState().refresh).toHaveBeenCalledTimes(1);
    expect(useBrainStore.getState().refresh).toHaveBeenCalledWith({ meetingId: 'm1' });
  });

  it('cancels a pending refresh on unmount — no refresh fires after the hook is gone', () => {
    useBrainStore.getState().setActiveScope('workspace');
    const { unmount } = render(<Harness />);

    dataChangedCb!();
    unmount();
    vi.advanceTimersByTime(300);

    expect(useBrainStore.getState().refresh).not.toHaveBeenCalled();
  });

  it('a direct scheduleBrainRefresh() call (the liveSuggestionsStore accept seam) shares the SAME debounce as data:changed', () => {
    useBrainStore.getState().setActiveScope('workspace');
    render(<Harness />);

    scheduleBrainRefresh(); // simulates liveSuggestionsStore.accept()'s success path
    dataChangedCb!(); // overlapping data:changed within the same window

    vi.advanceTimersByTime(300);

    expect(useBrainStore.getState().refresh).toHaveBeenCalledTimes(1);
  });
});
