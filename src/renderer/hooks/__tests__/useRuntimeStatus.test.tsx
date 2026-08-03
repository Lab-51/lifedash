// @vitest-environment jsdom
// === FILE PURPOSE ===
// useRuntimeStatus (LOCAL-RT.2 Task 2): the ONE-pull-then-push-driven contract
// this hook promises Task 3's Settings card, plus the pure state-mapping and
// tok/s-lookup functions it exports. StatusBar.test.tsx covers the rendered
// indicator; this file covers the hook/pure-function contract in isolation.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { LlamaRuntimeSnapshot } from '../../../shared/types/ai';

const getRuntimeSnapshot = vi.fn();
let runtimeStatusCb: ((snapshot: LlamaRuntimeSnapshot) => void) | null = null;
const unsubscribe = vi.fn();
const onRuntimeStatus = vi.fn((cb: (snapshot: LlamaRuntimeSnapshot) => void) => {
  runtimeStatusCb = cb;
  return unsubscribe;
});

vi.stubGlobal('electronAPI', { getRuntimeSnapshot, onRuntimeStatus });

const { useRuntimeStatus, deriveRuntimeIndicatorState, builtinChatStats, runtimeStateLabel } =
  await import('../useRuntimeStatus');

function baseRuntime(): LlamaRuntimeSnapshot['runtime'] {
  return {
    running: false,
    backend: 'vulkan',
    binaryAvailable: true,
    loadedModels: [],
    chat: { running: false, starting: false, modelId: null, baseUrl: null, pid: null, lastUsedAt: null, crashes: 0 },
    embedding: {
      running: false,
      starting: false,
      modelId: null,
      baseUrl: null,
      pid: null,
      lastUsedAt: null,
      crashes: 0,
    },
    idleStopMinutes: 15,
  };
}

function snapshot(overrides: Partial<LlamaRuntimeSnapshot> = {}): LlamaRuntimeSnapshot {
  return {
    configured: true,
    binaryPresent: true,
    runtime: baseRuntime(),
    telemetry: { latest: null, byModel: {}, context: null },
    ...overrides,
  };
}

// Renders the hook's derived state into the DOM (rather than assigning an
// outer variable during render) so tests can read it via testing-library
// queries without a react-hooks lint violation.
function Harness() {
  const { state } = useRuntimeStatus();
  return <div data-testid="harness-state">{state}</div>;
}

describe('useRuntimeStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeStatusCb = null;
    getRuntimeSnapshot.mockResolvedValue(snapshot({ configured: false }));
  });

  it('fires exactly ONE initial pull and never polls', async () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const { getByTestId } = render(<Harness />);
    await vi.waitFor(() => expect(getRuntimeSnapshot).toHaveBeenCalledTimes(1));
    expect(getByTestId('harness-state')).toBeTruthy();
    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });

  it('registers the push listener and unsubscribes on unmount', async () => {
    const { unmount } = render(<Harness />);
    await vi.waitFor(() => expect(onRuntimeStatus).toHaveBeenCalledTimes(1));
    expect(unsubscribe).not.toHaveBeenCalled();
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('stays subscribed and updates state when not-set-up receives a later push (provider-CRUD reveal)', async () => {
    const { getByTestId } = render(<Harness />);
    await vi.waitFor(() => expect(getByTestId('harness-state').textContent).toBe('not-set-up'));

    runtimeStatusCb!(snapshot({ configured: true }));
    await vi.waitFor(() => expect(getByTestId('harness-state').textContent).toBe('ready'));
    // Still exactly one pull — the reveal came from the push, not a re-pull.
    expect(getRuntimeSnapshot).toHaveBeenCalledTimes(1);
  });

  it('degrades to not-set-up (never throws) when the bridge is missing', async () => {
    vi.stubGlobal('electronAPI', {});
    const { getByTestId } = render(<Harness />);
    await vi.waitFor(() => expect(getByTestId('harness-state').textContent).toBe('not-set-up'));
    vi.stubGlobal('electronAPI', { getRuntimeSnapshot, onRuntimeStatus });
  });
});

describe('deriveRuntimeIndicatorState (pure)', () => {
  it('not-set-up when configured is false, regardless of runtime state', () => {
    expect(deriveRuntimeIndicatorState(snapshot({ configured: false }))).toBe('not-set-up');
    expect(deriveRuntimeIndicatorState(null)).toBe('not-set-up');
  });

  it('ready — the healthy idle-stopped resting state — when configured, stopped, no crash', () => {
    expect(deriveRuntimeIndicatorState(snapshot())).toBe('ready');
  });

  it('starting when the chat role is mid-launch', () => {
    const s = snapshot();
    s.runtime.chat.starting = true;
    expect(deriveRuntimeIndicatorState(s)).toBe('starting');
  });

  it('running when the chat role process is up', () => {
    const s = snapshot();
    s.runtime.chat.running = true;
    expect(deriveRuntimeIndicatorState(s)).toBe('running');
  });

  it('failed when the binary is missing', () => {
    const s = snapshot();
    s.runtime.binaryAvailable = false;
    expect(deriveRuntimeIndicatorState(s)).toBe('failed');
  });

  it('failed when stopped with an unresolved crash (crashes > 0, not running/starting)', () => {
    const s = snapshot();
    s.runtime.chat.crashes = 2;
    expect(deriveRuntimeIndicatorState(s)).toBe('failed');
  });

  it('running takes priority over a stale crash count once the role is back up', () => {
    const s = snapshot();
    s.runtime.chat.running = true;
    s.runtime.chat.crashes = 2; // recovered but not yet reset by a graceful stop
    expect(deriveRuntimeIndicatorState(s)).toBe('running');
  });
});

describe('builtinChatStats (pure)', () => {
  it('undefined before any generation', () => {
    expect(builtinChatStats(snapshot())).toBeUndefined();
    expect(builtinChatStats(null)).toBeUndefined();
  });

  it('ignores non-builtin providers and returns the newest builtin entry', () => {
    const s = snapshot({
      telemetry: {
        latest: null,
        context: null,
        byModel: {
          'openai:gpt-5-mini': {
            providerName: 'openai',
            model: 'gpt-5-mini',
            samples: 3,
            averageTokensPerSecond: 999,
            lastTokensPerSecond: 999,
            averageTtftMs: null,
            lastAt: 2000,
          },
          'builtin:default': {
            providerName: 'builtin',
            model: 'default',
            samples: 1,
            averageTokensPerSecond: 12,
            lastTokensPerSecond: 12,
            averageTtftMs: null,
            lastAt: 1000,
          },
          'builtin:qwen2.5-14b': {
            providerName: 'builtin',
            model: 'qwen2.5-14b',
            samples: 2,
            averageTokensPerSecond: 30,
            lastTokensPerSecond: 30,
            averageTtftMs: null,
            lastAt: 1500,
          },
        },
      },
    });
    expect(builtinChatStats(s)?.model).toBe('qwen2.5-14b');
    expect(builtinChatStats(s)?.lastTokensPerSecond).toBe(30);
  });
});

describe('runtimeStateLabel (pure) — wording Task 3 must match byte-for-byte', () => {
  it('never says "Disconnected" for any state', () => {
    const s = snapshot();
    for (const state of ['ready', 'starting', 'running', 'failed'] as const) {
      expect(runtimeStateLabel(state, s)).not.toMatch(/disconnect/i);
    }
  });

  it('ready reads as a calm, non-alarming label', () => {
    expect(runtimeStateLabel('ready', snapshot())).toBe('Local AI · ready');
  });

  it('running falls back to a plain label before any generation', () => {
    expect(runtimeStateLabel('running', snapshot())).toBe('Local AI · running');
  });

  it('running shows the last known tok/s once one exists', () => {
    const s = snapshot({
      telemetry: {
        latest: null,
        context: null,
        byModel: {
          'builtin:default': {
            providerName: 'builtin',
            model: 'default',
            samples: 1,
            averageTokensPerSecond: 41.6,
            lastTokensPerSecond: 41.6,
            averageTtftMs: null,
            lastAt: 1000,
          },
        },
      },
    });
    expect(runtimeStateLabel('running', s)).toBe('Local AI · 42 tok/s');
  });
});
