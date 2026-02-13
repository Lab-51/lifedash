// === FILE PURPOSE ===
// IPC handlers for meeting CRUD operations.
// Recording-related handlers will be added in Plans 4.2-4.3.

// === DEPENDENCIES ===
// electron (ipcMain), ../services/meetingService

import { ipcMain } from 'electron';
import * as meetingService from '../services/meetingService';
import type { CreateMeetingInput, UpdateMeetingInput } from '../../shared/types';

export function registerMeetingHandlers(): void {
  ipcMain.handle('meetings:list', async () => {
    return meetingService.getMeetings();
  });

  ipcMain.handle('meetings:get', async (_event, id: string) => {
    return meetingService.getMeeting(id);
  });

  ipcMain.handle('meetings:create', async (_event, data: CreateMeetingInput) => {
    return meetingService.createMeeting(data);
  });

  ipcMain.handle(
    'meetings:update',
    async (_event, id: string, data: UpdateMeetingInput) => {
      return meetingService.updateMeeting(id, data);
    },
  );

  ipcMain.handle('meetings:delete', async (_event, id: string) => {
    return meetingService.deleteMeeting(id);
  });
}
