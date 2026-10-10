// === FILE PURPOSE ===
// Database backup and restore using Drizzle ORM queries.
// Serializes every schema table (bar the derived search index) to JSON; restore
// replaces the tables a backup holds and keeps everything else (see backupRestore.ts).
// Manages backup files in app.getPath('userData')/backups/.
//
// === DEPENDENCIES ===
// - Database connection (getDb from connection.ts)
// - backupSchema (table list + FK order), backupRestore (the restore engine)
//
// === LIMITATIONS ===
// - Audio files are NOT backed up (stored outside DB)
// - API keys (aiProviders.apiKeyEncrypted) excluded from backups, except the pre-restore
//   safety backup; restore keeps the current ones
// - Settings are merged on restore, and machine-state keys (sweep flags, sign-in) are never touched
// - The search index (embeddings) is not backed up; restore keeps it for surviving rows

import { app, BrowserWindow } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sql } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { settings } from '../db/schema';
import { getBackupTables } from './backupSchema';
import { restoreTables, type BackupRows } from './backupRestore';
import { createLogger } from './logger';
import type { BackupInfo, BackupProgress, AutoBackupSettings, AutoBackupFrequency } from '../../shared/types';

const log = createLogger('Backup');

/** v1 = the hand-listed 21 tables; v2 = every schema table except the search index. */
const BACKUP_VERSION = 2;

// Columns never written to a backup (machine-bound secrets)
const SENSITIVE_COLUMNS: Record<string, string[]> = {
  aiProviders: ['apiKeyEncrypted'],
};

// --- Backup JSON format ---

interface BackupData {
  version: number;
  createdAt: string;
  tableCount: number;
  tables: BackupRows;
}

/** Rejects a file this version cannot restore faithfully, BEFORE anything is touched. */
export function validateBackupData(data: unknown): BackupData {
  const candidate = data as Partial<BackupData> | null;
  if (!candidate || typeof candidate.tables !== 'object' || candidate.tables === null) {
    throw new Error('Invalid backup file: missing version or tables field');
  }
  if (candidate.version !== 1 && candidate.version !== 2) {
    throw new Error(`Unsupported backup version ${String(candidate.version)} — update LifeDash to restore it`);
  }
  // Only tables a backup is allowed to hold: unknown ones, and the search index (never
  // backed up, so a file carrying it was not written by LifeDash), are refused.
  const known = new Set(
    getBackupTables()
      .filter((t) => t.includedInBackup)
      .map((t) => t.key),
  );
  const unknown = Object.keys(candidate.tables).filter((key) => !known.has(key));
  if (unknown.length > 0) {
    throw new Error(`Backup contains tables this version cannot restore (${unknown.join(', ')})`);
  }
  for (const [key, rows] of Object.entries(candidate.tables)) {
    if (!Array.isArray(rows)) throw new Error(`Invalid backup file: table ${key} is not a list of rows`);
  }
  return candidate as BackupData;
}

// --- Utility functions ---

export function getBackupDir(): string {
  const dir = path.join(app.getPath('userData'), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function emitProgress(mainWindow: BrowserWindow | undefined | null, progress: BackupProgress): void {
  mainWindow?.webContents.send('backup:progress', progress);
}

// --- Core backup/restore functions ---

/** Backup file names: `backup-YYYY-MM-DD-HH-MM-SS[-pre-restore].(json|sql)`. */
const BACKUP_FILE_RE = /^backup-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}(-pre-restore)?\.(sql|json)$/;

/**
 * Writes a backup under a name no existing file has: never overwrites (flag 'wx'), and on
 * a same-second collision moves to the next free second, so names stay sortable and valid.
 */
async function writeNewBackupFile(
  at: Date,
  suffix: string,
  json: string,
): Promise<{ fileName: string; filePath: string }> {
  const MAX_SECONDS_AHEAD = 60;
  for (let offset = 0; offset < MAX_SECONDS_AHEAD; offset++) {
    const ts = new Date(at.getTime() + offset * 1000).toISOString().replace(/[T:]/g, '-').slice(0, 19);
    const fileName = `backup-${ts}${suffix}.json`;
    const filePath = path.join(getBackupDir(), fileName);
    try {
      await fs.promises.writeFile(filePath, json, { encoding: 'utf-8', flag: 'wx' });
      return { fileName, filePath };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
  throw new Error('Could not find a free backup file name');
}

/**
 * `preRestore` marks the safety backup taken before a restore: it gets its own
 * `-pre-restore` name (so it can never overwrite the file being restored) and keeps the
 * machine-bound, safeStorage-encrypted API keys, so undoing a restore keeps every key.
 */
export async function createBackup(
  mainWindow?: BrowserWindow | null,
  options: { preRestore?: boolean } = {},
): Promise<BackupInfo> {
  try {
    emitProgress(mainWindow, {
      phase: 'starting',
      message: 'Preparing backup...',
    });

    const db = getDb();

    const now = new Date();

    emitProgress(mainWindow, {
      phase: 'dumping',
      message: 'Reading database tables...',
    });

    // Every backed-up table, read inside one transaction so the file is one
    // consistent snapshot (a row and its parent can never come from different moments).
    const included = getBackupTables().filter((t) => t.includedInBackup);
    const tables: BackupRows = {};
    await db.transaction(async (tx) => {
      for (const t of included) {
        const rows = (await tx.select().from(t.table)) as Record<string, unknown>[];
        const sensitiveKeys = options.preRestore ? [] : (SENSITIVE_COLUMNS[t.key] ?? []);
        tables[t.key] = rows.map((row) => {
          const cleaned = { ...row };
          for (const key of sensitiveKeys) delete cleaned[key];
          return cleaned;
        });
      }
    });

    const backupData: BackupData = {
      version: BACKUP_VERSION,
      createdAt: now.toISOString(),
      tableCount: included.length,
      tables,
    };

    emitProgress(mainWindow, {
      phase: 'saving',
      message: 'Saving backup file...',
    });

    const json = JSON.stringify(backupData, null, 2);
    const { fileName, filePath } = await writeNewBackupFile(now, options.preRestore ? '-pre-restore' : '', json);
    const stat = await fs.promises.stat(filePath);

    emitProgress(mainWindow, { phase: 'complete', message: 'Backup complete' });

    return {
      fileName,
      filePath,
      createdAt: now.toISOString(),
      sizeBytes: stat.size,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    emitProgress(mainWindow, {
      phase: 'failed',
      message: 'Backup failed',
      error: msg,
    });
    throw error;
  }
}

export async function listBackups(): Promise<BackupInfo[]> {
  const dir = getBackupDir();
  try {
    const files = await fs.promises.readdir(dir);
    const backupFiles = files.filter((f) => BACKUP_FILE_RE.test(f));

    const results: BackupInfo[] = [];
    for (const fileName of backupFiles) {
      const filePath = path.join(dir, fileName);
      const stat = await fs.promises.stat(filePath);
      results.push({
        fileName,
        filePath,
        createdAt: stat.mtime.toISOString(),
        sizeBytes: stat.size,
      });
    }

    // Sort newest first
    results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return results;
  } catch {
    return [];
  }
}

export async function restoreBackup(filePath: string, mainWindow?: BrowserWindow | null): Promise<void> {
  try {
    await fs.promises.access(filePath);

    emitProgress(mainWindow, {
      phase: 'starting',
      message: 'Reading backup file...',
    });

    const content = await fs.promises.readFile(filePath, 'utf-8');
    const backupData = validateBackupData(JSON.parse(content));

    emitProgress(mainWindow, {
      phase: 'starting',
      message: 'Creating safety backup...',
    });

    // The safety backup is what makes a restore undoable — without it, do not restore.
    try {
      await createBackup(mainWindow, { preRestore: true });
    } catch (err) {
      log.error('Safety backup failed — restore aborted, nothing changed:', err);
      throw new Error('Could not create a safety backup first, so nothing was restored', { cause: err });
    }

    emitProgress(mainWindow, {
      phase: 'restoring',
      message: 'Restoring database...',
    });

    const db = getDb();

    try {
      const stats = await db.transaction((tx) => restoreTables(tx, backupData.tables));

      log.info(
        `Restore committed (backup v${backupData.version}): ${stats.inserted} rows restored, ` +
          `${stats.dropped} dropped and ${stats.nulled} unlinked because their parent was not in the backup`,
      );
      emitProgress(mainWindow, {
        phase: 'complete',
        message: 'Restore complete',
      });
    } catch (txError) {
      log.error('Restore transaction failed (rolled back):', txError);
      emitProgress(mainWindow, {
        phase: 'failed',
        message: 'Restore failed — your data is unchanged (rolled back)',
        error: txError instanceof Error ? txError.message : 'Transaction failed',
      });
      throw txError;
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    emitProgress(mainWindow, {
      phase: 'failed',
      message: 'Restore failed',
      error: msg,
    });
    throw error;
  }
}

export async function deleteBackup(fileName: string): Promise<void> {
  // Validate filename to prevent path traversal
  if (!BACKUP_FILE_RE.test(fileName)) {
    throw new Error('Invalid backup file name');
  }
  const filePath = path.join(getBackupDir(), fileName);
  await fs.promises.unlink(filePath);
}

/**
 * Retention counts regular backups only, so a restore never pushes a real backup out of
 * the window. Pre-restore safety files are kept to the newest one: enough to undo the
 * last restore, without piling up files that carry API keys.
 */
export async function cleanOldBackups(retention: number): Promise<void> {
  const backups = await listBackups(); // sorted newest first
  const isPreRestore = (fileName: string) => fileName.includes('-pre-restore.');
  const toDelete = [
    ...backups.filter((b) => !isPreRestore(b.fileName)).slice(retention),
    ...backups.filter((b) => isPreRestore(b.fileName)).slice(1),
  ];
  for (const backup of toDelete) {
    try {
      await fs.promises.unlink(backup.filePath);
      log.debug(`Cleaned old backup: ${backup.fileName}`);
    } catch (err) {
      log.error(`Failed to delete ${backup.fileName}:`, err);
    }
  }
}

// --- Auto-backup settings (read/write from settings table) ---

export async function getAutoBackupSettings(): Promise<AutoBackupSettings> {
  const db = getDb();
  const rows = await db
    .select()
    .from(settings)
    .where(sql`${settings.key} LIKE 'autoBackup.%'`);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    enabled: map['autoBackup.enabled'] === 'true',
    frequency: (map['autoBackup.frequency'] as AutoBackupFrequency) || 'daily',
    retention: parseInt(map['autoBackup.retention'] || '5', 10),
    lastRun: map['autoBackup.lastRun'] || null,
  };
}

export async function updateAutoBackupSettings(updates: Partial<AutoBackupSettings>): Promise<void> {
  const db = getDb();
  const entries: [string, string][] = [];
  if (updates.enabled !== undefined) entries.push(['autoBackup.enabled', String(updates.enabled)]);
  if (updates.frequency !== undefined) entries.push(['autoBackup.frequency', updates.frequency]);
  if (updates.retention !== undefined) entries.push(['autoBackup.retention', String(updates.retention)]);
  if (updates.lastRun !== undefined) entries.push(['autoBackup.lastRun', updates.lastRun || '']);

  for (const [key, value] of entries) {
    await db
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value, updatedAt: new Date() },
      });
  }
}
