// === FILE PURPOSE ===
// IPC handlers for idea repository operations.

import { ipcMain } from 'electron';
import * as ideaService from '../services/ideaService';

export function registerIdeaHandlers(): void {
  ipcMain.handle('ideas:list', async () => {
    return ideaService.getIdeas();
  });

  ipcMain.handle('ideas:get', async (_event, id: string) => {
    return ideaService.getIdea(id);
  });

  ipcMain.handle('ideas:create', async (_event, data: any) => {
    return ideaService.createIdea(data);
  });

  ipcMain.handle('ideas:update', async (_event, id: string, data: any) => {
    return ideaService.updateIdea(id, data);
  });

  ipcMain.handle('ideas:delete', async (_event, id: string) => {
    return ideaService.deleteIdea(id);
  });

  ipcMain.handle('ideas:convert-to-project', async (_event, id: string) => {
    return ideaService.convertIdeaToProject(id);
  });

  ipcMain.handle('ideas:convert-to-card', async (_event, ideaId: string, columnId: string) => {
    return ideaService.convertIdeaToCard(ideaId, columnId);
  });
}
