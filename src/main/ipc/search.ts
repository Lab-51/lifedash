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

  // V3.4 knowledge Q&A — the explicit "Ask" action. A dedicated channel (NOT a
  // flag on search:query) so per-keystroke search never triggers a model call.
  // Returns SearchAnswer | null — grounded-only retrieval + the single knowledge_qa
  // call live behind searchService.askKnowledge (honest sentinel, null on failure).
  ipcMain.handle('search:ask', async (_event, query: unknown) => {
    const validQuery = validateInput(z.string().min(1).max(500), query);
    return searchService.askKnowledge(validQuery);
  });
}
