// === FILE PURPOSE ===
// IPC handlers for speaker diarization and meeting analytics.

import { ipcMain } from 'electron';
import * as speakerDiarizationService from '../services/speakerDiarizationService';
import * as meetingAnalyticsService from '../services/meetingAnalyticsService';

export function registerDiarizationHandlers(): void {
  ipcMain.handle('meeting:diarize', async (_event, meetingId: string) => {
    return speakerDiarizationService.diarizeMeeting(meetingId);
  });

  ipcMain.handle('meeting:analytics', async (_event, meetingId: string) => {
    return meetingAnalyticsService.calculateAnalytics(meetingId);
  });
}
