// === Preload bridge: Notification preferences ===
import { ipcRenderer } from 'electron';
import type { NotificationPreferences } from '../../shared/types';

export const notificationsBridge = {
  notificationGetPreferences: () =>
    ipcRenderer.invoke('notifications:get-preferences'),
  notificationUpdatePreferences: (prefs: Partial<NotificationPreferences>) =>
    ipcRenderer.invoke('notifications:update-preferences', prefs),
  notificationSendTest: () => ipcRenderer.invoke('notifications:test'),
  notificationShow: (title: string, body: string) =>
    ipcRenderer.invoke('notifications:show', title, body),
};
