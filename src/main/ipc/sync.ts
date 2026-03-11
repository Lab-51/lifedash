// === FILE PURPOSE ===
// IPC handlers for cloud sync auth and status.
// Handles sign-in (via auth webview), sign-out, auth state, sync toggle, and sync trigger.

// === DEPENDENCIES ===
// electron (ipcMain), authService, supabaseClient, syncService

import { BrowserWindow, ipcMain } from 'electron';
import { eq } from 'drizzle-orm';
import { openAuthWindow, signOut, getAuthState } from '../services/authService';
import { getSyncService } from '../services/syncService';
import { getDb } from '../db/connection';
import { settings } from '../db/schema';
import { validateInput } from '../../shared/validation/ipc-validator';
import { booleanParamSchema } from '../../shared/validation/schemas';
import { createLogger } from '../services/logger';
import type { SyncStatus } from '../../shared/types/sync';

const log = createLogger('SyncIPC');

const SETTINGS_KEY_SYNC_ENABLED = 'sync.enabled';

export function registerSyncHandlers(mainWindow: BrowserWindow): void {
  // Get current auth state
  ipcMain.handle('sync:get-auth-state', async () => {
    try {
      return await getAuthState();
    } catch (err) {
      log.error('Failed to get auth state:', err);
      return {
        isAuthenticated: false,
        user: null,
        lastSyncedAt: null,
      };
    }
  });

  // Open auth window and sign in
  ipcMain.handle('sync:sign-in', async () => {
    try {
      return await openAuthWindow();
    } catch (err) {
      log.error('Sign-in failed:', err);
      throw new Error('Sign-in failed. Please try again.');
    }
  });

  // Sign out
  ipcMain.handle('sync:sign-out', async () => {
    try {
      await signOut();
      // Notify all renderer subscribers (TitleBar, Settings, etc.) that sync
      // is disconnected so every useSyncStatus() instance updates immediately.
      mainWindow.webContents.send('sync:status-changed', {
        status: 'disconnected' as SyncStatus,
        lastSyncedAt: null,
      });
    } catch (err) {
      log.error('Sign-out failed:', err);
      throw new Error('Sign-out failed.');
    }
  });

  // Get current sync status
  ipcMain.handle('sync:get-status', async (): Promise<SyncStatus> => {
    try {
      const authState = await getAuthState();
      if (!authState.isAuthenticated) return 'disconnected';

      const db = getDb();
      const rows = await db
        .select()
        .from(settings)
        .where(eq(settings.key, SETTINGS_KEY_SYNC_ENABLED));

      const enabled = rows.length > 0 && rows[0].value === 'true';
      if (!enabled) return 'disconnected';

      // Placeholder — Task 2 will implement actual sync status tracking
      return 'synced';
    } catch (err) {
      log.error('Failed to get sync status:', err);
      return 'error';
    }
  });

  // Toggle sync enabled/disabled
  ipcMain.handle('sync:toggle-enabled', async (_event, enabled: unknown) => {
    const validEnabled = validateInput(booleanParamSchema, enabled);
    const db = getDb();
    const value = validEnabled ? 'true' : 'false';

    await db.insert(settings)
      .values({ key: SETTINGS_KEY_SYNC_ENABLED, value })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value, updatedAt: new Date() },
      });

    log.info(`Sync ${validEnabled ? 'enabled' : 'disabled'}`);
  });

  // Manual sync trigger — calls the sync service
  ipcMain.handle('sync:trigger-now', async () => {
    const authState = await getAuthState();
    if (!authState.isAuthenticated) {
      throw new Error('Not authenticated. Sign in first.');
    }

    const syncService = getSyncService();
    if (!syncService) {
      log.warn('Sync service not initialized');
      return { status: 'error' as SyncStatus, message: 'Sync service not initialized' };
    }

    log.info('Manual sync triggered');
    return syncService.syncNow();
  });
}
