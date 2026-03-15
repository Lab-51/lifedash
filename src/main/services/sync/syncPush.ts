// Push-to-remote logic: uploads local PGlite changes to Supabase.
// Handles both incremental (watermark-based) and full-replace (junction) tables.

import { SupabaseClient } from '@supabase/supabase-js';
import { eq, gt } from 'drizzle-orm';
import { getDb } from '../../db/connection';
import { syncTracking } from '../../db/schema';
import { createLogger } from '../logger';
import { BATCH_SIZE, SYNC_TABLES, transformRow } from './syncConfig';
import type { SyncTableConfig } from './syncConfig';

const log = createLogger('SyncPush');

/** Progress/error callbacks so push logic can report to the coordinator. */
export interface PushCallbacks {
  emitProgress: (table: string, synced: number, total: number) => void;
  emitError: (table: string, error: string) => void;
}

/**
 * Push all tables to Supabase. Returns true if any errors occurred.
 */
export async function pushAllTables(
  supabase: SupabaseClient,
  userId: string,
  callbacks: PushCallbacks,
): Promise<boolean> {
  let hasErrors = false;

  for (const tableConfig of SYNC_TABLES) {
    try {
      await pushTable(supabase, tableConfig, userId, callbacks);
    } catch (err) {
      hasErrors = true;
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Failed to push table ${tableConfig.name}:`, message);
      callbacks.emitError(tableConfig.name, message);
      // Continue to next table — don't block other tables
    }
  }

  return hasErrors;
}

/**
 * Push a single table — either incremental (watermark) or full (junction).
 */
async function pushTable(
  supabase: SupabaseClient,
  config: SyncTableConfig,
  userId: string,
  callbacks: PushCallbacks,
): Promise<void> {
  if (config.isJunction) {
    await pushJunctionTable(supabase, config, userId, callbacks);
    return;
  }

  const db = getDb();

  // Get last sync watermark for this table
  const watermarkRows = await db.select().from(syncTracking).where(eq(syncTracking.tableName, config.name));

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
  const transformed = rows.map((row: Record<string, unknown>) => transformRow(row, userId, config.excludeColumns));

  await batchUpsert(supabase, config.supabaseTable, transformed, config.conflictTarget);

  // Update watermark
  const now = new Date();
  await db
    .insert(syncTracking)
    .values({ tableName: config.name, lastSyncedAt: now })
    .onConflictDoUpdate({
      target: syncTracking.tableName,
      set: { lastSyncedAt: now },
    });

  callbacks.emitProgress(config.name, transformed.length, transformed.length);
  log.info(`Synced ${transformed.length} rows for ${config.name}`);
}

/**
 * Full replace push for junction tables (card_labels, idea_tags).
 * These have no updatedAt so we delete all user rows and re-insert.
 */
async function pushJunctionTable(
  supabase: SupabaseClient,
  config: SyncTableConfig,
  userId: string,
  callbacks: PushCallbacks,
): Promise<void> {
  const db = getDb();

  // Get all local rows
  const rows = await db.select().from(config.drizzleTable);

  // Delete all existing rows for this user in Supabase
  const { error: deleteError } = await supabase.from(config.supabaseTable).delete().eq('user_id', userId);

  if (deleteError) {
    throw new Error(`Delete failed for ${config.name}: ${deleteError.message}`);
  }

  if (rows.length === 0) {
    log.debug(`Table ${config.name}: no rows to sync (cleared remote)`);
    return;
  }

  // Transform and insert all
  const transformed = rows.map((row: Record<string, unknown>) => transformRow(row, userId, config.excludeColumns));

  // Insert in batches
  for (let i = 0; i < transformed.length; i += BATCH_SIZE) {
    const batch = transformed.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from(config.supabaseTable).insert(batch);

    if (error) {
      throw new Error(`Insert failed for ${config.name}: ${error.message}`);
    }
  }

  callbacks.emitProgress(config.name, transformed.length, transformed.length);
  log.info(`Synced ${transformed.length} rows for junction table ${config.name}`);
}

/**
 * Upsert rows to Supabase in batches of BATCH_SIZE.
 */
async function batchUpsert(
  supabase: SupabaseClient,
  table: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: Record<string, any>[],
  conflictTarget: string,
): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from(table).upsert(batch, { onConflict: conflictTarget });

    if (error) {
      throw new Error(`Upsert failed for ${table} (batch ${i / BATCH_SIZE + 1}): ${error.message}`);
    }
  }
}
