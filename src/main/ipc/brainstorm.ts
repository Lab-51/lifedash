// === FILE PURPOSE ===
// IPC handlers for brainstorming — CRUD + streaming AI chat.
// This is the first IPC handler with streaming. The send-message handler iterates
// the text stream and pushes chunks to the renderer via event.sender.send().

import { ipcMain } from 'electron';
import * as brainstormService from '../services/brainstormService';
import { resolveTaskModel, streamGenerate, logUsage } from '../services/ai-provider';
import { createLogger } from '../services/logger';
import { validateInput } from '../../shared/validation/ipc-validator';
import {
  idParamSchema,
  createBrainstormSessionInputSchema,
  updateBrainstormSessionInputSchema,
  brainstormMessageContentSchema,
} from '../../shared/validation/schemas';

const log = createLogger('Brainstorm');

// Per-session abort controllers — allows multiple concurrent sessions to stream simultaneously
const activeAbortControllers = new Map<string, AbortController>();

export function registerBrainstormHandlers(): void {
  ipcMain.handle('brainstorm:list-sessions', async () => {
    return brainstormService.getSessions();
  });

  ipcMain.handle('brainstorm:get-session', async (_event, id: unknown) => {
    const validId = validateInput(idParamSchema, id);
    return brainstormService.getSession(validId);
  });

  ipcMain.handle('brainstorm:create-session', async (_event, data: unknown) => {
    const input = validateInput(createBrainstormSessionInputSchema, data);
    return brainstormService.createSession(input);
  });

  ipcMain.handle('brainstorm:update-session', async (_event, id: unknown, data: unknown) => {
    const validId = validateInput(idParamSchema, id);
    const input = validateInput(updateBrainstormSessionInputSchema, data);
    return brainstormService.updateSession(validId, input);
  });

  ipcMain.handle('brainstorm:delete-session', async (_event, id: unknown) => {
    const validId = validateInput(idParamSchema, id);
    return brainstormService.deleteSession(validId);
  });

  // Streaming handler — saves user msg, streams AI response, saves assistant msg
  ipcMain.handle('brainstorm:send-message', async (event, sessionId: unknown, content: unknown) => {
    const validSessionId = validateInput(idParamSchema, sessionId);
    const validContent = validateInput(brainstormMessageContentSchema, content);
    // 1. Save user message
    await brainstormService.addMessage(validSessionId, 'user', validContent);

    // 2. Load conversation history + context
    const messages = await brainstormService.getMessages(validSessionId);
    const context = await brainstormService.buildContext(validSessionId);

    // 3. Resolve AI provider
    const provider = await resolveTaskModel('brainstorming');
    if (!provider) {
      throw new Error('No AI provider configured. Go to Settings to add one.');
    }

    // 4. Stream AI response with abort support
    const abortController = new AbortController();
    activeAbortControllers.set(validSessionId, abortController);

    const result = streamGenerate({
      providerId: provider.providerId,
      providerName: provider.providerName,
      apiKeyEncrypted: provider.apiKeyEncrypted,
      baseUrl: provider.baseUrl,
      model: provider.model,
      messages: messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      system: context,
      temperature: provider.temperature ?? 0.7,
      maxTokens: provider.maxTokens ?? 2048,
      abortSignal: abortController.signal,
    });

    let fullText = '';
    let aborted = false;
    try {
      for await (const chunk of result.textStream) {
        fullText += chunk;
        event.sender.send('brainstorm:stream-chunk', { sessionId: validSessionId, chunk });
      }
    } catch (streamErr) {
      // Check if the stream was aborted by the user
      if (abortController.signal.aborted) {
        aborted = true;
        log.info('Brainstorm stream aborted by user');
      } else if (!fullText) {
        // Some providers don't send proper finish signals, causing NoOutputGeneratedError
        throw streamErr;
      } else {
        log.warn('Stream ended with error but text was received:', streamErr instanceof Error ? streamErr.message : streamErr);
      }
    } finally {
      activeAbortControllers.delete(validSessionId);
    }

    // If aborted with no text, return null (no assistant message to save)
    if (aborted && !fullText.trim()) {
      return null;
    }

    if (!aborted && !fullText.trim()) {
      throw new Error('AI provider returned an empty response. Try again or check your provider settings.');
    }

    // 5. Log usage (fire-and-forget — some providers omit usage in streams)
    if (!aborted) {
      try {
        const usage = await result.usage;
        await logUsage(provider.providerId, provider.model, 'brainstorming', usage);
      } catch {
        log.debug('Usage data unavailable for this stream (provider may not support it)');
      }
    }

    // 6. Save and return assistant message (save partial text if aborted with content)
    const assistantMsg = await brainstormService.addMessage(validSessionId, 'assistant', fullText);
    return assistantMsg;
  });

  // Abort active brainstorm stream for a specific session
  ipcMain.handle('brainstorm:abort', async (_event, sessionId: unknown) => {
    const validSessionId = validateInput(idParamSchema, sessionId);
    const controller = activeAbortControllers.get(validSessionId);
    if (controller) {
      controller.abort();
      activeAbortControllers.delete(validSessionId);
      log.info(`Brainstorm stream abort requested for session ${validSessionId.slice(0, 8)}`);
    }
  });

  ipcMain.handle('brainstorm:export-to-idea', async (_event, sessionId: unknown, messageId: unknown) => {
    const validSessionId = validateInput(idParamSchema, sessionId);
    const validMessageId = validateInput(idParamSchema, messageId);
    return brainstormService.exportToIdea(validSessionId, validMessageId);
  });

  ipcMain.handle('brainstorm:export-to-card', async (_event, sessionId: unknown, messageId: unknown) => {
    const validSessionId = validateInput(idParamSchema, sessionId);
    const validMessageId = validateInput(idParamSchema, messageId);
    return brainstormService.exportToCard(validSessionId, validMessageId);
  });
}
