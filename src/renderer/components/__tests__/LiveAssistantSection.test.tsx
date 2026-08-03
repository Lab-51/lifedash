// @vitest-environment jsdom
// BRAIN-UX.1 Task 5 — the post-meeting assistant chat. Continues the SAME
// per-meeting thread the Live Assistant used while recording (live-phase history
// stays visible), sends over the existing meetingAgentSend bridge, renders the
// streamed reply, disables the input while streaming, cleans its listeners up on
// unmount, and turns the no-model failure into copy the user can act on.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { MeetingAgentMessage } from '../../../shared/types';

if (typeof Element.prototype.scrollIntoView === 'undefined') {
  Element.prototype.scrollIntoView = vi.fn();
}

type DeltaHandler = (data: { meetingId: string; threadId: string; chunk: string }) => void;
type ErrorHandler = (data: { meetingId: string; threadId: string; error: string }) => void;

const meetingAgentLoad = vi.fn();
const meetingAgentSend = vi.fn();
const meetingAgentStop = vi.fn();

const deltaHandlers: DeltaHandler[] = [];
const errorHandlers: ErrorHandler[] = [];
const unsubscribes = {
  delta: vi.fn(),
  toolCall: vi.fn(),
  error: vi.fn(),
};

vi.stubGlobal('electronAPI', {
  meetingAgentLoad,
  meetingAgentSend,
  meetingAgentStop,
  onMeetingAgentTextDelta: vi.fn((cb: DeltaHandler) => {
    deltaHandlers.push(cb);
    return unsubscribes.delta;
  }),
  onMeetingAgentToolCall: vi.fn(() => unsubscribes.toolCall),
  onMeetingAgentError: vi.fn((cb: ErrorHandler) => {
    errorHandlers.push(cb);
    return unsubscribes.error;
  }),
});

const { default: LiveAssistantSection } = await import('../meeting-detail/LiveAssistantSection');

function makeMessage(overrides: Partial<MeetingAgentMessage> = {}): MeetingAgentMessage {
  return {
    id: 'm1',
    threadId: 't1',
    role: 'user',
    content: 'What did we say about pricing?',
    toolCalls: null,
    toolResults: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/** Type a question and press the send button. */
function ask(text: string) {
  fireEvent.change(screen.getByLabelText('Ask about this meeting'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
}

describe('LiveAssistantSection (post-meeting Q&A chat)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deltaHandlers.length = 0;
    errorHandlers.length = 0;
    meetingAgentLoad.mockResolvedValue([]);
    meetingAgentSend.mockResolvedValue(null);
  });

  it('invites the first question when the thread is empty', async () => {
    render(<LiveAssistantSection meetingId="meeting-1" />);

    await waitFor(() => expect(meetingAgentLoad).toHaveBeenCalledWith('meeting-1'));
    expect(screen.getByText('Ask anything about this meeting')).toBeInTheDocument();
    expect(screen.getByLabelText('Ask about this meeting')).toBeInTheDocument();
  });

  it('keeps the live-phase conversation visible (one continuum) with its tool badges', async () => {
    meetingAgentLoad.mockResolvedValue([
      makeMessage({ id: 'm1', role: 'user', content: 'Summarize the meeting so far' }),
      makeMessage({
        id: 'm2',
        role: 'assistant',
        content: 'We covered pricing and hiring.',
        toolCalls: [{ id: 'c1', name: 'searchTranscript', args: { query: 'pricing' } }],
      }),
    ]);

    render(<LiveAssistantSection meetingId="meeting-1" />);

    expect(await screen.findByText('Summarize the meeting so far')).toBeInTheDocument();
    expect(screen.getByText('We covered pricing and hiring.')).toBeInTheDocument();
    expect(screen.getByText('Searched transcript for “pricing”')).toBeInTheDocument();
  });

  it('sends the question on the existing meeting-agent bridge and renders the streamed reply', async () => {
    let settleSend: (value: unknown) => void = () => {};
    meetingAgentSend.mockImplementation(
      () =>
        new Promise((resolve) => {
          settleSend = resolve;
        }),
    );

    render(<LiveAssistantSection meetingId="meeting-1" />);
    await waitFor(() => expect(meetingAgentLoad).toHaveBeenCalled());

    ask('What did we decide on pricing?');

    expect(meetingAgentSend).toHaveBeenCalledWith('meeting-1', 'What did we decide on pricing?');
    expect(await screen.findByText('What did we decide on pricing?')).toBeInTheDocument();

    // Streamed chunks for THIS meeting land in the in-flight bubble.
    act(() => {
      deltaHandlers.forEach((cb) => cb({ meetingId: 'meeting-1', threadId: 't1', chunk: 'We chose ' }));
      deltaHandlers.forEach((cb) => cb({ meetingId: 'meeting-1', threadId: 't1', chunk: 'tiered pricing [12:04].' }));
      // A different meeting's stream must not bleed into this section.
      deltaHandlers.forEach((cb) => cb({ meetingId: 'other-meeting', threadId: 't9', chunk: 'IGNORED' }));
    });

    expect(screen.getByText('We chose tiered pricing [12:04].')).toBeInTheDocument();
    expect(screen.queryByText(/IGNORED/)).not.toBeInTheDocument();

    // Finalized assistant message replaces the streaming bubble.
    await act(async () => {
      settleSend({
        assistantMessage: makeMessage({
          id: 'm-final',
          role: 'assistant',
          content: 'We chose tiered pricing [12:04].',
        }),
        threadId: 't1',
      });
    });

    expect(screen.getAllByText('We chose tiered pricing [12:04].')).toHaveLength(1);
    expect(unsubscribes.delta).toHaveBeenCalled();
  });

  it('disables the input while a response streams and re-enables it afterwards', async () => {
    let settleSend: (value: unknown) => void = () => {};
    meetingAgentSend.mockImplementation(
      () =>
        new Promise((resolve) => {
          settleSend = resolve;
        }),
    );

    render(<LiveAssistantSection meetingId="meeting-1" />);
    await waitFor(() => expect(meetingAgentLoad).toHaveBeenCalled());

    const input = screen.getByLabelText('Ask about this meeting');
    expect(input).not.toBeDisabled();

    ask('Who owns the follow-up?');

    await waitFor(() => expect(input).toBeDisabled());
    // Send is swapped for stop while the local model is answering.
    expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stop generating' }));
    expect(meetingAgentStop).toHaveBeenCalledWith('meeting-1');

    await act(async () => {
      settleSend(null);
    });

    expect(input).not.toBeDisabled();
  });

  it('surfaces the no-model failure with actionable copy', async () => {
    meetingAgentSend.mockRejectedValue(
      new Error(
        "Error invoking remote method 'meeting-agent:send': Error: No AI provider configured for the Live Assistant. Go to Settings to add one.",
      ),
    );

    render(<LiveAssistantSection meetingId="meeting-1" />);
    await waitFor(() => expect(meetingAgentLoad).toHaveBeenCalled());

    ask('What did we decide?');

    expect(await screen.findByText(/No AI model is assigned to the Live Assistant/)).toBeInTheDocument();
    expect(screen.getByText(/Open Settings/)).toBeInTheDocument();
    // Input is usable again so the user can retry after fixing settings.
    expect(screen.getByLabelText('Ask about this meeting')).not.toBeDisabled();
  });

  it('shows a streamed main-process error event without hanging the input', async () => {
    let settleSend: (value: unknown) => void = () => {};
    meetingAgentSend.mockImplementation(
      () =>
        new Promise((resolve) => {
          settleSend = resolve;
        }),
    );

    render(<LiveAssistantSection meetingId="meeting-1" />);
    await waitFor(() => expect(meetingAgentLoad).toHaveBeenCalled());

    ask('What did we decide?');

    act(() => {
      errorHandlers.forEach((cb) => cb({ meetingId: 'meeting-1', threadId: 't1', error: 'model unreachable' }));
    });
    await act(async () => {
      settleSend(null);
    });

    expect(screen.getByText('model unreachable')).toBeInTheDocument();
    expect(screen.getByLabelText('Ask about this meeting')).not.toBeDisabled();
  });

  it('unsubscribes from the stream listeners when unmounted mid-answer', async () => {
    meetingAgentSend.mockImplementation(() => new Promise(() => {}));

    const { unmount } = render(<LiveAssistantSection meetingId="meeting-1" />);
    await waitFor(() => expect(meetingAgentLoad).toHaveBeenCalled());

    ask('Still answering...');
    await waitFor(() => expect(meetingAgentSend).toHaveBeenCalled());

    unmount();

    expect(unsubscribes.delta).toHaveBeenCalled();
    expect(unsubscribes.toolCall).toHaveBeenCalled();
    expect(unsubscribes.error).toHaveBeenCalled();
  });

  it('canvas variant fills its flex parent instead of capping the message area at max-h-80', async () => {
    meetingAgentLoad.mockResolvedValue([]);
    const { container } = render(<LiveAssistantSection meetingId="meeting-1" variant="canvas" />);
    await waitFor(() => expect(meetingAgentLoad).toHaveBeenCalled());

    // Root stretches; the scrollable message area is flex-fill, not height-capped.
    expect(container.firstElementChild?.className).toContain('flex-1');
    const scrollArea = container.querySelector('.overflow-y-auto');
    expect(scrollArea?.className).toContain('flex-1');
    expect(scrollArea?.className).not.toContain('max-h-80');
    // Default (rail) keeps the cap — regression guard for SessionInspector's compact embed.
    const rail = render(<LiveAssistantSection meetingId="meeting-2" />);
    const railScroll = rail.container.querySelector('.overflow-y-auto');
    expect(railScroll?.className).toContain('max-h-80');
  });
});

describe('LiveAssistantSection — starter prompts', () => {
  it('offers opening moves on an empty thread and sends one on click', async () => {
    meetingAgentLoad.mockResolvedValue([]);
    render(<LiveAssistantSection meetingId="meeting-1" />);

    const chip = await screen.findByRole('button', { name: 'What tasks do I need to do?' });
    fireEvent.click(chip);

    await waitFor(() => expect(meetingAgentSend).toHaveBeenCalledWith('meeting-1', 'What tasks do I need to do?'));
  });

  it('hides the starters once the thread has messages', async () => {
    meetingAgentLoad.mockResolvedValue([makeMessage({ id: 'm1', role: 'user', content: 'hello' })]);
    render(<LiveAssistantSection meetingId="meeting-1" />);

    await screen.findByText('hello');
    expect(screen.queryByRole('button', { name: 'What tasks do I need to do?' })).not.toBeInTheDocument();
  });

  it('a starter click does not discard text the user was already typing', async () => {
    meetingAgentLoad.mockResolvedValue([]);
    render(<LiveAssistantSection meetingId="meeting-1" />);

    const input = await screen.findByPlaceholderText(/ask/i);
    fireEvent.change(input, { target: { value: 'half-written question' } });
    fireEvent.click(screen.getByRole('button', { name: 'What was decided?' }));

    await waitFor(() => expect(meetingAgentSend).toHaveBeenCalledWith('meeting-1', 'What was decided?'));
    expect(input).toHaveValue('half-written question');
  });
});
