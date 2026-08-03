// === FILE PURPOSE ===
// IPC behavior tests for the Live Assistant (meeting-agent:*, LIVE.1 Phase A).
// Mocks the service layer + `streamText` so no real model is required. Verifies:
// auto-create-thread + message persistence, the text-delta/tool-call/tool-result/done
// event sequence, `load` returning history, and `stop` aborting an in-flight stream
// (both the "partial results kept" and "no output at all" abort paths) plus a hard
// stream error emitting `meeting-agent:error` and rejecting. Also proves the V3.3
// Task 2 orchestration wiring: `send` runs SYSTEM_PROMPT through
// meetingAgentService.buildLiveAssistantSystemPrompt and forwards the result
// (unchanged, by default mock, or profile-augmented) to streamText's `system`.
// MEET-GROUND.1 Task 1 adds the Q&A grounding contract: the meeting's own brief
// is appended LAST to the system prompt in Q&A mode (never in live mode, where
// `system` stays byte-identical to SYSTEM_PROMPT), and an answer that provably
// read nothing — Q&A + not aborted + zero tool calls + no brief injected — is
// persisted as NO_GROUNDING_REFUSAL instead of the streamed text, with all four
// negative cases asserted.
// MEET-GROUND.1 Task 2 adds the history-replay contract: `toModelMessages`
// (unit-tested directly below) turns persisted tool calls/results back into
// SDK message parts instead of flattening them to text, so a follow-up turn
// sees what an earlier turn searched and found. Only tool calls with a
// MATCHING result are replayed — an orphaned call degrades its row to
// text-only — and one wiring test proves `send` passes the replayed (not
// flattened) history to streamText.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const VALID_MEETING_ID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_MEETING_ID_2 = '660e8400-e29b-41d4-a716-446655440000';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports
// ---------------------------------------------------------------------------

const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
      registeredHandlers.set(channel, fn);
    }),
  },
}));

vi.mock('ai', () => ({
  streamText: vi.fn(),
  stepCountIs: vi.fn(() => 5),
}));

vi.mock('../../services/meetingAgentService', () => ({
  getOrCreateThread: vi.fn(),
  addMessage: vi.fn(),
  getThreadMessages: vi.fn(),
  getMessagesForMeeting: vi.fn(),
  createMeetingAgentTools: vi.fn(() => ({ live: true })),
  // Post-meeting Q&A (BRAIN-UX.1 Task 5). Default mode is 'live' so every
  // pre-existing test exercises the unchanged recording path.
  createMeetingQaTools: vi.fn(() => ({ qa: true })),
  getMeetingAgentMode: vi.fn(() => Promise.resolve('live')),
  QA_SYSTEM_PROMPT: 'QA_SYSTEM_PROMPT_FIXTURE',
  // MEET-GROUND.1: default "no brief yet" — the state the reported incident
  // happened in. Tests that want grounding opt in explicitly.
  buildMeetingGroundingBlock: vi.fn(() => Promise.resolve(null)),
  // Default: identity passthrough (no profile) — matches production behavior when
  // no digital-twin profile exists, so existing tests stay byte-identical without
  // each one needing to configure this mock.
  buildLiveAssistantSystemPrompt: vi.fn((base: string) => Promise.resolve(base)),
}));

vi.mock('../../services/ai-provider', () => ({
  resolveTaskModel: vi.fn(),
  getProvider: vi.fn(),
  logUsage: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { registerMeetingAgentHandlers, SYSTEM_PROMPT, NO_GROUNDING_REFUSAL, toModelMessages } from '../meeting-agent';
import { streamText } from 'ai';
import * as meetingAgentService from '../../services/meetingAgentService';
import { resolveTaskModel, getProvider, logUsage } from '../../services/ai-provider';
import type { MeetingAgentMessage } from '../../../shared/types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Stand-in for meetingAgentService.buildMeetingGroundingBlock's output — the
 *  block is built and unit-tested in the service; here only its wiring matters. */
const GROUNDING_BLOCK = '## This meeting (ground truth)\nTitle: HR Goals\nProject: People\nBrief:\nWe set Q3 goals.';

function makeFakeEvent() {
  return { sender: { send: vi.fn() } };
}

function makeThread(meetingId: string) {
  return {
    id: `thread-${meetingId}`,
    meetingId,
    archivedAt: null, // null = the current thread; archived ones are read-only history
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** Build a streamText mock return value from a plain array of fullStream parts. */
function makeStreamResult(
  parts: Array<Record<string, unknown>>,
  usage: { inputTokens: number; outputTokens: number; totalTokens: number } = {
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
  },
) {
  return {
    fullStream: (async function* () {
      for (const part of parts) yield part;
    })(),
    usage: Promise.resolve(usage),
  };
}

function setupHappyMocks(meetingId: string) {
  const thread = makeThread(meetingId);
  vi.mocked(meetingAgentService.getOrCreateThread).mockResolvedValue(thread);
  vi.mocked(meetingAgentService.getThreadMessages).mockResolvedValue([]);
  vi.mocked(meetingAgentService.addMessage).mockImplementation(
    async (threadId, role, content, toolCalls, toolResults) =>
      ({
        id: `msg-${role}-${Math.random()}`,
        threadId,
        role,
        content,
        toolCalls: toolCalls ?? null,
        toolResults: toolResults ?? null,
        createdAt: new Date().toISOString(),
      }) as never,
  );
  vi.mocked(resolveTaskModel).mockResolvedValue({
    providerId: 'provider-1',
    providerName: 'lmstudio',
    apiKeyEncrypted: null,
    baseUrl: 'http://localhost:1234',
    model: 'local-model',
    temperature: 0.7,
    maxTokens: 2048,
  } as never);
  vi.mocked(getProvider).mockReturnValue(((model: string) => ({ modelId: model })) as never);
  vi.mocked(logUsage).mockResolvedValue(undefined);
  return thread;
}

beforeAll(() => {
  registerMeetingAgentHandlers();
});

beforeEach(() => {
  vi.clearAllMocks();
  // Default every test to the live (recording) path — a test that overrides the
  // mode with mockResolvedValue would otherwise leak it into later tests.
  vi.mocked(meetingAgentService.getMeetingAgentMode).mockResolvedValue('live');
  // Same for grounding: default to "no brief exists yet" (MEET-GROUND.1).
  vi.mocked(meetingAgentService.buildMeetingGroundingBlock).mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// meeting-agent:send
// ---------------------------------------------------------------------------

describe('meeting-agent:send', () => {
  it('auto-creates the thread, persists user + assistant messages, and emits the event sequence', async () => {
    const thread = setupHappyMocks(VALID_MEETING_ID);
    vi.mocked(streamText).mockReturnValue(
      makeStreamResult([
        { type: 'text-delta', text: 'Sure, ' },
        { type: 'text-delta', text: 'creating that now.' },
        { type: 'tool-call', toolName: 'createCardInInbox', toolCallId: 'call-1', input: { title: 'Follow up' } },
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'createCardInInbox',
          output: { success: true, cardId: 'card-1' },
        },
      ]) as never,
    );

    const handler = registeredHandlers.get('meeting-agent:send')!;
    const event = makeFakeEvent();
    const result = (await handler(event, VALID_MEETING_ID, 'Create a follow-up card')) as {
      assistantMessage: { role: string; content: string | null };
      threadId: string;
    };

    // Thread auto-created, both messages persisted
    expect(meetingAgentService.getOrCreateThread).toHaveBeenCalledWith(VALID_MEETING_ID);
    expect(meetingAgentService.addMessage).toHaveBeenNthCalledWith(1, thread.id, 'user', 'Create a follow-up card');
    expect(meetingAgentService.addMessage).toHaveBeenNthCalledWith(
      2,
      thread.id,
      'assistant',
      'Sure, creating that now.',
      [{ id: 'call-1', name: 'createCardInInbox', args: { title: 'Follow up' } }],
      [{ toolCallId: 'call-1', toolName: 'createCardInInbox', result: { success: true, cardId: 'card-1' } }],
    );

    // Event sequence sent to the renderer, in order
    const channels = event.sender.send.mock.calls.map((c) => c[0]);
    expect(channels).toEqual([
      'meeting-agent:text-delta',
      'meeting-agent:text-delta',
      'meeting-agent:tool-call',
      'meeting-agent:tool-result',
      'meeting-agent:done',
    ]);

    const doneCall = event.sender.send.mock.calls.find((c) => c[0] === 'meeting-agent:done')!;
    expect(doneCall[1]).toEqual({ assistantMessage: result.assistantMessage, threadId: thread.id });
    expect(result.threadId).toBe(thread.id);
    expect(result.assistantMessage.content).toBe('Sure, creating that now.');

    // Usage logged for the live_assistant task type
    expect(logUsage).toHaveBeenCalledWith('provider-1', 'local-model', 'live_assistant', {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });
  });

  it('throws when no AI provider is configured for live_assistant', async () => {
    setupHappyMocks(VALID_MEETING_ID);
    vi.mocked(resolveTaskModel).mockResolvedValue(null);

    const handler = registeredHandlers.get('meeting-agent:send')!;
    await expect(handler(makeFakeEvent(), VALID_MEETING_ID, 'hi')).rejects.toThrow(/No AI provider configured/);
  });

  it('rejects a non-UUID meetingId', async () => {
    const handler = registeredHandlers.get('meeting-agent:send')!;
    await expect(handler(makeFakeEvent(), 'not-a-uuid', 'hi')).rejects.toThrow(/Validation failed/);
  });

  it('rejects empty content', async () => {
    const handler = registeredHandlers.get('meeting-agent:send')!;
    await expect(handler(makeFakeEvent(), VALID_MEETING_ID, '')).rejects.toThrow(/Validation failed/);
  });

  it('emits meeting-agent:error and rejects on a hard stream failure, without saving an assistant message', async () => {
    setupHappyMocks(VALID_MEETING_ID);
    vi.mocked(streamText).mockReturnValue({
      // eslint-disable-next-line require-yield -- deliberately throws before any yield to simulate a hard stream failure
      fullStream: (async function* () {
        throw new Error('model unreachable');
      })(),
      usage: Promise.resolve({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
    } as never);

    const handler = registeredHandlers.get('meeting-agent:send')!;
    const event = makeFakeEvent();

    await expect(handler(event, VALID_MEETING_ID, 'hi')).rejects.toThrow('model unreachable');

    // Only the user message was persisted — no assistant message on hard failure
    expect(meetingAgentService.addMessage).toHaveBeenCalledTimes(1);
    expect(meetingAgentService.addMessage).toHaveBeenCalledWith(expect.any(String), 'user', 'hi');

    const errorCall = event.sender.send.mock.calls.find((c) => c[0] === 'meeting-agent:error');
    expect(errorCall).toBeTruthy();
    expect(errorCall![1]).toMatchObject({ meetingId: VALID_MEETING_ID, error: 'model unreachable' });
    expect(event.sender.send.mock.calls.some((c) => c[0] === 'meeting-agent:done')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// meeting-agent:send — digital-twin profile injection wiring (V3.3 Task 2)
// ---------------------------------------------------------------------------

describe('meeting-agent:send — twin profile injection wiring', () => {
  it('runs SYSTEM_PROMPT through buildLiveAssistantSystemPrompt and forwards it to streamText unchanged when no profile exists (regression guard)', async () => {
    setupHappyMocks(VALID_MEETING_ID);
    vi.mocked(streamText).mockReturnValue(makeStreamResult([{ type: 'text-delta', text: 'hi' }]) as never);

    const handler = registeredHandlers.get('meeting-agent:send')!;
    await handler(makeFakeEvent(), VALID_MEETING_ID, 'hello');

    expect(meetingAgentService.buildLiveAssistantSystemPrompt).toHaveBeenCalledWith(SYSTEM_PROMPT);
    const streamArg = vi.mocked(streamText).mock.calls[0][0] as { system: string };
    // Default mock is an identity passthrough — proves streamText's `system` is
    // byte-identical to the base SYSTEM_PROMPT when no profile is injected.
    expect(streamArg.system).toBe(SYSTEM_PROMPT);
  });

  it('forwards the profile-augmented prompt to streamText when a profile block is injected', async () => {
    setupHappyMocks(VALID_MEETING_ID);
    const augmented = `User profile (the professional you assist):\n\nIdentity: Dana, PM\n\n${SYSTEM_PROMPT}`;
    vi.mocked(meetingAgentService.buildLiveAssistantSystemPrompt).mockResolvedValueOnce(augmented);
    vi.mocked(streamText).mockReturnValue(makeStreamResult([{ type: 'text-delta', text: 'hi' }]) as never);

    const handler = registeredHandlers.get('meeting-agent:send')!;
    await handler(makeFakeEvent(), VALID_MEETING_ID, 'hello');

    const streamArg = vi.mocked(streamText).mock.calls[0][0] as { system: string };
    expect(streamArg.system).toBe(augmented);
  });
});

// ---------------------------------------------------------------------------
// meeting-agent:send — status-gated toolset (BRAIN-UX.1 Task 5)
// ---------------------------------------------------------------------------

describe('meeting-agent:send — post-meeting Q&A branch', () => {
  it('uses the live toolset and SYSTEM_PROMPT while the meeting is still recording (byte-identical to the pre-Q&A path)', async () => {
    setupHappyMocks(VALID_MEETING_ID);
    vi.mocked(meetingAgentService.getMeetingAgentMode).mockResolvedValue('live');
    vi.mocked(streamText).mockReturnValue(makeStreamResult([{ type: 'text-delta', text: 'hi' }]) as never);

    const handler = registeredHandlers.get('meeting-agent:send')!;
    await handler(makeFakeEvent(), VALID_MEETING_ID, 'hello');

    expect(meetingAgentService.createMeetingAgentTools).toHaveBeenCalledWith(VALID_MEETING_ID);
    expect(meetingAgentService.createMeetingQaTools).not.toHaveBeenCalled();

    const streamArg = vi.mocked(streamText).mock.calls[0][0] as { system: string; tools: unknown };
    expect(streamArg.tools).toEqual({ live: true });
    expect(meetingAgentService.buildLiveAssistantSystemPrompt).toHaveBeenCalledWith(SYSTEM_PROMPT);
    expect(streamArg.system).toBe(SYSTEM_PROMPT);
  });

  it('switches to the read-only Q&A toolset and QA_SYSTEM_PROMPT once the meeting is completed', async () => {
    setupHappyMocks(VALID_MEETING_ID);
    vi.mocked(meetingAgentService.getMeetingAgentMode).mockResolvedValue('qa');
    vi.mocked(streamText).mockReturnValue(makeStreamResult([{ type: 'text-delta', text: 'hi' }]) as never);

    const handler = registeredHandlers.get('meeting-agent:send')!;
    await handler(makeFakeEvent(), VALID_MEETING_ID, 'what did we decide?');

    expect(meetingAgentService.createMeetingQaTools).toHaveBeenCalledWith(VALID_MEETING_ID);
    expect(meetingAgentService.createMeetingAgentTools).not.toHaveBeenCalled();

    const streamArg = vi.mocked(streamText).mock.calls[0][0] as { system: string; tools: unknown };
    expect(streamArg.tools).toEqual({ qa: true });
    expect(meetingAgentService.buildLiveAssistantSystemPrompt).toHaveBeenCalledWith(
      meetingAgentService.QA_SYSTEM_PROMPT,
    );
    expect(streamArg.system).toBe(meetingAgentService.QA_SYSTEM_PROMPT);
  });

  it('keeps the same thread, persistence, and streaming events in Q&A mode (no new channel)', async () => {
    const thread = setupHappyMocks(VALID_MEETING_ID);
    vi.mocked(meetingAgentService.getMeetingAgentMode).mockResolvedValue('qa');
    // Grounded by an injected brief, so the answer is kept as streamed — the
    // zero-grounding refusal (MEET-GROUND.1) is asserted separately below.
    vi.mocked(meetingAgentService.buildMeetingGroundingBlock).mockResolvedValue(GROUNDING_BLOCK);
    vi.mocked(streamText).mockReturnValue(
      makeStreamResult([
        { type: 'text-delta', text: 'You decided ' },
        { type: 'text-delta', text: 'to use Postgres [12:04].' },
      ]) as never,
    );

    const handler = registeredHandlers.get('meeting-agent:send')!;
    const event = makeFakeEvent();
    const result = (await handler(event, VALID_MEETING_ID, 'what did we decide?')) as {
      assistantMessage: { content: string | null };
      threadId: string;
    };

    expect(meetingAgentService.getOrCreateThread).toHaveBeenCalledWith(VALID_MEETING_ID);
    expect(result.threadId).toBe(thread.id);
    expect(result.assistantMessage.content).toBe('You decided to use Postgres [12:04].');
    expect(event.sender.send.mock.calls.map((c) => c[0])).toEqual([
      'meeting-agent:text-delta',
      'meeting-agent:text-delta',
      'meeting-agent:done',
    ]);
  });
});

// ---------------------------------------------------------------------------
// meeting-agent:send — deterministic Q&A grounding (MEET-GROUND.1 Task 1)
// ---------------------------------------------------------------------------

/** The `system` string streamText was called with on the most recent send. */
function lastSystemPrompt(): string {
  const calls = vi.mocked(streamText).mock.calls;
  return (calls[calls.length - 1][0] as { system: string }).system;
}

describe('meeting-agent:send — Q&A grounding injection', () => {
  it("appends the meeting's grounding block AFTER the base prompt in Q&A mode", async () => {
    setupHappyMocks(VALID_MEETING_ID);
    vi.mocked(meetingAgentService.getMeetingAgentMode).mockResolvedValue('qa');
    vi.mocked(meetingAgentService.buildMeetingGroundingBlock).mockResolvedValue(GROUNDING_BLOCK);
    vi.mocked(streamText).mockReturnValue(makeStreamResult([{ type: 'text-delta', text: 'hi' }]) as never);

    const handler = registeredHandlers.get('meeting-agent:send')!;
    await handler(makeFakeEvent(), VALID_MEETING_ID, 'summarize this meeting');

    expect(meetingAgentService.buildMeetingGroundingBlock).toHaveBeenCalledWith(VALID_MEETING_ID);
    // Recency: the meeting block is the LAST and most specific thing in the prompt.
    expect(lastSystemPrompt()).toBe(`${meetingAgentService.QA_SYSTEM_PROMPT}\n\n${GROUNDING_BLOCK}`);
  });

  it('keeps the meeting block last, after the twin-profile block', async () => {
    setupHappyMocks(VALID_MEETING_ID);
    const profileAugmented = `User profile (the professional you assist):\n\nIdentity: Dana, PM\n\nQA_SYSTEM_PROMPT_FIXTURE`;
    vi.mocked(meetingAgentService.getMeetingAgentMode).mockResolvedValue('qa');
    vi.mocked(meetingAgentService.buildLiveAssistantSystemPrompt).mockResolvedValueOnce(profileAugmented);
    vi.mocked(meetingAgentService.buildMeetingGroundingBlock).mockResolvedValue(GROUNDING_BLOCK);
    vi.mocked(streamText).mockReturnValue(makeStreamResult([{ type: 'text-delta', text: 'hi' }]) as never);

    const handler = registeredHandlers.get('meeting-agent:send')!;
    await handler(makeFakeEvent(), VALID_MEETING_ID, 'summarize this meeting');

    expect(lastSystemPrompt()).toBe(`${profileAugmented}\n\n${GROUNDING_BLOCK}`);
  });

  it('leaves the Q&A prompt byte-identical when the meeting has no brief yet', async () => {
    setupHappyMocks(VALID_MEETING_ID);
    vi.mocked(meetingAgentService.getMeetingAgentMode).mockResolvedValue('qa');
    vi.mocked(streamText).mockReturnValue(
      makeStreamResult([
        { type: 'tool-call', toolName: 'searchTranscript', toolCallId: 'c1', input: { query: 'goals' } },
        { type: 'text-delta', text: 'hi' },
      ]) as never,
    );

    const handler = registeredHandlers.get('meeting-agent:send')!;
    await handler(makeFakeEvent(), VALID_MEETING_ID, 'what did we decide?');

    expect(lastSystemPrompt()).toBe(meetingAgentService.QA_SYSTEM_PROMPT);
  });

  it('never grounds or alters the system prompt in live mode (byte-identical to SYSTEM_PROMPT)', async () => {
    setupHappyMocks(VALID_MEETING_ID);
    vi.mocked(meetingAgentService.getMeetingAgentMode).mockResolvedValue('live');
    // Even with a brief available, live mode must not look it up or inject it.
    vi.mocked(meetingAgentService.buildMeetingGroundingBlock).mockResolvedValue(GROUNDING_BLOCK);
    vi.mocked(streamText).mockReturnValue(makeStreamResult([{ type: 'text-delta', text: 'hi' }]) as never);

    const handler = registeredHandlers.get('meeting-agent:send')!;
    await handler(makeFakeEvent(), VALID_MEETING_ID, 'hello');

    expect(meetingAgentService.buildMeetingGroundingBlock).not.toHaveBeenCalled();
    expect(lastSystemPrompt()).toBe(SYSTEM_PROMPT);
  });
});

// ---------------------------------------------------------------------------
// meeting-agent:send — deterministic zero-grounding refusal (MEET-GROUND.1)
// ---------------------------------------------------------------------------

describe('meeting-agent:send — zero-grounding refusal', () => {
  /** Stream one plain answer with no tool call — the shape of the reported incident. */
  function mockUngroundedAnswer(text = 'Here is a confident four-point summary.') {
    vi.mocked(streamText).mockReturnValue(makeStreamResult([{ type: 'text-delta', text }]) as never);
  }

  it('replaces a Q&A answer that read nothing (no brief, no tool call) with the refusal', async () => {
    const thread = setupHappyMocks(VALID_MEETING_ID);
    vi.mocked(meetingAgentService.getMeetingAgentMode).mockResolvedValue('qa');
    mockUngroundedAnswer();

    const handler = registeredHandlers.get('meeting-agent:send')!;
    const event = makeFakeEvent();
    const result = (await handler(event, VALID_MEETING_ID, 'summarize this meeting')) as {
      assistantMessage: { content: string | null };
    };

    expect(meetingAgentService.addMessage).toHaveBeenNthCalledWith(
      2,
      thread.id,
      'assistant',
      NO_GROUNDING_REFUSAL,
      undefined,
      undefined,
    );
    expect(result.assistantMessage.content).toBe(NO_GROUNDING_REFUSAL);
    // The fabricated text is never persisted — it only ever streamed by, and the
    // renderer swaps the bubble for the persisted message on done.
    expect(result.assistantMessage.content).not.toContain('four-point');
    expect(event.sender.send.mock.calls.some((c) => c[0] === 'meeting-agent:done')).toBe(true);
    // A normal assistant message, not an error.
    expect(event.sender.send.mock.calls.some((c) => c[0] === 'meeting-agent:error')).toBe(false);
  });

  it('never refuses when the brief was injected — a zero-tool answer can be grounded', async () => {
    setupHappyMocks(VALID_MEETING_ID);
    vi.mocked(meetingAgentService.getMeetingAgentMode).mockResolvedValue('qa');
    vi.mocked(meetingAgentService.buildMeetingGroundingBlock).mockResolvedValue(GROUNDING_BLOCK);
    mockUngroundedAnswer('We set Q3 goals and agreed on hiring.');

    const handler = registeredHandlers.get('meeting-agent:send')!;
    const result = (await handler(makeFakeEvent(), VALID_MEETING_ID, 'summarize this meeting')) as {
      assistantMessage: { content: string | null };
    };

    expect(result.assistantMessage.content).toBe('We set Q3 goals and agreed on hiring.');
  });

  it('never refuses in live mode, even with no brief and no tool call', async () => {
    setupHappyMocks(VALID_MEETING_ID);
    vi.mocked(meetingAgentService.getMeetingAgentMode).mockResolvedValue('live');
    mockUngroundedAnswer('Sure — what would you like me to capture?');

    const handler = registeredHandlers.get('meeting-agent:send')!;
    const result = (await handler(makeFakeEvent(), VALID_MEETING_ID, 'hello')) as {
      assistantMessage: { content: string | null };
    };

    expect(result.assistantMessage.content).toBe('Sure — what would you like me to capture?');
  });

  it('never refuses when a tool call happened', async () => {
    setupHappyMocks(VALID_MEETING_ID);
    vi.mocked(meetingAgentService.getMeetingAgentMode).mockResolvedValue('qa');
    vi.mocked(streamText).mockReturnValue(
      makeStreamResult([
        { type: 'tool-call', toolName: 'searchTranscript', toolCallId: 'c1', input: { query: 'goals' } },
        {
          type: 'tool-result',
          toolCallId: 'c1',
          toolName: 'searchTranscript',
          output: { results: [], matchCount: 0 },
        },
        { type: 'text-delta', text: 'That was not discussed [00:12].' },
      ]) as never,
    );

    const handler = registeredHandlers.get('meeting-agent:send')!;
    const result = (await handler(makeFakeEvent(), VALID_MEETING_ID, 'did we discuss goals?')) as {
      assistantMessage: { content: string | null; toolCalls: unknown };
    };

    expect(result.assistantMessage.content).toBe('That was not discussed [00:12].');
    expect(result.assistantMessage.toolCalls).toEqual([
      { id: 'c1', name: 'searchTranscript', args: { query: 'goals' } },
    ]);
  });

  it('never refuses an aborted stream — partial text the user cut short is kept', async () => {
    setupHappyMocks(VALID_MEETING_ID);
    vi.mocked(meetingAgentService.getMeetingAgentMode).mockResolvedValue('qa');
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(streamText).mockImplementation(
      (opts: unknown) =>
        (() => {
          capturedSignal = (opts as { abortSignal?: AbortSignal }).abortSignal;
          return {
            fullStream: (async function* () {
              yield { type: 'text-delta', text: 'Working on it' };
              await new Promise((resolve) => setTimeout(resolve, 20));
              if (capturedSignal?.aborted) {
                const err = new Error('The operation was aborted.');
                err.name = 'AbortError';
                throw err;
              }
              yield { type: 'text-delta', text: ' done' };
            })(),
            usage: Promise.resolve({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
          };
        })() as never,
    );

    const sendHandler = registeredHandlers.get('meeting-agent:send')!;
    const stopHandler = registeredHandlers.get('meeting-agent:stop')!;
    const sendPromise = sendHandler(makeFakeEvent(), VALID_MEETING_ID, 'summarize this meeting') as Promise<{
      assistantMessage: { content: string | null };
    }>;

    await new Promise((resolve) => setTimeout(resolve, 0));
    await stopHandler(makeFakeEvent(), VALID_MEETING_ID);
    const result = await sendPromise;

    expect(result.assistantMessage.content).toBe('Working on it');
  });
});

// ---------------------------------------------------------------------------
// toModelMessages — faithful history replay (MEET-GROUND.1 Task 2)
// ---------------------------------------------------------------------------

/** Build a MeetingAgentMessage row with sane defaults, overridden per test. */
function makeMessage(
  overrides: Partial<MeetingAgentMessage> & { role: MeetingAgentMessage['role'] },
): MeetingAgentMessage {
  return {
    id: `msg-${Math.random()}`,
    threadId: 'thread-1',
    content: null,
    toolCalls: null,
    toolResults: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('toModelMessages — faithful history replay (MEET-GROUND.1 Task 2)', () => {
  it('replays a turn with 2 tool calls + 2 matching results as assistant parts (text + 2 tool-call parts) followed by ONE tool message with json-wrapped outputs', () => {
    const row = makeMessage({
      role: 'assistant',
      content: 'Here is what I found.',
      toolCalls: [
        { id: 'call-1', name: 'searchTranscript', args: { query: 'goals' } },
        { id: 'call-2', name: 'getMeetingContext', args: {} },
      ],
      toolResults: [
        { toolCallId: 'call-1', toolName: 'searchTranscript', result: { matches: 2 } },
        { toolCallId: 'call-2', toolName: 'getMeetingContext', result: { title: 'HR Goals' } },
      ],
    });

    expect(toModelMessages([row])).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Here is what I found.' },
          { type: 'tool-call', toolCallId: 'call-1', toolName: 'searchTranscript', input: { query: 'goals' } },
          { type: 'tool-call', toolCallId: 'call-2', toolName: 'getMeetingContext', input: {} },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'searchTranscript',
            output: { type: 'json', value: { matches: 2 } },
          },
          {
            type: 'tool-result',
            toolCallId: 'call-2',
            toolName: 'getMeetingContext',
            output: { type: 'json', value: { title: 'HR Goals' } },
          },
        ],
      },
    ]);
  });

  it('maps ToolCallRecord.args to the SDK ToolCallPart\'s "input" field literally, never "args"', () => {
    const row = makeMessage({
      role: 'assistant',
      content: 'ok',
      toolCalls: [{ id: 'c1', name: 'searchTranscript', args: { query: 'pricing' } }],
      toolResults: [{ toolCallId: 'c1', toolName: 'searchTranscript', result: { matches: 0 } }],
    });

    const mapped = toModelMessages([row]);

    expect(mapped[0]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'ok' },
        { type: 'tool-call', toolCallId: 'c1', toolName: 'searchTranscript', input: { query: 'pricing' } },
      ],
    });
  });

  it('degrades a row whose only call has NO matching result to text-only, emitting no tool message', () => {
    const row = makeMessage({
      role: 'assistant',
      content: 'Let me check that.',
      toolCalls: [{ id: 'call-orphan', name: 'searchTranscript', args: { query: 'goals' } }],
      toolResults: null,
    });

    expect(toModelMessages([row])).toEqual([{ role: 'assistant', content: 'Let me check that.' }]);
  });

  it('replays only the matched call when one call is matched and one is orphaned, with only its result', () => {
    const row = makeMessage({
      role: 'assistant',
      content: 'Mixed turn.',
      toolCalls: [
        { id: 'call-matched', name: 'searchTranscript', args: { query: 'goals' } },
        { id: 'call-orphan', name: 'getMeetingContext', args: {} },
      ],
      toolResults: [{ toolCallId: 'call-matched', toolName: 'searchTranscript', result: { matches: 1 } }],
    });

    expect(toModelMessages([row])).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Mixed turn.' },
          { type: 'tool-call', toolCallId: 'call-matched', toolName: 'searchTranscript', input: { query: 'goals' } },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-matched',
            toolName: 'searchTranscript',
            output: { type: 'json', value: { matches: 1 } },
          },
        ],
      },
    ]);
  });

  it('omits the text part entirely for an empty-content assistant row with calls (no empty text part)', () => {
    const row = makeMessage({
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'call-1', name: 'searchTranscript', args: { query: 'goals' } }],
      toolResults: [{ toolCallId: 'call-1', toolName: 'searchTranscript', result: { matches: 0 } }],
    });

    const mapped = toModelMessages([row]);

    // The assistant message's content parts array has no text part at all —
    // only the tool-call part. (A trailing tool message still follows, since
    // the call has a matching result — asserted separately above.)
    expect(mapped[0]).toEqual({
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'searchTranscript', input: { query: 'goals' } }],
    });
    expect(mapped).toHaveLength(2);
  });

  it('leaves user rows and tool-free assistant rows mapped to plain string content, unchanged', () => {
    const rows = [
      makeMessage({ role: 'user', content: 'hello' }),
      makeMessage({ role: 'assistant', content: 'hi there' }),
      makeMessage({ role: 'user', content: null }),
    ];

    expect(toModelMessages(rows)).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
      { role: 'user', content: '' },
    ]);
  });

  it('skips persisted role:"tool" rows entirely', () => {
    const rows = [
      makeMessage({ role: 'user', content: 'hi' }),
      makeMessage({ role: 'tool', content: 'stray tool row' }),
      makeMessage({ role: 'assistant', content: 'hello back' }),
    ];

    expect(toModelMessages(rows)).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello back' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// meeting-agent:send — history replay wiring (MEET-GROUND.1 Task 2)
// ---------------------------------------------------------------------------

describe('meeting-agent:send — history replay wiring', () => {
  it("passes the faithfully-replayed history (not flattened) as streamText's `messages`", async () => {
    setupHappyMocks(VALID_MEETING_ID);
    const priorTurn = [
      makeMessage({ id: 'm1', role: 'user', content: 'search for pricing' }),
      makeMessage({
        id: 'm2',
        role: 'assistant',
        content: 'Found it.',
        toolCalls: [{ id: 'call-1', name: 'searchTranscript', args: { query: 'pricing' } }],
        toolResults: [{ toolCallId: 'call-1', toolName: 'searchTranscript', result: { matches: 1 } }],
      }),
    ];
    vi.mocked(meetingAgentService.getThreadMessages).mockResolvedValue(priorTurn);
    vi.mocked(streamText).mockReturnValue(makeStreamResult([{ type: 'text-delta', text: 'ok' }]) as never);

    const handler = registeredHandlers.get('meeting-agent:send')!;
    await handler(makeFakeEvent(), VALID_MEETING_ID, 'what did you find?');

    const streamArg = vi.mocked(streamText).mock.calls[0][0] as { messages: unknown };
    expect(streamArg.messages).toEqual(toModelMessages(priorTurn));
    expect(streamArg.messages).toEqual([
      { role: 'user', content: 'search for pricing' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Found it.' },
          { type: 'tool-call', toolCallId: 'call-1', toolName: 'searchTranscript', input: { query: 'pricing' } },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'searchTranscript',
            output: { type: 'json', value: { matches: 1 } },
          },
        ],
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// meeting-agent:load
// ---------------------------------------------------------------------------

describe('meeting-agent:load', () => {
  it("returns the meeting's message history", async () => {
    const messages = [
      { id: 'm1', threadId: 't1', role: 'user', content: 'hi', toolCalls: null, toolResults: null, createdAt: 'x' },
    ];
    vi.mocked(meetingAgentService.getMessagesForMeeting).mockResolvedValue(messages as never);

    const handler = registeredHandlers.get('meeting-agent:load')!;
    const result = await handler(makeFakeEvent(), VALID_MEETING_ID);

    expect(meetingAgentService.getMessagesForMeeting).toHaveBeenCalledWith(VALID_MEETING_ID);
    expect(result).toBe(messages);
  });

  it('returns an empty array when no thread exists yet', async () => {
    vi.mocked(meetingAgentService.getMessagesForMeeting).mockResolvedValue([]);

    const handler = registeredHandlers.get('meeting-agent:load')!;
    const result = await handler(makeFakeEvent(), VALID_MEETING_ID);

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// meeting-agent:stop
// ---------------------------------------------------------------------------

describe('meeting-agent:stop', () => {
  it('is a no-op when there is no active stream for that meeting', async () => {
    const handler = registeredHandlers.get('meeting-agent:stop')!;
    await expect(handler(makeFakeEvent(), VALID_MEETING_ID)).resolves.toBeUndefined();
  });

  it('aborts an in-flight stream, keeping partial text/tool results and still emitting done', async () => {
    setupHappyMocks(VALID_MEETING_ID_2);
    let capturedSignal: AbortSignal | undefined;

    vi.mocked(streamText).mockImplementation(
      (opts: unknown) =>
        (() => {
          capturedSignal = (opts as { abortSignal?: AbortSignal }).abortSignal;
          return {
            fullStream: (async function* () {
              yield { type: 'text-delta', text: 'Working on it' };
              await new Promise((resolve) => setTimeout(resolve, 20));
              if (capturedSignal?.aborted) {
                const err = new Error('The operation was aborted.');
                err.name = 'AbortError';
                throw err;
              }
              yield { type: 'text-delta', text: ' done' };
            })(),
            usage: Promise.resolve({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
          };
        })() as never,
    );

    const sendHandler = registeredHandlers.get('meeting-agent:send')!;
    const stopHandler = registeredHandlers.get('meeting-agent:stop')!;
    const event = makeFakeEvent();

    const sendPromise = sendHandler(event, VALID_MEETING_ID_2, 'hi') as Promise<{
      assistantMessage: { content: string | null };
      threadId: string;
    } | null>;

    // Let the first text-delta land, then request stop before the stream resumes.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await stopHandler(makeFakeEvent(), VALID_MEETING_ID_2);

    const result = await sendPromise;

    expect(result).not.toBeNull();
    expect(result!.assistantMessage.content).toBe('Working on it');
    expect(event.sender.send.mock.calls.some((c) => c[0] === 'meeting-agent:done')).toBe(true);
    expect(event.sender.send.mock.calls.some((c) => c[0] === 'meeting-agent:error')).toBe(false);
    // Second stream chunk (' done') never arrives — abort cut the stream short
    expect(result!.assistantMessage.content).not.toContain('done');
  });

  it('returns null and skips persistence when aborted before any output was produced', async () => {
    setupHappyMocks(VALID_MEETING_ID);
    let capturedSignal: AbortSignal | undefined;

    vi.mocked(streamText).mockImplementation(
      (opts: unknown) =>
        (() => {
          capturedSignal = (opts as { abortSignal?: AbortSignal }).abortSignal;
          return {
            fullStream: (async function* () {
              await new Promise((resolve) => setTimeout(resolve, 20));
              if (capturedSignal?.aborted) {
                const err = new Error('The operation was aborted.');
                err.name = 'AbortError';
                throw err;
              }
              yield { type: 'text-delta', text: 'should not appear' };
            })(),
            usage: Promise.resolve({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
          };
        })() as never,
    );

    const sendHandler = registeredHandlers.get('meeting-agent:send')!;
    const stopHandler = registeredHandlers.get('meeting-agent:stop')!;
    const event = makeFakeEvent();

    const sendPromise = sendHandler(event, VALID_MEETING_ID, 'hi');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await stopHandler(makeFakeEvent(), VALID_MEETING_ID);

    const result = await sendPromise;

    expect(result).toBeNull();
    // Only the user message was persisted — no assistant message when nothing was produced
    expect(meetingAgentService.addMessage).toHaveBeenCalledTimes(1);
    expect(event.sender.send.mock.calls.some((c) => c[0] === 'meeting-agent:done')).toBe(false);
    expect(event.sender.send.mock.calls.some((c) => c[0] === 'meeting-agent:error')).toBe(false);
  });
});
