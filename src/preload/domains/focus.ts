// === Preload bridge: Focus mode sessions ===
import { ipcRenderer } from 'electron';

export const focusBridge = {
  focusSaveSession: (input: { cardId?: string; durationMinutes: number; note?: string }) =>
    ipcRenderer.invoke('focus:save-session', input),
  focusGetStats: () => ipcRenderer.invoke('focus:get-stats'),
  focusGetDaily: (days?: number) => ipcRenderer.invoke('focus:get-daily', days),
};
