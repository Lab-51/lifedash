// === Preload bridge: Focus mode sessions ===
import { ipcRenderer } from 'electron';

export const focusBridge = {
  focusSaveSession: (input: {
    cardId?: string;
    projectId?: string;
    durationMinutes: number;
    note?: string;
    billable?: boolean;
  }) => ipcRenderer.invoke('focus:save-session', input),
  focusGetStats: () => ipcRenderer.invoke('focus:get-stats'),
  focusGetDaily: (days?: number) => ipcRenderer.invoke('focus:get-daily', days),
  focusGetHistory: (options?: { offset?: number; limit?: number }) => ipcRenderer.invoke('focus:get-history', options),
  focusGetPeriodStats: () => ipcRenderer.invoke('focus:get-period-stats'),
  focusGetTimeReport: (options: { startDate: string; endDate: string; projectId?: string; billableOnly?: boolean }) =>
    ipcRenderer.invoke('focus:get-time-report', options),
  focusUpdateSession: (id: string, input: { projectId?: string | null; note?: string | null; billable?: boolean }) =>
    ipcRenderer.invoke('focus:update-session', id, input),
  focusDeleteSession: (id: string) => ipcRenderer.invoke('focus:delete-session', id),
};
