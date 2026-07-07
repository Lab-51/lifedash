// @vitest-environment jsdom
import { forwardRef, useImperativeHandle } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// Polyfills
// ---------------------------------------------------------------------------
if (typeof Element.prototype.scrollIntoView === 'undefined') {
  Element.prototype.scrollIntoView = vi.fn();
}

// ---------------------------------------------------------------------------
// Mocks — the overlay's canvas audio meter and the reused chat are exercised by
// their own suites; here we stub them so the test focuses on the overlay shell,
// its auto-enter/minimize/Esc behavior, and the real LiveTranscriptFeed spine.
// audioCaptureService is stubbed because recordingStore.startRecording touches it
// (used by the reset-on-new-recording test).
// ---------------------------------------------------------------------------
vi.mock('../AudioLevelMeter', () => ({ default: () => null }));
vi.mock('../LiveAssistantChat', () => ({ default: () => null }));
vi.mock('../../services/audioCaptureService', () => ({
  startCapture: vi.fn().mockResolvedValue(undefined),
  stopCapture: vi.fn().mockResolvedValue(undefined),
  onAudioInterrupted: vi.fn(),
  onAudioLevel: vi.fn(),
}));

// BrainMindMap's own d3/layout behavior is covered by BrainMindMap.test.tsx —
// here it's mocked to a minimal forwardRef stub so tests can trigger
// onOpenEntity directly and assert the overlay's in-canvas-vs-navigate routing
// (Task 3) without dealing with real SVG/d3 internals.
vi.mock('../BrainMindMap', () => ({
  default: forwardRef(function MockBrainMindMap(
    props: { scopeKey: string; onOpenEntity: (arg: { type: string; entityId: string }) => void },
    ref: React.Ref<{ fit: () => void }>,
  ) {
    useImperativeHandle(ref, () => ({ fit: () => {} }));
    return (
      <div data-testid="mock-mindmap" data-scope-key={props.scopeKey}>
        <button onClick={() => props.onOpenEntity({ type: 'session', entityId: 'other-meet' })}>open-session</button>
        <button onClick={() => props.onOpenEntity({ type: 'card', entityId: 'card-same-project' })}>
          open-card-same-project
        </button>
        <button onClick={() => props.onOpenEntity({ type: 'card', entityId: 'card-other-project' })}>
          open-card-other-project
        </button>
      </div>
    );
  }),
}));

vi.stubGlobal('electronAPI', {
  createMeeting: vi.fn().mockResolvedValue({ id: 'meeting-new' }),
  startRecording: vi.fn().mockResolvedValue(undefined),
  stopRecording: vi.fn().mockResolvedValue(null),
  deleteMeeting: vi.fn().mockResolvedValue(undefined),
  updateMeeting: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn().mockResolvedValue(null),
  recordingSetState: vi.fn(),
  buildBrainTree: vi.fn().mockResolvedValue({
    root: {
      id: 'session:meeting-1',
      type: 'session',
      label: 'Live Meeting',
      entityId: 'meeting-1',
      childCount: 1,
      children: [
        {
          id: 'group:cards:meeting-1',
          type: 'group',
          label: 'Cards created',
          entityId: null,
          childCount: 0,
          children: [],
        },
      ],
    },
    crossLinks: [],
  }),
});

// ---------------------------------------------------------------------------
// Import store and component AFTER mocks
// ---------------------------------------------------------------------------
const { useRecordingStore } = await import('../../stores/recordingStore');
const { useCanvasBadgeStore } = await import('../../stores/canvasBadgeStore');
const { useActivityFeedStore } = await import('../../stores/activityFeedStore');
const { useBoardStore } = await import('../../stores/boardStore');
const { useMeetingStore } = await import('../../stores/meetingStore');
const { useProjectStore } = await import('../../stores/projectStore');
const { useBrainStore } = await import('../../stores/brainStore');
const { default: LiveModeOverlay } = await import('../LiveModeOverlay');

/** Renders LiveModeOverlay inside a Router (it uses useNavigate/useSearchParams)
 *  plus a tiny location probe so tests can assert whether a click navigated the
 *  underlying route (real navigate) or left it alone (in-canvas move). */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="test-location">{`${location.pathname}${location.search}`}</div>;
}

function renderOverlay(initialEntries: string[] = ['/']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <LocationProbe />
      <LiveModeOverlay />
    </MemoryRouter>,
  );
}

/** Flushes the overlay's mount-time "reset to Transcript on a new recording" rAF
 *  (see LiveModeOverlay's meetingId effect) deterministically, so it can't race
 *  a later `await` in the test and flip the active tab back to Transcript out
 *  from under a just-clicked Board/Brain tab. Mirrors the existing "resets the
 *  active tab..." test's own flush below — same underlying rAF. */
async function flushMountRaf() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

// Preserve the real actions so per-test spy overrides don't leak across tests.
const realActions = {
  stopRecording: useRecordingStore.getState().stopRecording,
  cancelRecording: useRecordingStore.getState().cancelRecording,
};

function makeSegment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'seg-1',
    meetingId: 'meeting-1',
    content: 'Hello world',
    startTime: 0,
    endTime: 1000,
    speaker: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const OVERLAY = { name: 'Live Mode' };

describe('LiveModeOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRecordingStore.setState({
      isRecording: false,
      isProcessing: false,
      liveModeMinimized: false,
      liveSegments: [],
      meetingId: null,
      elapsed: 0,
      ...realActions,
    });
    // canvasBadgeStore/activityFeedStore are module-level singletons — reset so
    // state set in one test can't leak into the next.
    useCanvasBadgeStore.setState({ counts: { transcript: 0, board: 0, brain: 0 } });
    useActivityFeedStore.setState({ entries: [], viewedTab: 'transcript', pendingToolCalls: [] });
    // meetingStore/boardStore are also module-level singletons — reset so the
    // Brain-tab routing tests (Task 3) can't leak seeded meetings/cards/project
    // state into unrelated tests, and vice versa.
    useMeetingStore.setState({ meetings: [] } as any);
    useProjectStore.setState({ projects: [] } as any);
    useBrainStore.setState({ inspectorOpen: false });
    useBoardStore.setState({
      project: null,
      columns: [],
      cards: [],
      allCards: [],
      labels: [],
      relationships: [],
      loading: false,
      error: null,
    } as any);
  });

  it('renders nothing when not recording', () => {
    renderOverlay();
    expect(screen.queryByRole('dialog', OVERLAY)).toBeNull();
  });

  it('AUTO-ENTERS when recording starts', () => {
    renderOverlay();
    expect(screen.queryByRole('dialog', OVERLAY)).toBeNull();

    act(() => {
      useRecordingStore.setState({ isRecording: true });
    });

    expect(screen.getByRole('dialog', OVERLAY)).toBeInTheDocument();
  });

  it('mounts via portal directly under document.body', () => {
    useRecordingStore.setState({ isRecording: true });
    renderOverlay();
    const dialog = screen.getByRole('dialog', OVERLAY);
    expect(dialog.parentElement).toBe(document.body);
  });

  // Regression: the field test found the overlay swallowed ALL clicks. Root cause was
  // the `.scanlines` class (pointer-events:none) applied to this interactive container
  // and inherited by every child. The fix restores interactivity inline and hardens the
  // root against app-chrome / drag-strip interference. (Runtime clickability itself is
  // confirmed by the user's manual smoke test — jsdom cannot hit-test compositor layers.)
  it('overlay root is click-safe: raised above app chrome, isolated, no-drag, pointer-events restored', () => {
    useRecordingStore.setState({ isRecording: true });
    renderOverlay();
    const dialog = screen.getByRole('dialog', OVERLAY);

    // Raised above AppLayout's z-[100] HUD beam and FeatureTour (z-[100]); old tier gone.
    expect(dialog.className).toContain('z-[110]');
    expect(dialog.className).not.toContain('z-[70]');

    // The load-bearing click fix: inline pointer-events:auto overrides `.scanlines`
    // (pointer-events:none), which was inherited by every child and blocked all clicks.
    expect(dialog.style.pointerEvents).toBe('auto');

    // Internal ConfirmDialog (z-[70]) stays inside the overlay's own stacking context.
    expect(dialog.style.isolation).toBe('isolate');

    // Frameless-window drag strip can't swallow clicks over the overlay header.
    expect((dialog.style as unknown as Record<string, string>).WebkitAppRegion).toBe('no-drag');
  });

  it('renders the transcript feed with live segments from recordingStore', () => {
    useRecordingStore.setState({
      isRecording: true,
      liveSegments: [makeSegment({ id: 'seg-1', content: 'Spoken words', startTime: 65000 })],
    });
    renderOverlay();
    const feed = screen.getByTestId('live-transcript-feed');
    expect(feed).toBeInTheDocument();
    expect(feed).toHaveTextContent('Spoken words');
    // Segment timestamp is formatted from startTime (65s → 01:05).
    expect(feed).toHaveTextContent('01:05');
  });

  it('reserves the Task 5 proposals mount point above the chat', () => {
    useRecordingStore.setState({ isRecording: true });
    renderOverlay();
    expect(screen.getByTestId('live-proposals-mount')).toBeInTheDocument();
  });

  it('minimizes (collapses to the pill) without stopping the recording', () => {
    useRecordingStore.setState({ isRecording: true });
    renderOverlay();
    expect(screen.getByRole('dialog', OVERLAY)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Minimize Live Mode'));

    expect(screen.queryByRole('dialog', OVERLAY)).toBeNull();
    expect(useRecordingStore.getState().liveModeMinimized).toBe(true);
    // Minimize is an escape hatch — recording must keep running.
    expect(useRecordingStore.getState().isRecording).toBe(true);
  });

  it('restores from minimized back to the full overlay', () => {
    useRecordingStore.setState({ isRecording: true, liveModeMinimized: true });
    renderOverlay();
    expect(screen.queryByRole('dialog', OVERLAY)).toBeNull();

    act(() => {
      useRecordingStore.getState().restoreLiveMode();
    });

    expect(screen.getByRole('dialog', OVERLAY)).toBeInTheDocument();
  });

  it('Esc minimizes but NEVER stops the recording', () => {
    const stopSpy = vi.fn(() => Promise.resolve());
    useRecordingStore.setState({ isRecording: true, stopRecording: stopSpy });
    renderOverlay();
    expect(screen.getByRole('dialog', OVERLAY)).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(useRecordingStore.getState().liveModeMinimized).toBe(true);
    expect(useRecordingStore.getState().isRecording).toBe(true);
    expect(stopSpy).not.toHaveBeenCalled();
  });

  it('Esc does NOT minimize while the Brain inspector is open (yields to the drawer)', () => {
    useRecordingStore.setState({ isRecording: true });
    useBrainStore.setState({ inspectorOpen: true });
    renderOverlay();
    expect(screen.getByRole('dialog', OVERLAY)).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    // The inspector's own Esc handler closes the drawer; the overlay must stay open
    // (else one Esc would both close the drawer AND minimize the whole live session).
    expect(useRecordingStore.getState().liveModeMinimized).toBe(false);
    expect(screen.getByRole('dialog', OVERLAY)).toBeInTheDocument();
  });

  it('Stop button triggers the shared stopRecording action', () => {
    const stopSpy = vi.fn(() => Promise.resolve());
    useRecordingStore.setState({ isRecording: true, stopRecording: stopSpy });
    renderOverlay();

    fireEvent.click(screen.getByLabelText('Stop and save recording'));

    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it('unmounts when recording stops (hands off to the post-recording flow)', () => {
    useRecordingStore.setState({ isRecording: true });
    renderOverlay();
    expect(screen.getByRole('dialog', OVERLAY)).toBeInTheDocument();

    // Mirrors what stopRecording() does: isRecording → false, processing begins.
    act(() => {
      useRecordingStore.setState({ isRecording: false, isProcessing: true });
    });

    expect(screen.queryByRole('dialog', OVERLAY)).toBeNull();
  });

  it('resets liveModeMinimized to false when a new recording starts (default takeover)', async () => {
    useRecordingStore.setState({ liveModeMinimized: true, isRecording: false, meetingId: null });

    await act(async () => {
      await useRecordingStore.getState().startRecording('Standup');
    });

    expect(useRecordingStore.getState().isRecording).toBe(true);
    expect(useRecordingStore.getState().liveModeMinimized).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Task 4: switchable canvas (Transcript | Board | Brain)
  // -------------------------------------------------------------------------
  describe('canvas (Task 4)', () => {
    it('shows the three canvas tabs with Transcript active by default', () => {
      useRecordingStore.setState({ isRecording: true });
      renderOverlay();

      expect(screen.getByRole('tab', { name: 'Transcript' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tab', { name: 'Board' })).toHaveAttribute('aria-selected', 'false');
      expect(screen.getByRole('tab', { name: 'Brain' })).toHaveAttribute('aria-selected', 'false');
    });

    it('switches to the Board tab and shows the no-project empty state pointing at the proposal chip', () => {
      useRecordingStore.setState({ isRecording: true, meetingId: 'meeting-1' });
      renderOverlay();

      fireEvent.click(screen.getByRole('tab', { name: 'Board' }));

      expect(screen.getByText('The board arrives with this project')).toBeInTheDocument();
      // Points at the existing propose->accept project chip (LIVE.3) in the feed
      // on the right — never a new create-project mechanism.
      expect(screen.getByText(/feed on the right/i)).toBeInTheDocument();
      expect(screen.queryByTestId('embedded-board')).toBeNull();
    });

    it('switches to the Brain tab and loads the session-scoped mind map via IPC', async () => {
      useRecordingStore.setState({ isRecording: true, meetingId: 'meeting-1' });
      renderOverlay();
      await flushMountRaf();

      fireEvent.click(screen.getByRole('tab', { name: 'Brain' }));

      expect(await screen.findByTestId('mock-mindmap')).toHaveAttribute('data-scope-key', 'session:meeting-1');
      expect(window.electronAPI.buildBrainTree).toHaveBeenCalledWith({ meetingId: 'meeting-1' });
    });

    it('shows the bare-session empty state on the Brain tab when there is no active meetingId yet', () => {
      useRecordingStore.setState({ isRecording: true, meetingId: null });
      renderOverlay();

      fireEvent.click(screen.getByRole('tab', { name: 'Brain' }));

      expect(screen.getByText('The brain grows as this session produces work.')).toBeInTheDocument();
    });

    it('renders a per-tab badge and clears it when that tab is viewed (no auto-flip)', () => {
      useRecordingStore.setState({ isRecording: true });
      useCanvasBadgeStore.setState({ counts: { transcript: 0, board: 2, brain: 0 } });
      renderOverlay();

      const tablist = screen.getByRole('tablist');
      expect(within(tablist).getByText('2')).toBeInTheDocument();
      // Badge never auto-switches the active tab.
      expect(screen.getByRole('tab', { name: 'Transcript' })).toHaveAttribute('aria-selected', 'true');

      fireEvent.click(screen.getByRole('tab', { name: /board/i }));

      expect(useCanvasBadgeStore.getState().counts.board).toBe(0);
      expect(within(tablist).queryByText('2')).toBeNull();
    });

    it('keeps accumulating transcript segments while the Board tab is active', () => {
      useRecordingStore.setState({
        isRecording: true,
        liveSegments: [makeSegment({ id: 'seg-1', content: 'First segment' })],
      });
      renderOverlay();

      fireEvent.click(screen.getByRole('tab', { name: 'Board' }));
      expect(screen.queryByTestId('live-transcript-feed')).toBeNull();

      // Simulate a segment arriving (recordingStore's app-wide IPC listener) while
      // the Board tab is on-canvas and LiveTranscriptFeed is unmounted.
      act(() => {
        useRecordingStore.setState((s) => ({
          liveSegments: [...s.liveSegments, makeSegment({ id: 'seg-2', content: 'Second segment' })],
        }));
      });

      fireEvent.click(screen.getByRole('tab', { name: 'Transcript' }));

      const feed = screen.getByTestId('live-transcript-feed');
      expect(feed).toHaveTextContent('First segment');
      expect(feed).toHaveTextContent('Second segment');
    });

    it('resets the active tab to Transcript when a new recording starts', async () => {
      useRecordingStore.setState({ isRecording: true, meetingId: 'meeting-1' });
      renderOverlay();

      fireEvent.click(screen.getByRole('tab', { name: 'Board' }));
      expect(screen.getByRole('tab', { name: 'Board' })).toHaveAttribute('aria-selected', 'true');

      // Simulate the current recording stopping and a NEW one starting while the
      // overlay stays mounted (it never unmounts — see LiveModeOverlay.tsx header).
      act(() => {
        useRecordingStore.setState({ isRecording: false, meetingId: null });
      });
      act(() => {
        useRecordingStore.setState({ isRecording: true, meetingId: 'meeting-2' });
      });
      // The reset is deferred into rAF (mirrors the overlay's fade-in effect) —
      // flush one frame so it lands before asserting.
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });

      expect(screen.getByRole('tab', { name: 'Transcript' })).toHaveAttribute('aria-selected', 'true');
    });
  });

  // -------------------------------------------------------------------------
  // Task 3: Brain node click routing — prefers in-canvas moves over navigating
  // underneath the full-screen overlay; falls back to a real navigation only
  // when no in-canvas surface exists (a different project, or another session).
  //
  // Migration fix A: the overlay's Board-tab view (foreign project + opened card)
  // is LOCAL state, NEVER the shared router URL — the URL belongs to whatever route
  // sits under this full-screen portal, usually a DIFFERENT session. So these clicks
  // must NOT write viewProject/openCard to the location (which would bleed onto that
  // unrelated session when the overlay is minimized).
  // -------------------------------------------------------------------------
  describe('Brain entity routing (Task 3)', () => {
    it("opens a card belonging to the session's OWN project IN-CANVAS (Board tab, no URL write)", async () => {
      useRecordingStore.setState({ isRecording: true, meetingId: 'meeting-1' });
      useMeetingStore.setState({ meetings: [{ id: 'meeting-1', title: 'Live Meeting', projectId: 'proj-1' }] } as any);
      useBoardStore.setState({
        project: { id: 'proj-1', name: 'Proj One' },
        columns: [],
        cards: [],
        allCards: [{ id: 'card-same-project', columnId: 'col-1', projectId: 'proj-1' }],
        labels: [],
        relationships: [],
        loading: false,
        error: null,
        loadBoard: vi.fn().mockResolvedValue(undefined),
      } as any);

      renderOverlay(['/']);
      await flushMountRaf();
      fireEvent.click(screen.getByRole('tab', { name: 'Brain' }));
      await screen.findByTestId('mock-mindmap');

      fireEvent.click(screen.getByText('open-card-same-project'));

      // In-canvas: switched to Board tab; the shared URL is left completely untouched
      // (fix A — the card opens via EmbeddedBoard's local cardOpen override, not ?openCard=).
      expect(screen.getByRole('tab', { name: 'Board' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('embedded-board')).toBeInTheDocument();
      expect(screen.getByTestId('test-location')).toHaveTextContent('/');
      expect(screen.getByTestId('test-location')).not.toHaveTextContent('openCard');
    });

    it("shows a card from a DIFFERENT project IN this overlay's Board tab via LOCAL state (no URL write, no navigation, no minimize)", async () => {
      useRecordingStore.setState({ isRecording: true, meetingId: 'meeting-1' });
      useMeetingStore.setState({ meetings: [{ id: 'meeting-1', title: 'Live Meeting', projectId: 'proj-1' }] } as any);
      useProjectStore.setState({ projects: [{ id: 'proj-2', name: 'Proj Two' }] } as any);
      useBoardStore.setState({
        allCards: [{ id: 'card-other-project', columnId: 'col-2', projectId: 'proj-2' }],
        project: { id: 'proj-2', name: 'Proj Two' },
        columns: [],
        cards: [],
        labels: [],
        relationships: [],
        loading: false,
        error: null,
        loadBoard: vi.fn().mockResolvedValue(undefined),
      } as any);

      renderOverlay(['/']);
      await flushMountRaf();
      fireEvent.click(screen.getByRole('tab', { name: 'Brain' }));
      await screen.findByTestId('mock-mindmap');

      fireEvent.click(screen.getByText('open-card-other-project'));

      // In-canvas viewed-project override held in LOCAL overlay state: Board tab active,
      // the foreign board embedded with the back-banner — and NOTHING written to the
      // shared URL (fix A: no viewProject/openCard, no /projects nav).
      expect(screen.getByRole('tab', { name: 'Board' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('embedded-board')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /back to this session's board/i })).toBeInTheDocument();
      expect(screen.getByTestId('test-location')).toHaveTextContent('/');
      expect(screen.getByTestId('test-location')).not.toHaveTextContent('viewProject');
      expect(screen.getByTestId('test-location')).not.toHaveTextContent('openCard');
      // The overlay stays up (no minimize) and the underlying route is untouched.
      expect(useRecordingStore.getState().liveModeMinimized).toBe(false);
      expect(screen.getByRole('dialog', OVERLAY)).toBeInTheDocument();
    });

    it('does NOT bleed the foreign-project view onto the underlying session when minimized (fix A)', async () => {
      // The overlay is a portal over a DIFFERENT underlying session's route. Opening a
      // foreign project in the overlay's Board tab, then minimizing, must leave that
      // underlying route's URL pristine — the whole point of keeping the view LOCAL.
      useRecordingStore.setState({ isRecording: true, meetingId: 'meeting-1' });
      useMeetingStore.setState({ meetings: [{ id: 'meeting-1', title: 'Live Meeting', projectId: 'proj-1' }] } as any);
      useProjectStore.setState({ projects: [{ id: 'proj-2', name: 'Proj Two' }] } as any);
      useBoardStore.setState({
        allCards: [{ id: 'card-other-project', columnId: 'col-2', projectId: 'proj-2' }],
        project: { id: 'proj-2', name: 'Proj Two' },
        columns: [],
        cards: [],
        labels: [],
        relationships: [],
        loading: false,
        error: null,
        loadBoard: vi.fn().mockResolvedValue(undefined),
      } as any);

      renderOverlay(['/session/underlying-session']);
      await flushMountRaf();
      fireEvent.click(screen.getByRole('tab', { name: 'Brain' }));
      await screen.findByTestId('mock-mindmap');
      fireEvent.click(screen.getByText('open-card-other-project'));

      // Foreign board is showing in the overlay, but the underlying route is unchanged.
      expect(screen.getByTestId('test-location')).toHaveTextContent('/session/underlying-session');

      // Minimize → overlay unmounts; the underlying session's URL stays pristine (no
      // viewProject/openCard bleed).
      fireEvent.click(screen.getByLabelText('Minimize Live Mode'));
      expect(screen.queryByRole('dialog', OVERLAY)).toBeNull();
      const location = screen.getByTestId('test-location');
      expect(location).toHaveTextContent('/session/underlying-session');
      expect(location).not.toHaveTextContent('viewProject');
      expect(location).not.toHaveTextContent('openCard');
    });

    it('opens a session node via a real navigation to /session/:id (no in-canvas surface for another session)', async () => {
      useRecordingStore.setState({ isRecording: true, meetingId: 'meeting-1' });
      renderOverlay(['/']);
      await flushMountRaf();
      fireEvent.click(screen.getByRole('tab', { name: 'Brain' }));
      await screen.findByTestId('mock-mindmap');

      fireEvent.click(screen.getByText('open-session'));

      expect(screen.getByTestId('test-location')).toHaveTextContent('/session/other-meet');
    });
  });
});
