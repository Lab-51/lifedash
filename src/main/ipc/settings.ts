// === FILE PURPOSE ===
// IPC handlers for app settings (key-value store).
// Supports get, set (upsert), get-all, and delete operations.

// === DEPENDENCIES ===
// drizzle-orm (eq operator), electron (ipcMain)

// === LIMITATIONS ===
// - No validation on key/value contents (caller responsibility)
// - Values are stored as plain text strings (use JSON.stringify for objects)

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { settings } from '../db/schema';
import { validateInput } from '../../shared/validation/ipc-validator';
import { settingKeySchema, settingValueSchema } from '../../shared/validation/schemas';
import { factoryResetAllTables } from '../services/factoryReset';
import { getProxyConfig, applyGlobalProxy } from '../services/proxyService';
import { createLogger, getLogDirectory } from '../services/logger';

const log = createLogger('Settings');

export function registerSettingsHandlers(mainWindow: BrowserWindow): void {
  // Get a single setting by key; returns null if not found
  ipcMain.handle('settings:get', async (_event, key: unknown) => {
    const validKey = validateInput(settingKeySchema, key);
    const db = getDb();
    const rows = await db.select().from(settings).where(eq(settings.key, validKey));
    return rows.length > 0 ? rows[0].value : null;
  });

  // Set (upsert) a setting — inserts or updates on conflict
  ipcMain.handle('settings:set', async (_event, key: unknown, value: unknown) => {
    const validKey = validateInput(settingKeySchema, key);
    const validValue = validateInput(settingValueSchema, value);
    const db = getDb();
    await db
      .insert(settings)
      .values({ key: validKey, value: validValue })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: validValue, updatedAt: new Date() },
      });
  });

  // Get all settings as a Record<key, value>
  ipcMain.handle('settings:get-all', async () => {
    const db = getDb();
    const rows = await db.select().from(settings);
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  });

  // Delete a setting by key
  ipcMain.handle('settings:delete', async (_event, key: unknown) => {
    const validKey = validateInput(settingKeySchema, key);
    const db = getDb();
    await db.delete(settings).where(eq(settings.key, validKey));
  });

  // Open a folder picker dialog for choosing the recordings save path
  ipcMain.handle('settings:pick-recordings-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose Recordings Folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  // Return the default recordings directory path
  ipcMain.handle('settings:get-default-recordings-path', async () => {
    return path.join(app.getPath('userData'), 'recordings');
  });

  // Get current proxy configuration (env + DB)
  ipcMain.handle('settings:getProxy', async () => {
    return await getProxyConfig();
  });

  // Apply proxy after settings change
  ipcMain.handle('settings:applyProxy', async () => {
    await applyGlobalProxy();
  });

  // Open the log files directory in the system file manager
  ipcMain.handle('settings:open-logs-folder', async () => {
    const dir = getLogDirectory();
    return await shell.openPath(dir);
  });

  // Factory reset: clear every schema table in one transaction (see factoryReset.ts)
  ipcMain.handle('settings:factory-reset', async () => {
    try {
      await factoryResetAllTables();
      log.info('Factory reset completed — all tables cleared');
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error('Factory reset failed:', error);
      return { success: false, error: message };
    }
  });
}
