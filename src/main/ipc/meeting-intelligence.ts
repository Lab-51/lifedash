// === FILE PURPOSE ===
// IPC handlers for AI-powered meeting intelligence — brief generation,
// action item extraction, and action-to-card conversion.

import { ipcMain } from 'electron';
import * as intelligence from '../services/meetingIntelligenceService';
import type { ActionItemStatus } from '../../shared/types';

export function registerMeetingIntelligenceHandlers(): void {
  // Generate AI brief for a completed meeting
  ipcMain.handle('meetings:generate-brief', async (_event, meetingId: string) => {
    return intelligence.generateBrief(meetingId);
  });

  // Generate AI-extracted action items from transcript
  ipcMain.handle('meetings:generate-actions', async (_event, meetingId: string) => {
    return intelligence.generateActionItems(meetingId);
  });

  // Get existing brief for a meeting
  ipcMain.handle('meetings:get-brief', async (_event, meetingId: string) => {
    return intelligence.getBrief(meetingId);
  });

  // Get action items for a meeting
  ipcMain.handle('meetings:get-actions', async (_event, meetingId: string) => {
    return intelligence.getActionItems(meetingId);
  });

  // Update action item status (approve/dismiss)
  ipcMain.handle(
    'meetings:update-action-status',
    async (_event, id: string, status: ActionItemStatus) => {
      return intelligence.updateActionItemStatus(id, status);
    },
  );

  // Convert an action item to a project card
  ipcMain.handle(
    'meetings:convert-action-to-card',
    async (_event, actionItemId: string, columnId: string) => {
      return intelligence.convertActionToCard(actionItemId, columnId);
    },
  );
}
