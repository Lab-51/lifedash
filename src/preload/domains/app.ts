// === Preload bridge: App-level IPC events ===
import { ipcRenderer } from 'electron';

export const appBridge = {
  onShowCommandPalette: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('app:show-command-palette', handler);
    return () => {
      ipcRenderer.removeListener('app:show-command-palette', handler);
    };
  },
};
