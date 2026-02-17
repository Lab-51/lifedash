import { ipcRenderer } from 'electron';

export const dashboardBridge = {
  generateStandup: (projectId?: string) => ipcRenderer.invoke('dashboard:generate-standup', projectId),
  getActivityData: () => ipcRenderer.invoke('dashboard:activity-data'),
};
