// === FILE PURPOSE ===
// IPC handlers for focus mode sessions.
// Achievement/stats logic now delegates to gamificationService.

import { ipcMain } from 'electron';
import * as focusService from '../services/focusService';
import * as gamificationService from '../services/gamificationService';
import { createLogger } from '../services/logger';
import { validateInput } from '../../shared/validation/ipc-validator';
import {
  focusSaveSessionSchema,
  focusGetDailySchema,
  focusGetHistorySchema,
  focusGetTimeReportSchema,
  focusUpdateSessionSchema,
  focusDeleteSessionSchema,
} from '../../shared/validation/schemas';

const log = createLogger('Focus');

export function registerFocusHandlers(): void {
  ipcMain.handle('focus:save-session', async (_, data: unknown) => {
    const input = validateInput(focusSaveSessionSchema, data);
    log.info(`Saving focus session: ${input.durationMinutes} min`);
    const session = await focusService.saveSession(input);

    // Award XP (focus_session uses durationMinutes as XP override)
    await gamificationService.awardXP('focus_session', input.cardId, input.durationMinutes);

    // Get unified stats and check achievements
    const stats = await gamificationService.getStats();
    const counts = await gamificationService.getAchievementCounts(stats);
    const newAchievements = await gamificationService.checkAndUnlockAchievements(stats, counts);

    if (newAchievements.length > 0) {
      log.info(`New achievements unlocked: ${newAchievements.map((a) => a.name).join(', ')}`);
    }
    return { session, stats, newAchievements };
  });

  ipcMain.handle('focus:get-stats', async () => {
    return gamificationService.getStats();
  });

  ipcMain.handle('focus:get-daily', async (_, days: unknown) => {
    const validDays = validateInput(focusGetDailySchema, days);
    return focusService.getDailyData(validDays);
  });

  ipcMain.handle('focus:get-history', async (_, options: unknown) => {
    const validOptions = validateInput(focusGetHistorySchema, options);
    return focusService.getSessionHistory(validOptions);
  });

  ipcMain.handle('focus:get-period-stats', async () => {
    return focusService.getPeriodStats();
  });

  ipcMain.handle('focus:get-time-report', async (_, options: unknown) => {
    const input = validateInput(focusGetTimeReportSchema, options);
    return focusService.getTimeReport(input);
  });

  ipcMain.handle('focus:update-session', async (_, id: unknown, data: unknown) => {
    const validId = validateInput(focusDeleteSessionSchema, id);
    const input = validateInput(focusUpdateSessionSchema, data);
    log.info(`Updating focus session: ${validId}`);
    await focusService.updateSession(validId, input);
  });

  ipcMain.handle('focus:delete-session', async (_, id: unknown) => {
    const validId = validateInput(focusDeleteSessionSchema, id);
    log.info(`Deleting focus session: ${validId}`);
    await focusService.deleteSession(validId);
  });
}
