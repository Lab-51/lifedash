// === FILE PURPOSE ===
// IPC handlers for audio recording control and streaming.
// Coordinates between audioProcessor (raw audio) and meetingService (DB).
//
// === DEPENDENCIES ===
// electron (ipcMain, BrowserWindow), ../services/audioProcessor
//
// === LIMITATIONS ===
// - No transcription handlers yet (Plan 4.3)
// - 'enable-loopback-audio' and 'disable-loopback-audio' are auto-registered
//   by electron-audio-loopback's initMain() — NOT registered here.
//
// === VERIFICATION STATUS ===
// - ipcMain.handle for request/response (recording:start, recording:stop)
// - ipcMain.on for fire-and-forget (audio:chunk)

import { ipcMain, BrowserWindow } from 'electron';
import * as audioProcessor from '../services/audioProcessor';
import * as meetingService from '../services/meetingService';
import { validateInput } from '../../shared/validation/ipc-validator';
import { idParamSchema } from '../../shared/validation/schemas';

export function registerRecordingHandlers(mainWindow: BrowserWindow): void {
  // Pass the window reference to audioProcessor for state push events
  audioProcessor.setMainWindow(mainWindow);

  ipcMain.handle(
    'recording:start',
    async (_event, meetingId: unknown) => {
      const validMeetingId = validateInput(idParamSchema, meetingId);

      // Read the meeting's stored transcription language to pass to audio processor
      let language: string | undefined;
      try {
        const meeting = await meetingService.getMeeting(validMeetingId);
        if (meeting?.transcriptionLanguage) {
          language = meeting.transcriptionLanguage;
        }
      } catch {
        // Non-fatal — will fall back to DB setting in transcriptionService
      }

      audioProcessor.startRecording(validMeetingId, language);
    },
  );

  ipcMain.handle('recording:stop', async () => {
    const audioPath = await audioProcessor.stopRecording();
    return audioPath;
  });

  // audio:chunk: binary PCM data — Zod validation not applicable
  ipcMain.on('audio:chunk', (_event, chunk: Buffer) => {
    audioProcessor.addChunk(chunk);
  });
}
