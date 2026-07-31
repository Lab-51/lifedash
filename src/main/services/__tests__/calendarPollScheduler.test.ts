// Unit tests for the calendar poll scheduler (Phase G, Task 4). Covers the
// load-bearing guarantees: replace-except-linked cache retention, event-start
// notification dedupe, poll interval honoring the settings key, and rotated-token
// persistence via updateCalendarTokens. Uses an in-memory PGlite DB; all providers
// are fake adapters — no network.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { calendarEvents, meetings, settings } from '../../db/schema';
import { CALENDAR_LOOKAHEAD_HOURS } from '../../../shared/types/calendar';
import type { CalendarProviderAdapter, CalendarTokens } from '../../../shared/types/calendar';

// --- Mocks (before importing the modules under test) --------------------------------
vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }));
vi.mock('../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../secure-storage', () => ({
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => 'enc::' + Buffer.from(s, 'utf8').toString('base64'),
  decryptString: (v: string) => Buffer.from(v.replace('enc::', ''), 'base64').toString('utf8'),
}));
const showNotification = vi.hoisted(() => vi.fn());
vi.mock('../notificationService', () => ({ showNotification }));
const holder = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof drizzle> }));
vi.mock('../../db/connection', () => ({ getDb: () => holder.db }));

import {
  persistCalendarConnection,
  registerCalendarAdapter,
  loadCalendarTokens,
  storeCalendarClientConfig,
} from '../calendarAuthService';
import { initCalendarPollScheduler, stopCalendarPollScheduler, runPollCycle } from '../calendarPollScheduler';

// --- Helpers -----------------------------------------------------------------------
const fakeWindow = { webContents: { send: vi.fn() } };

function makeAdapter(overrides: Partial<CalendarProviderAdapter> = {}): CalendarProviderAdapter {
  return {
    authorize: vi.fn(),
    refreshIfNeeded: vi.fn(async (t: CalendarTokens) => t),
    listCalendars: vi.fn(async () => []),
    fetchUpcoming: vi.fn(async () => []),
    ...overrides,
  };
}

async function seedEvent(id: string, provider: 'google' | 'microsoft', eventId: string, startsAt: Date): Promise<void> {
  await holder.db.insert(calendarEvents).values({
    id,
    provider,
    eventId,
    title: `Title ${eventId}`,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 30 * 60_000),
    attendees: [],
    seriesId: null,
    syncedAt: new Date(),
  });
}

async function setSetting(key: string, value: string): Promise<void> {
  await holder.db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

async function clearTables(): Promise<void> {
  await holder.db.delete(calendarEvents);
  await holder.db.delete(meetings);
  await holder.db.delete(settings);
}

const connectedTokens: CalendarTokens = { accessToken: 'AT', refreshToken: 'RT', expiresAt: Date.now() + 3_600_000 };

beforeAll(async () => {
  const pg = new PGlite({ extensions: { vector } });
  holder.db = drizzle(pg, { schema });
  await migrate(holder.db as never, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
});

afterAll(async () => {
  stopCalendarPollScheduler();
});

beforeEach(async () => {
  vi.clearAllMocks();
  stopCalendarPollScheduler();
  await clearTables();
  // Google client config so loadCalendarClientConfig resolves (poll requires it).
  await storeCalendarClientConfig({ provider: 'google', clientId: 'cid', clientSecret: 'sec' });
});

afterEach(() => {
  stopCalendarPollScheduler();
  vi.useRealTimers();
});

describe('replace-except-linked cache retention', () => {
  it('purges only the provider rows NOT referenced by meetings.calendarEventId, keeps others + upserts fresh', async () => {
    await setSetting('calendar:eventNotifications', 'false'); // isolate: no reminder timers
    await persistCalendarConnection('google', connectedTokens, 'me@example.com');

    const now = new Date();
    await seedEvent('google:linked', 'google', 'linked', new Date(now.getTime() + 3 * 3_600_000));
    await seedEvent('google:stale', 'google', 'stale', new Date(now.getTime() + 4 * 3_600_000));
    await seedEvent('microsoft:other', 'microsoft', 'other', new Date(now.getTime() + 3_600_000));

    // A session links 'google:linked' — it must survive even though the fetch omits it.
    await holder.db.insert(meetings).values({ title: 'Recorded', startedAt: now, calendarEventId: 'google:linked' });

    // Fresh fetch returns a brand-new event and NOT the linked/stale ones.
    const adapter = makeAdapter({
      fetchUpcoming: vi.fn(async () => [
        {
          id: 'google:fresh',
          provider: 'google' as const,
          eventId: 'fresh',
          title: 'Fresh',
          startsAt: new Date(now.getTime() + 6 * 3_600_000).toISOString(),
          endsAt: new Date(now.getTime() + 6.5 * 3_600_000).toISOString(),
          attendees: [],
        },
      ]),
    });
    registerCalendarAdapter('google', adapter);

    await runPollCycle(fakeWindow as never);

    const rows = await holder.db.select().from(calendarEvents);
    const ids = rows.map((r) => r.id).sort();
    // linked retained, stale purged, fresh inserted, other provider untouched.
    expect(ids).toEqual(['google:fresh', 'google:linked', 'microsoft:other']);
    expect(fakeWindow.webContents.send).toHaveBeenCalledWith('calendar:events-updated');
  });
});

describe('rotated-token persistence', () => {
  it('persists rotated tokens returned by refreshIfNeeded via updateCalendarTokens', async () => {
    await setSetting('calendar:eventNotifications', 'false');
    await persistCalendarConnection('google', connectedTokens, 'me@example.com');

    const rotated: CalendarTokens = {
      accessToken: 'AT-NEW',
      refreshToken: 'RT-NEW',
      expiresAt: Date.now() + 7_200_000,
    };
    const adapter = makeAdapter({
      refreshIfNeeded: vi.fn(async () => rotated), // new object → rotation signal
      fetchUpcoming: vi.fn(async () => []),
    });
    registerCalendarAdapter('google', adapter);

    await runPollCycle(fakeWindow as never);

    const stored = await loadCalendarTokens('google');
    expect(stored?.accessToken).toBe('AT-NEW');
    expect(stored?.refreshToken).toBe('RT-NEW');
  });

  it('does NOT persist when refreshIfNeeded returns the same tokens object', async () => {
    await setSetting('calendar:eventNotifications', 'false');
    await persistCalendarConnection('google', connectedTokens, 'me@example.com');

    const update = vi.fn(async (t: CalendarTokens) => t); // returns same reference
    const adapter = makeAdapter({ refreshIfNeeded: update, fetchUpcoming: vi.fn(async () => []) });
    registerCalendarAdapter('google', adapter);

    await runPollCycle(fakeWindow as never);

    const stored = await loadCalendarTokens('google');
    expect(stored?.accessToken).toBe('AT'); // unchanged
  });
});

describe('event-start notifications', () => {
  it('schedules a reminder at the start instant and dedupes across cycles', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T10:00:00Z'));
    await setSetting('calendar:eventNotifications', 'true');
    await setSetting('calendar:pollIntervalMinutes', '5');
    await persistCalendarConnection('google', connectedTokens, 'me@example.com');

    const startsAt = new Date(Date.now() + 2 * 60_000); // 2 min out (inside 5-min window)
    const adapter = makeAdapter({
      fetchUpcoming: vi.fn(async () => [
        {
          id: 'google:soon',
          provider: 'google' as const,
          eventId: 'soon',
          title: 'Soon Meeting',
          startsAt: startsAt.toISOString(),
          endsAt: new Date(startsAt.getTime() + 30 * 60_000).toISOString(),
          attendees: [],
        },
      ]),
    });
    registerCalendarAdapter('google', adapter);

    await runPollCycle(fakeWindow as never);
    // Second cycle before the timer fires: the event is already scheduled → no re-schedule.
    await runPollCycle(fakeWindow as never);

    expect(showNotification).not.toHaveBeenCalled(); // not until the start instant
    await vi.advanceTimersByTimeAsync(2 * 60_000);

    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(showNotification).toHaveBeenCalledWith('Soon Meeting is starting', 'Open LifeDash to record it');
  });

  it('does not schedule reminders when the setting is disabled', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T10:00:00Z'));
    await setSetting('calendar:eventNotifications', 'false');
    await persistCalendarConnection('google', connectedTokens, 'me@example.com');

    const startsAt = new Date(Date.now() + 2 * 60_000);
    const adapter = makeAdapter({
      fetchUpcoming: vi.fn(async () => [
        {
          id: 'google:soon',
          provider: 'google' as const,
          eventId: 'soon',
          title: 'Soon',
          startsAt: startsAt.toISOString(),
          endsAt: new Date(startsAt.getTime() + 30 * 60_000).toISOString(),
          attendees: [],
        },
      ]),
    });
    registerCalendarAdapter('google', adapter);

    await runPollCycle(fakeWindow as never);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(showNotification).not.toHaveBeenCalled();
  });
});

describe('poll interval honors the settings key', () => {
  it('runs the recurring poll on the configured cadence, not the default', async () => {
    vi.useFakeTimers();
    await setSetting('calendar:eventNotifications', 'false');
    await setSetting('calendar:pollIntervalMinutes', '2'); // 2 min, not the 5-min default
    await persistCalendarConnection('google', connectedTokens, 'me@example.com');

    const fetchUpcoming = vi.fn(async () => []);
    registerCalendarAdapter('google', makeAdapter({ fetchUpcoming }));

    initCalendarPollScheduler(fakeWindow as never);

    // First cycle after the ~15s startup delay.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchUpcoming).toHaveBeenCalledTimes(1);

    // A 2-min interval means one more tick after 2 min (a 5-min default would not).
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(fetchUpcoming).toHaveBeenCalledTimes(2);
  });
});

describe('selected-calendar plumbing (CAL-UX.1)', () => {
  it('passes the stored selection to fetchUpcoming, with the shared 7-day lookahead', async () => {
    await setSetting('calendar:eventNotifications', 'false');
    await setSetting(
      'calendar:google:selectedCalendars',
      JSON.stringify(['primary', 'team@group.calendar.google.com']),
    );
    await persistCalendarConnection('google', connectedTokens, 'me@example.com');

    const fetchUpcoming = vi.fn(async () => []);
    registerCalendarAdapter('google', makeAdapter({ fetchUpcoming }));

    await runPollCycle(fakeWindow as never);

    expect(fetchUpcoming).toHaveBeenCalledTimes(1);
    const [, , windowHours, selection] = fetchUpcoming.mock.calls[0] as unknown as [
      unknown,
      unknown,
      number,
      string[] | undefined,
    ];
    expect(windowHours).toBe(CALENDAR_LOOKAHEAD_HOURS);
    expect(windowHours).toBe(168);
    expect(selection).toEqual(['primary', 'team@group.calendar.google.com']);
  });

  it('passes undefined (provider default) when the selection key is absent', async () => {
    await setSetting('calendar:eventNotifications', 'false');
    await persistCalendarConnection('google', connectedTokens, 'me@example.com');

    const fetchUpcoming = vi.fn(async () => []);
    registerCalendarAdapter('google', makeAdapter({ fetchUpcoming }));

    await runPollCycle(fakeWindow as never);

    const [, , , selection] = fetchUpcoming.mock.calls[0] as unknown as [
      unknown,
      unknown,
      number,
      string[] | undefined,
    ];
    expect(selection).toBeUndefined();
  });

  it('falls back to the provider default when the stored selection is unparseable', async () => {
    await setSetting('calendar:eventNotifications', 'false');
    await setSetting('calendar:google:selectedCalendars', 'not-json');
    await persistCalendarConnection('google', connectedTokens, 'me@example.com');

    const fetchUpcoming = vi.fn(async () => []);
    registerCalendarAdapter('google', makeAdapter({ fetchUpcoming }));

    await runPollCycle(fakeWindow as never);

    const [, , , selection] = fetchUpcoming.mock.calls[0] as unknown as [
      unknown,
      unknown,
      number,
      string[] | undefined,
    ];
    expect(selection).toBeUndefined();
  });
});

describe('never throws from the background loop', () => {
  it('swallows an adapter refresh failure, records lastError, and still notifies the renderer', async () => {
    await setSetting('calendar:eventNotifications', 'false');
    await persistCalendarConnection('google', connectedTokens, 'me@example.com');

    const adapter = makeAdapter({
      refreshIfNeeded: vi.fn(async () => {
        throw new Error('network down');
      }),
    });
    registerCalendarAdapter('google', adapter);

    await expect(runPollCycle(fakeWindow as never)).resolves.toBeUndefined();
    expect(fakeWindow.webContents.send).toHaveBeenCalledWith('calendar:events-updated');

    // lastError landed on the stored auth blob (poll outcome recorded, not thrown).
    const rows = await holder.db.select().from(settings).where(eq(settings.key, 'calendar:google:auth'));
    const decoded = JSON.parse(Buffer.from(rows[0].value.replace('enc::', ''), 'base64').toString('utf8'));
    expect(decoded.lastError).toContain('network down');
  });
});
