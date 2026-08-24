// === FILE PURPOSE ===
// Desktop notification service using Electron's Notification API.
// Sends native OS notifications for due dates, daily digest, and reminders.
//
// === DEPENDENCIES ===
// Electron (Notification), settings table for preferences
//
// === LIMITATIONS ===
// - Requires OS notification permissions (usually granted by default for desktop apps)
// - No notification history/log (fire-and-forget)
// - Daily digest is text-only (no rich HTML in OS notifications)

import { Notification, BrowserWindow } from 'electron';
import { getDb } from '../db/connection';
import { settings } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createLogger } from './logger';
import type { NotificationPreferences } from '../../shared/types';

const log = createLogger('Notifications');

const SETTINGS_KEY = 'notification_preferences';

const DEFAULT_PREFERENCES: NotificationPreferences = {
  enabled: true,
  dueDateReminders: true,
  dailyDigest: true,
  dailyDigestHour: 9,
  recordingReminders: true,
  briefReady: true,
};

/** The app's main window, injected once at IPC bootstrap (ipc/notifications.ts) —
 *  same idiom as liveTriageService/transcriptionService/audioProcessor's own
 *  setMainWindow. Needed only for notifyBriefReady's click-to-focus/navigate. */
let mainWindow: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win;
}

/**
 * Load notification preferences from the settings table.
 * Returns defaults if no preferences have been saved yet.
 * Merges stored values with defaults for forward-compatibility
 * (new fields get default values automatically).
 */
export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  try {
    const db = getDb();
    const rows = await db.select().from(settings).where(eq(settings.key, SETTINGS_KEY)).limit(1);

    if (rows.length === 0) {
      return { ...DEFAULT_PREFERENCES };
    }

    const stored = JSON.parse(rows[0].value) as Partial<NotificationPreferences>;
    return { ...DEFAULT_PREFERENCES, ...stored };
  } catch (err) {
    log.error('Failed to load preferences:', err);
    return { ...DEFAULT_PREFERENCES };
  }
}

/**
 * Update notification preferences (partial update supported).
 * Loads current preferences, merges with new values, and upserts to DB.
 */
export async function updateNotificationPreferences(prefs: Partial<NotificationPreferences>): Promise<void> {
  const current = await getNotificationPreferences();
  const merged = { ...current, ...prefs };
  const value = JSON.stringify(merged);

  const db = getDb();

  // Check if key exists
  const existing = await db.select().from(settings).where(eq(settings.key, SETTINGS_KEY)).limit(1);

  if (existing.length > 0) {
    await db.update(settings).set({ value, updatedAt: new Date() }).where(eq(settings.key, SETTINGS_KEY));
  } else {
    await db.insert(settings).values({
      key: SETTINGS_KEY,
      value,
    });
  }
}

/**
 * Show a native OS notification via Electron's Notification API.
 * Non-fatal: failures are logged but do not throw.
 * `onClick`, when given, fires when the user clicks the notification — additive
 * (every pre-existing caller omits it and is unaffected).
 */
export function showNotification(title: string, body: string, onClick?: () => void): void {
  try {
    if (!Notification.isSupported()) {
      log.warn('Notifications not supported on this platform');
      return;
    }

    const notification = new Notification({ title, body });
    if (onClick) {
      notification.on('click', onClick);
    }
    notification.show();
  } catch (err) {
    log.error('Failed to show notification:', err);
  }
}

/**
 * Send a test notification to verify that notifications are working.
 */
export function sendTestNotification(): void {
  showNotification('LifeDash', 'Notifications are working!');
}

/** Focus the main window and hand the renderer the session route to open — the
 *  same show()/focus() sequence main.ts's own command-palette hotkey uses. A
 *  destroyed/missing window is a silent no-op (the app may be closing). */
function focusAndNavigateToSession(meetingId: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('app:navigate', `/session/${meetingId}`);
}

/**
 * POST-FLOW.1: the "arrival" desktop notification for an auto-generated brief.
 * Pref-gated on BOTH the master toggle and the new `briefReady` toggle (mirrors
 * every other per-type pref in this file). Never throws — a lookup or send
 * failure is logged and swallowed, since this must never block the auto-run
 * that fires it (see meetingIntelligenceService.ensurePostSessionGeneration).
 */
export async function notifyBriefReady(meetingId: string, meetingTitle: string): Promise<void> {
  try {
    const prefs = await getNotificationPreferences();
    if (!prefs.enabled || !prefs.briefReady) return;
    showNotification('LifeDash', `Brief ready — ${meetingTitle}`, () => focusAndNavigateToSession(meetingId));
  } catch (err) {
    log.error('Failed to notify brief ready:', err);
  }
}
