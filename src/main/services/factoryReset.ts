// === FILE PURPOSE ===
// Factory reset: empty EVERY table of the app schema in one transaction.
// The list is derived from the drizzle schema (backupSchema's enumeration) rather than
// hand-kept — the old hand list of ~35 tables silently left the twin's profile and facts,
// entities, calendar events and the search index behind after a "reset".
//
// === LIMITATIONS ===
// - drizzle's own migrations table lives in the `drizzle` schema and is not part of the
//   app schema, so it is never touched. A table declared in any other schema is refused
//   (throws) rather than guessed at.

import { sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { getDb } from '../db/connection';
import { getBackupTables } from './backupSchema';

/**
 * SQL name of every schema table. Unlike backup, which skips the rebuildable search index
 * (EXCLUDED_FROM_BACKUP: embeddings, embeddingIndexMeta), a RESET clears those too —
 * embeddings hold text derived from meetings and cards the user just asked to erase.
 * getBackupTables() returns all tables and only FLAGS the excluded ones, so nothing is filtered.
 */
export function getFactoryResetTableNames(): string[] {
  return getBackupTables().map(({ table }) => {
    const { name, schema } = getTableConfig(table);
    if (schema) throw new Error(`factoryReset: table "${name}" is in schema "${schema}", which is not supported`);
    return name;
  });
}

/**
 * One TRUNCATE ... CASCADE over all tables inside one transaction: all-or-nothing, and
 * CASCADE also reaches FKs the drizzle schema does not declare (cards.source_meeting_id).
 * Throws on failure with nothing cleared.
 */
export async function factoryResetAllTables(): Promise<void> {
  const tables = sql.join(
    getFactoryResetTableNames().map((name) => sql.identifier(name)),
    sql`, `,
  );
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`TRUNCATE TABLE ${tables} CASCADE`);
  });
}
