// === FILE PURPOSE ===
// IPC handlers for window control operations (minimize, maximize, close).
// These handlers are invoked from the renderer via the preload bridge.
// All handlers are parameterless — no input validation needed

import { BrowserWindow, ipcMain } from 'electron';

/**
 * Register IPC handlers for window controls.
 * Also sets up event forwarding so the renderer is notified when
 * the maximize state changes (e.g. from Windows snap gestures).
 */
export function registerWindowControlHandlers(
  mainWindow: BrowserWindow,
): void {
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

  ipcMain.handle('window:set-always-on-top', (_event, value: boolean) => {
    mainWindow.setAlwaysOnTop(value);
    return mainWindow.isAlwaysOnTop();
  });

  ipcMain.handle('window:is-always-on-top', () => {
    return mainWindow.isAlwaysOnTop();
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
