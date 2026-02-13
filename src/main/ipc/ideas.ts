// === FILE PURPOSE ===
// IPC handlers for idea repository operations.

import { ipcMain } from 'electron';
import * as ideaService from '../services/ideaService';
import { validateInput } from '../../shared/validation/ipc-validator';
import {
  idParamSchema,
  createIdeaInputSchema,
  updateIdeaInputSchema,
} from '../../shared/validation/schemas';

export function registerIdeaHandlers(): void {
  ipcMain.handle('ideas:list', async () => {
    return ideaService.getIdeas();
  });

  ipcMain.handle('ideas:get', async (_event, id: unknown) => {
    const validId = validateInput(idParamSchema, id);
    return ideaService.getIdea(validId);
  });

  ipcMain.handle('ideas:create', async (_event, data: unknown) => {
    const input = validateInput(createIdeaInputSchema, data);
    return ideaService.createIdea(input);
  });

  ipcMain.handle('ideas:update', async (_event, id: unknown, data: unknown) => {
    const validId = validateInput(idParamSchema, id);
    const input = validateInput(updateIdeaInputSchema, data);
    return ideaService.updateIdea(validId, input);
  });

  ipcMain.handle('ideas:delete', async (_event, id: unknown) => {
    const validId = validateInput(idParamSchema, id);
    return ideaService.deleteIdea(validId);
  });

  ipcMain.handle('ideas:convert-to-project', async (_event, id: unknown) => {
    const validId = validateInput(idParamSchema, id);
    return ideaService.convertIdeaToProject(validId);
  });

  ipcMain.handle('ideas:convert-to-card', async (_event, ideaId: unknown, columnId: unknown) => {
    const validIdeaId = validateInput(idParamSchema, ideaId);
    const validColumnId = validateInput(idParamSchema, columnId);
    return ideaService.convertIdeaToCard(validIdeaId, validColumnId);
  });

  ipcMain.handle('idea:analyze', async (_event, id: unknown) => {
    const validId = validateInput(idParamSchema, id);
    return ideaService.analyzeIdea(validId);
  });
}
