// @vitest-environment jsdom
// Regression tests for LIVE.3 Task 2: exactly one audio meter is visible at a time.
// The full-screen LiveModeOverlay owns the meter while it is active, so the sidebar
// RecordingControls meter must stay unmounted then — and reappear once Live Mode is
// minimized (which also re-registers audioCaptureService's single onAudioLevel
// callback, fixing the stale/frozen sidebar meter).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// The real meter drives a canvas rAF loop that jsdom cannot paint; stub it with a
// visible marker so we can assert purely on mount/unmount.
vi.mock('../AudioLevelMeter', () => ({ default: () => <div data-testid="audio-level-meter" /> }));

// RecordingControls' mount effects probe settings/model/config — stub them so the
// effects resolve cleanly and don't leave unhandled rejections.
vi.stubGlobal('electronAPI', {
  getSetting: vi.fn().mockResolvedValue(null),
  setSetting: vi.fn().mockResolvedValue(undefined),
  whisperGetActiveModel: vi.fn().mockResolvedValue(null),
  transcriptionGetConfig: vi.fn().mockResolvedValue({ type: 'local' }),
  getProjectsWithRecency: vi.fn().mockResolvedValue([]),
});

const { useRecordingStore } = await import('../../stores/recordingStore');
const { useMeetingStore } = await import('../../stores/meetingStore');
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
