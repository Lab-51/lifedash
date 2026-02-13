// === FILE PURPOSE ===
// IPC handlers for AI-powered meeting intelligence — brief generation,
// action item extraction, and action-to-card conversion.

import { ipcMain } from 'electron';
import * as intelligence from '../services/meetingIntelligenceService';
import { validateInput } from '../../shared/validation/ipc-validator';
import {
  idParamSchema,
  actionItemStatusSchema,
} from '../../shared/validation/schemas';

export function registerMeetingIntelligenceHandlers(): void {
  // Generate AI brief for a completed meeting
  ipcMain.handle('meetings:generate-brief', async (_event, meetingId: unknown) => {
    const validId = validateInput(idParamSchema, meetingId);
    return intelligence.generateBrief(validId);
  });

  // Generate AI-extracted action items from transcript
  ipcMain.handle('meetings:generate-actions', async (_event, meetingId: unknown) => {
    const validId = validateInput(idParamSchema, meetingId);
    return intelligence.generateActionItems(validId);
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
  ipcMain.handle(
    'meetings:update-action-status',
    async (_event, id: unknown, status: unknown) => {
      const validId = validateInput(idParamSchema, id);
      const validStatus = validateInput(actionItemStatusSchema, status);
      return intelligence.updateActionItemStatus(validId, validStatus);
    },
  );

  // Convert an action item to a project card
  ipcMain.handle(
    'meetings:convert-action-to-card',
    async (_event, actionItemId: unknown, columnId: unknown) => {
      const validActionItemId = validateInput(idParamSchema, actionItemId);
      const validColumnId = validateInput(idParamSchema, columnId);
      return intelligence.convertActionToCard(validActionItemId, validColumnId);
    },
  );
}
