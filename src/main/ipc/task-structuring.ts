// === FILE PURPOSE ===
// IPC handlers for AI task structuring operations.
// Bridges renderer requests to the taskStructuringService.

// === DEPENDENCIES ===
// - taskStructuringService (generateProjectPlan, generateQuickPlan, generateTaskBreakdown)

// === LIMITATIONS ===
// - No streaming — responses are returned as complete JSON payloads

import { ipcMain } from 'electron';
import { generateProjectPlan, generateQuickPlan, generateTaskBreakdown } from '../services/taskStructuringService';
import { validateInput } from '../../shared/validation/ipc-validator';
import {
  idParamSchema,
  taskStructuringNameSchema,
  taskStructuringDescriptionSchema,
} from '../../shared/validation/schemas';

export function registerTaskStructuringHandlers(): void {
  ipcMain.handle('task-structuring:generate-plan', async (_event, projectId: unknown, description?: unknown) => {
    const validProjectId = validateInput(idParamSchema, projectId);
    const validDescription =
      description !== undefined ? validateInput(taskStructuringDescriptionSchema, description) : undefined;
    return generateProjectPlan(validProjectId, validDescription);
  });

  ipcMain.handle('task-structuring:quick-plan', async (_event, name: unknown, description: unknown) => {
    const validName = validateInput(taskStructuringNameSchema, name);
    const validDescription = validateInput(taskStructuringDescriptionSchema, description);
    return generateQuickPlan(validName, validDescription);
  });

  ipcMain.handle('task-structuring:breakdown', async (_event, cardId: unknown) => {
    const validCardId = validateInput(idParamSchema, cardId);
    return generateTaskBreakdown(validCardId);
  });
}
