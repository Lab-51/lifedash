// === FILE PURPOSE ===
// IPC handlers for window control operations (minimize, maximize, close).
// These handlers are invoked from the renderer via the preload bridge.
// Boolean-param handlers validated via Zod booleanParamSchema.

import { BrowserWindow, ipcMain } from 'electron';
import { setIsRecording } from '../services/recordingState';
import { validateInput } from '../../shared/validation/ipc-validator';
import { booleanParamSchema } from '../../shared/validation/schemas';

/**
 * Register IPC handlers for window controls.
 * Also sets up event forwarding so the renderer is notified when
 * the maximize state changes (e.g. from Windows snap gestures).
 */
export function registerWindowControlHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle('window:minimize', () => {
    mainWindow.minimize();
  });

  ipcMain.handle('window:maximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.handle('window:close', () => {
    mainWindow.close();
  });

  ipcMain.handle('window:is-maximized', () => {
    return mainWindow.isMaximized();
  });

  ipcMain.handle('window:set-always-on-top', (_event, value: unknown) => {
    const validValue = validateInput(booleanParamSchema, value);
    mainWindow.setAlwaysOnTop(validValue);
    return mainWindow.isAlwaysOnTop();
  });

  ipcMain.handle('window:is-always-on-top', () => {
    return mainWindow.isAlwaysOnTop();
  });

  // Recording state — lets the renderer notify the main process
  // when a recording starts/stops so the close guard can check it.
  ipcMain.handle('recording:set-state', (_event, value: unknown) => {
    const validValue = validateInput(booleanParamSchema, value);
    setIsRecording(validValue);
  });

  // Forward maximize/unmaximize events to the renderer so the
  // title bar can update its icon (e.g. after Windows snap).
  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window:maximize-change', true);
  });

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window:maximize-change', false);
  });
}
