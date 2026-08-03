// @vitest-environment jsdom
// === FILE PURPOSE ===
// StatusBar (LOCAL-RT.2 Task 2): the new Local-AI runtime indicator added
// BESIDE the existing database dot (never replacing it — explicit user
// decision, regression-guarded below), plus its five-state vocabulary,
// optionality (no spawn, no poll), and provider-CRUD push reveal.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import '@testing-library/jest-dom';
import type { LlamaRuntimeSnapshot } from '../../../shared/types/ai';

// ---------------------------------------------------------------------------
// electronAPI stub. `stopBuiltinRuntime` / `checkBuiltinRuntime` are spied so
// tests can assert nothing in this observation path ever reaches a spawn path
// (`ensureRunning` itself is main-process-only and has no renderer bridge, so
// asserting these two — the only other builtin-runtime bridge calls — never
// fire is the closest verifiable proxy available from a renderer test).
// ---------------------------------------------------------------------------
const getDatabaseStatus = vi.fn().mockResolvedValue({ connected: true, message: 'ok' });
const meetingsGetPendingActionCount = vi.fn().mockResolvedValue(0);
const syncGetAuthState = vi.fn().mockResolvedValue({ isAuthenticated: false, user: null, lastSyncedAt: null });
const syncGetStatus = vi.fn().mockResolvedValue('disconnected');
const getRuntimeSnapshot = vi.fn();
const stopBuiltinRuntime = vi.fn();
const checkBuiltinRuntime = vi.fn();
let runtimeStatusCb: ((snapshot: LlamaRuntimeSnapshot) => void) | null = null;
const runtimeUnsubscribe = vi.fn();
const onRuntimeStatus = vi.fn((cb: (snapshot: LlamaRuntimeSnapshot) => void) => {
  runtimeStatusCb = cb;
  return runtimeUnsubscribe;
});

vi.stubGlobal('electronAPI', {
  getDatabaseStatus,
  meetingsGetPendingActionCount,
  syncGetAuthState,
  syncGetStatus,
  getRuntimeSnapshot,
  onRuntimeStatus,
  stopBuiltinRuntime,
  checkBuiltinRuntime,
});

const { useFocusStore } = await import('../../stores/focusStore');
const { useMeetingStore } = await import('../../stores/meetingStore');
const { useGamificationStore } = await import('../../stores/gamificationStore');
const { default: StatusBar } = await import('../StatusBar');

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

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="probe-location">{`${location.pathname}${location.search}`}</div>;
}

function renderStatusBar() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<StatusBar />} />
        <Route path="/settings" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('StatusBar — Local AI runtime indicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeStatusCb = null;
    getDatabaseStatus.mockResolvedValue({ connected: true, message: 'ok' });
    meetingsGetPendingActionCount.mockResolvedValue(0);
    syncGetAuthState.mockResolvedValue({ isAuthenticated: false, user: null, lastSyncedAt: null });
    syncGetStatus.mockResolvedValue('disconnected');
    useFocusStore.setState({ mode: 'idle' });
    useMeetingStore.setState({ pendingActionCount: 0 });
    useGamificationStore.setState({ stats: null } as never);
  });

  it('renders nothing for the Local AI indicator when not set up, but the database dot still renders (regression guard)', async () => {
    getRuntimeSnapshot.mockResolvedValue(snapshot({ configured: false }));
    renderStatusBar();

    await waitFor(() => expect(getRuntimeSnapshot).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Local AI/)).toBeNull();
    // The database indicator (pre-existing, never to be replaced) is unaffected.
    expect(await screen.findByText('Connected')).toBeInTheDocument();
  });

  it('"ready" renders and is NOT styled as an error, and never says "Disconnected"', async () => {
    getRuntimeSnapshot.mockResolvedValue(snapshot());
    renderStatusBar();

    const button = await screen.findByRole('button', { name: /Local AI/ });
    expect(button).toHaveTextContent('Local AI · ready');
    expect(button.className).not.toMatch(/text-red/);
    expect(button.className).not.toMatch(/bg-error/);
    expect(button.textContent).not.toMatch(/disconnect/i);
  });

  it('"running" shows tok/s', async () => {
    const s = snapshot();
    s.runtime.chat.running = true;
    s.telemetry.byModel = {
      'builtin:default': {
        providerName: 'builtin',
        model: 'default',
        samples: 4,
        averageTokensPerSecond: 38,
        lastTokensPerSecond: 38,
        averageTtftMs: 120,
        lastAt: Date.now(),
      },
    };
    getRuntimeSnapshot.mockResolvedValue(s);
    renderStatusBar();

    expect(await screen.findByText('Local AI · 38 tok/s')).toBeInTheDocument();
  });

  it('"failed" is visually distinct (the only alarming state)', async () => {
    const s = snapshot();
    s.runtime.chat.crashes = 3;
    getRuntimeSnapshot.mockResolvedValue(s);
    renderStatusBar();

    const button = await screen.findByRole('button', { name: /Local AI/ });
    expect(button).toHaveTextContent('Local AI · failed');
    expect(button.className).toMatch(/text-red-400/);
  });

  it('hover popover exposes model, backend and context usage', async () => {
    const s = snapshot();
    s.runtime.chat.running = true;
    s.runtime.chat.modelId = 'qwen2.5-14b-instruct';
    s.runtime.backend = 'vulkan';
    s.telemetry.context = { role: 'chat', usedTokens: 512, contextTokens: 8192, processing: false };
    getRuntimeSnapshot.mockResolvedValue(s);
    renderStatusBar();

    const button = await screen.findByRole('button', { name: /Local AI/ });
    fireEvent.mouseEnter(button);

    expect(await screen.findByText(/Model: qwen2.5-14b-instruct/)).toBeInTheDocument();
    expect(screen.getByText(/Backend: vulkan/)).toBeInTheDocument();
    expect(screen.getByText(/Context: 512 \/ 8192 tokens/)).toBeInTheDocument();
  });

  it('click navigates to Settings -> AI & Models', async () => {
    getRuntimeSnapshot.mockResolvedValue(snapshot());
    renderStatusBar();

    const button = await screen.findByRole('button', { name: /Local AI/ });
    fireEvent.click(button);

    expect(await screen.findByTestId('probe-location')).toHaveTextContent('/settings?tab=ai');
  });

  it('unsubscribes the push listener on unmount', async () => {
    getRuntimeSnapshot.mockResolvedValue(snapshot());
    const { unmount } = renderStatusBar();
    await waitFor(() => expect(onRuntimeStatus).toHaveBeenCalledTimes(1));
    expect(runtimeUnsubscribe).not.toHaveBeenCalled();
    unmount();
    expect(runtimeUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it(
    'not configured: exactly ONE initial pull, no re-pull over time, and neither builtin-runtime ' +
      'bridge call that could reach a spawn path is ever invoked; a later provider-CRUD push then ' +
      'reveals the indicator WITHOUT a remount',
    async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      getRuntimeSnapshot.mockResolvedValue(snapshot({ configured: false }));
      renderStatusBar();

      await vi.waitFor(() => expect(getRuntimeSnapshot).toHaveBeenCalledTimes(1));
      expect(screen.queryByText(/Local AI/)).toBeNull();

      // Advance well past any conceivable poll interval — still exactly one pull.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(getRuntimeSnapshot).toHaveBeenCalledTimes(1);
      expect(stopBuiltinRuntime).not.toHaveBeenCalled();
      expect(checkBuiltinRuntime).not.toHaveBeenCalled();

      // Provider-CRUD push reveals the indicator on the SAME mounted instance.
      expect(onRuntimeStatus).toHaveBeenCalledTimes(1);
      runtimeStatusCb!(snapshot({ configured: true }));
      await vi.waitFor(() => expect(screen.queryByText('Local AI · ready')).toBeInTheDocument());
      // Still no second pull — the reveal came from the push.
      expect(getRuntimeSnapshot).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    },
  );
});
