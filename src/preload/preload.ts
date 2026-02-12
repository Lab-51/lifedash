// === FILE PURPOSE ===
// Preload script — runs before renderer process loads.
// Exposes a safe API to the renderer via contextBridge.
// All IPC communication goes through this bridge, keeping
// contextIsolation intact and nodeIntegration disabled.

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  // Window controls
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onWindowMaximizeChange: (callback: (isMaximized: boolean) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      isMaximized: boolean,
    ) => {
      callback(isMaximized);
    };
    ipcRenderer.on('window:maximize-change', handler);
    // Return cleanup function for React useEffect
    return () => {
      ipcRenderer.removeListener('window:maximize-change', handler);
    };
  },

  // Database
  getDatabaseStatus: () => ipcRenderer.invoke('db:status'),
});
