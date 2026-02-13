// === Preload bridge: Database status ===
import { ipcRenderer } from 'electron';

export const databaseBridge = {
  getDatabaseStatus: () => ipcRenderer.invoke('db:status'),
};
