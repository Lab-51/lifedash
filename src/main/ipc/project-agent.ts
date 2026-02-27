// === FILE PURPOSE ===
// IPC handlers for project agent — streaming AI chat with tool calling.
// Mirrors the card-agent.ts pattern but operates at project scope.
// projectId is passed directly (no card->column->board chain lookup needed).

import { ipcMain } from 'electron';
import { streamText, stepCountIs, type LanguageModel } from 'ai';
import * as projectAgentService from '../services/projectAgentService';
import { resolveTaskModel, getProvider, logUsage } from '../services/ai-provider';
import { createLogger } from '../services/logger';
import { validateInput } from '../../shared/validation/ipc-validator';
import { idParamSchema, projectAgentMessageContentSchema } from '../../shared/validation/schemas';
import type { ToolCallRecord, ToolResultRecord } from '../../shared/types';
import { requireProFeature } from './guards';

const log = createLogger('ProjectAgent');

// Per-project abort controllers — allows multiple projects to stream simultaneously
const activeStreams = new Map<string, AbortController>();

// Only send the last N messages to the AI to keep token usage bounded.
// All messages are still stored in DB and shown in the UI.
const CONVERSATION_WINDOW = 20;

export function registerProjectAgentHandlers(): void {
  // --- Streaming agent chat ---
  ipcMain.handle(
    'project-agent:send-message',
    async (event, projectId: unknown, content: unknown) => {
      await requireProFeature('projectAgent');
      const validProjectId = validateInput(idParamSchema, projectId);
      const validContent = validateInput(projectAgentMessageContentSchema, content);

      // 1. Save user message
      await projectAgentService.addMessage(validProjectId, 'user', validContent);

      // 2. Load conversation history
      const messages = await projectAgentService.getMessages(validProjectId);

      // 3. Build project context
      const systemPrompt = await projectAgentService.buildProjectContext(validProjectId);

      // 4. Resolve AI provider
      const provider = await resolveTaskModel('project_agent');
      if (!provider) {
        throw new Error('No AI provider configured. Go to Settings to add one.');
      }

      // 5. Create tools and abort controller
      // projectId is passed directly — no card->column->board chain needed
      const tools = projectAgentService.createProjectAgentTools(validProjectId);
      const abortController = new AbortController();
      activeStreams.set(validProjectId, abortController);

      // 6. Convert messages to AI SDK format (windowed to last N messages)
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

      // 7. Stream with tools
      const result = streamText({
        model: factory(provider.model) as LanguageModel,
        messages: aiMessages,
        system: systemPrompt,
        tools,
        stopWhen: stepCountIs(5), // multi-step: agent may chain tools before answering
        temperature: provider.temperature,
        maxOutputTokens: provider.maxTokens ?? 4096,
        abortSignal: abortController.signal,
      });

      // Prevent unhandled promise rejections from internal result promises.
      // When a continuation step fails (e.g. Kimi K2.5 thinking mode), these
      // promises reject independently of our fullStream catch block.
      result.usage.then(null, () => {});

      // 8. Iterate fullStream for text chunks and tool events
      let fullText = '';
      let aborted = false;
      const collectedToolCalls: Array<{ toolName: string; toolCallId: string; input: Record<string, unknown> }> = [];
      const collectedToolResults: Array<{ toolCallId: string; toolName: string; output: unknown; success: boolean }> = [];

      try {
        for await (const part of result.fullStream) {
          switch (part.type) {
            case 'text-delta':
              fullText += part.text;
              event.sender.send('project-agent:stream-chunk', {
                projectId: validProjectId,
                chunk: part.text,
              });
              break;

            case 'tool-call':
              collectedToolCalls.push({
                toolName: part.toolName,
                toolCallId: part.toolCallId,
                input: part.input as Record<string, unknown>,
              });
              event.sender.send('project-agent:tool-event', {
                projectId: validProjectId,
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
              event.sender.send('project-agent:tool-event', {
                projectId: validProjectId,
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
          log.info('Project agent stream aborted by user');
        } else if (!fullText && collectedToolCalls.length === 0) {
          throw streamErr;
        } else {
          // Continuation step failed (e.g. Kimi thinking mode) — keep partial results.
          const errMsg = streamErr instanceof Error ? streamErr.message : String(streamErr);
          log.info('Project agent continuation unavailable (partial results kept):', errMsg);
        }
      } finally {
        activeStreams.delete(validProjectId);
      }

      // 9. If aborted with no text, return null
      if (aborted && !fullText.trim() && collectedToolCalls.length === 0) {
        return null;
      }

      // 10. Save assistant message with tool calls
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

      const assistantMsg = await projectAgentService.addMessage(
        validProjectId,
        'assistant',
        fullText || null,
        toolCallRecords,
        toolResultRecords,
      );

      // 11. Log usage
      if (!aborted) {
        try {
          const usage = await result.usage;
          await logUsage(provider.providerId, provider.model, 'project_agent', usage);
        } catch {
          log.debug('Usage data unavailable for project agent stream');
        }
      }

      // 12. Collect actions for UI
      const actions = projectAgentService.collectAgentActions(
        collectedToolCalls.map(tc => ({ toolName: tc.toolName, input: tc.input })),
        collectedToolResults.map(tr => ({ success: tr.success })),
      );

      return { assistantMessage: assistantMsg, actions };
    },
  );

  // --- Get conversation history ---
  ipcMain.handle('project-agent:get-messages', async (_event, projectId: unknown) => {
    await requireProFeature('projectAgent');
    const validProjectId = validateInput(idParamSchema, projectId);
    return projectAgentService.getMessages(validProjectId);
  });

  // --- Clear conversation ---
  ipcMain.handle('project-agent:clear-messages', async (_event, projectId: unknown) => {
    await requireProFeature('projectAgent');
    const validProjectId = validateInput(idParamSchema, projectId);
    await projectAgentService.clearMessages(validProjectId);
  });

  // --- Message count (for badge) ---
  ipcMain.handle('project-agent:get-message-count', async (_event, projectId: unknown) => {
    await requireProFeature('projectAgent');
    const validProjectId = validateInput(idParamSchema, projectId);
    return projectAgentService.getMessageCount(validProjectId);
  });

  // --- Resolved model info (for UI display) ---
  ipcMain.handle('project-agent:get-model-info', async () => {
    await requireProFeature('projectAgent');
    const provider = await resolveTaskModel('project_agent');
    if (!provider) return null;
    return { providerName: provider.providerName, model: provider.model };
  });

  // --- Abort active stream ---
  ipcMain.handle('project-agent:abort', async (_event, projectId: unknown) => {
    await requireProFeature('projectAgent');
    const validProjectId = validateInput(idParamSchema, projectId);
    const controller = activeStreams.get(validProjectId);
    if (controller) {
      controller.abort();
      activeStreams.delete(validProjectId);
      log.info(`Project agent stream abort requested for project ${validProjectId.slice(0, 8)}`);
    }
  });
}
