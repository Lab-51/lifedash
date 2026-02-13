// === Preload bridge: Window controls ===
import { ipcRenderer } from 'electron';

export const windowBridge = {
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
    return () => {
      ipcRenderer.removeListener('window:maximize-change', handler);
    };
  },
};
