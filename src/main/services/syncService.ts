// === FILE PURPOSE ===
// Core sync engine for bidirectional sync between local PGlite and Supabase.
// Pull-sync fetches web changes first, then push-sync uploads local changes.
// Supports periodic sync (every 60s), manual "Sync Now" triggers, and
// Realtime-triggered instant pull via Supabase broadcast channel.

// === DEPENDENCIES ===
// @supabase/supabase-js, drizzle-orm, electron (BrowserWindow)

// === LIMITATIONS ===
// - Junction tables (card_labels, idea_tags) use full replace sync
// - Tables without updatedAt use createdAt for watermark tracking
// - Audio recordings and prep briefings are never synced
// - Delete reconciliation runs during full sync to remove locally-orphaned rows

import { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { BrowserWindow } from 'electron';
import { eq, gt, inArray, sql } from 'drizzle-orm';
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
const PULL_DEBOUNCE_MS = 5_000; // 5 seconds — max once per 5s for realtime-triggered pulls
const PULL_BATCH_LIMIT = 500; // Max rows to pull per table per cycle
const BATCH_SIZE = 100;
const SETTINGS_KEY_SYNC_ENABLED = 'sync.enabled';
const SETTINGS_KEY_LAST_SYNCED = 'sync.lastSyncedAt';
const PULL_TRACKING_PREFIX = 'pull_'; // sync_tracking key prefix for pull watermarks
const REALTIME_CHANNEL_NAME = 'sync-signal';

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

// Reverse map: snake_case → camelCase (built from CAMEL_TO_SNAKE)
const SNAKE_TO_CAMEL: Record<string, string> = Object.fromEntries(
  Object.entries(CAMEL_TO_SNAKE).map(([camel, snake]) => [snake, camel]),
);

function snakeToCamel(key: string): string {
  return SNAKE_TO_CAMEL[key] || key;
}

/**
 * Transform a row from Supabase (snake_case keys) to PGlite/Drizzle (camelCase keys),
 * stripping user_id and excluded columns.
 */
function transformRowFromRemote(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row: Record<string, any>,
  excludeColumns: string[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transformed: Record<string, any> = {};

  for (const [key, value] of Object.entries(row)) {
    if (key === 'user_id') continue; // user_id only exists in Supabase, not in local PGlite
    const camelKey = snakeToCamel(key);
    if (excludeColumns.includes(camelKey)) continue;
    transformed[camelKey] = value;
  }

  return transformed;
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

    let hasErrors = false;

    try {
      // --- Phase 1: Pull remote changes into local PGlite ---
      const pullHadChanges = await this.pullSync(userId);

      // --- Phase 2: Push local changes to Supabase ---
      for (const tableConfig of SYNC_TABLES) {
        try {
          await this.pushTable(tableConfig, userId);
        } catch (err) {
          hasErrors = true;
          const message = err instanceof Error ? err.message : String(err);
          log.error(`Failed to push table ${tableConfig.name}:`, message);
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

  /**
   * Push a single table — either incremental (watermark) or full (junction).
   */
  private async pushTable(config: SyncTableConfig, userId: string): Promise<void> {
    const db = getDb();

    if (config.isJunction) {
      await this.pushJunctionTable(config, userId);
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
   * Full replace push for junction tables (card_labels, idea_tags).
   * These have no updatedAt so we delete all user rows and re-insert.
   */
  private async pushJunctionTable(config: SyncTableConfig, userId: string): Promise<void> {
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

  // --- Pull-sync methods ---

  /**
   * Pull remote changes from Supabase into local PGlite.
   * Iterates all SYNC_TABLES, pulling rows changed since last pull.
   * When reconcileDeletesFlag is true, also removes local rows deleted on web.
   * Returns true if any rows were pulled (so the renderer can refresh).
   */
  private async pullSync(userId: string, reconcileDeletesFlag = true): Promise<boolean> {
    let totalPulled = 0;
    let parentTablesChanged = false;

    // Pull regular (non-junction) tables first
    for (const config of SYNC_TABLES) {
      if (config.isJunction) continue;
      try {
        const pulled = await this.pullTable(config, userId);
        totalPulled += pulled;
        if (pulled > 0) parentTablesChanged = true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(`Pull failed for table ${config.name}: ${message}`);
        this.emitError(config.name, `Pull failed: ${message}`);
        // Continue to next table — pull failure does NOT block push
      }
    }

    // Pull junction tables only if any parent table had changes (optimization)
    if (parentTablesChanged) {
      for (const config of SYNC_TABLES) {
        if (!config.isJunction) continue;
        try {
          const pulled = await this.pullJunctionTable(config, userId);
          totalPulled += pulled;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log.warn(`Pull failed for junction table ${config.name}: ${message}`);
          this.emitError(config.name, `Pull failed: ${message}`);
        }
      }
    }

    // --- Phase 3: Reconcile deletes (remove local rows deleted on web) ---
    // Only during full sync cycles, not realtime-triggered pulls
    if (reconcileDeletesFlag) {
      const deletedCount = await this.reconcileDeletes(userId);
      totalPulled += deletedCount;
    }

    if (totalPulled > 0) {
      log.info(`Pull sync completed: ${totalPulled} total rows pulled/deleted`);
    } else {
      log.debug('Pull sync completed: no remote changes');
    }

    return totalPulled > 0;
  }

  /**
   * Pull a single regular table from Supabase.
   * Uses last_pulled_at watermark (separate from push watermark).
   * Returns the number of rows pulled.
   */
  private async pullTable(config: SyncTableConfig, userId: string): Promise<number> {
    const db = getDb();
    const pullTrackingKey = `${PULL_TRACKING_PREFIX}${config.name}`;

    // Get last_pulled_at watermark
    const watermarkRows = await db
      .select()
      .from(syncTracking)
      .where(eq(syncTracking.tableName, pullTrackingKey));

    const lastPulledAt = watermarkRows.length > 0 ? watermarkRows[0].lastSyncedAt : null;

    // Query Supabase for rows changed since last pull
    let query = this.supabase
      .from(config.supabaseTable)
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: true })
      .limit(PULL_BATCH_LIMIT);

    if (lastPulledAt) {
      const isoTimestamp = lastPulledAt instanceof Date
        ? lastPulledAt.toISOString()
        : String(lastPulledAt);
      // Pull rows where updated_at OR created_at is newer than last pull
      // This catches both new and modified rows
      query = query.or(`updated_at.gt.${isoTimestamp},created_at.gt.${isoTimestamp}`);
    }

    const { data: remoteRows, error } = await query;

    if (error) {
      throw new Error(`Supabase select failed for ${config.name}: ${error.message}`);
    }

    if (!remoteRows || remoteRows.length === 0) {
      log.debug(`Pull ${config.name}: no remote changes`);
      return 0;
    }

    let pulledCount = 0;

    for (const remoteRow of remoteRows) {
      const localRow = await this.getLocalRowById(config, remoteRow.id);
      const transformed = transformRowFromRemote(remoteRow, config.excludeColumns);

      if (localRow) {
        // Row exists locally — compare timestamps (last-write-wins)
        const remoteTimestamp = this.getRowTimestamp(remoteRow, config);
        const localTimestamp = this.getLocalRowTimestamp(localRow, config);

        if (remoteTimestamp > localTimestamp) {
          // Remote is newer — update local
          await this.updateLocalRow(config, transformed);
          pulledCount++;
        }
        // else: local is newer or equal — skip (push will handle it)
      } else {
        // Row doesn't exist locally — insert
        await this.insertLocalRow(config, transformed);
        pulledCount++;
      }
    }

    // Update pull watermark
    const now = new Date();
    await db.insert(syncTracking)
      .values({ tableName: pullTrackingKey, lastSyncedAt: now })
      .onConflictDoUpdate({
        target: syncTracking.tableName,
        set: { lastSyncedAt: now },
      });

    if (pulledCount > 0) {
      this.emitProgress(config.name, pulledCount, pulledCount);
      log.info(`Pulled ${pulledCount} rows for ${config.name}`);
    }

    return pulledCount;
  }

  /**
   * Pull a junction table from Supabase.
   * Full replace: fetch all remote rows for this user and replace local.
   * Returns the number of rows pulled.
   */
  private async pullJunctionTable(config: SyncTableConfig, userId: string): Promise<number> {
    const db = getDb();

    // Fetch all remote rows for this user
    const { data: remoteRows, error } = await this.supabase
      .from(config.supabaseTable)
      .select('*')
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Supabase select failed for ${config.name}: ${error.message}`);
    }

    if (!remoteRows) return 0;

    // Delete all local rows and re-insert from remote
    // Use raw SQL since Drizzle delete().from() without a where would delete everything
    await db.delete(config.drizzleTable);

    if (remoteRows.length === 0) {
      log.debug(`Pull ${config.name}: remote has no rows (cleared local)`);
      return 0;
    }

    // Transform and insert all remote rows
    const transformed = remoteRows.map((row: Record<string, unknown>) =>
      transformRowFromRemote(row, config.excludeColumns),
    );

    for (const row of transformed) {
      await db.insert(config.drizzleTable).values(row);
    }

    log.info(`Pulled ${transformed.length} rows for junction table ${config.name}`);
    return transformed.length;
  }

  /**
   * Look up a local row by its primary key (id).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async getLocalRowById(config: SyncTableConfig, id: string): Promise<Record<string, any> | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(config.drizzleTable)
      .where(eq(config.drizzleTable.id, id));
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Get the effective timestamp from a remote Supabase row for comparison.
   * Prefers updated_at, falls back to created_at.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getRowTimestamp(row: Record<string, any>, config: SyncTableConfig): number {
    const ts = row.updated_at || row.created_at;
    return ts ? new Date(ts).getTime() : 0;
  }

  /**
   * Get the effective timestamp from a local Drizzle row for comparison.
   * Prefers updatedAt, falls back to createdAt.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getLocalRowTimestamp(row: Record<string, any>, config: SyncTableConfig): number {
    const ts = row.updatedAt || row.createdAt;
    return ts ? new Date(ts).getTime() : 0;
  }

  /**
   * Update an existing local row with data pulled from Supabase.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async updateLocalRow(config: SyncTableConfig, row: Record<string, any>): Promise<void> {
    const db = getDb();
    const { id, ...rest } = row;
    await db
      .update(config.drizzleTable)
      .set(rest)
      .where(eq(config.drizzleTable.id, id));
  }

  /**
   * Insert a new local row with data pulled from Supabase.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async insertLocalRow(config: SyncTableConfig, row: Record<string, any>): Promise<void> {
    const db = getDb();
    await db.insert(config.drizzleTable).values(row);
  }

  /**
   * Reconcile deletes: find local rows that no longer exist in Supabase
   * (hard-deleted on web) and remove them from PGlite.
   * Only checks non-junction tables with an 'id' primary key.
   * Junction tables are already handled by full-replace in pullJunctionTable.
   */
  private async reconcileDeletes(userId: string): Promise<number> {
    const db = getDb();
    let totalDeleted = 0;

    for (const config of SYNC_TABLES) {
      if (config.isJunction) continue; // Junctions use full replace — already handled

      try {
        // Fetch all remote IDs for this user
        const { data: remoteRows, error } = await this.supabase
          .from(config.supabaseTable)
          .select('id')
          .eq('user_id', userId);

        if (error) {
          log.warn(`Delete reconciliation failed for ${config.name}: ${error.message}`);
          continue;
        }

        const remoteIds = new Set((remoteRows || []).map((r: { id: string }) => r.id));

        // Fetch all local IDs
        const localRows = await db
          .select({ id: config.drizzleTable.id })
          .from(config.drizzleTable);

        // Find orphaned local rows (exist locally but not remotely)
        const orphanIds = localRows
          .map((r: { id: string }) => r.id)
          .filter((id: string) => !remoteIds.has(id));

        if (orphanIds.length === 0) continue;

        // Delete orphaned rows in batches
        for (let i = 0; i < orphanIds.length; i += BATCH_SIZE) {
          const batch = orphanIds.slice(i, i + BATCH_SIZE);
          await db
            .delete(config.drizzleTable)
            .where(inArray(config.drizzleTable.id, batch));
        }

        totalDeleted += orphanIds.length;
        log.info(`Deleted ${orphanIds.length} orphaned rows from ${config.name}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(`Delete reconciliation error for ${config.name}: ${message}`);
        // Continue — don't block other tables
      }
    }

    return totalDeleted;
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

        try {
          // Skip delete reconciliation for realtime pulls (too aggressive; full sync handles it)
          const hadChanges = await this.pullSync(authState.user.id, false);
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
