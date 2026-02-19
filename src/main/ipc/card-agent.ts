// === FILE PURPOSE ===
// IPC handlers for card agent — streaming AI chat with tool calling.
// Extends the brainstorm streaming pattern with tool execution events.

import { ipcMain } from 'electron';
import { streamText, stepCountIs, type LanguageModel } from 'ai';
import * as cardAgentService from '../services/cardAgentService';
import { resolveTaskModel, getProvider, logUsage } from '../services/ai-provider';
import { createLogger } from '../services/logger';
import { validateInput } from '../../shared/validation/ipc-validator';
import { idParamSchema, cardAgentMessageContentSchema } from '../../shared/validation/schemas';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { cards, columns, boards } from '../db/schema';
import type { ToolCallRecord, ToolResultRecord } from '../../shared/types';

const log = createLogger('CardAgent');

// Per-card abort controllers — allows multiple cards to stream simultaneously
const activeStreams = new Map<string, AbortController>();

// Only send the last N messages to the AI to keep token usage bounded.
// All messages are still stored in DB and shown in the UI.
const CONVERSATION_WINDOW = 20;

export function registerCardAgentHandlers(): void {
  // --- Streaming agent chat ---
  ipcMain.handle(
    'card-agent:send-message',
    async (event, cardId: unknown, content: unknown) => {
      const validCardId = validateInput(idParamSchema, cardId);
      const validContent = validateInput(cardAgentMessageContentSchema, content);

      // 1. Save user message
      await cardAgentService.addMessage(validCardId, 'user', validContent);

      // 2. Load conversation history
      const messages = await cardAgentService.getMessages(validCardId);

      // 3. Build card context
      const systemPrompt = await cardAgentService.buildCardContext(validCardId);

      // 4. Resolve AI provider
      const provider = await resolveTaskModel('card_agent');
      if (!provider) {
        throw new Error('No AI provider configured. Go to Settings to add one.');
      }

      // 5. Resolve projectId for tool scoping
      const db = getDb();
      const [card] = await db.select({ columnId: cards.columnId }).from(cards)
        .where(eq(cards.id, validCardId));
      let projectId: string | null = null;
      if (card) {
        const [col] = await db.select({ boardId: columns.boardId }).from(columns)
          .where(eq(columns.id, card.columnId));
        if (col) {
          const [board] = await db.select({ projectId: boards.projectId }).from(boards)
            .where(eq(boards.id, col.boardId));
          if (board) projectId = board.projectId;
        }
      }

      // 6. Create tools and abort controller
      const tools = cardAgentService.createCardAgentTools(validCardId, projectId);
      const abortController = new AbortController();
      activeStreams.set(validCardId, abortController);

      // 7. Convert messages to AI SDK format (windowed to last N messages)
      const recentMessages = messages.slice(-CONVERSATION_WINDOW);
      const aiMessages = recentMessages.map(m => {
        if (m.role === 'user') {
          return { role: 'user' as const, content: m.content ?? '' };
        }
        if (m.role === 'assistant') {
          return { role: 'assistant' as const, content: m.content ?? '' };
        }
        // tool messages — for now, include as assistant context
        return { role: 'assistant' as const, content: m.content ?? '' };
      });

      const factory = getProvider(
        provider.providerId,
        provider.providerName,
        provider.apiKeyEncrypted,
        provider.baseUrl,
      );

      // 8. Stream with tools
      const result = streamText({
        model: factory(provider.model) as LanguageModel,
        messages: aiMessages,
        system: systemPrompt,
        tools,
        stopWhen: stepCountIs(5), // cap at 5 steps to prevent runaway loops
        temperature: provider.temperature,
        maxOutputTokens: provider.maxTokens ?? 2048,
        abortSignal: abortController.signal,
      });

      // 9. Iterate fullStream for text chunks and tool events
      let fullText = '';
      let aborted = false;
      const collectedToolCalls: Array<{ toolName: string; toolCallId: string; input: Record<string, unknown> }> = [];
      const collectedToolResults: Array<{ toolCallId: string; toolName: string; output: unknown; success: boolean }> = [];

      try {
        for await (const part of result.fullStream) {
          switch (part.type) {
            case 'text-delta':
              fullText += part.text;
              event.sender.send('card-agent:stream-chunk', {
                cardId: validCardId,
                chunk: part.text,
              });
              break;

            case 'tool-call':
              collectedToolCalls.push({
                toolName: part.toolName,
                toolCallId: part.toolCallId,
                input: part.input as Record<string, unknown>,
              });
              event.sender.send('card-agent:tool-event', {
                cardId: validCardId,
                type: 'call',
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
              event.sender.send('card-agent:tool-event', {
                cardId: validCardId,
                type: 'result',
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
          log.info('Card agent stream aborted by user');
        } else if (!fullText && collectedToolCalls.length === 0) {
          throw streamErr;
        } else {
          // Continuation step failed but we have partial results — keep them
          log.warn('Card agent stream error (partial results kept):',
            streamErr instanceof Error ? streamErr.message : streamErr);
        }
      } finally {
        activeStreams.delete(validCardId);
      }

      // 10. If aborted with no text, return null
      if (aborted && !fullText.trim() && collectedToolCalls.length === 0) {
        return null;
      }

      // 11. Save assistant message with tool calls
      const toolCallRecords: ToolCallRecord[] | undefined =
        collectedToolCalls.length > 0
          ? collectedToolCalls.map(tc => ({
              id: tc.toolCallId,
              name: tc.toolName,
              args: tc.input,
            }))
          : undefined;

      const toolResultRecords: ToolResultRecord[] | undefined =
        collectedToolResults.length > 0
          ? collectedToolResults.map(tr => ({
              toolCallId: tr.toolCallId,
              toolName: tr.toolName,
              result: tr.output,
            }))
          : undefined;

      const assistantMsg = await cardAgentService.addMessage(
        validCardId,
        'assistant',
        fullText || null,
        toolCallRecords,
        toolResultRecords,
      );

      // 12. Log usage
      if (!aborted) {
        try {
          const usage = await result.usage;
          await logUsage(provider.providerId, provider.model, 'card_agent', usage);
        } catch {
          log.debug('Usage data unavailable for card agent stream');
        }
      }

      // 13. Collect actions for UI
      const actions = cardAgentService.collectAgentActions(
        collectedToolCalls.map(tc => ({ toolName: tc.toolName, input: tc.input })),
        collectedToolResults.map(tr => ({ success: tr.success })),
      );

      return { assistantMessage: assistantMsg, actions };
    },
  );

  // --- Get conversation history ---
  ipcMain.handle('card-agent:get-messages', async (_event, cardId: unknown) => {
    const validCardId = validateInput(idParamSchema, cardId);
    return cardAgentService.getMessages(validCardId);
  });

  // --- Clear conversation ---
  ipcMain.handle('card-agent:clear-messages', async (_event, cardId: unknown) => {
    const validCardId = validateInput(idParamSchema, cardId);
    await cardAgentService.clearMessages(validCardId);
  });

  // --- Message count (for badge) ---
  ipcMain.handle('card-agent:get-message-count', async (_event, cardId: unknown) => {
    const validCardId = validateInput(idParamSchema, cardId);
    return cardAgentService.getMessageCount(validCardId);
  });

  // --- Abort active stream ---
  ipcMain.handle('card-agent:abort', async (_event, cardId: unknown) => {
    const validCardId = validateInput(idParamSchema, cardId);
    const controller = activeStreams.get(validCardId);
    if (controller) {
      controller.abort();
      activeStreams.delete(validCardId);
      log.info(`Card agent stream abort requested for card ${validCardId.slice(0, 8)}`);
    }
  });
}
