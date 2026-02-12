// === FILE PURPOSE ===
// IPC handlers for app settings (key-value store).
// Supports get, set (upsert), get-all, and delete operations.

// === DEPENDENCIES ===
// drizzle-orm (eq operator), electron (ipcMain)

// === LIMITATIONS ===
// - No validation on key/value contents (caller responsibility)
// - Values are stored as plain text strings (use JSON.stringify for objects)

import { ipcMain } from 'electron';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { settings } from '../db/schema';

export function registerSettingsHandlers(): void {
  // Get a single setting by key; returns null if not found
  ipcMain.handle('settings:get', async (_event, key: string) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(settings)
      .where(eq(settings.key, key));
    return rows.length > 0 ? rows[0].value : null;
  });

  // Set (upsert) a setting — inserts or updates on conflict
  ipcMain.handle(
    'settings:set',
    async (_event, key: string, value: string) => {
      const db = getDb();
      await db
        .insert(settings)
        .values({ key, value })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value, updatedAt: new Date() },
        });
    },
  );

  // Get all settings as a Record<key, value>
  ipcMain.handle('settings:get-all', async () => {
    const db = getDb();
    const rows = await db.select().from(settings);
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  });

  // Delete a setting by key
  ipcMain.handle('settings:delete', async (_event, key: string) => {
    const db = getDb();
    await db.delete(settings).where(eq(settings.key, key));
  });
}
