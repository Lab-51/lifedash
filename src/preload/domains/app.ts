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
};
