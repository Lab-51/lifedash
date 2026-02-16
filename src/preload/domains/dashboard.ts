import { ipcRenderer } from 'electron';

export const dashboardBridge = {
  generateStandup: () => ipcRenderer.invoke('dashboard:generate-standup'),
};
