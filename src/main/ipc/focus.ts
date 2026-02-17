// === FILE PURPOSE ===
// IPC handlers for focus mode gamification.

import { ipcMain } from 'electron';
import * as focusService from '../services/focusService';
import { createLogger } from '../services/logger';

const log = createLogger('Focus');

export function registerFocusHandlers(): void {
  ipcMain.handle('focus:save-session', async (_, input: { cardId?: string; durationMinutes: number; note?: string }) => {
    log.info(`Saving focus session: ${input.durationMinutes} min`);
    const session = await focusService.saveSession(input);
    const stats = await focusService.getStats();
    const newAchievements = await focusService.checkAndUnlockAchievements(stats);
    if (newAchievements.length > 0) {
      log.info(`New achievements unlocked: ${newAchievements.map(a => a.name).join(', ')}`);
    }
    return { session, stats, newAchievements };
  });

  ipcMain.handle('focus:get-stats', async () => {
    return focusService.getStats();
  });

  ipcMain.handle('focus:get-daily', async (_, days?: number) => {
    return focusService.getDailyData(days);
  });

  ipcMain.handle('focus:get-achievements', async () => {
    return focusService.getAchievements();
  });
}
