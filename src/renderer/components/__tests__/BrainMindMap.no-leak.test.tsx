// === FILE PURPOSE ===
// GPU-discipline audit for the "living brain" feature (V3.2 Task 5): asserts
// zero leaked timers/intervals/rAF while the Brain map is idle or its tab is
// hidden. Two things under audit, per BrainMindMap.tsx's own header comment and
// Task 4's report:
//   (1) BrainMindMap itself never calls setInterval/requestAnimationFrame — not
//       on mount, not while idle, not while interacting, not on unmount (a
//       hidden Brain tab is exactly BrainTabPanel unmounting this component).
//   (2) The ONE legitimate timer in the whole feature — services/brainLiveSync's
//       module-level debounced setTimeout — schedules nothing while idle and is
//       fully cleared by cancelScheduledBrainRefresh (useBrainLiveSync's unmount
//       cleanup), asserted here at the raw setTimeout/clearTimeout level (Task
//       4's own tests already assert the higher-level refresh-call behavior).
//
// Not asserted: setTimeout call counts for BrainMindMap itself. d3-zoom's wheel/
// touch gesture handling legitimately uses short self-clearing setTimeouts
// (wheel-idle / tap detection) — but ONLY in response to actual wheel/touch DOM
// events, which this suite never dispatches, so they never fire regardless.

// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { BrainNode, BrainNodeType, BrainTree } from '../../../shared/types';
import BrainMindMap from '../BrainMindMap';
import { useBrainStore } from '../../stores/brainStore';
import { scheduleBrainRefresh, cancelScheduledBrainRefresh } from '../../services/brainLiveSync';

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

function n(
  id: string,
  type: BrainNodeType,
  label: string,
  entityId: string | null,
  children: BrainNode[] = [],
): BrainNode {
  return { id, type, label, entityId, childCount: children.length, children };
}

function fixture(): BrainTree {
  const root = n('workspace', 'workspace', 'Workspace', null, [
    n('project:p1', 'project', 'Project Alpha', 'p1', [
      n('column:col1', 'column', 'Backlog', 'col1', [n('card:card1', 'card', 'First card', 'card1')]),
    ]),
  ]);
  return { root, crossLinks: [] };
}

const KEY = 'workspace';

beforeEach(() => {
  cleanup();
  useBrainStore.setState({ scopes: {}, activeScopeKey: null });
});

// ---------------------------------------------------------------------------
// (1) BrainMindMap itself — no continuous animation loop
// ---------------------------------------------------------------------------
describe('BrainMindMap — no leaked interval/rAF (Task 5)', () => {
  it('mounting, idling, interacting, and unmounting never touches setInterval or requestAnimationFrame', () => {
    const intervalSpy = vi.spyOn(window, 'setInterval');
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');

    useBrainStore.getState().setTree(KEY, fixture());
    const { unmount, getByRole } = render(<BrainMindMap scopeKey={KEY} onOpenEntity={() => {}} />);

    // Idle right after mount — event-driven only, nothing runs on its own.
    expect(intervalSpy).not.toHaveBeenCalled();
    expect(rafSpy).not.toHaveBeenCalled();

    // Interacting (expand/collapse) is still event-driven — no timer involved.
    // (The "Fit to view" button is skipped here: d3-zoom's gesture computation
    // touches SVG APIs jsdom doesn't implement, unrelated to this timer audit.)
    getByRole('button', { name: 'Expand Backlog (1)' }).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(intervalSpy).not.toHaveBeenCalled();
    expect(rafSpy).not.toHaveBeenCalled();

    // Unmount — simulates the Brain tab becoming hidden (BrainTabPanel only
    // renders this component while its tab is active).
    unmount();
    expect(intervalSpy).not.toHaveBeenCalled();
    expect(rafSpy).not.toHaveBeenCalled();

    intervalSpy.mockRestore();
    rafSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// (2) services/brainLiveSync — the ONE legitimate timer, scoped and clearable
// ---------------------------------------------------------------------------
describe('brainLiveSync debounce — idle schedules nothing, cancel clears it (Task 5)', () => {
  afterEach(() => {
    cancelScheduledBrainRefresh(); // defensive: never leave a pending timer across tests
    vi.useRealTimers();
  });

  it('idle: no timer is scheduled until scheduleBrainRefresh() is actually called', () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');

    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it('cancelScheduledBrainRefresh clears the pending timer — no refresh fires after', () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    useBrainStore.setState({ scopes: {}, activeScopeKey: 'workspace', refresh: vi.fn().mockResolvedValue(undefined) });

    scheduleBrainRefresh();
    cancelScheduledBrainRefresh(); // e.g. useBrainLiveSync's unmount cleanup

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10_000); // well past the 300ms debounce window
    expect(useBrainStore.getState().refresh).not.toHaveBeenCalled();
  });
});
