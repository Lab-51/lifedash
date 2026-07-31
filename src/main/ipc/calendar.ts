// === FILE PURPOSE ===
// IPC handlers for Phase G (Calendar Integration). Freezes the channels that Tasks
// 2–5 build against: status, client-config, connect, disconnect, upcoming (cache
// read), poll-now, and suggest-project (series→project association, Task 5), plus
// CAL-UX.1's calendar picker pair (list-calendars / set-selected-calendars).
//
// The per-provider OAuth/token work lives in calendarAuthService; connect/poll
// delegate to the registered provider adapter (Google = Task 2, Microsoft = Task 3),
// which does not exist yet — so those channels are inert until an adapter registers.

import { ipcMain } from 'electron';
import { z } from 'zod';
import { and, asc, gte, lte } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { calendarEvents } from '../db/schema';
import { validateInput } from '../../shared/validation/ipc-validator';
import {
  getCalendarStatuses,
  storeCalendarClientConfig,
  loadCalendarClientConfig,
  loadCalendarTokens,
  persistCalendarConnection,
  disconnectCalendar,
  recordCalendarSync,
  markCalendarNeedsReauth,
  getCalendarAdapter,
  CalendarReauthRequiredError,
} from '../services/calendarAuthService';
import { suggestProject } from '../services/calendarAssociationService';
import { loadSelectedCalendarIds, saveSelectedCalendarIds } from '../services/calendarSelectionService';
import { replaceProviderEvents } from '../services/calendarPollScheduler';
import { hasCalendarListScope } from '../services/calendarProviders/googleCalendarProvider';
import { createLogger } from '../services/logger';
import { CALENDAR_LOOKAHEAD_HOURS } from '../../shared/types/calendar';
import type {
  CalendarProvider,
  CalendarEvent,
  CalendarEventAttendee,
  CalendarListResult,
  CalendarProjectSuggestion,
} from '../../shared/types/calendar';

const log = createLogger('CalendarIPC');

// === Zod payload schemas (frozen contract) =========================================

const calendarProviderSchema = z.enum(['google', 'microsoft']);

const calendarClientConfigSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('google'),
    clientId: z.string().min(1).max(500),
    clientSecret: z.string().min(1).max(500),
  }),
  z.object({
    provider: z.literal('microsoft'),
    clientId: z.string().min(1).max(500),
  }),
]);

const withinHoursSchema = z.number().int().min(1).max(720);

const suggestProjectSchema = z.object({
  seriesId: z.string().max(512).optional(),
  eventId: z.string().max(512).optional(),
});

// At least one calendar: an empty selection ("sync nothing") is rejected at the edge.
const setSelectedCalendarsSchema = z.object({
  provider: calendarProviderSchema,
  calendarIds: z.array(z.string().min(1).max(512)).min(1).max(50),
});

// === Mapping =======================================================================

function toCalendarEvent(row: typeof calendarEvents.$inferSelect): CalendarEvent {
  return {
    id: row.id,
    provider: row.provider,
    eventId: row.eventId,
    title: row.title,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    attendees: row.attendees,
    seriesId: row.seriesId ?? undefined,
  };
}

/** Upsert a batch of freshly-fetched events into the local cache. Upsert-only — used by
 *  the connect/poll-now paths where nothing was deselected. The set-selected-calendars
 *  path instead polls with { replace: true } (scheduler's replace-except-linked pass) so
 *  a deselected calendar's events are evicted immediately, not on the next cycle. */
async function cacheEvents(provider: CalendarProvider, events: CalendarEvent[]): Promise<void> {
  const db = getDb();
  for (const ev of events) {
    const attendees: CalendarEventAttendee[] = ev.attendees ?? [];
    const values = {
      id: `${provider}:${ev.eventId}`,
      provider,
      eventId: ev.eventId,
      title: ev.title,
      startsAt: new Date(ev.startsAt),
      endsAt: new Date(ev.endsAt),
      attendees,
      seriesId: ev.seriesId ?? null,
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
          syncedAt: values.syncedAt,
        },
      });
  }
}

/** Poll one provider via its adapter (if registered) and refresh the cache. */
async function pollProvider(provider: CalendarProvider, opts?: { replace?: boolean }): Promise<void> {
  const adapter = getCalendarAdapter(provider);
  if (!adapter) return; // No adapter registered yet (Tasks 2 & 3).
  const tokens = await loadCalendarTokens(provider);
  const config = await loadCalendarClientConfig(provider);
  if (!tokens || !config) return;

  try {
    // undefined ⇒ the user has never picked calendars ⇒ provider default.
    const selectedCalendarIds = await loadSelectedCalendarIds(provider);
    const events = await adapter.fetchUpcoming(tokens, config, CALENDAR_LOOKAHEAD_HOURS, selectedCalendarIds);
    await (opts?.replace ? replaceProviderEvents(provider, events) : cacheEvents(provider, events));
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

export function registerCalendarHandlers(): void {
  // Connection status for both providers.
  ipcMain.handle('calendar:get-status', async () => getCalendarStatuses());

  // Store BYO client credentials (encrypted). NEVER echo the secret back.
  ipcMain.handle('calendar:set-client-config', async (_event, config: unknown) => {
    const valid = validateInput(calendarClientConfigSchema, config);
    await storeCalendarClientConfig(valid);
  });

  // Run the full authorize flow via the registered provider adapter.
  ipcMain.handle('calendar:connect', async (event, provider: unknown) => {
    const valid = validateInput(calendarProviderSchema, provider);
    const config = await loadCalendarClientConfig(valid);
    if (!config) {
      throw new Error('Set calendar client credentials before connecting');
    }
    const adapter = getCalendarAdapter(valid);
    if (!adapter) {
      throw new Error(`Calendar provider "${valid}" is not available yet`);
    }
    const { tokens, accountEmail } = await adapter.authorize(config);
    await persistCalendarConnection(valid, tokens, accountEmail);
    // Populate the cache immediately so the ribbon/banners show without waiting for the
    // next scheduled poll (~up to the poll interval). Best-effort — a fetch failure here
    // must not fail the connect (tokens are already persisted; the poller will retry).
    try {
      await pollProvider(valid);
      event.sender.send('calendar:events-updated');
    } catch (err) {
      log.warn(`Post-connect poll failed for ${valid}:`, err);
    }
    const statuses = await getCalendarStatuses();
    return statuses.find((s) => s.provider === valid) ?? null;
  });

  // Disconnect: delete tokens + purge cached events (keeps client config).
  ipcMain.handle('calendar:disconnect', async (_event, provider: unknown) => {
    const valid = validateInput(calendarProviderSchema, provider);
    await disconnectCalendar(valid);
  });

  // Upcoming events from the local cache within `withinHours`.
  ipcMain.handle('calendar:get-upcoming', async (_event, withinHours: unknown) => {
    const hours = validateInput(withinHoursSchema, withinHours);
    const now = new Date();
    const end = new Date(now.getTime() + hours * 60 * 60 * 1000);
    const db = getDb();
    const rows = await db
      .select()
      .from(calendarEvents)
      .where(and(gte(calendarEvents.endsAt, now), lte(calendarEvents.startsAt, end)))
      .orderBy(asc(calendarEvents.startsAt));
    return rows.map(toCalendarEvent);
  });

  // List the account's calendars for the Settings picker, plus the stored selection.
  // NEVER throws for a stale grant: a Google account connected before the calendar-list
  // scope existed returns needsReconnect WITHOUT any network call.
  ipcMain.handle('calendar:list-calendars', async (_event, provider: unknown) => {
    const valid = validateInput(calendarProviderSchema, provider);
    const selectedIds = (await loadSelectedCalendarIds(valid)) ?? [];
    const tokens = await loadCalendarTokens(valid);
    const config = await loadCalendarClientConfig(valid);
    const adapter = getCalendarAdapter(valid);
    // Not connected (or no adapter) — reconnecting is the only way forward.
    if (!tokens || !config || !adapter) {
      return { calendars: [], selectedIds, needsReconnect: true } satisfies CalendarListResult;
    }
    // Google-only: `calendar.events.readonly` reads events but cannot LIST calendars.
    // Microsoft's Calendars.ReadBasic covers both, so it never needs this pre-check.
    if (valid === 'google' && !hasCalendarListScope(tokens.scope)) {
      return { calendars: [], selectedIds, needsReconnect: true } satisfies CalendarListResult;
    }
    const calendars = await adapter.listCalendars(tokens, config);
    return { calendars, selectedIds, needsReconnect: false } satisfies CalendarListResult;
  });

  // Persist which calendars a provider syncs, then refresh the cache immediately so the
  // agenda reflects the new selection without waiting for the next poll cycle.
  ipcMain.handle('calendar:set-selected-calendars', async (event, payload: unknown) => {
    const valid = validateInput(setSelectedCalendarsSchema, payload);
    await saveSelectedCalendarIds(valid.provider, valid.calendarIds);
    // replace: evict deselected calendars' events now, not on the next poll cycle.
    await pollProvider(valid.provider, { replace: true });
    event.sender.send('calendar:events-updated');
  });

  // Force a poll of every connected provider now.
  ipcMain.handle('calendar:poll-now', async () => {
    await pollProvider('google');
    await pollProvider('microsoft');
  });

  // Series→project association learning (Task 5) — see calendarAssociationService.
  ipcMain.handle('calendar:suggest-project', async (_event, payload: unknown) => {
    const valid = validateInput(suggestProjectSchema, payload);
    const result: CalendarProjectSuggestion | null = await suggestProject(valid);
    return result;
  });
}
