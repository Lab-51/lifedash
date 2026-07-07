// === FILE PURPOSE ===
// IPC handler for full-text search across sessions/cards/projects (V3.1 Task 6).

import { ipcMain } from 'electron';
import { z } from 'zod';
import * as searchService from '../services/searchService';
import { validateInput } from '../../shared/validation/ipc-validator';

export function registerSearchHandlers(): void {
  ipcMain.handle('search:query', async (_event, query: unknown) => {
    const validQuery = validateInput(z.string().min(1).max(200), query);
    return searchService.search(validQuery);
  });
}
