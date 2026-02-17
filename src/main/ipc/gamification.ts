// === FILE PURPOSE ===
// IPC handlers for unified gamification system (XP awards, stats, achievements).

import { ipcMain } from 'electron';
import * as gamificationService from '../services/gamificationService';
import { createLogger } from '../services/logger';
import type { XpEventType } from '../../shared/types/gamification';

const log = createLogger('Gamification');

export function registerGamificationHandlers(): void {
  ipcMain.handle('gamification:award-xp', async (_, eventType: XpEventType, entityId?: string) => {
    log.info(`Awarding XP: ${eventType}${entityId ? ` (entity: ${entityId})` : ''}`);
    const xpAwarded = await gamificationService.awardXP(eventType, entityId);
    const stats = await gamificationService.getStats();
    const counts = await gamificationService.getAchievementCounts(stats);
    const newAchievements = await gamificationService.checkAndUnlockAchievements(stats, counts);

    if (newAchievements.length > 0) {
      log.info(`New achievements unlocked: ${newAchievements.map(a => a.name).join(', ')}`);
    }

    return { xpAwarded, stats, newAchievements };
  });

  ipcMain.handle('gamification:get-stats', async () => {
    return gamificationService.getStats();
  });

  ipcMain.handle('gamification:get-achievements', async () => {
    return gamificationService.getAchievements();
  });

  ipcMain.handle('gamification:get-daily', async (_, days?: number) => {
    return gamificationService.getDailyXP(days);
  });
}
