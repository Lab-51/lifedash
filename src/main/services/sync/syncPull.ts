// Pull-from-remote logic: fetches Supabase changes into local PGlite.
// Handles incremental pull (watermark-based), junction full-replace, and delete reconciliation.

import { SupabaseClient } from '@supabase/supabase-js';
import { eq, inArray } from 'drizzle-orm';
import { getDb } from '../../db/connection';
import { syncTracking } from '../../db/schema';
import { createLogger } from '../logger';
import { BATCH_SIZE, PULL_BATCH_LIMIT, PULL_TRACKING_PREFIX, SYNC_TABLES, transformRowFromRemote } from './syncConfig';
import type { SyncTableConfig } from './syncConfig';

const log = createLogger('SyncPull');

/** Progress/error callbacks so pull logic can report to the coordinator. */
export interface PullCallbacks {
  emitProgress: (table: string, synced: number, total: number) => void;
  emitError: (table: string, error: string) => void;
}

/**
 * Pull remote changes from Supabase into local PGlite.
 * Iterates all SYNC_TABLES, pulling rows changed since last pull.
 * When reconcileDeletesFlag is true, also removes local rows deleted on web.
 * Returns true if any rows were pulled (so the renderer can refresh).
 */
export async function pullSync(
  supabase: SupabaseClient,
  userId: string,
  callbacks: PullCallbacks,
  reconcileDeletesFlag = true,
): Promise<boolean> {
  let totalPulled = 0;
  let parentTablesChanged = false;

  // Pull regular (non-junction) tables first
  for (const config of SYNC_TABLES) {
    if (config.isJunction) continue;
    try {
      const pulled = await pullTable(supabase, config, userId);
      totalPulled += pulled;
      if (pulled > 0) parentTablesChanged = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`Pull failed for table ${config.name}: ${message}`);
      callbacks.emitError(config.name, `Pull failed: ${message}`);
      // Continue to next table — pull failure does NOT block push
    }
  }

  // Pull junction tables only if any parent table had changes (optimization)
  if (parentTablesChanged) {
    for (const config of SYNC_TABLES) {
      if (!config.isJunction) continue;
      try {
        const pulled = await pullJunctionTable(supabase, config, userId);
        totalPulled += pulled;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(`Pull failed for junction table ${config.name}: ${message}`);
        callbacks.emitError(config.name, `Pull failed: ${message}`);
      }
    }
  }

  // --- Reconcile deletes (remove local rows deleted on web) ---
  // Only during full sync cycles, not realtime-triggered pulls
  if (reconcileDeletesFlag) {
    const deletedCount = await reconcileDeletes(supabase, userId);
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
async function pullTable(supabase: SupabaseClient, config: SyncTableConfig, userId: string): Promise<number> {
  const db = getDb();
  const pullTrackingKey = `${PULL_TRACKING_PREFIX}${config.name}`;

  // Get last_pulled_at watermark
  const watermarkRows = await db.select().from(syncTracking).where(eq(syncTracking.tableName, pullTrackingKey));

  const lastPulledAt = watermarkRows.length > 0 ? watermarkRows[0].lastSyncedAt : null;

  // Query Supabase for rows changed since last pull.
  // Use the table's watermark column for ordering and filtering.
  // Tables without updated_at (e.g., brainstorm_messages) use created_at only.
  const hasUpdatedAt = config.watermarkDbColumn === 'updated_at';
  const orderColumn = hasUpdatedAt ? 'updated_at' : 'created_at';

  let query = supabase
    .from(config.supabaseTable)
    .select('*')
    .eq('user_id', userId)
    .order(orderColumn, { ascending: true })
    .limit(PULL_BATCH_LIMIT);

  if (lastPulledAt) {
    const isoTimestamp = lastPulledAt instanceof Date ? lastPulledAt.toISOString() : String(lastPulledAt);
    // Pull rows changed since last pull — include both updated_at and created_at
    // if the table has updated_at, otherwise just created_at
    if (hasUpdatedAt) {
      query = query.or(`updated_at.gt.${isoTimestamp},created_at.gt.${isoTimestamp}`);
    } else {
      query = query.gt('created_at', isoTimestamp);
    }
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
    const localRow = await getLocalRowById(config, remoteRow.id);
    const transformed = transformRowFromRemote(remoteRow, config.excludeColumns);

    if (localRow) {
      // Row exists locally — compare timestamps (last-write-wins)
      const remoteTimestamp = getRowTimestamp(remoteRow);
      const localTimestamp = getLocalRowTimestamp(localRow);

      if (remoteTimestamp > localTimestamp) {
        // Remote is newer — update local
        await updateLocalRow(config, transformed);
        pulledCount++;
      }
      // else: local is newer or equal — skip (push will handle it)
    } else {
      // Row doesn't exist locally — insert
      await insertLocalRow(config, transformed);
      pulledCount++;
    }
  }

  // Update pull watermark
  const now = new Date();
  await db
    .insert(syncTracking)
    .values({ tableName: pullTrackingKey, lastSyncedAt: now })
    .onConflictDoUpdate({
      target: syncTracking.tableName,
      set: { lastSyncedAt: now },
    });

  if (pulledCount > 0) {
    log.info(`Pulled ${pulledCount} rows for ${config.name}`);
  }

  return pulledCount;
}

/**
 * Pull a junction table from Supabase.
 * Full replace: fetch all remote rows for this user and replace local.
 * Returns the number of rows pulled.
 */
async function pullJunctionTable(supabase: SupabaseClient, config: SyncTableConfig, userId: string): Promise<number> {
  const db = getDb();

  // Fetch all remote rows for this user
  const { data: remoteRows, error } = await supabase.from(config.supabaseTable).select('*').eq('user_id', userId);

  if (error) {
    throw new Error(`Supabase select failed for ${config.name}: ${error.message}`);
  }

  if (!remoteRows) return 0;

  // Delete all local rows and re-insert from remote
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

// --- Helper functions ---

/**
 * Look up a local row by its primary key (id).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getLocalRowById(config: SyncTableConfig, id: string): Promise<Record<string, any> | null> {
  const db = getDb();
  const rows = await db.select().from(config.drizzleTable).where(eq(config.drizzleTable.id, id));
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Get the effective timestamp from a remote Supabase row for comparison.
 * Prefers updated_at, falls back to created_at.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRowTimestamp(row: Record<string, any>): number {
  const ts = row.updated_at || row.created_at;
  return ts ? new Date(ts).getTime() : 0;
}

/**
 * Get the effective timestamp from a local Drizzle row for comparison.
 * Prefers updatedAt, falls back to createdAt.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getLocalRowTimestamp(row: Record<string, any>): number {
  const ts = row.updatedAt || row.createdAt;
  return ts ? new Date(ts).getTime() : 0;
}

/**
 * Update an existing local row with data pulled from Supabase.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function updateLocalRow(config: SyncTableConfig, row: Record<string, any>): Promise<void> {
  const db = getDb();
  const { id, ...rest } = row;
  await db.update(config.drizzleTable).set(rest).where(eq(config.drizzleTable.id, id));
}

/**
 * Insert a new local row with data pulled from Supabase.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function insertLocalRow(config: SyncTableConfig, row: Record<string, any>): Promise<void> {
  const db = getDb();
  await db.insert(config.drizzleTable).values(row);
}

// --- Delete reconciliation ---

/**
 * Safety check: only reconcile deletes for a table if we have previously
 * completed at least one successful push for it. Without a push watermark
 * the remote may be empty simply because we haven't uploaded yet — deleting
 * all local rows in that case would cause total data loss.
 */
async function hasCompletedPush(tableName: string): Promise<boolean> {
  const db = getDb();
  const rows = await db.select().from(syncTracking).where(eq(syncTracking.tableName, tableName));
  return rows.length > 0 && rows[0].lastSyncedAt !== null;
}

/**
 * Reconcile deletes: find local rows that no longer exist in Supabase
 * (hard-deleted on web) and remove them from PGlite.
 * Only checks non-junction tables with an 'id' primary key.
 * Junction tables are already handled by full-replace in pullJunctionTable.
 */
async function reconcileDeletes(supabase: SupabaseClient, userId: string): Promise<number> {
  const db = getDb();
  let totalDeleted = 0;

  for (const config of SYNC_TABLES) {
    if (config.isJunction) continue; // Junctions use full replace — already handled

    try {
      // SAFETY: Skip delete reconciliation if we've never pushed this table.
      // If there's no push watermark, the remote is likely empty because we
      // haven't uploaded yet — not because the user deleted everything on web.
      const pushed = await hasCompletedPush(config.name);
      if (!pushed) {
        log.debug(`Skipping delete reconciliation for ${config.name}: no push watermark yet`);
        continue;
      }

      // Fetch all remote IDs for this user
      const { data: remoteRows, error } = await supabase.from(config.supabaseTable).select('id').eq('user_id', userId);

      if (error) {
        log.warn(`Delete reconciliation failed for ${config.name}: ${error.message}`);
        continue;
      }

      const remoteIds = new Set((remoteRows || []).map((r: { id: string }) => r.id));

      // SAFETY: If the remote returned zero rows but we have local data,
      // something is likely wrong (network issue, RLS policy, empty account).
      // Never bulk-delete all local data — that's almost certainly not intentional.
      if (remoteIds.size === 0) {
        log.warn(
          `Delete reconciliation skipped for ${config.name}: remote returned 0 rows (refusing to delete all local data)`,
        );
        continue;
      }

      // Fetch all local IDs
      const localRows = await db.select({ id: config.drizzleTable.id }).from(config.drizzleTable);

      // Find orphaned local rows (exist locally but not remotely)
      const orphanIds = localRows.map((r: { id: string }) => r.id).filter((id: string) => !remoteIds.has(id));

      if (orphanIds.length === 0) continue;

      // SAFETY: If orphans would be more than 50% of local rows, refuse.
      // This catches edge cases like partial remote responses or pagination issues.
      const orphanRatio = orphanIds.length / localRows.length;
      if (orphanRatio > 0.5 && orphanIds.length > 5) {
        log.warn(
          `Delete reconciliation skipped for ${config.name}: ${orphanIds.length}/${localRows.length} rows ` +
            `(${Math.round(orphanRatio * 100)}%) would be deleted — exceeds safety threshold`,
        );
        continue;
      }

      // Delete orphaned rows in batches
      for (let i = 0; i < orphanIds.length; i += BATCH_SIZE) {
        const batch = orphanIds.slice(i, i + BATCH_SIZE);
        await db.delete(config.drizzleTable).where(inArray(config.drizzleTable.id, batch));
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
