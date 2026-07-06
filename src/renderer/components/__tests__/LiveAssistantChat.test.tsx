// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// Polyfill scrollIntoView for jsdom (used by the auto-scroll effect)
// ---------------------------------------------------------------------------
if (typeof Element.prototype.scrollIntoView === 'undefined') {
  Element.prototype.scrollIntoView = vi.fn();
}

// ---------------------------------------------------------------------------
// Mock window.electronAPI — must happen before any store or component import
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
// Import stores and component AFTER mocking
// ---------------------------------------------------------------------------
const { useMeetingAgentStore } = await import('../../stores/meetingAgentStore');
const { useSettingsStore } = await import('../../stores/settingsStore');
const { default: LiveAssistantChat } = await import('../LiveAssistantChat');

function renderChat(meetingId = 'meeting-1') {
  return render(
    <MemoryRouter>
      <LiveAssistantChat meetingId={meetingId} />
    </MemoryRouter>,
  );
}

const baseMeetingAgentState = {
  meetingId: null,
  messages: [] as unknown[],
  streaming: false,
  streamingText: '',
  toolEvents: [] as unknown[],
  loading: false,
  error: null,
  load: vi.fn().mockResolvedValue(undefined),
  send: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  reset: vi.fn(),
};

const enabledProvider = {
  id: 'p1',
  name: 'ollama' as const,
  displayName: null,
  enabled: true,
  hasApiKey: false,
  baseUrl: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const baseSettingsState = {
  providers: [enabledProvider],
  settings: {},
  loading: false,
  error: null,
  connectionTests: {},
  encryptionAvailable: true,
  loadProviders: vi.fn().mockResolvedValue(undefined),
  hasAnyEnabledProvider: vi.fn().mockReturnValue(true),
};

describe('LiveAssistantChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMeetingAgentStore.setState({ ...baseMeetingAgentState } as never);
    useSettingsStore.setState({ ...baseSettingsState } as never);
  });

  it('renders the 3 starter prompts when the thread is empty', () => {
    renderChat();
    expect(screen.getByText('Summarize the meeting so far')).toBeInTheDocument();
    expect(screen.getByText('What questions are still open?')).toBeInTheDocument();
    expect(screen.getByText('Create a card for that last point')).toBeInTheDocument();
  });

  it('sends a starter prompt for the active meeting when clicked', () => {
    const send = vi.fn().mockResolvedValue(undefined);
    useMeetingAgentStore.setState({ send } as never);
    renderChat('meeting-42');

    fireEvent.click(screen.getByText('Summarize the meeting so far'));

    expect(send).toHaveBeenCalledWith('meeting-42', 'Summarize the meeting so far');
  });

  it('renders persisted user and assistant messages via ChatMessageModern', () => {
    useMeetingAgentStore.setState({
      messages: [
        {
          id: 'm1',
          threadId: 't1',
          role: 'user',
          content: 'Summarize please',
          toolCalls: null,
          toolResults: null,
          createdAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'm2',
          threadId: 't1',
          role: 'assistant',
          content: 'Here is the summary.',
          toolCalls: null,
          toolResults: null,
          createdAt: '2026-01-01T00:00:05Z',
        },
      ],
    } as never);

    renderChat();

    expect(screen.getByText('Summarize please')).toBeInTheDocument();
    expect(screen.getByText('Here is the summary.')).toBeInTheDocument();
  });

  it('renders the streaming text buffer while a response is in flight', () => {
    useMeetingAgentStore.setState({ streaming: true, streamingText: 'Partial answer in progress' } as never);
    renderChat();
    expect(screen.getByText('Partial answer in progress')).toBeInTheDocument();
  });

  it('shows a "Thinking..." indicator while streaming before any text has arrived', () => {
    useMeetingAgentStore.setState({ streaming: true, streamingText: '' } as never);
    renderChat();
    expect(screen.getByText('Thinking...')).toBeInTheDocument();
  });

  it('renders a human-readable tool-call badge for a persisted createCardInInbox call', () => {
    useMeetingAgentStore.setState({
      messages: [
        {
          id: 'm1',
          threadId: 't1',
          role: 'assistant',
          content: null,
          toolCalls: [{ id: 'call-1', name: 'createCardInInbox', args: { title: 'Follow up with design' } }],
          toolResults: [{ toolCallId: 'call-1', toolName: 'createCardInInbox', result: { success: true } }],
          createdAt: '2026-01-01T00:00:05Z',
        },
      ],
    } as never);

    renderChat();

    expect(screen.getByText('Created card: "Follow up with design"')).toBeInTheDocument();
  });

  it('renders past-tense tool badges for searchTranscript, getTranscriptWindow, and getMeetingContext', () => {
    useMeetingAgentStore.setState({
      messages: [
        {
          id: 'm1',
          threadId: 't1',
          role: 'assistant',
          content: 'Done.',
          toolCalls: [
            { id: 'c1', name: 'searchTranscript', args: { query: 'budget' } },
            { id: 'c2', name: 'getTranscriptWindow', args: {} },
            { id: 'c3', name: 'getMeetingContext', args: {} },
          ],
          toolResults: null,
          createdAt: '2026-01-01T00:00:05Z',
        },
      ],
    } as never);

    renderChat();

    expect(screen.getByText('Searched transcript')).toBeInTheDocument();
    expect(screen.getByText('Read transcript window')).toBeInTheDocument();
    expect(screen.getByText('Loaded meeting context')).toBeInTheDocument();
  });

  it('renders a live in-progress tool badge while streaming', () => {
    useMeetingAgentStore.setState({
      streaming: true,
      streamingText: '',
      toolEvents: [{ toolName: 'searchTranscript', type: 'call', args: { query: 'budget' } }],
    } as never);

    renderChat();

    expect(screen.getByText('Searching transcript…')).toBeInTheDocument();
  });

  it('shows the stop button while streaming and stops the active meeting on click', () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    useMeetingAgentStore.setState({ streaming: true, stop } as never);
    renderChat('meeting-9');

    fireEvent.click(screen.getByRole('button', { name: 'Stop generating' }));

    expect(stop).toHaveBeenCalledWith('meeting-9');
  });

  it('shows a disabled empty state with a Settings link when no AI provider is configured', () => {
    useSettingsStore.setState({ providers: [], hasAnyEnabledProvider: vi.fn().mockReturnValue(false) } as never);

    renderChat();

    expect(screen.getByText('No AI provider configured')).toBeInTheDocument();
    expect(screen.getByText(/Configure an AI provider in Settings to use the Live Assistant\./)).toBeInTheDocument();
    const settingsLink = screen.getByText('Open Settings');
    expect(settingsLink).toBeInTheDocument();
    // Should not throw when clicked, even without a matched route.
    fireEvent.click(settingsLink);
  });

  it('shows a loading skeleton while the thread is loading', () => {
    useMeetingAgentStore.setState({ loading: true } as never);
    const { container } = renderChat();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });
});
