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
  showNotification,
} from '../services/notificationService';
import { validateInput } from '../../shared/validation/ipc-validator';
import {
  notificationPreferencesUpdateSchema,
  notificationShowTitleSchema,
  notificationShowBodySchema,
} from '../../shared/validation/schemas';

export function registerNotificationHandlers(): void {
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
