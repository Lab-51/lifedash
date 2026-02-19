// === FILE PURPOSE ===
// IPC handlers for whisper model management — list, download, check availability.
//
// === DEPENDENCIES ===
// electron (ipcMain, BrowserWindow), ../services/whisperModelManager
//
// === LIMITATIONS ===
// - Single download at a time (no parallel downloads)
// - No download cancellation from renderer yet

import path from 'node:path';
import { ipcMain, BrowserWindow } from 'electron';
import * as whisperModelManager from '../services/whisperModelManager';
import { validateInput } from '../../shared/validation/ipc-validator';
import { whisperModelNameSchema } from '../../shared/validation/schemas';

export function registerWhisperHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle('whisper:list-models', async () => {
    return whisperModelManager.AVAILABLE_MODELS.map((m) => ({
      ...m,
      available: whisperModelManager.isModelAvailable(m.fileName),
    }));
  });

  ipcMain.handle('whisper:download-model', async (_event, fileName: unknown) => {
    const validFileName = validateInput(whisperModelNameSchema, fileName);
    const { promise } = whisperModelManager.downloadModel(validFileName, (downloaded, total) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('whisper:download-progress', {
          fileName,
          downloaded,
          total,
          percent: total > 0 ? Math.round((downloaded / total) * 100) : 0,
        });
      }
    });
    return promise;
  });

  ipcMain.handle('whisper:has-model', async () => {
    return whisperModelManager.getDefaultModelPath() !== null;
  });

  ipcMain.handle('whisper:get-active-model', async () => {
    const modelPath = whisperModelManager.getDefaultModelPath();
    if (!modelPath) return null;
    return path.basename(modelPath);
  });
}
