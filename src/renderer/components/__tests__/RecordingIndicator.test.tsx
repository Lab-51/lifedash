// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// Import store and component
// ---------------------------------------------------------------------------
const { useRecordingStore } = await import('../../stores/recordingStore');
const { default: RecordingIndicator } = await import('../RecordingIndicator');

const realActions = {
  stopRecording: useRecordingStore.getState().stopRecording,
};

function renderIndicator() {
  return render(
    <MemoryRouter>
      <RecordingIndicator />
    </MemoryRouter>,
  );
}

describe('RecordingIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRecordingStore.setState({
      isRecording: false,
      isProcessing: false,
      liveModeMinimized: false,
      elapsed: 0,
      processingProgress: null,
      ...realActions,
    });
  });

  it('renders nothing when neither recording nor processing', () => {
    const { container } = renderIndicator();
    expect(container.firstChild).toBeNull();
  });

  it('shows the elapsed timer while recording', () => {
    useRecordingStore.setState({ isRecording: true, elapsed: 75 });
    renderIndicator();
    expect(screen.getByText('01:15')).toBeInTheDocument();
  });

  it('does not render the pending-proposals badge while the count is zero (Task 5 slot)', () => {
    useRecordingStore.setState({ isRecording: true });
    renderIndicator();
    expect(screen.queryByTestId('pending-proposals-badge')).toBeNull();
  });

  it('offers "Return to Live" only when Live Mode is minimized, and restoring calls restoreLiveMode', () => {
    useRecordingStore.setState({ isRecording: true, liveModeMinimized: true });
    renderIndicator();

    fireEvent.click(screen.getByLabelText('Recording controls'));
    fireEvent.click(screen.getByLabelText('Return to Live Mode'));

    expect(useRecordingStore.getState().liveModeMinimized).toBe(false);
  });

  it('hides "Return to Live" when the overlay is already showing (not minimized)', () => {
    useRecordingStore.setState({ isRecording: true, liveModeMinimized: false });
    renderIndicator();

    fireEvent.click(screen.getByLabelText('Recording controls'));

    expect(screen.queryByLabelText('Return to Live Mode')).toBeNull();
    // Stop is always available in the popover.
    expect(screen.getByLabelText('Stop Recording')).toBeInTheDocument();
  });

  it('Stop control triggers the shared stopRecording action', () => {
    const stopSpy = vi.fn(() => Promise.resolve());
    useRecordingStore.setState({ isRecording: true, stopRecording: stopSpy });
    renderIndicator();

    fireEvent.click(screen.getByLabelText('Recording controls'));
    fireEvent.click(screen.getByLabelText('Stop Recording'));

    expect(stopSpy).toHaveBeenCalledTimes(1);
  });
});
