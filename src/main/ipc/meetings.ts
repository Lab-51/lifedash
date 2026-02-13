// === FILE PURPOSE ===
// IPC handlers for meeting CRUD operations.
// Recording-related handlers will be added in Plans 4.2-4.3.

// === DEPENDENCIES ===
// electron (ipcMain), ../services/meetingService

import { ipcMain } from 'electron';
import * as meetingService from '../services/meetingService';
import { validateInput } from '../../shared/validation/ipc-validator';
import {
  idParamSchema,
  createMeetingInputSchema,
  updateMeetingInputSchema,
} from '../../shared/validation/schemas';

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

  ipcMain.handle(
    'meetings:update',
    async (_event, id: unknown, data: unknown) => {
      const validId = validateInput(idParamSchema, id);
      const input = validateInput(updateMeetingInputSchema, data);
      return meetingService.updateMeeting(validId, input);
    },
  );

  ipcMain.handle('meetings:delete', async (_event, id: unknown) => {
    const validId = validateInput(idParamSchema, id);
    return meetingService.deleteMeeting(validId);
  });
}
