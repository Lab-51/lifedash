// === Preload bridge: Window controls ===
import { ipcRenderer } from 'electron';

export const windowBridge = {
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  windowSetAlwaysOnTop: (value: boolean) => ipcRenderer.invoke('window:set-always-on-top', value),
  windowIsAlwaysOnTop: () => ipcRenderer.invoke('window:is-always-on-top'),
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
  recordingSetState: (isRecording: boolean) =>
    ipcRenderer.invoke('recording:set-state', isRecording),
  onRecordingForceStop: (callback: () => void) => {
    const handler = () => {
      callback();
    };
    ipcRenderer.on('recording:force-stop', handler);
    return () => {
      ipcRenderer.removeListener('recording:force-stop', handler);
    };
  },
};
