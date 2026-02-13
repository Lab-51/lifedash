// === FILE PURPOSE ===
// Background scheduler for automatic database backups.
// Checks hourly if a backup is due based on user-configured frequency.
//
// === DEPENDENCIES ===
// - backupService (createBackup, cleanOldBackups, getAutoBackupSettings, updateAutoBackupSettings)
// - Database connection must be established before init
//
// === LIMITATIONS ===
// - Hourly check granularity (not second-precise)
// - Requires Docker running when backup triggers

import { BrowserWindow } from 'electron';
import {
  createBackup,
  cleanOldBackups,
  getAutoBackupSettings,
  updateAutoBackupSettings,
} from './backupService';
import { createLogger } from './logger';

const log = createLogger('AutoBackup');

let intervalId: ReturnType<typeof setInterval> | null = null;
let mainWindowRef: BrowserWindow | null = null;

const CHECK_INTERVAL_MS = 3_600_000; // 1 hour
const STARTUP_DELAY_MS = 10_000; // 10 seconds after startup

export function initAutoBackup(mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow;

  // Run first check after a short delay (don't block app startup)
  setTimeout(() => {
    checkAndRunBackup().catch((err) => {
      log.error('Initial check failed:', err);
    });
  }, STARTUP_DELAY_MS);

  // Then check every hour
  intervalId = setInterval(() => {
    checkAndRunBackup().catch((err) => {
      log.error('Scheduled check failed:', err);
    });
  }, CHECK_INTERVAL_MS);

  log.info('Scheduler initialized');
}

export function stopAutoBackup(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  mainWindowRef = null;
  log.info('Scheduler stopped');
}

export async function checkAndRunBackup(): Promise<void> {
  try {
    const settings = await getAutoBackupSettings();

    if (!settings.enabled || settings.frequency === 'off') {
      return;
    }

    // Determine if backup is due
    const now = Date.now();
    let isDue = false;

    if (!settings.lastRun) {
      // First time — always due
      isDue = true;
    } else {
      const lastRunMs = new Date(settings.lastRun).getTime();
      const elapsed = now - lastRunMs;

      if (settings.frequency === 'daily') {
        isDue = elapsed >= 24 * 60 * 60 * 1000; // 24 hours
      } else if (settings.frequency === 'weekly') {
        isDue = elapsed >= 7 * 24 * 60 * 60 * 1000; // 7 days
      }
    }

    if (!isDue) return;

    log.info('Backup is due, starting...');

    try {
      await createBackup(mainWindowRef);
      await updateAutoBackupSettings({ lastRun: new Date().toISOString() });
      log.info('Backup completed successfully');
    } catch (backupErr) {
      log.error('Backup failed:', backupErr);
      // Don't throw — background task shouldn't crash the app
      return;
    }

    // Clean old backups according to retention
    try {
      await cleanOldBackups(settings.retention);
    } catch (cleanErr) {
      log.error('Retention cleanup failed:', cleanErr);
    }
  } catch (err) {
    log.error('Check failed:', err);
    // Never throw from background scheduler
  }
}
