// === FILE PURPOSE ===
// Background poll scheduler for Phase G (Calendar Integration, Task 4). Periodically
// refreshes the local calendar_events cache from every CONNECTED provider, pushes a
// 'calendar:events-updated' notice to the renderer, and schedules desktop reminders
// for events about to start. Modeled on notificationScheduler (init/stop pair +
// startup delay). NEVER throws from the background loop.
//
// === PRIVACY / SAFETY (load-bearing) ===
// - NEVER auto-starts recording — event-start reminders only nudge the user (hard
//   privacy floor; recording is always an explicit user click).
// - Linked-row retention: a per-poll cache replace deletes only rows NOT referenced
//   by meetings.calendarEventId, so a session's linked event survives even after it
//   drops out of the fetch window (Task 5 reads the cache post-session).
// - Token-rotation persistence: adapters' internal 401-refresh does NOT persist the
//   rotated tokens; the poller persists them here via updateCalendarTokens.
//
// === DEPENDENCIES ===
// calendarAuthService (statuses, adapters, tokens, sync metadata), notificationService,
// database (calendar_events + meetings), electron BrowserWindow.

import type { BrowserWindow } from 'electron';
import { and, eq, gte, isNotNull, lte, notInArray } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { calendarEvents, meetings, settings } from '../db/schema';
import {
  getCalendarStatuses,
  getCalendarAdapter,
  loadCalendarTokens,
  loadCalendarClientConfig,
  updateCalendarTokens,
  recordCalendarSync,
  markCalendarNeedsReauth,
  CalendarReauthRequiredError,
} from './calendarAuthService';
import { showNotification } from './notificationService';
import { loadSelectedCalendarIds } from './calendarSelectionService';
import { createLogger } from './logger';
import {
  CALENDAR_LOOKAHEAD_HOURS,
  CALENDAR_SETTING_POLL_INTERVAL_MINUTES,
  CALENDAR_SETTING_EVENT_NOTIFICATIONS,
  CALENDAR_DEFAULT_POLL_INTERVAL_MINUTES,
  CALENDAR_DEFAULT_EVENT_NOTIFICATIONS,
} from '../../shared/types/calendar';
import type { CalendarProvider, CalendarEvent } from '../../shared/types/calendar';

const log = createLogger('CalendarPoll');

/** Delay before the first poll so it never blocks app startup. */
const STARTUP_DELAY_MS = 15_000;
/** Floor for the configurable poll interval (minutes). */
const MIN_POLL_INTERVAL_MINUTES = 1;

let intervalId: ReturnType<typeof setInterval> | null = null;
let startupTimeoutId: ReturnType<typeof setTimeout> | null = null;

// Dedupe: an event id here has already had a start reminder SCHEDULED, so it will
// never be scheduled twice across poll cycles. Persists until stop().
const scheduledNotificationEventIds = new Set<string>();
// Pending reminder timers so stop() can clear them (no reminder fires after shutdown).
const pendingNotificationTimers = new Set<ReturnType<typeof setTimeout>>();

/**
 * Start the calendar poll scheduler. Reads the poll interval from settings once
 * (a change takes effect on the next app start). Fire-and-forget; never throws.
 */
export function initCalendarPollScheduler(mainWindow: BrowserWindow): void {
  startupTimeoutId = setTimeout(() => {
    void (async () => {
      await runPollCycle(mainWindow);
      const minutes = await getPollIntervalMinutes();
      intervalId = setInterval(() => {
        void runPollCycle(mainWindow);
      }, minutes * 60_000);
    })();
  }, STARTUP_DELAY_MS);

  log.info('Calendar poll scheduler initialized');
}

/** Stop the scheduler and clear all pending timers + dedupe state. */
export function stopCalendarPollScheduler(): void {
  if (startupTimeoutId !== null) {
    clearTimeout(startupTimeoutId);
    startupTimeoutId = null;
  }
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  for (const timer of pendingNotificationTimers) {
    clearTimeout(timer);
  }
  pendingNotificationTimers.clear();
  scheduledNotificationEventIds.clear();
  log.info('Calendar poll scheduler stopped');
}

/**
 * One poll cycle: refresh every connected provider's cache (with linked-row
 * retention + rotation persistence), notify the renderer, and schedule event-start
 * reminders. NEVER throws — the whole body is guarded.
 */
export async function runPollCycle(mainWindow: BrowserWindow): Promise<void> {
  try {
    const statuses = await getCalendarStatuses();
    for (const status of statuses) {
      if (!status.connected) continue;
      await pollProvider(status.provider);
    }

    // Push a refresh notice so the renderer ribbon/banners re-read the cache.
    try {
      mainWindow.webContents.send('calendar:events-updated');
    } catch (err) {
      // Window may be gone during shutdown — non-fatal.
      log.warn('Failed to send calendar:events-updated:', err);
    }

    if (await getEventNotificationsEnabled()) {
      await scheduleEventStartNotifications();
    }
  } catch (err) {
    // Never throw from the background scheduler.
    log.error('Poll cycle failed:', err);
  }
}

/**
 * Poll a single provider via its registered adapter: refresh (persisting rotation),
 * fetch, replace-except-linked, and record the sync outcome. Never throws.
 */
async function pollProvider(provider: CalendarProvider): Promise<void> {
  const adapter = getCalendarAdapter(provider);
  if (!adapter) return; // No adapter registered.
  const tokens = await loadCalendarTokens(provider);
  const config = await loadCalendarClientConfig(provider);
  if (!tokens || !config) return;

  try {
    // Refresh if near/after expiry. The adapter returns the SAME object when no
    // refresh was needed, and a NEW object when it rotated — reference inequality is
    // the rotation signal. The adapter does NOT persist rotation, so we do it here.
    const refreshed = await adapter.refreshIfNeeded(tokens);
    if (refreshed !== tokens) {
      await updateCalendarTokens(provider, refreshed);
    }

    // undefined ⇒ the user has never picked calendars ⇒ provider default.
    const selectedCalendarIds = await loadSelectedCalendarIds(provider);
    const events = await adapter.fetchUpcoming(refreshed, config, CALENDAR_LOOKAHEAD_HOURS, selectedCalendarIds);
    await replaceProviderEvents(provider, events);
    await recordCalendarSync(provider, { lastSyncAt: new Date().toISOString(), lastError: undefined });
  } catch (err) {
    if (err instanceof CalendarReauthRequiredError) {
      await markCalendarNeedsReauth(provider, err.message);
    } else {
      const message = err instanceof Error ? err.message : 'Poll failed';
      log.warn(`Calendar poll failed for ${provider}:`, message);
      await recordCalendarSync(provider, { lastError: message });
    }
  }
}

/**
 * Replace this provider's cached rows with the freshly-fetched set, RETAINING any
 * row referenced by meetings.calendarEventId. Approach: delete the provider's rows
 * whose id is NOT in the set of linked ids, then upsert the fresh events. A linked
 * event thus survives even after it leaves the fetch window (Task 5 depends on this to
 * read the event post-session). It ALSO evicts events of newly-deselected calendars.
 * Exported: ipc/calendar.ts's set-selected-calendars path uses it so a deselection
 * takes effect immediately instead of waiting for the next poll cycle.
 */
export async function replaceProviderEvents(provider: CalendarProvider, events: CalendarEvent[]): Promise<void> {
  const db = getDb();

  // Ids linked by any session (calendarEventId is the prefixed `${provider}:${eventId}`,
  // matching calendar_events.id). Cross-provider ids in this list are harmless — the
  // delete below is also scoped by provider, and they can never match this provider's ids.
  const linkedRows = await db
    .select({ id: meetings.calendarEventId })
    .from(meetings)
    .where(isNotNull(meetings.calendarEventId));
  const linkedIds = linkedRows.map((r) => r.id).filter((id): id is string => id !== null);

  if (linkedIds.length > 0) {
    await db
      .delete(calendarEvents)
      .where(and(eq(calendarEvents.provider, provider), notInArray(calendarEvents.id, linkedIds)));
  } else {
    await db.delete(calendarEvents).where(eq(calendarEvents.provider, provider));
  }

  for (const ev of events) {
    const values = {
      id: `${provider}:${ev.eventId}`,
      provider,
      eventId: ev.eventId,
      title: ev.title,
      startsAt: new Date(ev.startsAt),
      endsAt: new Date(ev.endsAt),
      attendees: ev.attendees ?? [],
      seriesId: ev.seriesId ?? null,
      description: ev.description ?? null,
      syncedAt: new Date(),
    };
    await db
      .insert(calendarEvents)
      .values(values)
      .onConflictDoUpdate({
        target: calendarEvents.id,
        set: {
          title: values.title,
          startsAt: values.startsAt,
          endsAt: values.endsAt,
          attendees: values.attendees,
          seriesId: values.seriesId,
          description: values.description,
          syncedAt: values.syncedAt,
        },
      });
  }
}

/**
 * Schedule a desktop reminder at the exact start instant of every cached event
 * starting within the next poll interval. Module-level dedupe ensures an event is
 * only ever scheduled once. NEVER auto-starts recording.
 */
async function scheduleEventStartNotifications(): Promise<void> {
  const intervalMs = (await getPollIntervalMinutes()) * 60_000;
  const now = Date.now();
  const windowEnd = new Date(now + intervalMs);

  const db = getDb();
  const rows = await db
    .select({ id: calendarEvents.id, title: calendarEvents.title, startsAt: calendarEvents.startsAt })
    .from(calendarEvents)
    .where(and(gte(calendarEvents.startsAt, new Date(now)), lte(calendarEvents.startsAt, windowEnd)));

  for (const row of rows) {
    if (scheduledNotificationEventIds.has(row.id)) continue;
    scheduledNotificationEventIds.add(row.id);

    const delay = Math.max(0, row.startsAt.getTime() - Date.now());
    const title = row.title;
    const timer = setTimeout(() => {
      pendingNotificationTimers.delete(timer);
      showNotification(`${title} is starting`, 'Open LifeDash to record it');
    }, delay);
    pendingNotificationTimers.add(timer);
  }
}

// === Settings helpers ==============================================================

async function readSettingValue(key: string): Promise<string | null> {
  try {
    const db = getDb();
    const rows = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
    return rows.length > 0 ? rows[0].value : null;
  } catch {
    return null;
  }
}

/** Poll interval in minutes from settings (default 5), floored at 1. */
async function getPollIntervalMinutes(): Promise<number> {
  const raw = await readSettingValue(CALENDAR_SETTING_POLL_INTERVAL_MINUTES);
  const parsed = parseInt(raw ?? CALENDAR_DEFAULT_POLL_INTERVAL_MINUTES, 10);
  if (Number.isNaN(parsed) || parsed < MIN_POLL_INTERVAL_MINUTES) return MIN_POLL_INTERVAL_MINUTES;
  return parsed;
}

/** Whether event-start reminders are enabled (default true). */
async function getEventNotificationsEnabled(): Promise<boolean> {
  const raw = await readSettingValue(CALENDAR_SETTING_EVENT_NOTIFICATIONS);
  // Unset → default true; only an explicit 'false' disables (mirrors other toggles).
  return (raw ?? CALENDAR_DEFAULT_EVENT_NOTIFICATIONS) !== 'false';
}
