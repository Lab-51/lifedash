// === FILE PURPOSE ===
// IPC handlers for the live suggestion lifecycle (LIVE.2 Task 2): accept
// (action_item -> card via the live-assistant rail; decision/question ->
// status-only), dismiss, and list for a meeting's proactive-triage proposals.

import { ipcMain } from 'electron';
import * as liveSuggestionService from '../services/liveSuggestionService';
import { validateInput } from '../../shared/validation/ipc-validator';
import { idParamSchema } from '../../shared/validation/schemas';

export function registerLiveSuggestionHandlers(): void {
  ipcMain.handle('live-suggestions:accept', async (_event, id: unknown) => {
    const validId = validateInput(idParamSchema, id);
    return liveSuggestionService.acceptSuggestion(validId);
  });

  ipcMain.handle('live-suggestions:dismiss', async (_event, id: unknown) => {
    const validId = validateInput(idParamSchema, id);
    return liveSuggestionService.dismissSuggestion(validId);
  });

  ipcMain.handle('live-suggestions:list', async (_event, meetingId: unknown) => {
    const validMeetingId = validateInput(idParamSchema, meetingId);
    return liveSuggestionService.listSuggestions(validMeetingId);
  });
}
