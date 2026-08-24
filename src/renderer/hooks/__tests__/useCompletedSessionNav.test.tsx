// @vitest-environment jsdom
//
// POST-FLOW.1 Task 2 — the stop → arrival navigation. A REAL MemoryRouter does
// the navigating (so the landing URL is genuinely asserted), with useNavigate
// wrapped in a counting spy that DELEGATES to the real one. The spy is not
// decoration: React batches two navigate() calls in the same effect into a single
// render, so observing only `useLocation()` cannot tell one push from two — a
// deliberately double-navigating mutant passed a key-counting version of this file.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { NavigateFunction } from 'react-router-dom';
import '@testing-library/jest-dom';

const navigateSpy = vi.fn<NavigateFunction>();

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    // Called during render like the real hook, so the rules of hooks hold; the
    // returned spy forwards to the genuine navigate.
    useNavigate: () => {
      const real = actual.useNavigate();
      navigateSpy.mockImplementation(real as never);
      return navigateSpy;
    },
  };
});

vi.mock('../../services/audioCaptureService', () => ({
  startCapture: vi.fn().mockResolvedValue(undefined),
  stopCapture: vi.fn().mockResolvedValue(undefined),
  onAudioInterrupted: vi.fn(),
  getAudioLevel: vi.fn(() => 0),
}));
vi.mock('../../services/inactivityDetectorService', () => ({
  startInactivityDetector: vi.fn(),
  stopInactivityDetector: vi.fn(),
  keepRecording: vi.fn(),
}));
vi.mock('../../stores/gamificationStore', () => ({
  useGamificationStore: { getState: () => ({ awardXP: vi.fn() }) },
}));
vi.mock('../../stores/meetingStore', () => ({
  useMeetingStore: { getState: () => ({ addTranscriptSegment: vi.fn() }) },
}));
vi.mock('../../hooks/useToast', () => ({ toast: vi.fn() }));

vi.stubGlobal('electronAPI', {
  recordingSetState: vi.fn(),
  stopRecording: vi.fn().mockResolvedValue('/tmp/audio.wav'),
  updateMeeting: vi.fn().mockResolvedValue(undefined),
  deleteMeeting: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn().mockResolvedValue(null),
});

const { useRecordingStore } = await import('../../stores/recordingStore');
const { useCompletedSessionNav } = await import('../useCompletedSessionNav');

function Probe() {
  useCompletedSessionNav();
  const location = useLocation();
  return <div data-testid="here">{`${location.pathname}${location.search}`}</div>;
}

function renderProbe() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Probe />
    </MemoryRouter>,
  );
}

describe('useCompletedSessionNav — stop lands on the session, cancel never does', () => {
  beforeEach(() => {
    navigateSpy.mockClear();
    useRecordingStore.setState({ meetingId: null, completedMeetingId: null, isRecording: false, isProcessing: false });
  });

  it('navigates to the finished session exactly once and clears the trigger', () => {
    renderProbe();
    expect(screen.getByTestId('here')).toHaveTextContent('/');
    navigateSpy.mockClear();

    act(() => {
      useRecordingStore.setState({ completedMeetingId: 'meet-42' });
    });

    expect(screen.getByTestId('here')).toHaveTextContent('/session/meet-42?autoGenerate=1');
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenCalledWith('/session/meet-42?autoGenerate=1');
    expect(useRecordingStore.getState().completedMeetingId).toBeNull();
  });

  it('does nothing at all while completedMeetingId is null', () => {
    renderProbe();
    navigateSpy.mockClear();

    act(() => {
      useRecordingStore.setState({ isRecording: true });
    });

    expect(screen.getByTestId('here')).toHaveTextContent('/');
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('a REAL cancelRecording leaves the route untouched', async () => {
    renderProbe();
    useRecordingStore.setState({ meetingId: 'meet-99', isRecording: true });
    navigateSpy.mockClear();

    await act(async () => {
      await useRecordingStore.getState().cancelRecording();
    });

    expect(screen.getByTestId('here')).toHaveTextContent('/');
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('a REAL stopRecording navigates to that meeting, once', async () => {
    renderProbe();
    useRecordingStore.setState({ meetingId: 'meet-77', isRecording: true });
    navigateSpy.mockClear();

    await act(async () => {
      await useRecordingStore.getState().stopRecording();
    });

    expect(screen.getByTestId('here')).toHaveTextContent('/session/meet-77?autoGenerate=1');
    expect(navigateSpy).toHaveBeenCalledTimes(1);
  });
});
