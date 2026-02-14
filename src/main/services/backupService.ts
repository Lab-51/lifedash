// === FILE PURPOSE ===
// Database backup and restore using Drizzle ORM queries.
// Serializes all tables to JSON, restores by deleting and re-inserting.
// Manages backup files in app.getPath('userData')/backups/.
//
// === DEPENDENCIES ===
// - Database connection (getDb from connection.ts)
// - Drizzle ORM + schema tables
//
// === LIMITATIONS ===
// - Audio files are NOT backed up (stored outside DB)
// - API keys (aiProviders.apiKeyEncrypted) excluded from backups

import { app, BrowserWindow } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { getDb } from '../db/connection';
import * as schema from '../db/schema';
import { settings } from '../db/schema';
import { createLogger } from './logger';
import type {
  BackupInfo,
  BackupProgress,
  AutoBackupSettings,
  AutoBackupFrequency,
} from '../../shared/types';

const log = createLogger('Backup');

// --- Table maps in FK-safe order ---

// INSERT order: parents first, children last
const BACKUP_TABLES_INSERT_ORDER: [string, PgTable][] = [
  ['projects', schema.projects],
  ['settings', schema.settings],
  ['aiProviders', schema.aiProviders],
  ['boards', schema.boards],
  ['labels', schema.labels],
  ['columns', schema.columns],
  ['meetings', schema.meetings],
  ['ideas', schema.ideas],
  ['brainstormSessions', schema.brainstormSessions],
  ['cards', schema.cards],
  ['aiUsage', schema.aiUsage],
  ['transcripts', schema.transcripts],
  ['meetingBriefs', schema.meetingBriefs],
  ['actionItems', schema.actionItems],
  ['cardLabels', schema.cardLabels],
  ['cardComments', schema.cardComments],
  ['cardRelationships', schema.cardRelationships],
  ['cardActivities', schema.cardActivities],
  ['cardAttachments', schema.cardAttachments],
  ['ideaTags', schema.ideaTags],
  ['brainstormMessages', schema.brainstormMessages],
];

// DELETE order: children first, parents last (reverse of insert)
const BACKUP_TABLES_DELETE_ORDER: [string, PgTable][] = [
  ...BACKUP_TABLES_INSERT_ORDER,
].reverse();

// Columns to strip from backups (sensitive data)
const SENSITIVE_COLUMNS: Record<string, string[]> = {
  aiProviders: ['apiKeyEncrypted'],
};

// --- Backup JSON format ---

interface BackupData {
  version: number;
  createdAt: string;
  tableCount: number;
  tables: Record<string, Record<string, unknown>[]>;
}

// --- Utility functions ---

export function getBackupDir(): string {
  const dir = path.join(app.getPath('userData'), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function emitProgress(
  mainWindow: BrowserWindow | undefined | null,
  progress: BackupProgress,
): void {
  mainWindow?.webContents.send('backup:progress', progress);
}

// --- Core backup/restore functions ---

export async function createBackup(
  mainWindow?: BrowserWindow | null,
): Promise<BackupInfo> {
  try {
    emitProgress(mainWindow, {
      phase: 'starting',
      message: 'Preparing backup...',
    });

    const db = getDb();

    // Generate filename: backup-YYYY-MM-DD-HHmmss.json
    const now = new Date();
    const ts = now.toISOString().replace(/[T:]/g, '-').slice(0, 19);
    const fileName = `backup-${ts}.json`;

    emitProgress(mainWindow, {
      phase: 'dumping',
      message: 'Reading database tables...',
    });

    // Query all tables in FK-safe insert order
    const tables: Record<string, Record<string, unknown>[]> = {};

    for (const [name, table] of BACKUP_TABLES_INSERT_ORDER) {
      const rows = await db.select().from(table);

      // Strip sensitive columns
      const sensitiveKeys = SENSITIVE_COLUMNS[name];
      if (sensitiveKeys) {
        tables[name] = rows.map((row: Record<string, unknown>) => {
          const cleaned = { ...row };
          for (const key of sensitiveKeys) {
            delete cleaned[key];
          }
          return cleaned;
        });
      } else {
        tables[name] = rows;
      }
    }

    const backupData: BackupData = {
      version: 1,
      createdAt: now.toISOString(),
      tableCount: BACKUP_TABLES_INSERT_ORDER.length,
      tables,
    };

    emitProgress(mainWindow, {
      phase: 'saving',
      message: 'Saving backup file...',
    });

    const filePath = path.join(getBackupDir(), fileName);
    const json = JSON.stringify(backupData, null, 2);
    await fs.promises.writeFile(filePath, json, 'utf-8');
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
    const backupFiles = files.filter((f) =>
      /^backup-\d{4}-\d{2}-\d{2}-\d{6}\.(sql|json)$/.test(f),
    );

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

export async function restoreBackup(
  filePath: string,
  mainWindow?: BrowserWindow | null,
): Promise<void> {
  try {
    await fs.promises.access(filePath);

    emitProgress(mainWindow, {
      phase: 'starting',
      message: 'Reading backup file...',
    });

    const content = await fs.promises.readFile(filePath, 'utf-8');
    const backupData: BackupData = JSON.parse(content);

    // Validate backup format
    if (!backupData.version || typeof backupData.tables !== 'object') {
      throw new Error(
        'Invalid backup file: missing version or tables field',
      );
    }

    emitProgress(mainWindow, {
      phase: 'starting',
      message: 'Creating safety backup...',
    });

    // Safety backup (non-blocking -- log errors but don't prevent restore)
    try {
      await createBackup(mainWindow);
    } catch (err) {
      log.error('Safety backup failed (continuing restore):', err);
    }

    emitProgress(mainWindow, {
      phase: 'restoring',
      message: 'Restoring database...',
    });

    const db = getDb();

    // Delete all data in reverse FK order (children first)
    for (const [name, table] of BACKUP_TABLES_DELETE_ORDER) {
      try {
        await db.delete(table);
      } catch (err) {
        log.error(`Failed to clear table ${name}:`, err);
      }
    }

    // Insert data in forward FK order (parents first)
    for (const [name, table] of BACKUP_TABLES_INSERT_ORDER) {
      const rows = backupData.tables[name];
      if (rows && rows.length > 0) {
        try {
          await db.insert(table).values(rows);
        } catch (err) {
          log.error(`Failed to restore table ${name}:`, err);
        }
      }
    }

    emitProgress(mainWindow, {
      phase: 'complete',
      message: 'Restore complete',
    });
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
  if (!/^backup-[\d-]+\.(sql|json)$/.test(fileName)) {
    throw new Error('Invalid backup file name');
  }
  const filePath = path.join(getBackupDir(), fileName);
  await fs.promises.unlink(filePath);
}

export async function cleanOldBackups(retention: number): Promise<void> {
  const backups = await listBackups(); // sorted newest first
  if (backups.length <= retention) return;

  const toDelete = backups.slice(retention);
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
    frequency:
      (map['autoBackup.frequency'] as AutoBackupFrequency) || 'daily',
    retention: parseInt(map['autoBackup.retention'] || '5', 10),
    lastRun: map['autoBackup.lastRun'] || null,
  };
}

export async function updateAutoBackupSettings(
  updates: Partial<AutoBackupSettings>,
): Promise<void> {
  const db = getDb();
  const entries: [string, string][] = [];
  if (updates.enabled !== undefined)
    entries.push(['autoBackup.enabled', String(updates.enabled)]);
  if (updates.frequency !== undefined)
    entries.push(['autoBackup.frequency', updates.frequency]);
  if (updates.retention !== undefined)
    entries.push(['autoBackup.retention', String(updates.retention)]);
  if (updates.lastRun !== undefined)
    entries.push(['autoBackup.lastRun', updates.lastRun || '']);

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
