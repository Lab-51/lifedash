// === FILE PURPOSE ===
// IPC handlers for the background agent system.
// Exposes preferences management, insight CRUD, and daily token tracking.
// All handlers are Pro-gated. The run-now handler triggers the scheduler manually.

import { ipcMain } from 'electron';
import { z } from 'zod';
import * as backgroundAgentService from '../services/backgroundAgentService';
import { checkAndRunInsights } from '../services/backgroundAgentScheduler';
import { validateInput } from '../../shared/validation/ipc-validator';
import { idParamSchema } from '../../shared/validation/schemas';
import { requireProFeature } from './guards';

// Local Zod schema for preferences update (partial, all fields optional)
const backgroundAgentPreferencesUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  frequency: z.enum(['hourly', 'every_4h', 'daily']).optional(),
  dailyTokenBudget: z.number().int().min(0).optional(),
  enabledInsightTypes: z
    .array(z.enum(['stale_cards', 'risk_detection', 'relationship_suggestions', 'weekly_digest']))
    .optional(),
  staleCardThresholdDays: z.number().int().min(1).optional(),
});

export function registerBackgroundAgentHandlers(): void {
  // --- Get preferences ---
  ipcMain.handle('background-agent:get-preferences', async () => {
    await requireProFeature('backgroundAgent');
    return backgroundAgentService.getPreferences();
  });

  // --- Update preferences ---
  ipcMain.handle('background-agent:update-preferences', async (_event, data: unknown) => {
    await requireProFeature('backgroundAgent');
    const validData = validateInput(backgroundAgentPreferencesUpdateSchema, data);
    await backgroundAgentService.updatePreferences(validData);
  });

  // --- Get insights for a project ---
  ipcMain.handle(
    'background-agent:get-insights',
    async (_event, projectId: unknown, options: unknown) => {
      await requireProFeature('backgroundAgent');
      const validProjectId = validateInput(idParamSchema, projectId);
      const validOptions = validateInput(
        z.object({
          status: z.enum(['new', 'read', 'dismissed', 'acted_on']).optional(),
          type: z
            .enum(['stale_cards', 'risk_detection', 'relationship_suggestions', 'weekly_digest'])
            .optional(),
          limit: z.number().int().min(1).max(200).optional(),
        }).optional(),
        options ?? undefined,
      );
      return backgroundAgentService.getInsights(validProjectId, validOptions ?? {});
    },
  );

  // --- Count of all new insights (badge) ---
  ipcMain.handle('background-agent:get-new-count', async () => {
    await requireProFeature('backgroundAgent');
    return backgroundAgentService.getAllNewInsightsCount();
  });

  // --- Mark insight as read ---
  ipcMain.handle('background-agent:mark-read', async (_event, id: unknown) => {
    await requireProFeature('backgroundAgent');
    const validId = validateInput(idParamSchema, id);
    await backgroundAgentService.markAsRead(validId);
  });

  // --- Dismiss insight ---
  ipcMain.handle('background-agent:dismiss', async (_event, id: unknown) => {
    await requireProFeature('backgroundAgent');
    const validId = validateInput(idParamSchema, id);
    await backgroundAgentService.dismissInsight(validId);
  });

  // --- Mark insight as acted on ---
  ipcMain.handle('background-agent:mark-acted-on', async (_event, id: unknown) => {
    await requireProFeature('backgroundAgent');
    const validId = validateInput(idParamSchema, id);
    await backgroundAgentService.markActedOn(validId);
  });

  // --- Run now (manual trigger) ---
  ipcMain.handle('background-agent:run-now', async () => {
    await requireProFeature('backgroundAgent');
    try {
      await checkAndRunInsights();
      return { ran: true };
    } catch (error) {
      return { ran: false, reason: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // --- Get daily token usage ---
  ipcMain.handle('background-agent:get-daily-usage', async () => {
    await requireProFeature('backgroundAgent');
    return backgroundAgentService.getDailyUsage();
  });
}
