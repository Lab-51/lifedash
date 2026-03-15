// === Preload bridge: App-level IPC events ===
import { ipcRenderer } from 'electron';

export const appBridge = {
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:open-external', url),

  onShowCommandPalette: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('app:show-command-palette', handler);
    return () => {
      ipcRenderer.removeListener('app:show-command-palette', handler);
    };
  },

  // Auto-update: status lifecycle events (checking → up-to-date | ready)
  onUpdateStatus: (callback: (data: { status: string; releaseName?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { status: string; releaseName?: string }) =>
      callback(data);
    ipcRenderer.on('app:update-status', handler);
    return () => {
      ipcRenderer.removeListener('app:update-status', handler);
    };
  },

  // Auto-update: quit the app and install the downloaded update
  installUpdate: (): Promise<void> => ipcRenderer.invoke('app:install-update'),

  // Auto-update: manually trigger an update check
  checkForUpdates: (): Promise<void> => ipcRenderer.invoke('app:check-for-updates'),

  // Open the log files directory in the system file manager
  openLogsFolder: (): Promise<string> => ipcRenderer.invoke('settings:open-logs-folder'),
};
