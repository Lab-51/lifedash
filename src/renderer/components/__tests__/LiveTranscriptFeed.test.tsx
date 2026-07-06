// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// Polyfill scrollIntoView for jsdom (used by the auto-scroll effect)
// ---------------------------------------------------------------------------
if (typeof Element.prototype.scrollIntoView === 'undefined') {
  Element.prototype.scrollIntoView = vi.fn();
}

// ---------------------------------------------------------------------------
// Import store and component AFTER polyfills
// ---------------------------------------------------------------------------
const { useRecordingStore } = await import('../../stores/recordingStore');
const { default: LiveTranscriptFeed } = await import('../LiveTranscriptFeed');

function makeSegment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'seg-1',
    meetingId: 'meet-1',
    content: 'Hello world',
    startTime: 0,
    endTime: 1000,
    speaker: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/** Overrides scroll metrics on a jsdom element so scroll-position logic can be tested. */
function setScrollMetrics(el: HTMLElement, metrics: { scrollTop: number; scrollHeight: number; clientHeight: number }) {
  Object.defineProperty(el, 'scrollTop', { value: metrics.scrollTop, writable: true, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: metrics.scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: metrics.clientHeight, configurable: true });
}

describe('LiveTranscriptFeed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRecordingStore.setState({ liveSegments: [] });
  });

  it('shows a "waiting for speech" empty state when there are no segments', () => {
    useRecordingStore.setState({ liveSegments: [] });
    render(<LiveTranscriptFeed />);
    expect(screen.getByText(/waiting for speech/i)).toBeInTheDocument();
  });

  it('renders transcript segments from recordingStore with a formatted timestamp', () => {
    useRecordingStore.setState({
      liveSegments: [makeSegment({ id: 'seg-1', content: 'First segment', startTime: 0 })],
    });
    render(<LiveTranscriptFeed />);
    expect(screen.getByText('First segment')).toBeInTheDocument();
    expect(screen.getByText('00:00')).toBeInTheDocument();
  });

  it('renders the speaker label when a segment is diarized', () => {
    useRecordingStore.setState({
      liveSegments: [makeSegment({ id: 'seg-1', content: 'Diarized line', speaker: 'Alice' })],
    });
    render(<LiveTranscriptFeed />);
    expect(screen.getByText('Alice:')).toBeInTheDocument();
  });

  it('appends new segments as they arrive', () => {
    useRecordingStore.setState({
      liveSegments: [makeSegment({ id: 'seg-1', content: 'First segment', startTime: 0 })],
    });
    render(<LiveTranscriptFeed />);
    expect(screen.getByText('First segment')).toBeInTheDocument();

    act(() => {
      useRecordingStore.setState({
        liveSegments: [
          makeSegment({ id: 'seg-1', content: 'First segment', startTime: 0 }),
          makeSegment({ id: 'seg-2', content: 'Second segment', startTime: 12000 }),
        ],
      });
    });

    expect(screen.getByText('Second segment')).toBeInTheDocument();
    expect(screen.getByText('00:12')).toBeInTheDocument();
  });

  describe('auto-scroll pin logic', () => {
    it('stays pinned to the bottom by default as new segments arrive', () => {
      useRecordingStore.setState({
        liveSegments: [makeSegment({ id: 'seg-1', content: 'First' })],
      });
      render(<LiveTranscriptFeed />);
      const callsAfterMount = (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls.length;

      act(() => {
        useRecordingStore.setState({
          liveSegments: [
            makeSegment({ id: 'seg-1', content: 'First' }),
            makeSegment({ id: 'seg-2', content: 'Second' }),
          ],
        });
      });

      expect((Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
        callsAfterMount,
      );
    });

    it('releases the pin once the user scrolls up, and does not yank them back to the bottom', () => {
      useRecordingStore.setState({
        liveSegments: [makeSegment({ id: 'seg-1', content: 'First' })],
      });
      render(<LiveTranscriptFeed />);
      const scrollContainer = screen.getByTestId('live-transcript-feed');

      // Simulate the user scrolling up, away from the bottom (> 80px threshold).
      setScrollMetrics(scrollContainer, { scrollTop: 0, scrollHeight: 1000, clientHeight: 200 });
      fireEvent.scroll(scrollContainer);

      (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();

      act(() => {
        useRecordingStore.setState({
          liveSegments: [
            makeSegment({ id: 'seg-1', content: 'First' }),
            makeSegment({ id: 'seg-2', content: 'Second' }),
          ],
        });
      });

      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    });
  });
});
