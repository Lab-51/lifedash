// === Preload bridge: Focus mode sessions ===
import { ipcRenderer } from 'electron';

export const focusBridge = {
  focusSaveSession: (input: { cardId?: string; durationMinutes: number; note?: string }) =>
    ipcRenderer.invoke('focus:save-session', input),
  focusGetStats: () => ipcRenderer.invoke('focus:get-stats'),
  focusGetDaily: (days?: number) => ipcRenderer.invoke('focus:get-daily', days),
  focusGetHistory: (options?: { offset?: number; limit?: number }) =>
    ipcRenderer.invoke('focus:get-history', options),
  focusGetPeriodStats: () => ipcRenderer.invoke('focus:get-period-stats'),
  focusGetTimeReport: (options: { startDate: string; endDate: string; projectId?: string }) =>
    ipcRenderer.invoke('focus:get-time-report', options),
};
