// === FILE PURPOSE ===
// IPC handlers for meeting CRUD operations.
// Recording-related handlers will be added in Plans 4.2-4.3.

// === DEPENDENCIES ===
// electron (ipcMain), ../services/meetingService

import { ipcMain } from 'electron';
import { z } from 'zod';
import * as meetingService from '../services/meetingService';
import { generateMeetingPrep } from '../services/meetingPrepService';
import { validateInput } from '../../shared/validation/ipc-validator';
import { idParamSchema, createMeetingInputSchema, updateMeetingInputSchema } from '../../shared/validation/schemas';

const meetingIdsSchema = z.array(z.string().uuid());

export function registerMeetingHandlers(): void {
  ipcMain.handle('meetings:list', async () => {
    return meetingService.getMeetings();
  });

  ipcMain.handle('meetings:get', async (_event, id: unknown) => {
    const validId = validateInput(idParamSchema, id);
    return meetingService.getMeeting(validId);
  });

  ipcMain.handle('meetings:create', async (_event, data: unknown) => {
    const input = validateInput(createMeetingInputSchema, data);
    return meetingService.createMeeting(input);
  });

  ipcMain.handle('meetings:update', async (_event, id: unknown, data: unknown) => {
    const validId = validateInput(idParamSchema, id);
    const input = validateInput(updateMeetingInputSchema, data);
    return meetingService.updateMeeting(validId, input);
  });

  ipcMain.handle('meetings:delete', async (_event, id: unknown) => {
    const validId = validateInput(idParamSchema, id);
    return meetingService.deleteMeeting(validId);
  });

  ipcMain.handle('meetings:action-item-counts', async (_event, ids: unknown) => {
    const validIds = validateInput(meetingIdsSchema, ids);
    return meetingService.getActionItemCounts(validIds);
  });

  ipcMain.handle('meetings:pending-action-count', async () => {
    return meetingService.getPendingActionCount();
  });

  ipcMain.handle('meetings:search-transcripts', async (_event, query: unknown, limit?: unknown) => {
    const validQuery = validateInput(z.string().min(2), query);
    const validLimit = limit !== undefined ? validateInput(z.number().int().min(1).max(100), limit) : undefined;
    return meetingService.searchTranscripts(validQuery, validLimit);
  });

  ipcMain.handle('meetings:generate-prep', async (_event, projectId: unknown) => {
    const validId = validateInput(idParamSchema, projectId);
    return generateMeetingPrep(validId);
  });
}
