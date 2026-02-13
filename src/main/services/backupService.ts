// === FILE PURPOSE ===
// Database backup and restore via pg_dump/psql through Docker exec.
// Manages backup files in app.getPath('userData')/backups/.
//
// === DEPENDENCIES ===
// - Docker CLI on system PATH
// - PostgreSQL container "living-dashboard-db" running
//
// === LIMITATIONS ===
// - Audio files are NOT backed up (stored outside DB)
// - Requires Docker to be running

import { app, BrowserWindow } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sql } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { settings } from '../db/schema';
import { createLogger } from './logger';
import type {
  BackupInfo,
  BackupProgress,
  AutoBackupSettings,
  AutoBackupFrequency,
} from '../../shared/types';

const log = createLogger('Backup');

const execFileAsync = promisify(execFile);

export function getBackupDir(): string {
  const dir = path.join(app.getPath('userData'), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function isDockerAvailable(): Promise<boolean> {
  try {
    await execFileAsync('docker', ['info']);
    return true;
  } catch {
    return false;
  }
}

function emitProgress(
  mainWindow: BrowserWindow | undefined | null,
  progress: BackupProgress,
): void {
  mainWindow?.webContents.send('backup:progress', progress);
}

export async function createBackup(
  mainWindow?: BrowserWindow | null,
): Promise<BackupInfo> {
  try {
    emitProgress(mainWindow, {
      phase: 'starting',
      message: 'Preparing backup...',
    });

    // Generate filename: backup-YYYY-MM-DD-HHmmss.sql
    const now = new Date();
    const ts = now.toISOString().replace(/[T:]/g, '-').slice(0, 19);
    const fileName = `backup-${ts}.sql`;

    emitProgress(mainWindow, {
      phase: 'dumping',
      message: 'Dumping database...',
    });

    const { stdout } = await execFileAsync(
      'docker',
      [
        'exec',
        'living-dashboard-db',
        'pg_dump',
        '-U',
        'dashboard',
        '--clean',
        '--if-exists',
        'living_dashboard',
      ],
      { maxBuffer: 100 * 1024 * 1024 }, // 100MB
    );

    emitProgress(mainWindow, {
      phase: 'saving',
      message: 'Saving backup file...',
    });

    const filePath = path.join(getBackupDir(), fileName);
    await fs.promises.writeFile(filePath, stdout, 'utf-8');
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
      /^backup-\d{4}-\d{2}-\d{2}-\d{6}\.sql$/.test(f),
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

    const content = await fs.promises.readFile(filePath, 'utf-8');

    await new Promise<void>((resolve, reject) => {
      const proc = spawn('docker', [
        'exec',
        '-i',
        'living-dashboard-db',
        'psql',
        '-U',
        'dashboard',
        'living_dashboard',
      ]);

      let stderr = '';
      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`psql exited with code ${code}: ${stderr}`));
      });
      proc.on('error', reject);

      proc.stdin.write(content);
      proc.stdin.end();
    });

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
  if (!/^backup-[\d-]+\.sql$/.test(fileName)) {
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
