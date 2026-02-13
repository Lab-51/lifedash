// === FILE PURPOSE ===
// IPC handlers for desktop notification preferences and testing.
//
// === DEPENDENCIES ===
// Electron (ipcMain), notificationService

import { ipcMain } from 'electron';
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  sendTestNotification,
} from '../services/notificationService';

export function registerNotificationHandlers(): void {
  ipcMain.handle('notifications:get-preferences', async () => {
    return getNotificationPreferences();
  });

  ipcMain.handle('notifications:update-preferences', async (_event, prefs) => {
    await updateNotificationPreferences(prefs);
  });

  ipcMain.handle('notifications:test', async () => {
    sendTestNotification();
  });
}
