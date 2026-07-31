// === FILE PURPOSE ===
// IPC behavior tests for the CAL-UX.1 calendar-picker channels plus the CAL-UX.2/2b
// event channels. Covers the load-bearing guarantees: the Google stale-scope pre-check
// runs BEFORE any network call (adapter untouched), Microsoft is never pre-checked, an
// empty selection is rejected at the API edge, saving a selection re-polls + pushes the
// refresh notice, and the connect→cache→get-upcoming round trip preserves the event
// description. Services are mocked; the DB is a REAL in-memory PGlite (same harness as
// calendarPollScheduler.test.ts) because the round trip IS the guarantee. No network.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '../../db/schema';
import { calendarEvents } from '../../db/schema';
import type { CalendarEvent, CalendarListResult, CalendarTokens } from '../../../shared/types/calendar';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports
// ---------------------------------------------------------------------------

const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
      registeredHandlers.set(channel, fn);
    }),
  },
}));

const holder = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof drizzle> }));
vi.mock('../../db/connection', () => ({ getDb: () => holder.db }));
vi.mock('../../services/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../../services/calendarAssociationService', () => ({ suggestProject: vi.fn() }));
vi.mock('../../services/calendarContextService', () => ({
  getEventContext: vi.fn(),
  generatePrepNote: vi.fn(),
}));
vi.mock('../../services/calendarSelectionService', () => ({
  loadSelectedCalendarIds: vi.fn(),
  saveSelectedCalendarIds: vi.fn(),
}));
vi.mock('../../services/calendarPollScheduler', () => ({
  replaceProviderEvents: vi.fn(async () => {}),
}));
vi.mock('../../services/calendarAuthService', () => ({
  getCalendarStatuses: vi.fn(),
  storeCalendarClientConfig: vi.fn(),
  loadCalendarClientConfig: vi.fn(),
  loadCalendarTokens: vi.fn(),
  persistCalendarConnection: vi.fn(),
  disconnectCalendar: vi.fn(),
  recordCalendarSync: vi.fn(),
  markCalendarNeedsReauth: vi.fn(),
  getCalendarAdapter: vi.fn(),
  CalendarReauthRequiredError: class extends Error {},
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { registerCalendarHandlers } from '../calendar';
import {
  loadCalendarClientConfig,
  loadCalendarTokens,
  getCalendarAdapter,
  getCalendarStatuses,
} from '../../services/calendarAuthService';
import { loadSelectedCalendarIds, saveSelectedCalendarIds } from '../../services/calendarSelectionService';
import { replaceProviderEvents } from '../../services/calendarPollScheduler';
import { getEventContext, generatePrepNote } from '../../services/calendarContextService';

const handler = (channel: string) => registeredHandlers.get(channel)!;

const GOOGLE_CONFIG = { provider: 'google' as const, clientId: 'cid', clientSecret: 'sec' };
const MS_CONFIG = { provider: 'microsoft' as const, clientId: 'cid' };
const PICKER_SCOPE =
  'openid email https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/calendar.calendarlist.readonly';

function tokens(scope?: string): CalendarTokens {
  return { accessToken: 'AT', refreshToken: 'RT', expiresAt: Date.now() + 3_600_000, scope };
}

function makeAdapter() {
  return {
    authorize: vi.fn(),
    refreshIfNeeded: vi.fn(),
    listCalendars: vi.fn(async () => [{ id: 'primary', name: 'Personal', isPrimary: true }]),
    fetchUpcoming: vi.fn(async () => []),
  };
}

function makeEvent() {
  return { sender: { send: vi.fn() } };
}

beforeAll(async () => {
  const pg = new PGlite({ extensions: { vector } });
  holder.db = drizzle(pg, { schema });
  await migrate(holder.db as never, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  registerCalendarHandlers();
});

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(loadSelectedCalendarIds).mockResolvedValue(undefined);
  await holder.db.delete(calendarEvents);
});

// === calendar:list-calendars =======================================================

describe('calendar:list-calendars', () => {
  it('returns needsReconnect WITHOUT calling the adapter when the Google grant predates the picker scope', async () => {
    const adapter = makeAdapter();
    vi.mocked(loadCalendarTokens).mockResolvedValue(
      tokens('openid email https://www.googleapis.com/auth/calendar.events.readonly'),
    );
    vi.mocked(loadCalendarClientConfig).mockResolvedValue(GOOGLE_CONFIG);
    vi.mocked(getCalendarAdapter).mockReturnValue(adapter);
    vi.mocked(loadSelectedCalendarIds).mockResolvedValue(['keep-me']);

    const result = (await handler('calendar:list-calendars')({}, 'google')) as CalendarListResult;

    expect(result).toEqual({ calendars: [], selectedIds: ['keep-me'], needsReconnect: true });
    expect(adapter.listCalendars).not.toHaveBeenCalled();
  });

  it('treats a missing granted-scope string as stale (no adapter call)', async () => {
    const adapter = makeAdapter();
    vi.mocked(loadCalendarTokens).mockResolvedValue(tokens(undefined));
    vi.mocked(loadCalendarClientConfig).mockResolvedValue(GOOGLE_CONFIG);
    vi.mocked(getCalendarAdapter).mockReturnValue(adapter);

    const result = (await handler('calendar:list-calendars')({}, 'google')) as CalendarListResult;

    expect(result.needsReconnect).toBe(true);
    expect(result.selectedIds).toEqual([]);
    expect(adapter.listCalendars).not.toHaveBeenCalled();
  });

  it('lists calendars when the Google grant carries the calendarlist scope', async () => {
    const adapter = makeAdapter();
    vi.mocked(loadCalendarTokens).mockResolvedValue(tokens(PICKER_SCOPE));
    vi.mocked(loadCalendarClientConfig).mockResolvedValue(GOOGLE_CONFIG);
    vi.mocked(getCalendarAdapter).mockReturnValue(adapter);
    vi.mocked(loadSelectedCalendarIds).mockResolvedValue(['primary']);

    const result = (await handler('calendar:list-calendars')({}, 'google')) as CalendarListResult;

    expect(adapter.listCalendars).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      calendars: [{ id: 'primary', name: 'Personal', isPrimary: true }],
      selectedIds: ['primary'],
      needsReconnect: false,
    });
  });

  it('never pre-checks Microsoft (Calendars.ReadBasic already covers listing)', async () => {
    const adapter = makeAdapter();
    vi.mocked(loadCalendarTokens).mockResolvedValue(tokens(undefined));
    vi.mocked(loadCalendarClientConfig).mockResolvedValue(MS_CONFIG);
    vi.mocked(getCalendarAdapter).mockReturnValue(adapter);

    const result = (await handler('calendar:list-calendars')({}, 'microsoft')) as CalendarListResult;

    expect(adapter.listCalendars).toHaveBeenCalledTimes(1);
    expect(result.needsReconnect).toBe(false);
  });

  it('reports needsReconnect when the provider is not connected', async () => {
    vi.mocked(loadCalendarTokens).mockResolvedValue(null);
    vi.mocked(loadCalendarClientConfig).mockResolvedValue(GOOGLE_CONFIG);
    vi.mocked(getCalendarAdapter).mockReturnValue(makeAdapter());

    const result = (await handler('calendar:list-calendars')({}, 'google')) as CalendarListResult;

    expect(result).toEqual({ calendars: [], selectedIds: [], needsReconnect: true });
  });

  it('rejects an unknown provider', async () => {
    await expect(handler('calendar:list-calendars')({}, 'yahoo')).rejects.toThrow(/Validation failed/);
  });
});

// === calendar:set-selected-calendars ===============================================

describe('calendar:set-selected-calendars', () => {
  it('persists the selection, re-polls the provider and pushes the refresh notice', async () => {
    const adapter = makeAdapter();
    vi.mocked(loadCalendarTokens).mockResolvedValue(tokens(PICKER_SCOPE));
    vi.mocked(loadCalendarClientConfig).mockResolvedValue(GOOGLE_CONFIG);
    vi.mocked(getCalendarAdapter).mockReturnValue(adapter);
    vi.mocked(loadSelectedCalendarIds).mockResolvedValue(['primary', 'team']);
    const event = makeEvent();

    await handler('calendar:set-selected-calendars')(event, { provider: 'google', calendarIds: ['primary', 'team'] });

    expect(saveSelectedCalendarIds).toHaveBeenCalledWith('google', ['primary', 'team']);
    // Re-poll uses the freshly stored selection and the shared 7-day lookahead.
    expect(adapter.fetchUpcoming).toHaveBeenCalledWith(expect.anything(), GOOGLE_CONFIG, 168, ['primary', 'team']);
    expect(event.sender.send).toHaveBeenCalledWith('calendar:events-updated');
    // Replace-based caching: deselected calendars' events are evicted NOW, not next cycle.
    expect(replaceProviderEvents).toHaveBeenCalledWith('google', []);
  });

  it('poll-now mirrors the calendar: replace-based caching for both providers + refresh push', async () => {
    const adapter = makeAdapter();
    vi.mocked(loadCalendarTokens).mockResolvedValue(tokens(PICKER_SCOPE));
    vi.mocked(loadCalendarClientConfig).mockResolvedValue(GOOGLE_CONFIG);
    vi.mocked(getCalendarAdapter).mockReturnValue(adapter);
    const event = makeEvent();

    await handler('calendar:poll-now')(event);

    expect(adapter.fetchUpcoming).toHaveBeenCalled();
    // Manual refresh must evict upstream-deleted events, not just upsert.
    expect(replaceProviderEvents).toHaveBeenCalledWith('google', []);
    expect(replaceProviderEvents).toHaveBeenCalledWith('microsoft', []);
    expect(event.sender.send).toHaveBeenCalledWith('calendar:events-updated');
  });

  it('rejects an EMPTY selection before touching storage', async () => {
    await expect(
      handler('calendar:set-selected-calendars')(makeEvent(), { provider: 'google', calendarIds: [] }),
    ).rejects.toThrow(/Validation failed/);
    expect(saveSelectedCalendarIds).not.toHaveBeenCalled();
  });

  it('rejects more than 50 calendars and oversized ids', async () => {
    await expect(
      handler('calendar:set-selected-calendars')(makeEvent(), {
        provider: 'google',
        calendarIds: Array.from({ length: 51 }, (_, i) => `cal-${i}`),
      }),
    ).rejects.toThrow(/Validation failed/);
    await expect(
      handler('calendar:set-selected-calendars')(makeEvent(), { provider: 'google', calendarIds: ['x'.repeat(513)] }),
    ).rejects.toThrow(/Validation failed/);
    expect(saveSelectedCalendarIds).not.toHaveBeenCalled();
  });
});

// === cache round trip: connect → cacheEvents → get-upcoming (CAL-UX.2b) ============

describe('event cache round trip', () => {
  /** An event starting in an hour, so `calendar:get-upcoming` always sees it. */
  function upcoming(description?: string): CalendarEvent {
    const startsAt = new Date(Date.now() + 3_600_000);
    return {
      id: 'google:evt-desc',
      provider: 'google',
      eventId: 'evt-desc',
      title: 'Described meeting',
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 30 * 60_000).toISOString(),
      attendees: [{ name: 'Ada', email: 'ada@example.com' }],
      ...(description === undefined ? {} : { description }),
    };
  }

  /** Drive the connect handler, whose post-connect poll goes through cacheEvents. */
  async function connectWith(events: CalendarEvent[]): Promise<void> {
    const adapter = {
      ...makeAdapter(),
      authorize: vi.fn(async () => ({ tokens: tokens(PICKER_SCOPE) })),
      fetchUpcoming: vi.fn(async () => events),
    };
    vi.mocked(getCalendarAdapter).mockReturnValue(adapter);
    vi.mocked(loadCalendarClientConfig).mockResolvedValue(GOOGLE_CONFIG);
    vi.mocked(loadCalendarTokens).mockResolvedValue(tokens(PICKER_SCOPE));
    vi.mocked(getCalendarStatuses).mockResolvedValue([]);
    await handler('calendar:connect')(makeEvent(), 'google');
  }

  const readUpcoming = async () => (await handler('calendar:get-upcoming')({}, 24)) as CalendarEvent[];

  it('persists the description and returns it on the cached event', async () => {
    await connectWith([upcoming('Agenda: pricing, then the roadmap.')]);

    const [event] = await readUpcoming();
    expect(event.id).toBe('google:evt-desc');
    expect(event.attendees).toEqual([{ name: 'Ada', email: 'ada@example.com' }]);
    expect(event.description).toBe('Agenda: pricing, then the roadmap.');
  });

  it('maps a stored NULL description to undefined, and the upsert overwrites it', async () => {
    await connectWith([upcoming()]);
    expect((await readUpcoming())[0].description).toBeUndefined();

    // Re-poll with the same id: cacheEvents is upsert-only, so this exercises the
    // onConflictDoUpdate `set` — the newly published description must land.
    await connectWith([upcoming('Now it has an agenda.')]);
    const rows = await readUpcoming();
    expect(rows).toHaveLength(1);
    expect(rows[0].description).toBe('Now it has an agenda.');
  });
});

// === calendar:get-event-context (CAL-UX.2) =========================================

const EMPTY_CONTEXT = { recordedSession: null, lastSeriesSession: null, attendeeMatches: [] };

describe('calendar:get-event-context', () => {
  it('delegates to the context service and returns its result verbatim', async () => {
    const context = {
      recordedSession: { meetingId: 'm-1', title: 'Weekly sync' },
      lastSeriesSession: null,
      attendeeMatches: [{ entityId: 'e-1', name: 'Anna Kowalski', factCount: 2 }],
    };
    vi.mocked(getEventContext).mockResolvedValue(context);

    const result = await handler('calendar:get-event-context')({}, { eventId: 'google:evt-1' });

    expect(getEventContext).toHaveBeenCalledWith('google:evt-1');
    expect(result).toEqual(context);
  });

  it('rejects a missing, empty or oversized eventId before touching the service', async () => {
    vi.mocked(getEventContext).mockResolvedValue(EMPTY_CONTEXT);

    await expect(handler('calendar:get-event-context')({}, {})).rejects.toThrow(/Validation failed/);
    await expect(handler('calendar:get-event-context')({}, { eventId: '' })).rejects.toThrow(/Validation failed/);
    await expect(handler('calendar:get-event-context')({}, { eventId: 'x'.repeat(513) })).rejects.toThrow(
      /Validation failed/,
    );
    await expect(handler('calendar:get-event-context')({}, 'google:evt-1')).rejects.toThrow(/Validation failed/);
    expect(getEventContext).not.toHaveBeenCalled();
  });
});

// === calendar:generate-prep-note (CAL-UX.2) ========================================

describe('calendar:generate-prep-note', () => {
  it('delegates to the context service and wraps the note in { note }', async () => {
    vi.mocked(generatePrepNote).mockResolvedValue('Follow up on the deck.');

    const result = await handler('calendar:generate-prep-note')({}, { eventId: 'google:evt-1' });

    expect(generatePrepNote).toHaveBeenCalledWith('google:evt-1');
    expect(result).toEqual({ note: 'Follow up on the deck.' });
  });

  it('propagates the service rejection (e.g. no model configured) unchanged', async () => {
    vi.mocked(generatePrepNote).mockRejectedValue(new Error('No AI provider configured for prep notes.'));

    await expect(handler('calendar:generate-prep-note')({}, { eventId: 'google:evt-1' })).rejects.toThrow(
      /No AI provider configured/,
    );
  });

  it('rejects a missing or oversized eventId before touching the service', async () => {
    await expect(handler('calendar:generate-prep-note')({}, {})).rejects.toThrow(/Validation failed/);
    await expect(handler('calendar:generate-prep-note')({}, { eventId: 'x'.repeat(513) })).rejects.toThrow(
      /Validation failed/,
    );
    expect(generatePrepNote).not.toHaveBeenCalled();
  });
});
