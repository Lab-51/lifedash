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
  createMeetingAgentTools: vi.fn(() => ({})),
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

import { registerMeetingAgentHandlers, SYSTEM_PROMPT } from '../meeting-agent';
import { streamText } from 'ai';
import * as meetingAgentService from '../../services/meetingAgentService';
import { resolveTaskModel, getProvider, logUsage } from '../../services/ai-provider';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeFakeEvent() {
  return { sender: { send: vi.fn() } };
}

function makeThread(meetingId: string) {
  return {
    id: `thread-${meetingId}`,
    meetingId,
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
