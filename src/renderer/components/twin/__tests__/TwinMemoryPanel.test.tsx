// @vitest-environment jsdom
// === FILE PURPOSE ===
// TwinMemoryPanel (V3.4 Task 3) — the Memory ledger's safety-triad UI. Covers:
// reverse-chron fact list + "learned in <session>" provenance (resolved from the
// meetings store, with the graceful "a past session" fallback for a null/unknown
// sourceMeetingId — NEVER a raw id), the forget -> undo-snackbar round trip
// (including its focus management and aria-live announcement, and the ~5s
// auto-expiry), the "Pause learning" kill-switch (setting round-trip + banner),
// the live active-fact count callback (Memory tab badge), and the empty state.
// window.electronAPI.twinMemoryList/-Forget/-Restore and window.electronAPI.
// setSetting are mocked — the real IPC/service implementations are covered by
// twinMemoryService's own unit tests (Task 2).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import '@testing-library/jest-dom';
import type { TwinFact } from '../../../../shared/types/twin';
import { TWIN_LEARNING_PAUSED_SETTING_KEY } from '../../../../shared/types/twin';

const twinMemoryList = vi.fn();
const twinMemoryForget = vi.fn();
const twinMemoryRestore = vi.fn();
const setSetting = vi.fn().mockResolvedValue(undefined);

vi.stubGlobal('electronAPI', {
  twinMemoryList,
  twinMemoryForget,
  twinMemoryRestore,
  setSetting,
});

const { default: TwinMemoryPanel } = await import('../TwinMemoryPanel');
const { useMeetingStore } = await import('../../../stores/meetingStore');
const { useSettingsStore } = await import('../../../stores/settingsStore');

/** Reflects the router's current location so navigation assertions can read it. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderPanel(onCountChange?: (n: number) => void) {
  return render(
    <MemoryRouter initialEntries={['/twin']}>
      <Routes>
        <Route path="/twin" element={<TwinMemoryPanel onCountChange={onCountChange} />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

function fact(overrides: Partial<TwinFact> = {}): TwinFact {
  return {
    id: 'fact-1',
    fact: 'Prefers async updates over meetings',
    category: 'preference',
    sourceMeetingId: 'meeting-1',
    status: 'active',
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  twinMemoryList.mockResolvedValue([]);
  useMeetingStore.setState({ meetings: [] } as any);
  useSettingsStore.setState({ settings: {} } as any);
});

describe('TwinMemoryPanel — list + provenance', () => {
  it('renders a learned fact with its category chip and the resolved session title', async () => {
    useMeetingStore.setState({ meetings: [{ id: 'meeting-1', title: 'Weekly Sync' }] as any } as any);
    twinMemoryList.mockResolvedValue([fact()]);
    renderPanel();

    expect(await screen.findByText('Prefers async updates over meetings')).toBeInTheDocument();
    expect(screen.getByLabelText('Category: Preference')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'learned in Weekly Sync' })).toBeInTheDocument();
  });

  it('falls back to "a past session" (never a raw id) when sourceMeetingId is null', async () => {
    twinMemoryList.mockResolvedValue([fact({ sourceMeetingId: null })]);
    renderPanel();

    await screen.findByText('Prefers async updates over meetings');
    expect(screen.getByText('learned in a past session')).toBeInTheDocument();
    // Not a link/button — the session no longer exists, nothing to navigate to.
    expect(screen.queryByRole('button', { name: /learned in/i })).not.toBeInTheDocument();
  });

  it('falls back to "a past session" but STAYS navigable when the id is unresolved in the meetings store', async () => {
    // meetings store has no entry for meeting-404 (e.g. not yet loaded) — the id is
    // still real, so the link must still work, just without a resolved title.
    twinMemoryList.mockResolvedValue([fact({ sourceMeetingId: 'meeting-404' })]);
    renderPanel();

    await screen.findByText('Prefers async updates over meetings');
    const link = screen.getByRole('button', { name: 'learned in a past session' });
    fireEvent.click(link);
    expect(await screen.findByTestId('location')).toHaveTextContent('/session/meeting-404');
  });

  it('navigates to /session/:id when a resolved provenance link is clicked', async () => {
    useMeetingStore.setState({ meetings: [{ id: 'meeting-1', title: 'Weekly Sync' }] as any } as any);
    twinMemoryList.mockResolvedValue([fact()]);
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'learned in Weekly Sync' }));
    expect(await screen.findByTestId('location')).toHaveTextContent('/session/meeting-1');
  });
});

describe('TwinMemoryPanel — forget + undo', () => {
  it('forgetting a fact calls twinMemoryForget, removes the row, and shows an accessible undo snackbar focused on Undo', async () => {
    twinMemoryForget.mockResolvedValue(fact({ status: 'forgotten' }));
    twinMemoryList.mockResolvedValue([fact()]);
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /forget: prefers async updates/i }));

    await waitFor(() => expect(twinMemoryForget).toHaveBeenCalledWith('fact-1'));
    expect(screen.queryByText('Prefers async updates over meetings')).not.toBeInTheDocument();

    const snackbar = await screen.findByRole('status');
    expect(snackbar).toHaveAttribute('aria-live', 'polite');
    const undoButton = screen.getByRole('button', { name: /undo/i });
    expect(undoButton).toHaveFocus();
  });

  it('clicking Undo restores the fact via twinMemoryRestore and returns focus to the list heading', async () => {
    twinMemoryForget.mockResolvedValue(fact({ status: 'forgotten' }));
    twinMemoryRestore.mockResolvedValue(fact());
    twinMemoryList.mockResolvedValueOnce([fact()]).mockResolvedValueOnce([fact()]);
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /forget:/i }));
    fireEvent.click(await screen.findByRole('button', { name: /undo/i }));

    await waitFor(() => expect(twinMemoryRestore).toHaveBeenCalledWith('fact-1'));
    expect(await screen.findByText('Prefers async updates over meetings')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /undo/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Learned facts' })).toHaveFocus();
  });

  it('auto-dismisses the undo snackbar after ~5s and returns focus to the list heading', async () => {
    // Real timers -- the snackbar's own setTimeout is an implementation detail
    // (not something the panel exposes for a test clock), so this waits out the
    // real ~5s window rather than fighting fake-timer/RTL polling interaction.
    twinMemoryForget.mockResolvedValue(fact({ status: 'forgotten' }));
    twinMemoryList.mockResolvedValue([fact()]);
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /forget:/i }));
    await screen.findByRole('button', { name: /undo/i });

    await waitFor(() => expect(screen.queryByRole('button', { name: /undo/i })).not.toBeInTheDocument(), {
      timeout: 6000,
    });

    expect(screen.getByRole('heading', { name: 'Learned facts' })).toHaveFocus();
    expect(twinMemoryRestore).not.toHaveBeenCalled();
  }, 8000);
});

describe('TwinMemoryPanel — pause learning kill-switch', () => {
  it('flips the twin.learningPaused setting when the toggle is clicked', async () => {
    renderPanel();
    await screen.findByRole('heading', { name: 'Learned facts' });

    fireEvent.click(screen.getByRole('button', { name: /pause learning/i }));
    await waitFor(() => expect(setSetting).toHaveBeenCalledWith(TWIN_LEARNING_PAUSED_SETTING_KEY, 'true'));
  });

  it('shows the explicit paused banner and a pressed "Resume learning" toggle when the setting is true', async () => {
    useSettingsStore.setState({ settings: { [TWIN_LEARNING_PAUSED_SETTING_KEY]: 'true' } } as any);
    renderPanel();

    expect(await screen.findByText(/learning is paused/i)).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: /resume learning/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  it('does NOT show the banner when learning is active', async () => {
    renderPanel();
    await screen.findByRole('heading', { name: 'Learned facts' });
    expect(screen.queryByText(/learning is paused/i)).not.toBeInTheDocument();
  });
});

describe('TwinMemoryPanel — count badge + empty state', () => {
  it('reports the active fact count as facts load, and again after a forget', async () => {
    twinMemoryForget.mockResolvedValue(fact({ status: 'forgotten' }));
    twinMemoryList.mockResolvedValue([fact()]);
    const onCountChange = vi.fn();
    renderPanel(onCountChange);

    await waitFor(() => expect(onCountChange).toHaveBeenCalledWith(1));
    fireEvent.click(await screen.findByRole('button', { name: /forget:/i }));
    await waitFor(() => expect(onCountChange).toHaveBeenCalledWith(0));
  });

  it('shows the empty-state explainer when there are no facts', async () => {
    twinMemoryList.mockResolvedValue([]);
    renderPanel();

    expect(await screen.findByText('No facts learned yet')).toBeInTheDocument();
    expect(screen.getByText(/quietly learns durable facts/i)).toBeInTheDocument();
  });
});
