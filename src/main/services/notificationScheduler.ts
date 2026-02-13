// === FILE PURPOSE ===
// Background scheduler for notification checks.
// Periodically checks for due cards and sends daily digest.
//
// === DEPENDENCIES ===
// notificationService, database (cards, meetings)
//
// === LIMITATIONS ===
// - Hourly check granularity (not minute-precise)
// - Daily digest timing approximate (depends on check interval)

import { getDb } from '../db/connection';
import { cards } from '../db/schema';
import { and, eq, isNotNull, lte } from 'drizzle-orm';
import {
  getNotificationPreferences,
  showNotification,
} from './notificationService';

const CHECK_INTERVAL_MS = 3_600_000; // 1 hour
const STARTUP_DELAY_MS = 30_000; // 30 seconds

let intervalId: ReturnType<typeof setInterval> | null = null;
let startupTimeoutId: ReturnType<typeof setTimeout> | null = null;
let lastDigestDate: string | null = null; // 'YYYY-MM-DD' of last digest sent

/**
 * Initialize the notification scheduler.
 * Starts a delayed first check, then repeats hourly.
 */
export function initNotificationScheduler(): void {
  // Run first check after a short delay (don't block app startup)
  startupTimeoutId = setTimeout(() => {
    checkAndNotify().catch((err) => {
      console.error('[NotificationScheduler] Initial check failed:', err);
    });
  }, STARTUP_DELAY_MS);

  // Then check every hour
  intervalId = setInterval(() => {
    checkAndNotify().catch((err) => {
      console.error('[NotificationScheduler] Scheduled check failed:', err);
    });
  }, CHECK_INTERVAL_MS);

  console.log('[NotificationScheduler] Scheduler initialized');
}

/**
 * Stop the notification scheduler and reset state.
 */
export function stopNotificationScheduler(): void {
  if (startupTimeoutId !== null) {
    clearTimeout(startupTimeoutId);
    startupTimeoutId = null;
  }
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  lastDigestDate = null;
  console.log('[NotificationScheduler] Scheduler stopped');
}

/**
 * Main check routine: loads preferences and sends due-date
 * and daily-digest notifications as configured.
 */
export async function checkAndNotify(): Promise<void> {
  try {
    const preferences = await getNotificationPreferences();

    if (!preferences.enabled) {
      return;
    }

    // --- Due date reminders ---
    if (preferences.dueDateReminders) {
      await checkDueDateReminders();
    }

    // --- Daily digest ---
    if (preferences.dailyDigest) {
      await checkDailyDigest(preferences.dailyDigestHour);
    }
  } catch (err) {
    console.error('[NotificationScheduler] Check failed:', err);
    // Never throw from background scheduler
  }
}

/**
 * Check for cards due within the next 24 hours and send notifications.
 */
async function checkDueDateReminders(): Promise<void> {
  try {
    const db = getDb();
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const dueCards = await db
      .select({
        title: cards.title,
        dueDate: cards.dueDate,
      })
      .from(cards)
      .where(
        and(
          isNotNull(cards.dueDate),
          lte(cards.dueDate, in24h),
          eq(cards.archived, false),
        ),
      )
      .limit(10);

    // Show notifications for up to 5 cards
    const toNotify = dueCards.slice(0, 5);
    for (const card of toNotify) {
      const dueStr = card.dueDate
        ? new Date(card.dueDate).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : 'soon';
      showNotification(
        'Card Due Soon',
        `"${card.title}" is due ${dueStr}`,
      );
    }

    if (dueCards.length > 5) {
      showNotification(
        'Cards Due Soon',
        `${dueCards.length - 5} more card(s) are also due within 24 hours`,
      );
    }
  } catch (err) {
    console.error('[NotificationScheduler] Due date check failed:', err);
  }
}

/**
 * Send a daily digest notification if the current hour matches the
 * configured digest hour and one hasn't been sent yet today.
 */
async function checkDailyDigest(digestHour: number): Promise<void> {
  try {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10); // 'YYYY-MM-DD'
    const currentHour = now.getHours();

    // Already sent today or not yet time
    if (lastDigestDate === todayStr || currentHour < digestHour) {
      return;
    }

    const db = getDb();
    const todayStart = new Date(todayStr + 'T00:00:00');
    const todayEnd = new Date(todayStr + 'T23:59:59');

    // Count cards due today
    const dueToday = await db
      .select({ title: cards.title })
      .from(cards)
      .where(
        and(
          isNotNull(cards.dueDate),
          lte(cards.dueDate, todayEnd),
          eq(cards.archived, false),
        ),
      )
      .limit(50);

    // Count overdue cards (due before today)
    const overdue = await db
      .select({ title: cards.title })
      .from(cards)
      .where(
        and(
          isNotNull(cards.dueDate),
          lte(cards.dueDate, todayStart),
          eq(cards.archived, false),
        ),
      )
      .limit(50);

    const parts: string[] = [];
    if (dueToday.length > 0) {
      parts.push(`${dueToday.length} card(s) due today`);
    }
    if (overdue.length > 0) {
      parts.push(`${overdue.length} overdue`);
    }

    if (parts.length > 0) {
      showNotification('Daily Digest', parts.join(' | '));
    } else {
      showNotification('Daily Digest', 'No cards due today. Have a productive day!');
    }

    lastDigestDate = todayStr;
  } catch (err) {
    console.error('[NotificationScheduler] Daily digest check failed:', err);
  }
}
