// === FILE PURPOSE ===
// Schema-derived table metadata for backup and restore: every table in the drizzle
// schema, ordered parents-first from its foreign keys, with the FK rules restore needs.
// Derived rather than hand-listed because a hand-kept list of 21 of 48 tables is what
// let restore cascade-delete rows it never put back — a new table is now covered with
// nothing to edit.

import { is, getTableColumns } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from '../db/schema';

/** Derived, rebuildable and large: never written to a backup, and KEPT (not wiped) on restore. */
export const EXCLUDED_FROM_BACKUP = new Set(['embeddings', 'embeddingIndexMeta']);

export type OnDeleteRule = 'cascade' | 'set null' | 'no action' | 'restrict' | 'set default';

export interface BackupFk {
  /** JS property key of the child column (the key rows carry). */
  columnKey: string;
  /** SQL name of the child column. */
  columnSql: string;
  /** Schema export key of the parent table. */
  parentKey: string;
  /** JS key and SQL name of the referenced parent column. */
  parentColumnKey: string;
  parentColumnSql: string;
  onDelete: OnDeleteRule;
}

/**
 * FKs that exist in the database but are not declared in the drizzle schema, so
 * getTableConfig cannot see them. cards.source_meeting_id was created by migration
 * 0033 but is declared as a bare uuid (a declared ref would also make drizzle-kit emit
 * a migration re-adding a constraint that already exists). A test compares this
 * metadata with pg_constraint so any new drift fails loudly.
 */
const UNDECLARED_FKS: Record<string, BackupFk[]> = {
  cards: [
    {
      columnKey: 'sourceMeetingId',
      columnSql: 'source_meeting_id',
      parentKey: 'meetings',
      parentColumnKey: 'id',
      parentColumnSql: 'id',
      onDelete: 'set null',
    },
  ],
};

export interface BackupTable {
  /** Schema export key — also the key used in backup files (v1 and v2). */
  key: string;
  table: PgTable;
  sqlName: string;
  /** FKs to OTHER tables. */
  fks: BackupFk[];
  /** FKs to this same table — inserted null, then set once every row exists. */
  selfFks: BackupFk[];
  /** JS keys of timestamp columns, the only values a JSON round-trip turns into strings. */
  timestampKeys: Set<string>;
  includedInBackup: boolean;
}

function describeTable(key: string, table: PgTable, keyOf: Map<PgTable, string>): BackupTable {
  const config = getTableConfig(table);
  const jsKeyBySql = new Map<string, string>();
  const timestampKeys = new Set<string>();
  for (const [jsKey, column] of Object.entries(getTableColumns(table))) {
    jsKeyBySql.set(column.name, jsKey);
    if (column.columnType === 'PgTimestamp') timestampKeys.add(jsKey);
  }

  const fks: BackupFk[] = [];
  const selfFks: BackupFk[] = [];
  for (const fk of config.foreignKeys) {
    const ref = fk.reference();
    if (ref.columns.length !== 1) throw new Error(`backupSchema: composite FK on ${key} is not supported`);
    const parentKey = keyOf.get(ref.foreignTable);
    if (!parentKey) throw new Error(`backupSchema: FK on ${key} points at a table outside the schema`);
    const parentJsKeys = new Map(
      Object.entries(getTableColumns(ref.foreignTable)).map(([jsKey, column]) => [column.name, jsKey]),
    );
    const described: BackupFk = {
      columnKey: jsKeyBySql.get(ref.columns[0].name)!,
      columnSql: ref.columns[0].name,
      parentKey,
      parentColumnKey: parentJsKeys.get(ref.foreignColumns[0].name)!,
      parentColumnSql: ref.foreignColumns[0].name,
      onDelete: fk.onDelete ?? 'no action',
    };
    (ref.foreignTable === table ? selfFks : fks).push(described);
  }
  fks.push(...(UNDECLARED_FKS[key] ?? []));

  return {
    key,
    table,
    sqlName: config.name,
    fks,
    selfFks,
    timestampKeys,
    includedInBackup: !EXCLUDED_FROM_BACKUP.has(key),
  };
}

let cached: BackupTable[] | null = null;

/** Every schema table, parents before children. Throws on an FK cycle between tables. */
export function getBackupTables(): BackupTable[] {
  if (cached) return cached;
  const entries = Object.entries(schema).filter(([, value]) => is(value, PgTable)) as [string, PgTable][];
  const keyOf = new Map(entries.map(([key, table]) => [table, key]));
  const described = new Map(entries.map(([key, table]) => [key, describeTable(key, table, keyOf)]));

  const ordered: BackupTable[] = [];
  const placed = new Set<string>();
  while (ordered.length < described.size) {
    const ready = [...described.values()].filter(
      (t) => !placed.has(t.key) && t.fks.every((fk) => placed.has(fk.parentKey)),
    );
    if (ready.length === 0) throw new Error('backupSchema: foreign-key cycle between tables');
    for (const t of ready) {
      ordered.push(t);
      placed.add(t.key);
    }
  }
  cached = ordered;
  return ordered;
}
