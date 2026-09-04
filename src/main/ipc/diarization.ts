// === FILE PURPOSE ===
// IPC handlers for speaker diarization, speaker NAMES, and meeting analytics.

import { ipcMain } from 'electron';
import * as speakerDiarizationService from '../services/speakerDiarizationService';
import * as speakerNameService from '../services/speakerNameService';
import * as meetingAnalyticsService from '../services/meetingAnalyticsService';
import { validateInput } from '../../shared/validation/ipc-validator';
import { idParamSchema, renameSpeakerSchema } from '../../shared/validation/schemas';

export function registerDiarizationHandlers(): void {
  ipcMain.handle('meeting:diarize', async (_event, meetingId: unknown) => {
    const validMeetingId = validateInput(idParamSchema, meetingId);
    return speakerDiarizationService.diarizeMeeting(validMeetingId);
  });

  /** The user's own correction to a speaker's name (SPEAKER.1). `name: null`
   *  clears it, which is also what makes the label eligible for a later
   *  automatic resolution. */
  ipcMain.handle('meeting:rename-speaker', async (_event, payload: unknown) => {
    const valid = validateInput(renameSpeakerSchema, payload);
    return speakerNameService.renameSpeaker(valid.meetingId, valid.label, valid.name);
  });

  ipcMain.handle('meeting:resolve-speaker-names', async (_event, meetingId: unknown) => {
    const validMeetingId = validateInput(idParamSchema, meetingId);
    return speakerNameService.resolveSpeakerNames(validMeetingId);
  });

  ipcMain.handle('meeting:analytics', async (_event, meetingId: unknown) => {
    const validMeetingId = validateInput(idParamSchema, meetingId);
    return meetingAnalyticsService.calculateAnalytics(validMeetingId);
  });
}
