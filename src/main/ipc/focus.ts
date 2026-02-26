// === FILE PURPOSE ===
// IPC handlers for focus mode sessions.
// Achievement/stats logic now delegates to gamificationService.

import { ipcMain } from 'electron';
import * as focusService from '../services/focusService';
import * as gamificationService from '../services/gamificationService';
import { createLogger } from '../services/logger';

const log = createLogger('Focus');

export function registerFocusHandlers(): void {
  ipcMain.handle('focus:save-session', async (_, input: { cardId?: string; projectId?: string; durationMinutes: number; note?: string; billable?: boolean }) => {
    log.info(`Saving focus session: ${input.durationMinutes} min`);
    const session = await focusService.saveSession(input);

    // Award XP (focus_session uses durationMinutes as XP override)
    await gamificationService.awardXP('focus_session', input.cardId, input.durationMinutes);

    // Get unified stats and check achievements
    const stats = await gamificationService.getStats();
    const counts = await gamificationService.getAchievementCounts(stats);
    const newAchievements = await gamificationService.checkAndUnlockAchievements(stats, counts);

    if (newAchievements.length > 0) {
      log.info(`New achievements unlocked: ${newAchievements.map(a => a.name).join(', ')}`);
    }
    return { session, stats, newAchievements };
  });

  ipcMain.handle('focus:get-stats', async () => {
    return gamificationService.getStats();
  });

  ipcMain.handle('focus:get-daily', async (_, days?: number) => {
    return focusService.getDailyData(days);
  });

  ipcMain.handle('focus:get-history', async (_, options?: { offset?: number; limit?: number }) => {
    return focusService.getSessionHistory(options);
  });

  ipcMain.handle('focus:get-period-stats', async () => {
    return focusService.getPeriodStats();
  });

  ipcMain.handle('focus:get-time-report', async (_, options: { startDate: string; endDate: string; projectId?: string; billableOnly?: boolean }) => {
    // Note: This endpoint is NOT gated — it provides all focus page data (summary, chart, sessions).
    // Only the CSV export action in the renderer is Pro-gated via ProGate component.
    return focusService.getTimeReport(options);
  });

  ipcMain.handle('focus:update-session', async (_, id: string, input: { projectId?: string | null; note?: string | null; billable?: boolean }) => {
    log.info(`Updating focus session: ${id}`);
    await focusService.updateSession(id, input);
  });

  ipcMain.handle('focus:delete-session', async (_, id: string) => {
    log.info(`Deleting focus session: ${id}`);
    await focusService.deleteSession(id);
  });
}
