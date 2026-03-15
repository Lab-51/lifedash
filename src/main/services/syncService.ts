// Sync service coordinator — lifecycle management, scheduling, and IPC event emission.
// Delegates push/pull logic to sync/syncPush.ts and sync/syncPull.ts.

import { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { BrowserWindow } from 'electron';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { settings } from '../db/schema';
import { getAuthState } from './authService';
import { createLogger } from './logger';
import { pushAllTables } from './sync/syncPush';
import { pullSync } from './sync/syncPull';
import {
  SYNC_INTERVAL_MS,
  DEBOUNCE_DELAY_MS,
  PULL_DEBOUNCE_MS,
  SETTINGS_KEY_SYNC_ENABLED,
  SETTINGS_KEY_LAST_SYNCED,
  REALTIME_CHANNEL_NAME,
} from './sync/syncConfig';
import type { SyncStatus } from '../../shared/types/sync';

const log = createLogger('SyncService');

export class SyncService {
  private supabase: SupabaseClient;
  private mainWindow: BrowserWindow | null = null;
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pullDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private realtimeChannel: RealtimeChannel | null = null;
  private isSyncing = false;
  private isStarted = false;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Start the sync service — begins periodic sync every 60 seconds.
   * Pass the main window so sync can emit status events to the renderer.
   */
  start(mainWindow: BrowserWindow): void {
    if (this.isStarted) return;
    this.mainWindow = mainWindow;
    this.isStarted = true;

    this.periodicTimer = setInterval(() => {
      this.syncAllIfEnabled().catch((err) => {
        log.error('Periodic sync failed:', err);
      });
    }, SYNC_INTERVAL_MS);

    this.subscribeToRealtimeSync();

    log.info('Sync service started (periodic interval: 60s, realtime pull enabled)');
  }

  /**
   * Stop the sync service — clear all timers.
   */
  stop(): void {
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.pullDebounceTimer) {
      clearTimeout(this.pullDebounceTimer);
      this.pullDebounceTimer = null;
    }
    this.unsubscribeFromRealtimeSync();
    this.isStarted = false;
    log.info('Sync service stopped');
  }

  /**
   * Debounced sync — resets timer on each call, fires after 5 seconds.
   * Use this when data mutations happen to coalesce rapid writes.
   */
  scheduleSync(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.syncAllIfEnabled().catch((err) => {
        log.error('Debounced sync failed:', err);
      });
    }, DEBOUNCE_DELAY_MS);
  }

  /**
   * Immediate full sync — called from the "Sync Now" IPC handler.
   * Returns the resulting sync status.
   */
  async syncNow(): Promise<{ status: SyncStatus; message: string }> {
    const authState = await getAuthState();
    if (!authState.isAuthenticated || !authState.user) {
      return { status: 'disconnected', message: 'Not authenticated' };
    }

    if (this.isSyncing) {
      return { status: 'syncing', message: 'Sync already in progress' };
    }

    try {
      await this.syncAll(authState.user.id);
      return { status: 'synced', message: 'Sync completed successfully' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { status: 'error', message };
    }
  }

  // --- Internal methods ---

  /**
   * Check if sync is enabled and authenticated, then run syncAll.
   */
  private async syncAllIfEnabled(): Promise<void> {
    try {
      const db = getDb();
      const rows = await db.select().from(settings).where(eq(settings.key, SETTINGS_KEY_SYNC_ENABLED));
      const enabled = rows.length > 0 && rows[0].value === 'true';
      if (!enabled) return;

      const authState = await getAuthState();
      if (!authState.isAuthenticated || !authState.user) return;

      await this.syncAll(authState.user.id);
    } catch (err) {
      log.error('syncAllIfEnabled failed:', err);
    }
  }

  /**
   * Full sync cycle: pull remote changes first, then push local changes.
   */
  private async syncAll(userId: string): Promise<void> {
    if (this.isSyncing) {
      log.debug('Sync already in progress, skipping');
      return;
    }

    this.isSyncing = true;
    this.emitStatus('syncing');

    const callbacks = {
      emitProgress: this.emitProgress.bind(this),
      emitError: this.emitError.bind(this),
    };

    try {
      // --- Phase 1: Pull remote changes into local PGlite ---
      const pullHadChanges = await pullSync(this.supabase, userId, callbacks);

      // --- Phase 2: Push local changes to Supabase ---
      const hasErrors = await pushAllTables(this.supabase, userId, callbacks);

      // Update the global last synced timestamp
      const now = new Date().toISOString();
      const db = getDb();
      await db
        .insert(settings)
        .values({ key: SETTINGS_KEY_LAST_SYNCED, value: now })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: now, updatedAt: new Date() },
        });

      // Notify renderer if pull brought in new data
      if (pullHadChanges) {
        this.emitPullComplete();
      }

      this.emitStatus(hasErrors ? 'error' : 'synced', now);
      log.info(`Sync completed ${hasErrors ? 'with errors' : 'successfully'}`);
    } finally {
      this.isSyncing = false;
    }
  }

  // --- Realtime subscription for instant pull triggers ---

  /**
   * Subscribe to the Supabase Realtime broadcast channel.
   * When the web dashboard sends a "web-edit" event, trigger an immediate pull sync
   * (debounced to max once per 5 seconds).
   */
  private subscribeToRealtimeSync(): void {
    this.realtimeChannel = this.supabase
      .channel(REALTIME_CHANNEL_NAME)
      .on('broadcast', { event: 'web-edit' }, (payload) => {
        this.handleRealtimeSyncSignal(payload);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          log.info('Subscribed to realtime sync-signal channel');
        } else if (status === 'CHANNEL_ERROR') {
          log.warn('Realtime sync-signal channel error — will retry on next sync cycle');
        }
      });
  }

  /**
   * Unsubscribe from the Realtime channel (called on stop/sign-out/quit).
   */
  private unsubscribeFromRealtimeSync(): void {
    if (this.realtimeChannel) {
      this.supabase.removeChannel(this.realtimeChannel);
      this.realtimeChannel = null;
      log.info('Unsubscribed from realtime sync-signal channel');
    }
  }

  /**
   * Handle an incoming realtime sync signal.
   * Debounced: max one pull-sync per PULL_DEBOUNCE_MS.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleRealtimeSyncSignal(payload: any): void {
    // Only react if the signal is for our user
    const signalUserId = payload?.payload?.user_id;
    if (!signalUserId) {
      log.debug('Realtime sync signal received but no user_id in payload, ignoring');
      return;
    }

    // Debounce: skip if a pull is already scheduled
    if (this.pullDebounceTimer) {
      log.debug('Realtime sync signal debounced (pull already scheduled)');
      return;
    }

    this.pullDebounceTimer = setTimeout(async () => {
      this.pullDebounceTimer = null;
      try {
        const authState = await getAuthState();
        if (!authState.isAuthenticated || !authState.user) return;
        if (authState.user.id !== signalUserId) return;

        // Check if sync is enabled
        const db = getDb();
        const rows = await db.select().from(settings).where(eq(settings.key, SETTINGS_KEY_SYNC_ENABLED));
        const enabled = rows.length > 0 && rows[0].value === 'true';
        if (!enabled) return;

        // If a full sync is already running, skip — it will include pull
        if (this.isSyncing) {
          log.debug('Realtime pull skipped — full sync already in progress');
          return;
        }

        log.info('Realtime sync signal received — running immediate pull sync');
        this.isSyncing = true;
        this.emitStatus('syncing');

        const callbacks = {
          emitProgress: this.emitProgress.bind(this),
          emitError: this.emitError.bind(this),
        };

        try {
          // Skip delete reconciliation for realtime pulls (too aggressive; full sync handles it)
          const hadChanges = await pullSync(this.supabase, authState.user.id, callbacks, false);
          if (hadChanges) {
            this.emitPullComplete();
          }
          this.emitStatus('synced');
        } finally {
          this.isSyncing = false;
        }
      } catch (err) {
        log.error('Realtime-triggered pull sync failed:', err);
        this.isSyncing = false;
      }
    }, PULL_DEBOUNCE_MS);
  }

  // --- Event emitters ---

  private emitStatus(status: SyncStatus, lastSyncedAt?: string): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    this.mainWindow.webContents.send('sync:status-changed', {
      status,
      lastSyncedAt: lastSyncedAt || null,
    });
  }

  private emitProgress(table: string, synced: number, total: number): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    this.mainWindow.webContents.send('sync:progress', { table, synced, total });
  }

  private emitError(table: string, error: string): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    this.mainWindow.webContents.send('sync:error', { table, error });
  }

  /**
   * Notify the renderer that pull sync brought in new data so the UI can refresh.
   */
  private emitPullComplete(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    this.mainWindow.webContents.send('sync:pull-complete');
  }
}

// --- Module-level singleton ---

let syncServiceInstance: SyncService | null = null;

/**
 * Initialize the sync service singleton. Called once from main.ts after DB and auth are ready.
 */
export function initSyncService(supabase: SupabaseClient, mainWindow: BrowserWindow): SyncService {
  if (syncServiceInstance) {
    syncServiceInstance.stop();
  }
  syncServiceInstance = new SyncService(supabase);
  syncServiceInstance.start(mainWindow);
  return syncServiceInstance;
}

/**
 * Get the sync service singleton. Returns null if not initialized.
 */
export function getSyncService(): SyncService | null {
  return syncServiceInstance;
}

/**
 * Stop and clean up the sync service. Called on app quit.
 */
export function stopSyncService(): void {
  if (syncServiceInstance) {
    syncServiceInstance.stop();
    syncServiceInstance = null;
  }
}
