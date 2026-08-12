// === FILE PURPOSE ===
// IPC handlers for AI-powered meeting intelligence — brief generation,
// action item extraction, and action-to-card conversion.

import { ipcMain } from 'electron';
import * as intelligence from '../services/meetingIntelligenceService';
import { validateInput } from '../../shared/validation/ipc-validator';
import { idParamSchema, actionItemStatusSchema } from '../../shared/validation/schemas';

export function registerMeetingIntelligenceHandlers(): void {
  // Generate AI brief for a completed meeting. Routed through the shared
  // single-flight map (TWIN-LEARN.1) so that when the session page opens while
  // the main-process auto-run is still generating, this JOINS that run instead of
  // starting a second one. With nothing in flight it proceeds unconditionally —
  // this is also the explicit Regenerate button.
  ipcMain.handle('meetings:generate-brief', async (_event, meetingId: unknown) => {
    const validId = validateInput(idParamSchema, meetingId);
    return intelligence.generateBriefShared(validId);
  });

  // Generate AI-extracted action items from transcript. Same single-flight join:
  // the renderer fires this the moment a brief lands, which is exactly when the
  // auto-run starts its own extraction — and a second extraction would DUPLICATE
  // every item (there is no "already extracted" guard, by design: this is also
  // the explicit Regenerate path).
  ipcMain.handle('meetings:generate-actions', async (_event, meetingId: unknown) => {
    const validId = validateInput(idParamSchema, meetingId);
    return intelligence.generateActionItemsShared(validId);
  });

  // Get existing brief for a meeting
  ipcMain.handle('meetings:get-brief', async (_event, meetingId: unknown) => {
    const validId = validateInput(idParamSchema, meetingId);
    return intelligence.getBrief(validId);
  });

  // Get action items for a meeting
  ipcMain.handle('meetings:get-actions', async (_event, meetingId: unknown) => {
    const validId = validateInput(idParamSchema, meetingId);
    return intelligence.getActionItems(validId);
  });

  // Update action item status (approve/dismiss)
  ipcMain.handle('meetings:update-action-status', async (_event, id: unknown, status: unknown) => {
    const validId = validateInput(idParamSchema, id);
    const validStatus = validateInput(actionItemStatusSchema, status);
    return intelligence.updateActionItemStatus(validId, validStatus);
  });

  // Convert an action item to a project card
  ipcMain.handle('meetings:convert-action-to-card', async (_event, actionItemId: unknown, columnId: unknown) => {
    const validActionItemId = validateInput(idParamSchema, actionItemId);
    const validColumnId = validateInput(idParamSchema, columnId);
    return intelligence.convertActionToCard(validActionItemId, validColumnId);
  });
}
