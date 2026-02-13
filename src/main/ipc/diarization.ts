// === FILE PURPOSE ===
// IPC handlers for speaker diarization and meeting analytics.

import { ipcMain } from 'electron';
import * as speakerDiarizationService from '../services/speakerDiarizationService';
import * as meetingAnalyticsService from '../services/meetingAnalyticsService';
import { validateInput } from '../../shared/validation/ipc-validator';
import { idParamSchema } from '../../shared/validation/schemas';

export function registerDiarizationHandlers(): void {
  ipcMain.handle('meeting:diarize', async (_event, meetingId: unknown) => {
    const validMeetingId = validateInput(idParamSchema, meetingId);
    return speakerDiarizationService.diarizeMeeting(validMeetingId);
  });

  ipcMain.handle('meeting:analytics', async (_event, meetingId: unknown) => {
    const validMeetingId = validateInput(idParamSchema, meetingId);
    return meetingAnalyticsService.calculateAnalytics(validMeetingId);
  });
}
