// === FILE PURPOSE ===
// IPC handlers for the in-meeting "Live Assistant" (LIVE.1, Phase A) — streaming
// AI chat with tool calling, scoped to a single meeting. Mirrors card-agent.ts's
// streaming loop structure. Unlike card-agent (multi-thread per card), a meeting
// has exactly one thread (unique index on meetingId), so `send` takes no threadId
// and auto-creates the thread on first use.
//
// BRAIN-UX.1 Task 5: the SAME channel + thread also serves post-meeting Q&A —
// `send` asks meetingAgentService for the meeting's mode and swaps toolset +
// system prompt accordingly ('qa' for completed meetings, 'live' otherwise).
// Everything else (streaming events, persistence, abort, usage logging) is
// shared, so a meeting's live and post-meeting Q&A are one conversation.
//
// MEET-GROUND.1 Task 1: Q&A mode additionally gets the meeting's own brief
// appended to the system prompt (deterministic grounding), and an answer that
// provably read nothing is replaced by NO_GROUNDING_REFUSAL below. Both are
// Q&A-only — the live path is byte-identical to before.

import { ipcMain } from 'electron';
import {
  streamText,
  stepCountIs,
  type LanguageModel,
  type ModelMessage,
  type TextPart,
  type ToolCallPart,
  type ToolResultPart,
  type JSONValue,
} from 'ai';
import * as meetingAgentService from '../services/meetingAgentService';
import { resolveTaskModel, getProvider, logUsage } from '../services/ai-provider';
import { createLogger } from '../services/logger';
import { validateInput } from '../../shared/validation/ipc-validator';
import { idParamSchema, meetingAgentMessageContentSchema } from '../../shared/validation/schemas';
import type { ToolCallRecord, ToolResultRecord, MeetingAgentMessage } from '../../shared/types';

const log = createLogger('MeetingAgent');

// Per-meeting abort controllers — allows multiple meetings to stream simultaneously.
// Also serves as the single "chat in flight" signal: any entry means a Live
// Assistant stream is consuming the local model right now.
const activeStreams = new Map<string, AbortController>();

/**
 * Whether a Live Assistant chat stream is currently in flight. The proactive
 * triage loop (liveTriageService) reads this to yield priority to chat on the
 * single local model — triage SKIPS (never queues) a run while any chat streams.
 * This is the one source of truth for "chat is streaming"; do not add another.
 */
export function isMeetingAgentStreamActive(): boolean {
  return activeStreams.size > 0;
}

// Only send the last N messages to the AI to keep token usage bounded.
// All messages are still stored in DB and shown in the UI.
const CONVERSATION_WINDOW = 20;

// Exported so tests can assert the base prompt passed into
// meetingAgentService.buildLiveAssistantSystemPrompt (V3.3 Task 2 profile
// injection) is byte-identical to this literal.
export const SYSTEM_PROMPT = `## Your Role
You are the Live Assistant — an AI helper present during a live meeting. You have
tools to inspect the live transcript, search past what is currently visible, look up
the meeting's project and prior briefs, capture action items as cards, work the
meeting's linked project board directly, and file notes on decisions/questions the
user states. The user should not need to leave the meeting to manage their board.

## Tool Use
- Use getTranscriptWindow or searchTranscript to ground answers in what was actually
  said — do not guess or invent meeting content.
- Use getMeetingContext for the meeting's title, project, and prior briefs.
- Use createCardInInbox to capture a concrete action item when the user asks you to.
- Use listBoards, listColumnCards, searchProjectCards, moveCard, and getProjectStats to
  inspect or update the meeting's linked project board (e.g. "move that card to Done",
  "what's in the backlog?"). If the meeting has no linked project yet, these tools will
  tell you so — suggest createCardInInbox instead.
- Use captureNote to log a decision or open question the user explicitly states (e.g.
  "let's go with Postgres" or "we still need to figure out pricing"). This is recorded
  as already-confirmed, not a proposal — only use it for something the user actually said.
- Use createProject ONLY when this meeting is clearly about a brand-new initiative that
  has no linked project yet AND the user agrees to track it — it creates the project and
  links this meeting so future cards land there. Ask the user before creating one. Never
  use it for a casual mention of other work, and never when the meeting already has a
  project (the tool will refuse in that case).

## Conversation Style
Keep responses short (2-4 sentences) — the user is in a live meeting and cannot read
long text. Ask one clarifying question if a request is ambiguous.`;

/**
 * Persisted INSTEAD of the model's text when a post-meeting answer provably read
 * nothing about the meeting: no brief was injected into the prompt AND no tool
 * was called, so whatever it wrote cannot be grounded in this meeting (the
 * incident this guards against: a confident four-point "summary" assembled from
 * the injected twin profile, with zero tool calls).
 *
 * Copy rule (see DECISIONS.md): it may only claim what is true — the brief was
 * unavailable and no transcript search happened. It is a normal assistant
 * message, not an error, and the renderer replaces the streamed bubble with the
 * persisted message on `done`. Single exported constant so tests can assert it
 * byte-identically and the wording cannot drift.
 */
export const NO_GROUNDING_REFUSAL =
  "I couldn't read this meeting — its brief isn't available yet and I didn't search the transcript. Ask me something specific (e.g. 'search for X') so I can look it up, or try again once the brief has generated.";

/**
 * MEET-GROUND.1 Task 2: turns one persisted assistant row into the ModelMessage(s)
 * replayed to the model. A row with tool calls becomes an assistant message whose
 * content is a parts array — an optional text part, then tool-call parts — followed
 * by ONE tool message carrying the matching results. This is what lets a follow-up
 * turn see what an earlier turn searched and found instead of re-reading from
 * scratch (the "cross-turn amnesia" this task fixes).
 *
 * Only tool calls with a MATCHING result (`call.id === result.toolCallId`) are
 * replayed — llama-server is OpenAI-compatible, and those servers hard-reject an
 * assistant `tool_calls` entry with no following tool result. A row whose calls
 * have no match at all (or has no calls) degrades to the plain text mapping used
 * for tool-free rows, and emits no tool message.
 */
function mapAssistantRow(m: MeetingAgentMessage): ModelMessage[] {
  const calls = m.toolCalls ?? [];
  const resultsById = new Map((m.toolResults ?? []).map((r) => [r.toolCallId, r] as const));
  const matchedCalls = calls.filter((c) => resultsById.has(c.id));

  if (matchedCalls.length === 0) {
    return [{ role: 'assistant', content: m.content ?? '' }];
  }

  const contentParts: Array<TextPart | ToolCallPart> = [
    ...(m.content ? [{ type: 'text', text: m.content } as const] : []),
    ...matchedCalls.map<ToolCallPart>((c) => ({
      type: 'tool-call',
      toolCallId: c.id,
      toolName: c.name,
      input: c.args,
    })),
  ];

  const toolResultParts = matchedCalls.map<ToolResultPart>((c) => {
    const r = resultsById.get(c.id)!; // present by construction — c passed the resultsById.has(c.id) filter above
    return {
      type: 'tool-result',
      toolCallId: r.toolCallId,
      toolName: r.toolName,
      output: { type: 'json', value: r.result as JSONValue },
    };
  });

  return [
    { role: 'assistant', content: contentParts },
    { role: 'tool', content: toolResultParts },
  ];
}

/**
 * Faithful history replay (MEET-GROUND.1 Task 2) — replaces the old flatten-to-
 * content mapping that dropped every turn's toolCalls/toolResults, leaving a
 * follow-up question with no record of what an earlier turn already searched or
 * found (and making re-searching the "rational" move). Exported so the mapping
 * is unit-testable independent of the streaming handler. Persisted `role: 'tool'`
 * rows are skipped — defensive: none are written today, but the DB column allows
 * the value.
 */
export function toModelMessages(messages: MeetingAgentMessage[]): ModelMessage[] {
  const aiMessages: ModelMessage[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      aiMessages.push({ role: 'user', content: m.content ?? '' });
    } else if (m.role === 'assistant') {
      aiMessages.push(...mapAssistantRow(m));
    }
  }
  return aiMessages;
}

export function registerMeetingAgentHandlers(): void {
  // --- Streaming agent chat ---
  ipcMain.handle('meeting-agent:send', async (event, meetingId: unknown, content: unknown) => {
    const validMeetingId = validateInput(idParamSchema, meetingId);
    const validContent = validateInput(meetingAgentMessageContentSchema, content);

    // 0. Auto-create the meeting's single thread on first use
    const thread = await meetingAgentService.getOrCreateThread(validMeetingId);

    // 1. Save user message
    await meetingAgentService.addMessage(thread.id, 'user', validContent);

    // 2. Load conversation history
    const messages = await meetingAgentService.getThreadMessages(thread.id);

    // 3. Resolve AI provider — the ONLY place provider selection happens for the
    //    Live Assistant. Transcripts must only ever reach this configured provider.
    const provider = await resolveTaskModel('live_assistant');
    if (!provider) {
      throw new Error('No AI provider configured for the Live Assistant. Go to Settings to add one.');
    }

    // 4. Select the toolset by meeting status (BRAIN-UX.1 Task 5) and create the
    //    abort controller. A COMPLETED meeting gets the read-only Q&A toolset;
    //    every other status keeps the live toolset unchanged.
    const mode = await meetingAgentService.getMeetingAgentMode(validMeetingId);
    const tools =
      mode === 'qa'
        ? meetingAgentService.createMeetingQaTools(validMeetingId)
        : await meetingAgentService.createMeetingAgentTools(validMeetingId);
    const abortController = new AbortController();
    activeStreams.set(validMeetingId, abortController);

    // 5. Convert messages to AI SDK format (windowed to last N messages), replaying
    // each turn's tool calls/results faithfully (MEET-GROUND.1 Task 2) so a
    // follow-up question sees what an earlier turn searched and found rather than
    // starting blind. Window over DB rows FIRST, then map — unchanged semantics.
    const recentMessages = messages.slice(-CONVERSATION_WINDOW);
    const aiMessages = toModelMessages(recentMessages);

    const factory = getProvider(provider.providerId, provider.providerName, provider.apiKeyEncrypted, provider.baseUrl);

    // 5b. Inject the digital-twin profile context (V3.3 Task 2) — read fresh from
    // the DB every send so profile edits apply on the very next message. Falls
    // back to the base prompt unchanged when no profile exists or the lookup fails.
    // The base is the mode's prompt: Q&A for a finished meeting, SYSTEM_PROMPT live.
    const basePrompt = mode === 'qa' ? meetingAgentService.QA_SYSTEM_PROMPT : SYSTEM_PROMPT;
    let system = await meetingAgentService.buildLiveAssistantSystemPrompt(basePrompt);

    // 5c. Q&A grounding (MEET-GROUND.1): append THIS meeting's title/project/own
    // brief LAST, so the most specific material is also the most recent thing in
    // the prompt. Deterministic on purpose — telling the model to ground itself
    // did not stop a small local model from answering from the twin profile
    // instead, and tool_choice forcing is silently ignored by the builtin
    // llama-server runtime. The transcript is never injected (too large; a
    // window would masquerade as the whole meeting) — it stays tool-only.
    // Null when no brief exists yet; that fact is read ONCE here and reused at
    // persistence time, so the refusal below cannot race a brief generated
    // mid-stream. Live mode is untouched: forcing grounding there would
    // interfere with action flows (create card, move card, ...).
    const groundingBlock = mode === 'qa' ? await meetingAgentService.buildMeetingGroundingBlock(validMeetingId) : null;
    if (groundingBlock) system = `${system}\n\n${groundingBlock}`;

    // 6. Stream with tools
    const streamStart = performance.now();
    const result = streamText({
      model: factory(provider.model) as LanguageModel,
      messages: aiMessages,
      system,
      tools,
      stopWhen: stepCountIs(5), // multi-step: model may chain tool calls before answering
      temperature: provider.temperature,
      maxOutputTokens: provider.maxTokens ?? 2048,
      abortSignal: abortController.signal,
    });

    // Prevent unhandled promise rejections from internal result promises.
    // When a continuation step fails (e.g. a local model's thinking mode), these
    // promises reject independently of our fullStream catch block.
    result.usage.then(null, () => {});

    // 7. Iterate fullStream for text chunks and tool events
    let fullText = '';
    let aborted = false;
    let hardError: unknown = null;
    const collectedToolCalls: Array<{ toolName: string; toolCallId: string; input: Record<string, unknown> }> = [];
    const collectedToolResults: Array<{ toolCallId: string; toolName: string; output: unknown; success: boolean }> = [];

    try {
      for await (const part of result.fullStream) {
        switch (part.type) {
          case 'text-delta':
            fullText += part.text;
            event.sender.send('meeting-agent:text-delta', {
              meetingId: validMeetingId,
              threadId: thread.id,
              chunk: part.text,
            });
            break;

          case 'tool-call':
            collectedToolCalls.push({
              toolName: part.toolName,
              toolCallId: part.toolCallId,
              input: part.input as Record<string, unknown>,
            });
            event.sender.send('meeting-agent:tool-call', {
              meetingId: validMeetingId,
              threadId: thread.id,
              toolName: part.toolName,
              args: part.input,
            });
            break;

          case 'tool-result':
            collectedToolResults.push({
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              output: part.output,
              success: (part.output as Record<string, unknown>)?.success !== false,
            });
            event.sender.send('meeting-agent:tool-result', {
              meetingId: validMeetingId,
              threadId: thread.id,
              toolName: part.toolName,
              result: part.output,
            });
            break;

          // Other stream parts (start, finish, etc.) — ignored
        }
      }
    } catch (streamErr) {
      if (abortController.signal.aborted) {
        aborted = true;
        log.info('Meeting agent stream aborted by user');
      } else if (!fullText && collectedToolCalls.length === 0) {
        hardError = streamErr;
      } else {
        // Continuation step failed (e.g. local model's thinking mode) — keep partial results.
        const errMsg = streamErr instanceof Error ? streamErr.message : String(streamErr);
        log.info('Meeting agent continuation unavailable (partial results kept):', errMsg);
      }
    } finally {
      activeStreams.delete(validMeetingId);
    }

    const streamDurationMs = Math.round(performance.now() - streamStart);
    log.info(`Live Assistant stream completed in ${streamDurationMs}ms (tools: ${collectedToolCalls.length})`);

    // 8. Hard failure — emit an error event so the renderer never hangs, then reject.
    if (hardError) {
      const message = hardError instanceof Error ? hardError.message : 'Live Assistant failed to respond.';
      event.sender.send('meeting-agent:error', {
        meetingId: validMeetingId,
        threadId: thread.id,
        error: message,
      });
      throw hardError;
    }

    // 9. If aborted with no output at all, return null (nothing to save)
    if (aborted && !fullText.trim() && collectedToolCalls.length === 0) {
      return null;
    }

    // 10. Save assistant message with tool calls
    const toolCallRecords: ToolCallRecord[] | undefined =
      collectedToolCalls.length > 0
        ? collectedToolCalls.map((tc) => ({ id: tc.toolCallId, name: tc.toolName, args: tc.input }))
        : undefined;

    const toolResultRecords: ToolResultRecord[] | undefined =
      collectedToolResults.length > 0
        ? collectedToolResults.map((tr) => ({ toolCallId: tr.toolCallId, toolName: tr.toolName, result: tr.output }))
        : undefined;

    // A post-meeting answer that read NOTHING — no brief in the prompt and no
    // tool call — cannot be about this meeting, whatever it says. Replace it
    // with an honest refusal rather than persist a fabrication. Deterministic,
    // never heuristic: all four conditions must hold. Never live mode (grounding
    // is a Q&A concern), never an aborted stream (the user cut it short), never
    // when a tool ran or the brief was injected (a zero-tool answer grounded in
    // an injected brief is legitimate — "summarize this meeting" is exactly it).
    const readNothing = mode === 'qa' && !aborted && collectedToolCalls.length === 0 && !groundingBlock;
    if (readNothing) {
      log.info('Q&A answer had no grounding (no brief injected, no tool call) — persisting the refusal instead');
    }

    const assistantMessage = await meetingAgentService.addMessage(
      thread.id,
      'assistant',
      readNothing ? NO_GROUNDING_REFUSAL : fullText || null,
      toolCallRecords,
      toolResultRecords,
    );

    // 11. Log usage
    if (!aborted) {
      try {
        const usage = await result.usage;
        await logUsage(provider.providerId, provider.model, 'live_assistant', usage);
      } catch {
        log.debug('Usage data unavailable for meeting agent stream');
      }
    }

    // 12. Emit + return the final payload
    const payload = { assistantMessage, threadId: thread.id };
    event.sender.send('meeting-agent:done', payload);
    return payload;
  });

  // --- Load conversation history for a meeting's drawer ---
  ipcMain.handle('meeting-agent:load', async (_event, meetingId: unknown) => {
    const validMeetingId = validateInput(idParamSchema, meetingId);
    return meetingAgentService.getMessagesForMeeting(validMeetingId);
  });

  // --- Thread management: clear, start new (archiving the old), browse archive ---

  /** Permanently delete the CURRENT thread's messages. Destructive by design —
   *  the renderer confirms first. Nothing else reads this conversation, so no
   *  brief, card, embedding or twin fact is affected. */
  ipcMain.handle('meeting-agent:clear', async (_event, meetingId: unknown) => {
    const validMeetingId = validateInput(idParamSchema, meetingId);
    await meetingAgentService.clearThreadMessages(validMeetingId);
    log.info(`Meeting agent thread cleared for meeting ${validMeetingId.slice(0, 8)}`);
    return meetingAgentService.getMessagesForMeeting(validMeetingId);
  });

  /** Archive the current thread and start an empty one. Non-destructive. */
  ipcMain.handle('meeting-agent:new-thread', async (_event, meetingId: unknown) => {
    const validMeetingId = validateInput(idParamSchema, meetingId);
    return meetingAgentService.startNewThread(validMeetingId);
  });

  /** Current + archived threads, with a message count so the picker can label them. */
  ipcMain.handle('meeting-agent:list-threads', async (_event, meetingId: unknown) => {
    const validMeetingId = validateInput(idParamSchema, meetingId);
    return meetingAgentService.listThreadsWithCounts(validMeetingId);
  });

  /** Read one archived thread's messages (read-only history view). */
  ipcMain.handle('meeting-agent:thread-messages', async (_event, threadId: unknown) => {
    const validThreadId = validateInput(idParamSchema, threadId);
    return meetingAgentService.getThreadMessages(validThreadId);
  });

  /** Delete an archived thread outright. Refuses the current one by construction. */
  ipcMain.handle('meeting-agent:delete-thread', async (_event, threadId: unknown) => {
    const validThreadId = validateInput(idParamSchema, threadId);
    await meetingAgentService.deleteArchivedThread(validThreadId);
  });

  // --- Abort the active stream for a meeting ---
  ipcMain.handle('meeting-agent:stop', async (_event, meetingId: unknown) => {
    const validMeetingId = validateInput(idParamSchema, meetingId);
    const controller = activeStreams.get(validMeetingId);
    if (controller) {
      controller.abort();
      activeStreams.delete(validMeetingId);
      log.info(`Meeting agent stream abort requested for meeting ${validMeetingId.slice(0, 8)}`);
    }
  });
}
