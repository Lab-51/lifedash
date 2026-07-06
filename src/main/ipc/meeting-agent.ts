// === FILE PURPOSE ===
// IPC handlers for the in-meeting "Live Assistant" (LIVE.1, Phase A) — streaming
// AI chat with tool calling, scoped to a single meeting. Mirrors card-agent.ts's
// streaming loop structure. Unlike card-agent (multi-thread per card), a meeting
// has exactly one thread (unique index on meetingId), so `send` takes no threadId
// and auto-creates the thread on first use.

import { ipcMain } from 'electron';
import { streamText, stepCountIs, type LanguageModel } from 'ai';
import * as meetingAgentService from '../services/meetingAgentService';
import { resolveTaskModel, getProvider, logUsage } from '../services/ai-provider';
import { createLogger } from '../services/logger';
import { validateInput } from '../../shared/validation/ipc-validator';
import { idParamSchema, meetingAgentMessageContentSchema } from '../../shared/validation/schemas';
import type { ToolCallRecord, ToolResultRecord } from '../../shared/types';

const log = createLogger('MeetingAgent');

// Per-meeting abort controllers — allows multiple meetings to stream simultaneously
const activeStreams = new Map<string, AbortController>();

// Only send the last N messages to the AI to keep token usage bounded.
// All messages are still stored in DB and shown in the UI.
const CONVERSATION_WINDOW = 20;

const SYSTEM_PROMPT = `## Your Role
You are the Live Assistant — an AI helper present during a live meeting. You have
tools to inspect the live transcript, search past what is currently visible, look up
the meeting's project and prior briefs, and capture action items as cards.

## Tool Use
- Use getTranscriptWindow or searchTranscript to ground answers in what was actually
  said — do not guess or invent meeting content.
- Use getMeetingContext for the meeting's title, project, and prior briefs.
- Use createCardInInbox to capture a concrete action item when the user asks you to.

## Conversation Style
Keep responses short (2-4 sentences) — the user is in a live meeting and cannot read
long text. Ask one clarifying question if a request is ambiguous.`;

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

    // 4. Create tools and abort controller
    const tools = meetingAgentService.createMeetingAgentTools(validMeetingId);
    const abortController = new AbortController();
    activeStreams.set(validMeetingId, abortController);

    // 5. Convert messages to AI SDK format (windowed to last N messages)
    const recentMessages = messages.slice(-CONVERSATION_WINDOW);
    const aiMessages = recentMessages.map((m) => ({
      role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.content ?? '',
    }));

    const factory = getProvider(provider.providerId, provider.providerName, provider.apiKeyEncrypted, provider.baseUrl);

    // 6. Stream with tools
    const streamStart = performance.now();
    const result = streamText({
      model: factory(provider.model) as LanguageModel,
      messages: aiMessages,
      system: SYSTEM_PROMPT,
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

    const assistantMessage = await meetingAgentService.addMessage(
      thread.id,
      'assistant',
      fullText || null,
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
