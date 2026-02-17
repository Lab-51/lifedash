// === Preload bridge: Unified gamification system ===
import { ipcRenderer } from 'electron';

export const gamificationBridge = {
  gamificationAwardXp: (eventType: string, entityId?: string) =>
    ipcRenderer.invoke('gamification:award-xp', eventType, entityId),
  gamificationGetStats: () => ipcRenderer.invoke('gamification:get-stats'),
  gamificationGetAchievements: () => ipcRenderer.invoke('gamification:get-achievements'),
  gamificationGetDaily: (days?: number) => ipcRenderer.invoke('gamification:get-daily', days),
};
