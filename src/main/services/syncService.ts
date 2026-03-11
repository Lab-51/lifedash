// === FILE PURPOSE ===
// Core sync engine that pushes local PGlite data to Supabase.
// Desktop is the source of truth — sync is push-only (local -> cloud).
// Supports periodic sync (every 60s) and manual "Sync Now" triggers.

// === DEPENDENCIES ===
// @supabase/supabase-js, drizzle-orm, electron (BrowserWindow)

// === LIMITATIONS ===
// - Push-only (no pull from Supabase)
// - Junction tables (card_labels, idea_tags) use full replace sync
// - Tables without updatedAt use createdAt for watermark tracking
// - Audio recordings and prep briefings are never synced

import { SupabaseClient } from '@supabase/supabase-js';
import { BrowserWindow } from 'electron';
import { eq, gt, sql } from 'drizzle-orm';
import { getDb } from '../db/connection';
import {
  projects,
  boards,
  columns,
  cards,
  labels,
  cardLabels,
  cardComments,
  cardChecklistItems,
  meetings,
  meetingBriefs,
  actionItems,
  ideas,
  ideaTags,
  brainstormSessions,
  brainstormMessages,
  syncTracking,
  settings,
} from '../db/schema';
import { getAuthState } from './authService';
import { createLogger } from './logger';
import type { SyncStatus } from '../../shared/types/sync';

const log = createLogger('SyncService');

const SYNC_INTERVAL_MS = 60_000; // 60 seconds
const DEBOUNCE_DELAY_MS = 5_000; // 5 seconds
const BATCH_SIZE = 100;
const SETTINGS_KEY_SYNC_ENABLED = 'sync.enabled';
const SETTINGS_KEY_LAST_SYNCED = 'sync.lastSyncedAt';

/**
 * Describes a table that can be synced. Tables with updatedAt use watermark-based
 * incremental sync; tables without it use createdAt; junction tables do full replace.
 */
interface SyncTableConfig {
  /** PGlite table name (matches Drizzle schema) */
  name: string;
  /** Drizzle table reference */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  drizzleTable: any;
  /** Supabase table name (same as PGlite since both are Postgres) */
  supabaseTable: string;
  /** Which timestamp column to use for watermarking ('updatedAt' | 'createdAt' | null for full sync) */
  watermarkColumn: string | null;
  /** DB column name for the watermark (snake_case as stored in PGlite) */
  watermarkDbColumn: string | null;
  /** Columns to exclude from sync (e.g., audioPath for meetings) */
  excludeColumns: string[];
  /** Whether this is a junction table (full replace on each sync) */
  isJunction: boolean;
  /** For upsert conflict resolution — the primary key column(s) */
  conflictTarget: string;
}

const SYNC_TABLES: SyncTableConfig[] = [
  {
    name: 'projects',
    drizzleTable: projects,
    supabaseTable: 'projects',
    watermarkColumn: 'updatedAt',
    watermarkDbColumn: 'updated_at',
    excludeColumns: [],
    isJunction: false,
    conflictTarget: 'id',
  },
  {
    name: 'boards',
    drizzleTable: boards,
    supabaseTable: 'boards',
    watermarkColumn: 'createdAt',
    watermarkDbColumn: 'created_at',
    excludeColumns: [],
    isJunction: false,
    conflictTarget: 'id',
  },
  {
    name: 'columns',
    drizzleTable: columns,
    supabaseTable: 'columns',
    watermarkColumn: 'createdAt',
    watermarkDbColumn: 'created_at',
    excludeColumns: [],
    isJunction: false,
    conflictTarget: 'id',
  },
  {
    name: 'cards',
    drizzleTable: cards,
    supabaseTable: 'cards',
    watermarkColumn: 'updatedAt',
    watermarkDbColumn: 'updated_at',
    excludeColumns: [],
    isJunction: false,
    conflictTarget: 'id',
  },
  {
    name: 'labels',
    drizzleTable: labels,
    supabaseTable: 'labels',
    watermarkColumn: 'createdAt',
    watermarkDbColumn: 'created_at',
    excludeColumns: [],
    isJunction: false,
    conflictTarget: 'id',
  },
  {
    name: 'card_labels',
    drizzleTable: cardLabels,
    supabaseTable: 'card_labels',
    watermarkColumn: null,
    watermarkDbColumn: null,
    excludeColumns: [],
    isJunction: true,
    conflictTarget: 'card_id,label_id',
  },
  {
    name: 'card_comments',
    drizzleTable: cardComments,
    supabaseTable: 'card_comments',
    watermarkColumn: 'updatedAt',
    watermarkDbColumn: 'updated_at',
    excludeColumns: [],
    isJunction: false,
    conflictTarget: 'id',
  },
  {
    name: 'card_checklist_items',
    drizzleTable: cardChecklistItems,
    supabaseTable: 'card_checklist_items',
    watermarkColumn: 'createdAt',
    watermarkDbColumn: 'created_at',
    excludeColumns: [],
    isJunction: false,
    conflictTarget: 'id',
  },
  {
    name: 'meetings',
    drizzleTable: meetings,
    supabaseTable: 'meetings',
    watermarkColumn: 'createdAt',
    watermarkDbColumn: 'created_at',
    excludeColumns: ['audioPath', 'prepBriefing'],
    isJunction: false,
    conflictTarget: 'id',
  },
  {
    name: 'meeting_briefs',
    drizzleTable: meetingBriefs,
    supabaseTable: 'meeting_briefs',
    watermarkColumn: 'createdAt',
    watermarkDbColumn: 'created_at',
    excludeColumns: [],
    isJunction: false,
    conflictTarget: 'id',
  },
  {
    name: 'action_items',
    drizzleTable: actionItems,
    supabaseTable: 'action_items',
    watermarkColumn: 'createdAt',
    watermarkDbColumn: 'created_at',
    excludeColumns: [],
    isJunction: false,
    conflictTarget: 'id',
  },
  {
    name: 'ideas',
    drizzleTable: ideas,
    supabaseTable: 'ideas',
    watermarkColumn: 'updatedAt',
    watermarkDbColumn: 'updated_at',
    excludeColumns: [],
    isJunction: false,
    conflictTarget: 'id',
  },
  {
    name: 'idea_tags',
    drizzleTable: ideaTags,
    supabaseTable: 'idea_tags',
    watermarkColumn: null,
    watermarkDbColumn: null,
    excludeColumns: [],
    isJunction: true,
    conflictTarget: 'idea_id,tag',
  },
  {
    name: 'brainstorm_sessions',
    drizzleTable: brainstormSessions,
    supabaseTable: 'brainstorm_sessions',
    watermarkColumn: 'updatedAt',
    watermarkDbColumn: 'updated_at',
    excludeColumns: [],
    isJunction: false,
    conflictTarget: 'id',
  },
  {
    name: 'brainstorm_messages',
    drizzleTable: brainstormMessages,
    supabaseTable: 'brainstorm_messages',
    watermarkColumn: 'createdAt',
    watermarkDbColumn: 'created_at',
    excludeColumns: [],
    isJunction: false,
    conflictTarget: 'id',
  },
];

// Drizzle returns camelCase keys; Supabase expects snake_case DB column names.
// This map converts camelCase property names to their snake_case DB column equivalents.
const CAMEL_TO_SNAKE: Record<string, string> = {
  projectId: 'project_id',
  boardId: 'board_id',
  columnId: 'column_id',
  cardId: 'card_id',
  labelId: 'label_id',
  meetingId: 'meeting_id',
  sessionId: 'session_id',
  ideaId: 'idea_id',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  startedAt: 'started_at',
  endedAt: 'ended_at',
  audioPath: 'audio_path',
  prepBriefing: 'prep_briefing',
  dueDate: 'due_date',
  hourlyRate: 'hourly_rate',
  recurrenceType: 'recurrence_type',
  recurrenceEndDate: 'recurrence_end_date',
  sourceRecurringId: 'source_recurring_id',
  tableName: 'table_name',
  lastSyncedAt: 'last_synced_at',
  startTime: 'start_time',
  endTime: 'end_time',
  fileName: 'file_name',
  filePath: 'file_path',
  fileSize: 'file_size',
  mimeType: 'mime_type',
  transcriptionLanguage: 'transcription_language',
  labelNames: 'label_names',
};

function camelToSnake(key: string): string {
  return CAMEL_TO_SNAKE[key] || key;
}

/**
 * Transform a row from Drizzle (camelCase keys) to Supabase (snake_case keys),
 * adding user_id and removing excluded columns.
 */
function transformRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row: Record<string, any>,
  userId: string,
  excludeColumns: string[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transformed: Record<string, any> = {};

  for (const [key, value] of Object.entries(row)) {
    if (excludeColumns.includes(key)) continue;
    const snakeKey = camelToSnake(key);
    transformed[snakeKey] = value;
  }

  transformed.user_id = userId;
  return transformed;
}

export class SyncService {
  private supabase: SupabaseClient;
  private mainWindow: BrowserWindow | null = null;
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
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

    log.info('Sync service started (periodic interval: 60s)');
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
   * Iterate all 16 tables and push changes since last sync.
   */
  private async syncAll(userId: string): Promise<void> {
    if (this.isSyncing) {
      log.debug('Sync already in progress, skipping');
      return;
    }

    this.isSyncing = true;
    this.emitStatus('syncing');

    let hasErrors = false;

    try {
      for (const tableConfig of SYNC_TABLES) {
        try {
          await this.syncTable(tableConfig, userId);
        } catch (err) {
          hasErrors = true;
          const message = err instanceof Error ? err.message : String(err);
          log.error(`Failed to sync table ${tableConfig.name}:`, message);
          this.emitError(tableConfig.name, message);
          // Continue to next table — don't block other tables
        }
      }

      // Update the global last synced timestamp
      const now = new Date().toISOString();
      const db = getDb();
      await db.insert(settings)
        .values({ key: SETTINGS_KEY_LAST_SYNCED, value: now })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: now, updatedAt: new Date() },
        });

      this.emitStatus(hasErrors ? 'error' : 'synced', now);
      log.info(`Sync completed ${hasErrors ? 'with errors' : 'successfully'}`);
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Sync a single table — either incremental (watermark) or full (junction).
   */
  private async syncTable(config: SyncTableConfig, userId: string): Promise<void> {
    const db = getDb();

    if (config.isJunction) {
      await this.syncJunctionTable(config, userId);
      return;
    }

    // Get last sync watermark for this table
    const watermarkRows = await db
      .select()
      .from(syncTracking)
      .where(eq(syncTracking.tableName, config.name));

    const lastSyncedAt = watermarkRows.length > 0 ? watermarkRows[0].lastSyncedAt : null;

    // Query rows changed since last sync
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let rows: any[];
    if (lastSyncedAt && config.watermarkDbColumn) {
      // Incremental: only rows updated/created since last sync
      rows = await db
        .select()
        .from(config.drizzleTable)
        .where(gt(config.drizzleTable[config.watermarkColumn!], lastSyncedAt));
    } else {
      // First sync or no watermark: all rows
      rows = await db.select().from(config.drizzleTable);
    }

    if (rows.length === 0) {
      log.debug(`Table ${config.name}: no changes to sync`);
      return;
    }

    // Transform and batch upsert
    const transformed = rows.map((row: Record<string, unknown>) =>
      transformRow(row, userId, config.excludeColumns),
    );

    await this.batchUpsert(config.supabaseTable, transformed, config.conflictTarget);

    // Update watermark
    const now = new Date();
    await db.insert(syncTracking)
      .values({ tableName: config.name, lastSyncedAt: now })
      .onConflictDoUpdate({
        target: syncTracking.tableName,
        set: { lastSyncedAt: now },
      });

    this.emitProgress(config.name, transformed.length, transformed.length);
    log.info(`Synced ${transformed.length} rows for ${config.name}`);
  }

  /**
   * Full replace sync for junction tables (card_labels, idea_tags).
   * These have no updatedAt so we delete all user rows and re-insert.
   */
  private async syncJunctionTable(config: SyncTableConfig, userId: string): Promise<void> {
    const db = getDb();

    // Get all local rows
    const rows = await db.select().from(config.drizzleTable);

    // Delete all existing rows for this user in Supabase
    const { error: deleteError } = await this.supabase
      .from(config.supabaseTable)
      .delete()
      .eq('user_id', userId);

    if (deleteError) {
      throw new Error(`Delete failed for ${config.name}: ${deleteError.message}`);
    }

    if (rows.length === 0) {
      log.debug(`Table ${config.name}: no rows to sync (cleared remote)`);
      return;
    }

    // Transform and insert all
    const transformed = rows.map((row: Record<string, unknown>) =>
      transformRow(row, userId, config.excludeColumns),
    );

    // Insert in batches
    for (let i = 0; i < transformed.length; i += BATCH_SIZE) {
      const batch = transformed.slice(i, i + BATCH_SIZE);
      const { error } = await this.supabase
        .from(config.supabaseTable)
        .insert(batch);

      if (error) {
        throw new Error(`Insert failed for ${config.name}: ${error.message}`);
      }
    }

    this.emitProgress(config.name, transformed.length, transformed.length);
    log.info(`Synced ${transformed.length} rows for junction table ${config.name}`);
  }

  /**
   * Upsert rows to Supabase in batches of BATCH_SIZE.
   */
  private async batchUpsert(
    table: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows: Record<string, any>[],
    conflictTarget: string,
  ): Promise<void> {
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error } = await this.supabase
        .from(table)
        .upsert(batch, { onConflict: conflictTarget });

      if (error) {
        throw new Error(`Upsert failed for ${table} (batch ${i / BATCH_SIZE + 1}): ${error.message}`);
      }
    }
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
