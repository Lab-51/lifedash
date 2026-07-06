// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
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

vi.stubGlobal('electronAPI', {
  createMeeting: vi.fn().mockResolvedValue({ id: 'meeting-new' }),
  startRecording: vi.fn().mockResolvedValue(undefined),
  stopRecording: vi.fn().mockResolvedValue(null),
  deleteMeeting: vi.fn().mockResolvedValue(undefined),
  updateMeeting: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn().mockResolvedValue(null),
  recordingSetState: vi.fn(),
});

// ---------------------------------------------------------------------------
// Import store and component AFTER mocks
// ---------------------------------------------------------------------------
const { useRecordingStore } = await import('../../stores/recordingStore');
const { default: LiveModeOverlay } = await import('../LiveModeOverlay');

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
  });

  it('renders nothing when not recording', () => {
    render(<LiveModeOverlay />);
    expect(screen.queryByRole('dialog', OVERLAY)).toBeNull();
  });

  it('AUTO-ENTERS when recording starts', () => {
    render(<LiveModeOverlay />);
    expect(screen.queryByRole('dialog', OVERLAY)).toBeNull();

    act(() => {
      useRecordingStore.setState({ isRecording: true });
    });

    expect(screen.getByRole('dialog', OVERLAY)).toBeInTheDocument();
  });

  it('mounts via portal directly under document.body', () => {
    useRecordingStore.setState({ isRecording: true });
    render(<LiveModeOverlay />);
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
    render(<LiveModeOverlay />);
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
    render(<LiveModeOverlay />);
    const feed = screen.getByTestId('live-transcript-feed');
    expect(feed).toBeInTheDocument();
    expect(feed).toHaveTextContent('Spoken words');
    // Segment timestamp is formatted from startTime (65s → 01:05).
    expect(feed).toHaveTextContent('01:05');
  });

  it('reserves the Task 5 proposals mount point above the chat', () => {
    useRecordingStore.setState({ isRecording: true });
    render(<LiveModeOverlay />);
    expect(screen.getByTestId('live-proposals-mount')).toBeInTheDocument();
  });

  it('minimizes (collapses to the pill) without stopping the recording', () => {
    useRecordingStore.setState({ isRecording: true });
    render(<LiveModeOverlay />);
    expect(screen.getByRole('dialog', OVERLAY)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Minimize Live Mode'));

    expect(screen.queryByRole('dialog', OVERLAY)).toBeNull();
    expect(useRecordingStore.getState().liveModeMinimized).toBe(true);
    // Minimize is an escape hatch — recording must keep running.
    expect(useRecordingStore.getState().isRecording).toBe(true);
  });

  it('restores from minimized back to the full overlay', () => {
    useRecordingStore.setState({ isRecording: true, liveModeMinimized: true });
    render(<LiveModeOverlay />);
    expect(screen.queryByRole('dialog', OVERLAY)).toBeNull();

    act(() => {
      useRecordingStore.getState().restoreLiveMode();
    });

    expect(screen.getByRole('dialog', OVERLAY)).toBeInTheDocument();
  });

  it('Esc minimizes but NEVER stops the recording', () => {
    const stopSpy = vi.fn(() => Promise.resolve());
    useRecordingStore.setState({ isRecording: true, stopRecording: stopSpy });
    render(<LiveModeOverlay />);
    expect(screen.getByRole('dialog', OVERLAY)).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(useRecordingStore.getState().liveModeMinimized).toBe(true);
    expect(useRecordingStore.getState().isRecording).toBe(true);
    expect(stopSpy).not.toHaveBeenCalled();
  });

  it('Stop button triggers the shared stopRecording action', () => {
    const stopSpy = vi.fn(() => Promise.resolve());
    useRecordingStore.setState({ isRecording: true, stopRecording: stopSpy });
    render(<LiveModeOverlay />);

    fireEvent.click(screen.getByLabelText('Stop and save recording'));

    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it('unmounts when recording stops (hands off to the post-recording flow)', () => {
    useRecordingStore.setState({ isRecording: true });
    render(<LiveModeOverlay />);
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
});
