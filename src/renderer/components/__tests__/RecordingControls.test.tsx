// @vitest-environment jsdom
// Regression tests for LIVE.3 Task 2: exactly one audio meter is visible at a time.
// The full-screen LiveModeOverlay owns the meter while it is active, so the sidebar
// RecordingControls meter must stay unmounted then — and reappear once Live Mode is
// minimized (which also re-registers audioCaptureService's single onAudioLevel
// callback, fixing the stale/frozen sidebar meter).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// The real meter drives a canvas rAF loop that jsdom cannot paint; stub it with a
// visible marker so we can assert purely on mount/unmount.
vi.mock('../AudioLevelMeter', () => ({ default: () => <div data-testid="audio-level-meter" /> }));

const notificationShow = vi.fn();

// RecordingControls' mount effects probe settings/model/config — stub them so the
// effects resolve cleanly and don't leave unhandled rejections.
vi.stubGlobal('electronAPI', {
  getSetting: vi.fn().mockResolvedValue(null),
  setSetting: vi.fn().mockResolvedValue(undefined),
  whisperGetActiveModel: vi.fn().mockResolvedValue(null),
  transcriptionGetConfig: vi.fn().mockResolvedValue({ type: 'local' }),
  getProjectsWithRecency: vi.fn().mockResolvedValue([]),
  notificationShow,
});

const { useRecordingStore } = await import('../../stores/recordingStore');
const { useMeetingStore } = await import('../../stores/meetingStore');
const { useToastStore } = await import('../../hooks/useToast');
const { default: RecordingControls } = await import('../RecordingControls');

describe('RecordingControls — single audio meter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMeetingStore.setState({ meetings: [] } as never);
    useRecordingStore.setState({
      isRecording: true,
      isProcessing: false,
      liveModeMinimized: false,
      elapsed: 0,
      error: null,
    } as never);
  });

  it('hides the sidebar meter while the full-screen Live Mode overlay is active', () => {
    useRecordingStore.setState({ isRecording: true, liveModeMinimized: false } as never);
    render(<RecordingControls />);
    expect(screen.queryByTestId('audio-level-meter')).toBeNull();
  });

  it('shows the sidebar meter once Live Mode is minimized (overlay meter unmounted)', () => {
    useRecordingStore.setState({ isRecording: true, liveModeMinimized: true } as never);
    render(<RecordingControls />);
    expect(screen.getByTestId('audio-level-meter')).toBeInTheDocument();
  });
});

// -----------------------------------------------------------------------------
// GUARD.1 Task 2: RecordingControls is the always-mounted-during-recording home
// for the inactivity countdown's IPC/toast side effects (Session Decisions —
// the store itself stays free of them beyond the Task 1 contract).
// -----------------------------------------------------------------------------
describe('RecordingControls — inactivity auto-stop observer (GUARD.1 Task 2)', () => {
  const realKeepRecording = () => {};

  beforeEach(() => {
    vi.clearAllMocks();
    useToastStore.setState({ toasts: [] });
    useMeetingStore.setState({ meetings: [] } as never);
    useRecordingStore.setState({
      isRecording: true,
      isProcessing: false,
      liveModeMinimized: false,
      inactivityState: 'idle',
      inactivitySecondsLeft: 0,
      keepRecording: realKeepRecording,
      elapsed: 0,
      error: null,
    } as never);
  });

  it('fires a desktop notification when the countdown starts, regardless of minimized state', async () => {
    render(<RecordingControls />);

    act(() => {
      useRecordingStore.setState({ inactivityState: 'countdown', inactivitySecondsLeft: 120 } as never);
    });

    await waitFor(() =>
      expect(notificationShow).toHaveBeenCalledWith('Still recording?', expect.stringContaining('LifeDash')),
    );
    // Not minimized — no toast substitute needed (the full-screen banner covers it).
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('fires a toast with a working "Keep recording" action when the countdown starts while minimized', async () => {
    const keepSpy = vi.fn();
    useRecordingStore.setState({ liveModeMinimized: true, keepRecording: keepSpy } as never);
    render(<RecordingControls />);

    act(() => {
      useRecordingStore.setState({ inactivityState: 'countdown', inactivitySecondsLeft: 120 } as never);
    });

    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    const toastEntry = useToastStore.getState().toasts[0];
    expect(toastEntry.action?.label).toBe('Keep recording');

    toastEntry.action?.onClick();
    expect(keepSpy).toHaveBeenCalledTimes(1);
  });

  it('does not repeat the notification for the same countdown episode (only per-second ticks)', async () => {
    render(<RecordingControls />);

    act(() => {
      useRecordingStore.setState({ inactivityState: 'countdown', inactivitySecondsLeft: 120 } as never);
    });
    await waitFor(() => expect(notificationShow).toHaveBeenCalledTimes(1));

    act(() => {
      useRecordingStore.setState({ inactivitySecondsLeft: 119 } as never);
    });
    act(() => {
      useRecordingStore.setState({ inactivitySecondsLeft: 118 } as never);
    });

    expect(notificationShow).toHaveBeenCalledTimes(1);
  });

  it('surfaces a distinct toast after an unattended auto-stop (countdown + recording end together)', async () => {
    render(<RecordingControls />);

    act(() => {
      useRecordingStore.setState({ inactivityState: 'countdown', inactivitySecondsLeft: 1 } as never);
    });
    act(() => {
      useRecordingStore.setState({ inactivityState: 'idle', inactivitySecondsLeft: 0, isRecording: false } as never);
    });

    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
        'Recording auto-stopped after inactivity — session saved',
      ),
    );
  });

  it('does NOT surface the auto-stop toast when "Keep recording" cancels the countdown (still recording)', () => {
    render(<RecordingControls />);

    act(() => {
      useRecordingStore.setState({ inactivityState: 'countdown', inactivitySecondsLeft: 1 } as never);
    });
    act(() => {
      // Mirrors keepRecording()/onActivityResume(): inactivityState clears but isRecording stays true.
      useRecordingStore.setState({ inactivityState: 'idle', inactivitySecondsLeft: 0 } as never);
    });

    expect(useToastStore.getState().toasts.map((t) => t.message)).not.toContain(
      'Recording auto-stopped after inactivity — session saved',
    );
  });
});
