// @vitest-environment jsdom
// GUARD.1 Task 2: InactivityBanner renders purely from recordingStore's frozen
// Task 1 contract (inactivityState, inactivitySecondsLeft, keepRecording).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

const { useRecordingStore } = await import('../../stores/recordingStore');
const { default: InactivityBanner } = await import('../InactivityBanner');

describe('InactivityBanner', () => {
  const realKeepRecording = useRecordingStore.getState().keepRecording;

  beforeEach(() => {
    useRecordingStore.setState({
      inactivityState: 'idle',
      inactivitySecondsLeft: 0,
      keepRecording: realKeepRecording,
    } as never);
  });

  it('is absent when idle', () => {
    render(<InactivityBanner />);
    expect(screen.queryByText(/no audio detected/i)).toBeNull();
  });

  it('renders the countdown and calls keepRecording when the button is clicked', () => {
    const keepSpy = vi.fn();
    useRecordingStore.setState({
      inactivityState: 'countdown',
      inactivitySecondsLeft: 95,
      keepRecording: keepSpy,
    } as never);

    render(<InactivityBanner />);

    expect(screen.getByText(/no audio detected/i)).toBeInTheDocument();
    expect(screen.getByText('1:35')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /keep recording/i }));
    expect(keepSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps the countdown text in an aria-live region', () => {
    useRecordingStore.setState({
      inactivityState: 'countdown',
      inactivitySecondsLeft: 120,
      keepRecording: vi.fn(),
    } as never);

    render(<InactivityBanner />);

    expect(screen.getByText(/no audio detected/i)).toHaveAttribute('aria-live', 'polite');
  });
});
