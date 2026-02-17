// === Preload bridge: Focus mode gamification ===
import { ipcRenderer } from 'electron';

export const focusBridge = {
  focusSaveSession: (input: { cardId?: string; durationMinutes: number; note?: string }) =>
    ipcRenderer.invoke('focus:save-session', input),
  focusGetStats: () => ipcRenderer.invoke('focus:get-stats'),
  focusGetDaily: (days?: number) => ipcRenderer.invoke('focus:get-daily', days),
  focusGetAchievements: () => ipcRenderer.invoke('focus:get-achievements'),
};
