// === FILE PURPOSE ===
// IPC handlers for AI task structuring operations.
// Bridges renderer requests to the taskStructuringService.

// === DEPENDENCIES ===
// - taskStructuringService (generateProjectPlan, generateQuickPlan, generateTaskBreakdown)

// === LIMITATIONS ===
// - No streaming — responses are returned as complete JSON payloads

import { ipcMain } from 'electron';
import {
  generateProjectPlan,
  generateQuickPlan,
  generateTaskBreakdown,
} from '../services/taskStructuringService';

export function registerTaskStructuringHandlers(): void {
  ipcMain.handle(
    'task-structuring:generate-plan',
    async (_event, projectId: string, description?: string) => {
      return generateProjectPlan(projectId, description);
    },
  );

  ipcMain.handle(
    'task-structuring:quick-plan',
    async (_event, name: string, description: string) => {
      return generateQuickPlan(name, description);
    },
  );

  ipcMain.handle(
    'task-structuring:breakdown',
    async (_event, cardId: string) => {
      return generateTaskBreakdown(cardId);
    },
  );
}
