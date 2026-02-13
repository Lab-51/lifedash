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

import { Notification } from 'electron';
import { getDb } from '../db/connection';
import { settings } from '../db/schema';
import { eq } from 'drizzle-orm';
import type { NotificationPreferences } from '../../shared/types';

const SETTINGS_KEY = 'notification_preferences';

const DEFAULT_PREFERENCES: NotificationPreferences = {
  enabled: true,
  dueDateReminders: true,
  dailyDigest: true,
  dailyDigestHour: 9,
  recordingReminders: true,
};

/**
 * Load notification preferences from the settings table.
 * Returns defaults if no preferences have been saved yet.
 * Merges stored values with defaults for forward-compatibility
 * (new fields get default values automatically).
 */
export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(settings)
      .where(eq(settings.key, SETTINGS_KEY))
      .limit(1);

    if (rows.length === 0) {
      return { ...DEFAULT_PREFERENCES };
    }

    const stored = JSON.parse(rows[0].value) as Partial<NotificationPreferences>;
    return { ...DEFAULT_PREFERENCES, ...stored };
  } catch (err) {
    console.error('[Notifications] Failed to load preferences:', err);
    return { ...DEFAULT_PREFERENCES };
  }
}

/**
 * Update notification preferences (partial update supported).
 * Loads current preferences, merges with new values, and upserts to DB.
 */
export async function updateNotificationPreferences(
  prefs: Partial<NotificationPreferences>,
): Promise<void> {
  const current = await getNotificationPreferences();
  const merged = { ...current, ...prefs };
  const value = JSON.stringify(merged);

  const db = getDb();

  // Check if key exists
  const existing = await db
    .select()
    .from(settings)
    .where(eq(settings.key, SETTINGS_KEY))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(settings)
      .set({ value, updatedAt: new Date() })
      .where(eq(settings.key, SETTINGS_KEY));
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
 */
export function showNotification(title: string, body: string): void {
  try {
    if (!Notification.isSupported()) {
      console.warn('[Notifications] Notifications not supported on this platform');
      return;
    }

    const notification = new Notification({ title, body });
    notification.show();
  } catch (err) {
    console.error('[Notifications] Failed to show notification:', err);
  }
}

/**
 * Send a test notification to verify that notifications are working.
 */
export function sendTestNotification(): void {
  showNotification('Living Dashboard', 'Notifications are working!');
}
