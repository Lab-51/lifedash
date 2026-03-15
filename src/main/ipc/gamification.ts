// === FILE PURPOSE ===
// IPC handlers for unified gamification system (XP awards, stats, achievements).

import { ipcMain } from 'electron';
import * as gamificationService from '../services/gamificationService';
import { createLogger } from '../services/logger';
import { validateInput } from '../../shared/validation/ipc-validator';
import { xpEventTypeSchema, gamificationGetDailySchema, idParamSchema } from '../../shared/validation/schemas';

const log = createLogger('Gamification');

export function registerGamificationHandlers(): void {
  ipcMain.handle('gamification:award-xp', async (_, eventType: unknown, entityId: unknown) => {
    const validEventType = validateInput(xpEventTypeSchema, eventType);
    const validEntityId = entityId !== undefined ? validateInput(idParamSchema.optional(), entityId) : undefined;
    log.info(`Awarding XP: ${validEventType}${validEntityId ? ` (entity: ${validEntityId})` : ''}`);
    const xpAwarded = await gamificationService.awardXP(validEventType, validEntityId);
    const stats = await gamificationService.getStats();
    const counts = await gamificationService.getAchievementCounts(stats);
    const newAchievements = await gamificationService.checkAndUnlockAchievements(stats, counts);

    if (newAchievements.length > 0) {
      log.info(`New achievements unlocked: ${newAchievements.map((a) => a.name).join(', ')}`);
    }

    return { xpAwarded, stats, newAchievements };
  });

  ipcMain.handle('gamification:get-stats', async () => {
    return gamificationService.getStats();
  });

  ipcMain.handle('gamification:get-achievements', async () => {
    return gamificationService.getAchievements();
  });

  ipcMain.handle('gamification:get-daily', async (_, days: unknown) => {
    const validDays = validateInput(gamificationGetDailySchema, days);
    return gamificationService.getDailyXP(validDays);
  });
}
