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

export function registerRecordingHandlers(mainWindow: BrowserWindow): void {
  // Pass the window reference to audioProcessor for state push events
  audioProcessor.setMainWindow(mainWindow);

  ipcMain.handle(
    'recording:start',
    async (_event, meetingId: string) => {
      audioProcessor.startRecording(meetingId);
    },
  );

  ipcMain.handle('recording:stop', async () => {
    const audioPath = await audioProcessor.stopRecording();
    return audioPath;
  });

  // One-way audio chunk streaming (no response needed)
  ipcMain.on('audio:chunk', (_event, chunk: Buffer) => {
    audioProcessor.addChunk(chunk);
  });
}
