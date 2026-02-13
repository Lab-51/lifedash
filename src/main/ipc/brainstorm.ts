// === FILE PURPOSE ===
// IPC handlers for brainstorming — CRUD + streaming AI chat.
// This is the first IPC handler with streaming. The send-message handler iterates
// the text stream and pushes chunks to the renderer via event.sender.send().

import { ipcMain } from 'electron';
import * as brainstormService from '../services/brainstormService';
import { resolveTaskModel, streamGenerate, logUsage } from '../services/ai-provider';
import { createLogger } from '../services/logger';

const log = createLogger('Brainstorm');

export function registerBrainstormHandlers(): void {
  ipcMain.handle('brainstorm:list-sessions', async () => {
    return brainstormService.getSessions();
  });

  ipcMain.handle('brainstorm:get-session', async (_event, id: string) => {
    return brainstormService.getSession(id);
  });

  ipcMain.handle('brainstorm:create-session', async (_event, data: any) => {
    return brainstormService.createSession(data);
  });

  ipcMain.handle('brainstorm:update-session', async (_event, id: string, data: any) => {
    return brainstormService.updateSession(id, data);
  });

  ipcMain.handle('brainstorm:delete-session', async (_event, id: string) => {
    return brainstormService.deleteSession(id);
  });

  // Streaming handler — saves user msg, streams AI response, saves assistant msg
  ipcMain.handle('brainstorm:send-message', async (event, sessionId: string, content: string) => {
    // 1. Save user message
    await brainstormService.addMessage(sessionId, 'user', content);

    // 2. Load conversation history + context
    const messages = await brainstormService.getMessages(sessionId);
    const context = await brainstormService.buildContext(sessionId);

    // 3. Resolve AI provider
    const provider = await resolveTaskModel('brainstorming');
    if (!provider) {
      throw new Error('No AI provider configured. Go to Settings to add one.');
    }

    // 4. Stream AI response
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
    });

    let fullText = '';
    for await (const chunk of result.textStream) {
      fullText += chunk;
      event.sender.send('brainstorm:stream-chunk', { sessionId, chunk });
    }

    // 5. Log usage (fire-and-forget)
    try {
      const usage = await result.usage;
      await logUsage(provider.providerId, provider.model, 'brainstorming', usage);
    } catch (err) {
      log.error('Failed to log usage:', err);
    }

    // 6. Save and return assistant message
    const assistantMsg = await brainstormService.addMessage(sessionId, 'assistant', fullText);
    return assistantMsg;
  });

  ipcMain.handle('brainstorm:export-to-idea', async (_event, sessionId: string, messageId: string) => {
    return brainstormService.exportToIdea(sessionId, messageId);
  });
}
