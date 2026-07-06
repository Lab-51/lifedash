// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// Polyfill scrollIntoView for jsdom (used by the auto-scroll effect)
// ---------------------------------------------------------------------------
if (typeof Element.prototype.scrollIntoView === 'undefined') {
  Element.prototype.scrollIntoView = vi.fn();
}

// ---------------------------------------------------------------------------
// Mock window.electronAPI — only exercised once a test sets an active meetingId,
// which mounts the real LiveAssistantChat (Task 4) into the bottom-half placeholder.
// ---------------------------------------------------------------------------
vi.stubGlobal('electronAPI', {
  meetingAgentLoad: vi.fn().mockResolvedValue([]),
  meetingAgentSend: vi.fn().mockResolvedValue(null),
  meetingAgentStop: vi.fn().mockResolvedValue(undefined),
  onMeetingAgentTextDelta: vi.fn().mockReturnValue(() => {}),
  onMeetingAgentToolCall: vi.fn().mockReturnValue(() => {}),
  onMeetingAgentToolResult: vi.fn().mockReturnValue(() => {}),
  onMeetingAgentDone: vi.fn().mockReturnValue(() => {}),
  onMeetingAgentError: vi.fn().mockReturnValue(() => {}),
  getAIProviders: vi.fn().mockResolvedValue([]),
});

// ---------------------------------------------------------------------------
// Import store and component AFTER polyfills/mocks
// ---------------------------------------------------------------------------
const { useRecordingStore } = await import('../../stores/recordingStore');
const { useSettingsStore } = await import('../../stores/settingsStore');
const { default: LiveMeetingDrawer } = await import('../LiveMeetingDrawer');

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

describe('LiveMeetingDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRecordingStore.setState({
      isRecording: false,
      liveDrawerOpen: false,
      liveSegments: [],
      meetingId: null,
    });
    useSettingsStore.setState({ providers: [], hasAnyEnabledProvider: () => false } as never);
  });

  it('renders nothing when not recording, even if the drawer was toggled open', () => {
    useRecordingStore.setState({ isRecording: false, liveDrawerOpen: true });
    render(<LiveMeetingDrawer />);
    expect(screen.queryByRole('dialog', { name: 'Live Assistant' })).toBeNull();
  });

  it('renders nothing while recording if the drawer has not been opened', () => {
    useRecordingStore.setState({ isRecording: true, liveDrawerOpen: false });
    render(<LiveMeetingDrawer />);
    expect(screen.queryByRole('dialog', { name: 'Live Assistant' })).toBeNull();
  });

  it('shows a "waiting for speech" empty state when recording with no segments yet', () => {
    useRecordingStore.setState({ isRecording: true, liveDrawerOpen: true, liveSegments: [] });
    render(<LiveMeetingDrawer />);
    expect(screen.getByText(/waiting for speech/i)).toBeInTheDocument();
  });

  it('renders transcript segments with a formatted timestamp', () => {
    useRecordingStore.setState({
      isRecording: true,
      liveDrawerOpen: true,
      liveSegments: [makeSegment({ id: 'seg-1', content: 'First segment', startTime: 0 })],
    });
    render(<LiveMeetingDrawer />);
    expect(screen.getByText('First segment')).toBeInTheDocument();
    expect(screen.getByText('00:00')).toBeInTheDocument();
  });

  it('appends new segments as they arrive', () => {
    useRecordingStore.setState({
      isRecording: true,
      liveDrawerOpen: true,
      liveSegments: [makeSegment({ id: 'seg-1', content: 'First segment', startTime: 0 })],
    });
    render(<LiveMeetingDrawer />);
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

  it('mounts via portal directly under document.body', () => {
    useRecordingStore.setState({ isRecording: true, liveDrawerOpen: true, liveSegments: [makeSegment()] });
    render(<LiveMeetingDrawer />);
    const dialog = screen.getByRole('dialog', { name: 'Live Assistant' });
    expect(dialog.parentElement).toBe(document.body);
  });

  it('reserves a bottom-half container for the Live Assistant chat', () => {
    useRecordingStore.setState({ isRecording: true, liveDrawerOpen: true, liveSegments: [] });
    render(<LiveMeetingDrawer />);
    expect(screen.getByTestId('live-assistant-chat-placeholder')).toBeInTheDocument();
  });

  it('mounts LiveAssistantChat into the bottom-half container once a meeting is active', async () => {
    useSettingsStore.setState({
      providers: [
        {
          id: 'p1',
          name: 'ollama',
          displayName: null,
          enabled: true,
          hasApiKey: false,
          baseUrl: null,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
      hasAnyEnabledProvider: () => true,
    } as never);
    useRecordingStore.setState({
      isRecording: true,
      liveDrawerOpen: true,
      liveSegments: [],
      meetingId: 'meeting-1',
    });

    render(
      <MemoryRouter>
        <LiveMeetingDrawer />
      </MemoryRouter>,
    );

    // meetingAgentStore's load() resolves asynchronously — wait for the real
    // LiveAssistantChat to finish loading before asserting its content.
    expect(await screen.findByText('Summarize the meeting so far')).toBeInTheDocument();
    const container = screen.getByTestId('live-assistant-chat-placeholder');
    expect(container.querySelector('textarea')).not.toBeNull();
  });

  it('closes on Escape', () => {
    useRecordingStore.setState({ isRecording: true, liveDrawerOpen: true, liveSegments: [] });
    render(<LiveMeetingDrawer />);
    expect(screen.getByRole('dialog', { name: 'Live Assistant' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(useRecordingStore.getState().liveDrawerOpen).toBe(false);
  });

  describe('auto-scroll pin logic', () => {
    it('stays pinned to the bottom by default as new segments arrive', () => {
      useRecordingStore.setState({
        isRecording: true,
        liveDrawerOpen: true,
        liveSegments: [makeSegment({ id: 'seg-1', content: 'First' })],
      });
      render(<LiveMeetingDrawer />);
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
        isRecording: true,
        liveDrawerOpen: true,
        liveSegments: [makeSegment({ id: 'seg-1', content: 'First' })],
      });
      render(<LiveMeetingDrawer />);
      const dialog = screen.getByRole('dialog', { name: 'Live Assistant' });
      const scrollContainer = dialog.querySelector('.overflow-y-auto') as HTMLElement;
      expect(scrollContainer).not.toBeNull();

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
