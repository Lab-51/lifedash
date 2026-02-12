// === FILE PURPOSE ===
// IPC handlers for database-related operations.
// Exposes database health/status checks to the renderer process.

import { ipcMain } from 'electron';
import { checkDatabaseHealth } from '../db/connection';

export function registerDatabaseHandlers(): void {
  ipcMain.handle('db:status', async () => {
    return checkDatabaseHealth();
  });
}
