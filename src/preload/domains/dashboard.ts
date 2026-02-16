import { ipcRenderer } from 'electron';

export const dashboardBridge = {
  generateStandup: () => ipcRenderer.invoke('dashboard:generate-standup'),
  getActivityData: () => ipcRenderer.invoke('dashboard:activity-data'),
};
