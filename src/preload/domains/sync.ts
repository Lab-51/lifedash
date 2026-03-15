// === Preload bridge: Cloud sync auth and controls ===
import { ipcRenderer } from 'electron';

export const syncBridge = {
  syncGetAuthState: () => ipcRenderer.invoke('sync:get-auth-state'),
  syncSignIn: () => ipcRenderer.invoke('sync:sign-in'),
  syncSignOut: () => ipcRenderer.invoke('sync:sign-out'),
  syncGetStatus: () => ipcRenderer.invoke('sync:get-status'),
  syncToggleEnabled: (enabled: boolean) => ipcRenderer.invoke('sync:toggle-enabled', enabled),
  syncTriggerNow: () => ipcRenderer.invoke('sync:trigger-now'),

  // Event listeners for real-time sync status updates from the main process
  onSyncStatusChanged: (callback: (data: { status: string; lastSyncedAt: string | null }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { status: string; lastSyncedAt: string | null }) =>
      callback(data);
    ipcRenderer.on('sync:status-changed', handler);
    return () => {
      ipcRenderer.removeListener('sync:status-changed', handler);
    };
  },

  onSyncError: (callback: (data: { table: string; error: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { table: string; error: string }) => callback(data);
    ipcRenderer.on('sync:error', handler);
    return () => {
      ipcRenderer.removeListener('sync:error', handler);
    };
  },

  onSyncPullComplete: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('sync:pull-complete', handler);
    return () => {
      ipcRenderer.removeListener('sync:pull-complete', handler);
    };
  },
};
