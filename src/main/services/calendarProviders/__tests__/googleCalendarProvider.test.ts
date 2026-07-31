// Unit tests for the Google Calendar provider adapter (Phase G, Task 2). All OAuth is
// delegated to calendarAuthService (mocked here) and all network (global fetch) is
// mocked — no live calls. Covers: authorize delegation + endpoint/scope/extraAuthParams,
// events normalization (title/attendees/seriesId + `google:` prefixing), all-day +
// cancelled filtering, the request URL window params, refresh-then-retry on 401,
// needsReauth on invalid_grant, and structural absence of any body/description/location.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mocks (declared before importing the module under test) -----------------------
const h = vi.hoisted(() => {
  class MockReauthError extends Error {
    constructor(message = 'reauth required') {
      super(message);
      this.name = 'CalendarReauthRequiredError';
    }
  }
  return {
    MockReauthError,
    runAuthorizationCodeFlow: vi.fn(),
    refreshAccessToken: vi.fn(),
    loadCalendarClientConfig: vi.fn(),
    markCalendarNeedsReauth: vi.fn().mockResolvedValue(undefined),
    registerCalendarAdapter: vi.fn(),
  };
});
const MockReauthError = h.MockReauthError;

vi.mock('../../calendarAuthService', () => ({
  runAuthorizationCodeFlow: h.runAuthorizationCodeFlow,
  refreshAccessToken: h.refreshAccessToken,
  loadCalendarClientConfig: h.loadCalendarClientConfig,
  markCalendarNeedsReauth: h.markCalendarNeedsReauth,
  registerCalendarAdapter: h.registerCalendarAdapter,
  CalendarReauthRequiredError: h.MockReauthError,
}));
vi.mock('../../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { googleCalendarAdapter, registerGoogleCalendarAdapter } from '../googleCalendarProvider';
import type { CalendarClientConfig, CalendarTokens } from '../../../../shared/types/calendar';

const googleConfig: CalendarClientConfig = {
  provider: 'google',
  clientId: 'g-client',
  clientSecret: 'g-secret',
};

function tokens(overrides: Partial<CalendarTokens> = {}): CalendarTokens {
  return {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: Date.now() + 3_600_000,
    ...overrides,
  };
}

function jsonResponse(body: unknown, init: { status?: number; ok?: boolean } = {}): Response {
  const status = init.status ?? 200;
  return {
    ok: init.ok ?? status < 400,
    status,
    json: async () => body,
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// === authorize =====================================================================

describe('authorize', () => {
  it('delegates to runAuthorizationCodeFlow with Google endpoints, scope and offline params', async () => {
    h.runAuthorizationCodeFlow.mockResolvedValue({
      tokens: tokens(),
      accountEmail: 'user@example.com',
    });

    const result = await googleCalendarAdapter.authorize(googleConfig);

    expect(result.accountEmail).toBe('user@example.com');
    expect(h.runAuthorizationCodeFlow).toHaveBeenCalledTimes(1);
    const req = h.runAuthorizationCodeFlow.mock.calls[0][0];
    expect(req.provider).toBe('google');
    expect(req.clientId).toBe('g-client');
    expect(req.clientSecret).toBe('g-secret');
    expect(req.endpoints.authorizeUrl).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(req.endpoints.tokenUrl).toBe('https://oauth2.googleapis.com/token');
    expect(req.endpoints.scope).toBe('openid email https://www.googleapis.com/auth/calendar.events.readonly');
    expect(req.endpoints.sendClientSecret).toBe(true);
    expect(req.endpoints.extraAuthParams).toEqual({
      access_type: 'offline',
      prompt: 'consent',
    });
  });
});

// === refreshIfNeeded ===============================================================

describe('refreshIfNeeded', () => {
  it('returns tokens unchanged when not near expiry', async () => {
    const t = tokens({ expiresAt: Date.now() + 3_600_000 });
    const result = await googleCalendarAdapter.refreshIfNeeded(t);
    expect(result).toBe(t);
    expect(h.refreshAccessToken).not.toHaveBeenCalled();
    expect(h.loadCalendarClientConfig).not.toHaveBeenCalled();
  });

  it('refreshes when within the expiry skew window', async () => {
    h.loadCalendarClientConfig.mockResolvedValue(googleConfig);
    const refreshed = tokens({ accessToken: 'access-2' });
    h.refreshAccessToken.mockResolvedValue(refreshed);

    const result = await googleCalendarAdapter.refreshIfNeeded(tokens({ expiresAt: Date.now() + 1_000 }));

    expect(result).toBe(refreshed);
    expect(h.refreshAccessToken).toHaveBeenCalledWith(expect.objectContaining({ provider: 'google' }), 'refresh-1');
  });

  it('returns tokens unchanged when no client config is resolvable', async () => {
    h.loadCalendarClientConfig.mockResolvedValue(null);
    const t = tokens({ expiresAt: Date.now() - 1_000 });
    const result = await googleCalendarAdapter.refreshIfNeeded(t);
    expect(result).toBe(t);
    expect(h.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('lets CalendarReauthRequiredError propagate', async () => {
    h.loadCalendarClientConfig.mockResolvedValue(googleConfig);
    h.refreshAccessToken.mockRejectedValue(new MockReauthError());
    await expect(
      googleCalendarAdapter.refreshIfNeeded(tokens({ expiresAt: Date.now() - 1_000 })),
    ).rejects.toBeInstanceOf(MockReauthError);
  });
});

// === fetchUpcoming: URL + normalization ============================================

describe('fetchUpcoming — request URL', () => {
  it('builds the events URL with the correct window params', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [] }));

    await googleCalendarAdapter.fetchUpcoming(tokens(), googleConfig, 24);

    const [calledUrl, init] = fetchMock.mock.calls[0];
    const url = new URL(calledUrl as string);
    expect(url.origin + url.pathname).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    expect(url.searchParams.get('singleEvents')).toBe('true');
    expect(url.searchParams.get('orderBy')).toBe('startTime');
    expect(url.searchParams.get('maxResults')).toBe('50');

    const timeMin = new Date(url.searchParams.get('timeMin') as string).getTime();
    const timeMax = new Date(url.searchParams.get('timeMax') as string).getTime();
    expect(timeMax - timeMin).toBe(24 * 3_600_000);

    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer access-1' });
  });
});

describe('fetchUpcoming — normalization', () => {
  it('maps summary, id prefix, attendees and seriesId', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [
          {
            id: 'evt-1',
            status: 'confirmed',
            summary: 'Standup',
            start: { dateTime: '2026-08-01T09:00:00Z' },
            end: { dateTime: '2026-08-01T09:30:00Z' },
            recurringEventId: 'series-9',
            attendees: [{ displayName: 'Ada', email: 'ada@example.com' }, { email: 'noname@example.com' }],
            // These body fields must be ignored:
            description: 'SECRET NOTES',
            location: 'Room 5',
          },
        ],
      }),
    );

    const events = await googleCalendarAdapter.fetchUpcoming(tokens(), googleConfig, 12);

    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.id).toBe('google:evt-1');
    expect(e.eventId).toBe('evt-1');
    expect(e.provider).toBe('google');
    expect(e.title).toBe('Standup');
    expect(e.seriesId).toBe('google:series-9');
    expect(e.startsAt).toBe('2026-08-01T09:00:00.000Z');
    expect(e.endsAt).toBe('2026-08-01T09:30:00.000Z');
    expect(e.attendees).toEqual([{ name: 'Ada', email: 'ada@example.com' }, { email: 'noname@example.com' }]);
  });

  it('never carries body/description/location onto the normalized event', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [
          {
            id: 'evt-2',
            status: 'confirmed',
            summary: 'Private 1:1',
            start: { dateTime: '2026-08-01T10:00:00Z' },
            end: { dateTime: '2026-08-01T10:30:00Z' },
            description: 'do not leak',
            location: 'do not leak either',
          },
        ],
      }),
    );

    const [e] = await googleCalendarAdapter.fetchUpcoming(tokens(), googleConfig, 12);
    expect(e).not.toHaveProperty('description');
    expect(e).not.toHaveProperty('location');
    expect(e).not.toHaveProperty('body');
    expect(Object.keys(e).sort()).toEqual(
      ['attendees', 'endsAt', 'eventId', 'id', 'provider', 'startsAt', 'title'].sort(),
    );
  });

  it('falls back to "(untitled)" when summary is missing', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [
          {
            id: 'evt-3',
            status: 'confirmed',
            start: { dateTime: '2026-08-01T11:00:00Z' },
            end: { dateTime: '2026-08-01T11:30:00Z' },
          },
        ],
      }),
    );
    const [e] = await googleCalendarAdapter.fetchUpcoming(tokens(), googleConfig, 12);
    expect(e.title).toBe('(untitled)');
    expect(e.attendees).toEqual([]);
    expect(e.seriesId).toBeUndefined();
  });
});

describe('fetchUpcoming — filtering', () => {
  it('skips all-day (start.date) and cancelled events', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [
          { id: 'allday', status: 'confirmed', start: { date: '2026-08-01' }, end: { date: '2026-08-02' } },
          {
            id: 'cancelled',
            status: 'cancelled',
            start: { dateTime: '2026-08-01T09:00:00Z' },
            end: { dateTime: '2026-08-01T09:30:00Z' },
          },
          {
            id: 'keep',
            status: 'confirmed',
            summary: 'Real',
            start: { dateTime: '2026-08-01T12:00:00Z' },
            end: { dateTime: '2026-08-01T12:30:00Z' },
          },
        ],
      }),
    );

    const events = await googleCalendarAdapter.fetchUpcoming(tokens(), googleConfig, 12);
    expect(events.map((e) => e.eventId)).toEqual(['keep']);
  });
});

// === fetchUpcoming: 401 refresh-retry + needsReauth ================================

describe('fetchUpcoming — 401 handling', () => {
  it('refreshes then retries once on 401, and returns events from the retry', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, { status: 401 })).mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            id: 'evt-after',
            status: 'confirmed',
            summary: 'After refresh',
            start: { dateTime: '2026-08-01T13:00:00Z' },
            end: { dateTime: '2026-08-01T13:30:00Z' },
          },
        ],
      }),
    );
    h.refreshAccessToken.mockResolvedValue(tokens({ accessToken: 'access-refreshed' }));

    const events = await googleCalendarAdapter.fetchUpcoming(tokens(), googleConfig, 12);

    expect(h.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Retry used the refreshed access token.
    const secondInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(secondInit.headers).toMatchObject({ Authorization: 'Bearer access-refreshed' });
    expect(events.map((e) => e.eventId)).toEqual(['evt-after']);
    expect(h.markCalendarNeedsReauth).not.toHaveBeenCalled();
  });

  it('propagates the reauth error when the refresh fails with invalid_grant', async () => {
    // The adapter no longer classifies errors — it lets the reauth error propagate so the
    // poll orchestrator can flip needsReauth. It must NOT flip needsReauth itself.
    fetchMock.mockResolvedValueOnce(jsonResponse({}, { status: 401 }));
    h.refreshAccessToken.mockRejectedValue(new MockReauthError('invalid_grant'));

    await expect(googleCalendarAdapter.fetchUpcoming(tokens(), googleConfig, 12)).rejects.toBeInstanceOf(
      MockReauthError,
    );
    // Never a second fetch after a failed refresh.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(h.markCalendarNeedsReauth).not.toHaveBeenCalled();
  });

  it('throws a non-reauth error when the retry after refresh still returns non-ok', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({}, { status: 401 }));
    h.refreshAccessToken.mockResolvedValue(tokens({ accessToken: 'access-refreshed' }));

    await expect(googleCalendarAdapter.fetchUpcoming(tokens(), googleConfig, 12)).rejects.toThrow(/HTTP 401/);
    // A 401 after a SUCCESSFUL refresh is a permission/config problem, not expired auth.
    expect(h.markCalendarNeedsReauth).not.toHaveBeenCalled();
  });

  it('propagates a network error to the caller (the poll orchestrator handles it)', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    await expect(googleCalendarAdapter.fetchUpcoming(tokens(), googleConfig, 12)).rejects.toThrow('network down');
  });

  it('throws a non-reauth error (with the HTTP status) on a non-401 error status', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, { status: 500 }));
    await expect(googleCalendarAdapter.fetchUpcoming(tokens(), googleConfig, 12)).rejects.toThrow(/HTTP 500/);
    expect(h.markCalendarNeedsReauth).not.toHaveBeenCalled();
  });
});

// === registration seam =============================================================

describe('registerGoogleCalendarAdapter', () => {
  it('registers the adapter under the google provider key', () => {
    registerGoogleCalendarAdapter();
    expect(h.registerCalendarAdapter).toHaveBeenCalledWith('google', googleCalendarAdapter);
  });
});
