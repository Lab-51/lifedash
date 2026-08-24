// === FILE PURPOSE ===
// IPC handlers for desktop notification preferences and testing.
//
// === DEPENDENCIES ===
// Electron (ipcMain), notificationService

import { ipcMain, BrowserWindow } from 'electron';
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  sendTestNotification,
  showNotification,
  setMainWindow,
} from '../services/notificationService';
import { validateInput } from '../../shared/validation/ipc-validator';
import {
  notificationPreferencesUpdateSchema,
  notificationShowTitleSchema,
  notificationShowBodySchema,
} from '../../shared/validation/schemas';

export function registerNotificationHandlers(mainWindow: BrowserWindow): void {
  // POST-FLOW.1: notifyBriefReady's click-to-navigate needs to focus the window
  // and send to the renderer — wired here, mirroring ipc/recording.ts's
  // audioProcessor.setMainWindow(mainWindow).
  setMainWindow(mainWindow);

  ipcMain.handle('notifications:get-preferences', async () => {
    return getNotificationPreferences();
  });

  ipcMain.handle('notifications:update-preferences', async (_event, prefs: unknown) => {
    const input = validateInput(notificationPreferencesUpdateSchema, prefs);
    await updateNotificationPreferences(input);
  });

  ipcMain.handle('notifications:test', async () => {
    sendTestNotification();
  });

  ipcMain.handle('notifications:show', async (_event, title: unknown, body: unknown) => {
    const validTitle = validateInput(notificationShowTitleSchema, title);
    const validBody = validateInput(notificationShowBodySchema, body);
    showNotification(validTitle, validBody);
  });
}
