// === FILE PURPOSE ===
// The restore engine: replaces the tables a backup holds and leaves every other table
// intact and consistent. Runs inside the caller's transaction, so any failure rolls the
// whole restore back.
//
// How it avoids the old data loss:
// - Only tables present in the backup are emptied, and with FK cascades suppressed
//   (session_replication_role = replica), so emptying `meetings` no longer wipes
//   entity facts, agent threads or checklist items the backup never contained.
// - Rows are re-inserted parents-first. A row whose parent is missing gets that FK's
//   declared on-delete rule (null the column, or drop the row) instead of failing the
//   insert, so even an inconsistent dump restores.
// - Tables the backup does not hold then get the same on-delete rules for rows whose
//   parent did not come back — exactly what a normal delete of that parent would do.
// - This machine's current API key always wins by provider id; a key in the file (only
//   pre-restore safety backups carry one) fills only providers that have none here.
// - Settings are merged, and machine-state settings are never touched (isMachineStateSetting).

import { sql } from 'drizzle-orm';
import type { getDb } from '../db/connection';
import { aiProviders, settings } from '../db/schema';
import { getBackupTables, type BackupFk, type BackupTable } from './backupSchema';

type Db = ReturnType<typeof getDb>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type Row = Record<string, unknown>;
export type BackupRows = Record<string, Row[]>;

export interface RestoreStats {
  inserted: number;
  /** Rows whose parent was missing: dropped (cascade) or kept with the FK nulled (set null). */
  dropped: number;
  nulled: number;
}

const INSERT_BATCH = 50;

/** JSON turns Date into an ISO string; only timestamp columns get a Date back. */
export function rehydrateRow(row: Row, table: BackupTable): Row {
  const result: Row = { ...row };
  for (const key of table.timestampKeys) {
    if (typeof result[key] === 'string') result[key] = new Date(result[key] as string);
  }
  return result;
}

function referencedColumns(tables: BackupTable[]): Map<string, Set<string>> {
  const refs = new Map<string, Set<string>>();
  for (const t of tables) {
    for (const fk of [...t.fks, ...t.selfFks]) {
      if (!refs.has(fk.parentKey)) refs.set(fk.parentKey, new Set());
      refs.get(fk.parentKey)!.add(fk.parentColumnKey);
    }
  }
  return refs;
}

/** Applies each FK's on-delete rule to rows whose parent value is not available. */
function applyFkRules(rows: Row[], fk: BackupFk, available: Set<unknown>, stats: RestoreStats): Row[] {
  const kept: Row[] = [];
  for (const row of rows) {
    const value = row[fk.columnKey];
    if (value == null || available.has(value)) kept.push(row);
    else if (fk.onDelete === 'set null') {
      kept.push({ ...row, [fk.columnKey]: null });
      stats.nulled += 1;
    } else stats.dropped += 1; // cascade (and any rule that cannot keep an orphan)
  }
  return kept;
}

/**
 * Settings that describe THIS machine's state rather than the user's choices. A backup
 * never overwrites or removes them. Each entry guards a concrete harm:
 * - maintenance:*  one-shot sweep flags; losing one re-arms the sweep (the recording
 *                  sweep deletes every unreferenced WAV)
 * - autoBackup.*   an old lastRun makes a backup due at once and an old retention then
 *                  deletes the newer backup files
 * - sync.*, calendar:{google,microsoft}:{auth,client}  sign-in tokens and the OAuth client
 *                  they are bound to; an old one breaks sign-in
 * - recordings:savePath, whisper:preferredModel, background_agent_daily_usage  a folder,
 *                  a downloaded model and a usage budget that exist only on this machine
 * - transcription:localOnly, transcription_provider, diagnostics.sendCrashReports  privacy
 *                  consent: an old backup must never silently send audio or crash data off
 *                  the device again, so the user's current choice always stands
 */
const MACHINE_STATE_PREFIXES = ['maintenance:', 'autoBackup.', 'sync.'];
const MACHINE_STATE_KEYS = new Set([
  'calendar:google:auth',
  'calendar:google:client',
  'calendar:microsoft:auth',
  'calendar:microsoft:client',
  'recordings:savePath',
  'whisper:preferredModel',
  'background_agent_daily_usage',
  'transcription:localOnly',
  'transcription_provider',
  'diagnostics.sendCrashReports',
]);

export function isMachineStateSetting(key: string): boolean {
  return MACHINE_STATE_KEYS.has(key) || MACHINE_STATE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Writes the rows and returns how many were written. */
async function insertRows(tx: Tx, t: BackupTable, rows: Row[]): Promise<number> {
  if (t.key === 'settings') {
    // Settings MERGE: the table is never emptied, backed-up keys are upserted over the
    // current ones, keys the backup lacks are kept, and machine state is never touched.
    const userSettings = rows.filter((r) => !isMachineStateSetting(String(r.key)));
    for (const row of userSettings) {
      await tx
        .insert(settings)
        .values(row as typeof settings.$inferInsert)
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: row.value as string, updatedAt: row.updatedAt as Date },
        });
    }
    return userSettings.length;
  }
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    await tx.insert(t.table).values(rows.slice(i, i + INSERT_BATCH));
  }
  return rows.length;
}

/** Self-FKs: insert with the column null, then point each row back once every row exists. */
async function applySelfFks(tx: Tx, t: BackupTable, original: Row[], available: Set<unknown>, stats: RestoreStats) {
  for (const fk of t.selfFks) {
    for (const row of original) {
      const value = row[fk.columnKey];
      if (value == null) continue;
      const self = t.table as unknown as Record<string, unknown>;
      if (available.has(value)) {
        await tx
          .update(t.table)
          .set({ [fk.columnKey]: value })
          .where(sql`${self[fk.parentColumnKey]} = ${row[fk.parentColumnKey]}`);
      } else if (fk.onDelete === 'set null') stats.nulled += 1;
      else {
        await tx.delete(t.table).where(sql`${self[fk.parentColumnKey]} = ${row[fk.parentColumnKey]}`);
        stats.dropped += 1;
      }
    }
  }
}

/** Rows in a table the backup did not hold whose parent is gone: apply the FK's on-delete rule. */
async function sweepOrphans(tx: Tx, t: BackupTable, byKey: Map<string, BackupTable>): Promise<void> {
  for (const fk of [...t.fks, ...t.selfFks]) {
    const child = sql.identifier(t.sqlName);
    const column = sql.identifier(fk.columnSql);
    const parent = sql.identifier(byKey.get(fk.parentKey)!.sqlName);
    const parentColumn = sql.identifier(fk.parentColumnSql);
    const orphan = sql`${column} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${parent} p WHERE p.${parentColumn} = ${child}.${column})`;
    if (fk.onDelete === 'set null') {
      await tx.execute(sql`UPDATE ${child} SET ${column} = NULL WHERE ${orphan}`);
    } else {
      await tx.execute(sql`DELETE FROM ${child} WHERE ${orphan}`);
    }
  }
}

/**
 * Replaces every table present in `data` and keeps every other table, consistent.
 * Settings are merged rather than replaced (see insertRows). API keys a backup lacks
 * are taken from this machine's current providers, read inside the same transaction.
 */
export async function restoreTables(tx: Tx, data: BackupRows): Promise<RestoreStats> {
  const tables = getBackupTables();
  const byKey = new Map(tables.map((t) => [t.key, t]));
  const held = new Set(Object.keys(data));
  const refs = referencedColumns(tables);
  const stats: RestoreStats = { inserted: 0, dropped: 0, nulled: 0 };

  const currentKeys = await tx
    .select({ id: aiProviders.id, apiKeyEncrypted: aiProviders.apiKeyEncrypted })
    .from(aiProviders);
  const apiKeys = new Map(currentKeys.map((p) => [p.id, p.apiKeyEncrypted]));

  await tx.execute(sql`SET LOCAL session_replication_role = replica`);
  for (const t of tables) if (held.has(t.key) && t.key !== 'settings') await tx.delete(t.table);
  await tx.execute(sql`SET LOCAL session_replication_role = origin`);

  // Values a child may point at: what this restore inserted for held parents, what
  // already exists for parents the backup does not hold.
  const available = new Map<string, Set<unknown>>();
  const valuesOf = async (fk: BackupFk): Promise<Set<unknown>> => {
    const id = `${fk.parentKey}.${fk.parentColumnKey}`;
    if (!available.has(id)) {
      const parent = byKey.get(fk.parentKey)!;
      const column = (parent.table as unknown as Record<string, never>)[fk.parentColumnKey];
      const current = await tx.select({ v: column }).from(parent.table);
      available.set(id, new Set(current.map((r) => r.v)));
    }
    return available.get(id)!;
  };

  for (const t of tables) {
    if (!held.has(t.key)) continue;
    let rows = (data[t.key] ?? []).map((row) => rehydrateRow(row, t));
    if (t.key === 'aiProviders') {
      rows = rows.map((row) => ({
        ...row,
        // This machine's key wins: a key in the file may be another machine's ciphertext
        // or an older key since rotated. It only fills a provider that has no key here.
        apiKeyEncrypted: apiKeys.get(row.id as string) ?? row.apiKeyEncrypted ?? null,
      }));
    }
    for (const fk of t.fks) rows = applyFkRules(rows, fk, await valuesOf(fk), stats);

    const original = rows;
    const nulledSelf = rows.map((row) => {
      const copy = { ...row };
      for (const fk of t.selfFks) copy[fk.columnKey] = null;
      return copy;
    });
    stats.inserted += await insertRows(tx, t, nulledSelf);

    for (const columnKey of refs.get(t.key) ?? []) {
      available.set(`${t.key}.${columnKey}`, new Set(rows.map((row) => row[columnKey])));
    }
    if (t.selfFks.length > 0) {
      await applySelfFks(tx, t, original, available.get(`${t.key}.${t.selfFks[0].parentColumnKey}`)!, stats);
    }
  }

  for (const t of tables) if (!held.has(t.key)) await sweepOrphans(tx, t, byKey);
  return stats;
}
