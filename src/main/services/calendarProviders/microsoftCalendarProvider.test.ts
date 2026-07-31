// Unit tests for the Microsoft Graph calendar adapter (Phase G, Task 3). All OAuth
// is delegated to (and here mocked from) calendarAuthService; all network is mocked.
// MS-specific guarantees asserted: (a) NO client_secret on any token/authorize request
// (public client, PKCE only); (b) the Graph `$select` NEVER requests body/bodyPreview.
// Plus normalization + `microsoft:` prefixing, isCancelled/isAllDay/seriesMaster
// filtering, window params on the URL, refresh-then-retry on 401, needsReauth on
// refresh failure, and never-throw-out-of-fetch.

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { CalendarClientConfig, CalendarTokens } from '../../../shared/types/calendar';

// --- Mocks (declared before importing the module under test) -----------------------
const mocks = vi.hoisted(() => ({
  runAuthorizationCodeFlow: vi.fn(),
  refreshAccessToken: vi.fn(),
  loadCalendarClientConfig: vi.fn(),
  markCalendarNeedsReauth: vi.fn().mockResolvedValue(undefined),
  registerCalendarAdapter: vi.fn(),
}));
vi.mock('../calendarAuthService', () => mocks);
vi.mock('../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { microsoftCalendarAdapter, registerMicrosoftCalendarAdapter } from './microsoftCalendarProvider';

const MS_CONFIG: CalendarClientConfig = { provider: 'microsoft', clientId: 'ms-client-id' };

function tokens(overrides: Partial<CalendarTokens> = {}): CalendarTokens {
  return {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: Date.now() + 60 * 60 * 1000,
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `status-${status}`,
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('microsoftCalendarAdapter.authorize', () => {
  it('delegates to runAuthorizationCodeFlow and returns tokens + accountEmail', async () => {
    const flowTokens = tokens({ accessToken: 'AT', refreshToken: 'RT' });
    mocks.runAuthorizationCodeFlow.mockResolvedValue({ tokens: flowTokens, accountEmail: 'user@ex.com' });

    const result = await microsoftCalendarAdapter.authorize(MS_CONFIG);

    expect(result.tokens).toBe(flowTokens);
    expect(result.accountEmail).toBe('user@ex.com');
    expect(mocks.runAuthorizationCodeFlow).toHaveBeenCalledTimes(1);
  });

  it('builds a Microsoft request with the correct endpoints/scope and NO client_secret', async () => {
    mocks.runAuthorizationCodeFlow.mockResolvedValue({ tokens: tokens(), accountEmail: undefined });
    await microsoftCalendarAdapter.authorize(MS_CONFIG);

    const req = mocks.runAuthorizationCodeFlow.mock.calls[0][0];
    expect(req.provider).toBe('microsoft');
    expect(req.clientId).toBe('ms-client-id');
    // MS-specific (a): no secret anywhere, ever.
    expect(req).not.toHaveProperty('clientSecret');
    expect(req.endpoints.sendClientSecret).toBe(false);
    expect(req.endpoints.scope).toBe('openid email offline_access Calendars.ReadBasic');
    expect(req.endpoints.scope).toContain('offline_access');
    expect(req.endpoints.authorizeUrl).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    expect(req.endpoints.tokenUrl).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token');
  });
});

describe('microsoftCalendarAdapter.refreshIfNeeded', () => {
  it('returns the same tokens unchanged when not near expiry', async () => {
    const t = tokens({ expiresAt: Date.now() + 10 * 60 * 1000 });
    const result = await microsoftCalendarAdapter.refreshIfNeeded(t);
    expect(result).toBe(t);
    expect(mocks.refreshAccessToken).not.toHaveBeenCalled();
    expect(mocks.loadCalendarClientConfig).not.toHaveBeenCalled();
  });

  it('refreshes when within the ~60s expiry margin, sending NO client_secret', async () => {
    const rotated = tokens({ accessToken: 'AT2', refreshToken: 'RT2' });
    mocks.loadCalendarClientConfig.mockResolvedValue(MS_CONFIG);
    mocks.refreshAccessToken.mockResolvedValue(rotated);

    const result = await microsoftCalendarAdapter.refreshIfNeeded(tokens({ expiresAt: Date.now() + 10_000 }));

    expect(result).toBe(rotated);
    expect(mocks.refreshAccessToken).toHaveBeenCalledTimes(1);
    const [req, refreshToken] = mocks.refreshAccessToken.mock.calls[0];
    expect(refreshToken).toBe('refresh-1');
    // MS-specific (a): refresh request also carries no secret.
    expect(req).not.toHaveProperty('clientSecret');
    expect(req.endpoints.sendClientSecret).toBe(false);
    expect(req.clientId).toBe('ms-client-id');
  });

  it('returns tokens unchanged when no client config is available', async () => {
    mocks.loadCalendarClientConfig.mockResolvedValue(null);
    const t = tokens({ expiresAt: Date.now() + 10_000 });
    const result = await microsoftCalendarAdapter.refreshIfNeeded(t);
    expect(result).toBe(t);
    expect(mocks.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('lets a refresh error (invalid_grant → CalendarReauthRequiredError) propagate', async () => {
    mocks.loadCalendarClientConfig.mockResolvedValue(MS_CONFIG);
    mocks.refreshAccessToken.mockRejectedValue(new Error('Calendar authorization expired'));
    await expect(microsoftCalendarAdapter.refreshIfNeeded(tokens({ expiresAt: Date.now() + 10_000 }))).rejects.toThrow(
      /authorization expired/i,
    );
  });
});

describe('microsoftCalendarAdapter.fetchUpcoming — request shape', () => {
  it('builds the calendarView URL with window params, $top/$orderby, and a body-free $select', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit = {};
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return jsonResponse(200, { value: [] });
    });
    vi.stubGlobal('fetch', fetchMock);

    await microsoftCalendarAdapter.fetchUpcoming(tokens({ accessToken: 'the-access' }), MS_CONFIG, 24);

    const url = new URL(capturedUrl);
    expect(url.origin + url.pathname).toBe('https://graph.microsoft.com/v1.0/me/calendarView');
    expect(url.searchParams.get('$top')).toBe('50');
    expect(url.searchParams.get('$orderby')).toBe('start/dateTime');

    // MS-specific (b): $select MUST NOT contain body / bodyPreview / location.
    const select = url.searchParams.get('$select') ?? '';
    expect(select).toBe('subject,start,end,attendees,seriesMasterId,isCancelled,isAllDay,type');
    expect(select).not.toContain('body');
    expect(select).not.toContain('bodyPreview');
    expect(select).not.toContain('location');

    // Window params: end - start === 24h.
    const start = new Date(url.searchParams.get('startDateTime') ?? '').getTime();
    const end = new Date(url.searchParams.get('endDateTime') ?? '').getTime();
    expect(end - start).toBe(24 * 60 * 60 * 1000);

    // Headers: Bearer token + UTC preference.
    const headers = capturedInit.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer the-access');
    expect(headers.Prefer).toBe('outlook.timezone="UTC"');
  });
});

describe('microsoftCalendarAdapter.fetchUpcoming — normalization & filtering', () => {
  it('normalizes occurrences with microsoft: prefixing and filters cancelled/all-day/seriesMaster', async () => {
    const graphBody = {
      value: [
        {
          id: 'evt-1',
          subject: 'Standup',
          start: { dateTime: '2026-08-01T10:00:00.0000000', timeZone: 'UTC' },
          end: { dateTime: '2026-08-01T10:30:00.0000000', timeZone: 'UTC' },
          attendees: [
            { emailAddress: { name: 'Alice', address: 'alice@ex.com' } },
            { emailAddress: { name: 'Bob', address: 'bob@ex.com' } },
          ],
          type: 'singleInstance',
        },
        {
          id: 'evt-2',
          subject: 'Weekly sync (occurrence)',
          seriesMasterId: 'series-9',
          start: { dateTime: '2026-08-01T12:00:00.0000000', timeZone: 'UTC' },
          end: { dateTime: '2026-08-01T13:00:00.0000000', timeZone: 'UTC' },
          type: 'occurrence',
        },
        {
          id: 'evt-untitled',
          start: { dateTime: '2026-08-01T14:00:00.0000000' },
          end: { dateTime: '2026-08-01T15:00:00.0000000' },
        },
        {
          id: 'evt-cancelled',
          subject: 'Cancelled',
          isCancelled: true,
          start: { dateTime: '2026-08-01T16:00:00.0000000' },
          end: { dateTime: '2026-08-01T16:30:00.0000000' },
        },
        {
          id: 'evt-allday',
          subject: 'Holiday',
          isAllDay: true,
          start: { dateTime: '2026-08-02T00:00:00.0000000' },
          end: { dateTime: '2026-08-03T00:00:00.0000000' },
        },
        {
          id: 'evt-master',
          subject: 'Series master',
          type: 'seriesMaster',
          start: { dateTime: '2026-08-01T18:00:00.0000000' },
          end: { dateTime: '2026-08-01T18:30:00.0000000' },
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, graphBody)),
    );

    const events = await microsoftCalendarAdapter.fetchUpcoming(tokens(), MS_CONFIG, 48);

    expect(events.map((e) => e.eventId)).toEqual(['evt-1', 'evt-2', 'evt-untitled']);

    const first = events[0];
    expect(first.id).toBe('microsoft:evt-1');
    expect(first.provider).toBe('microsoft');
    expect(first.title).toBe('Standup');
    expect(first.startsAt).toBe('2026-08-01T10:00:00.000Z');
    expect(first.endsAt).toBe('2026-08-01T10:30:00.000Z');
    expect(first.attendees).toEqual([
      { name: 'Alice', email: 'alice@ex.com' },
      { name: 'Bob', email: 'bob@ex.com' },
    ]);
    expect(first.seriesId).toBeUndefined();

    const second = events[1];
    expect(second.id).toBe('microsoft:evt-2');
    expect(second.seriesId).toBe('microsoft:series-9');
    expect(second.attendees).toEqual([]);

    // Missing subject → "(untitled)".
    expect(events[2].title).toBe('(untitled)');
  });
});

describe('microsoftCalendarAdapter.fetchUpcoming — 401 handling', () => {
  it('refreshes once and retries on 401, then returns events without flagging reauth', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'InvalidAuthenticationToken' } }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          value: [
            {
              id: 'e',
              subject: 'Retried',
              start: { dateTime: '2026-08-01T10:00:00.0000000' },
              end: { dateTime: '2026-08-01T11:00:00.0000000' },
              type: 'singleInstance',
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    mocks.refreshAccessToken.mockResolvedValue(tokens({ accessToken: 'fresh-access' }));

    const events = await microsoftCalendarAdapter.fetchUpcoming(tokens({ accessToken: 'stale' }), MS_CONFIG, 24);

    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('microsoft:e');
    expect(mocks.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(mocks.markCalendarNeedsReauth).not.toHaveBeenCalled();
    // Retry used the fresh access token.
    const retryHeaders = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(retryHeaders.Authorization).toBe('Bearer fresh-access');
  });

  it('flags needsReauth and returns [] when the refresh fails (invalid_grant)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(401, { error: { code: 'InvalidAuthenticationToken' } })),
    );
    mocks.refreshAccessToken.mockRejectedValue(new Error('Calendar authorization expired'));

    const events = await microsoftCalendarAdapter.fetchUpcoming(tokens(), MS_CONFIG, 24);

    expect(events).toEqual([]);
    expect(mocks.markCalendarNeedsReauth).toHaveBeenCalledTimes(1);
    expect(mocks.markCalendarNeedsReauth).toHaveBeenCalledWith(
      'microsoft',
      expect.stringMatching(/authorization expired/i),
    );
  });

  it('flags needsReauth and returns [] when the retry after refresh still fails', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(401, {})).mockResolvedValueOnce(jsonResponse(401, {}));
    vi.stubGlobal('fetch', fetchMock);
    mocks.refreshAccessToken.mockResolvedValue(tokens({ accessToken: 'fresh' }));

    const events = await microsoftCalendarAdapter.fetchUpcoming(tokens(), MS_CONFIG, 24);

    expect(events).toEqual([]);
    expect(mocks.markCalendarNeedsReauth).toHaveBeenCalledTimes(1);
  });
});

describe('microsoftCalendarAdapter.fetchUpcoming — never throws', () => {
  it('returns [] on a non-401 HTTP error without flagging reauth', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(500, { error: 'boom' })),
    );
    const events = await microsoftCalendarAdapter.fetchUpcoming(tokens(), MS_CONFIG, 24);
    expect(events).toEqual([]);
    expect(mocks.markCalendarNeedsReauth).not.toHaveBeenCalled();
  });

  it('returns [] when fetch rejects (network error)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const events = await microsoftCalendarAdapter.fetchUpcoming(tokens(), MS_CONFIG, 24);
    expect(events).toEqual([]);
  });
});

describe('registerMicrosoftCalendarAdapter', () => {
  it('registers the adapter instance under the microsoft provider key', () => {
    registerMicrosoftCalendarAdapter();
    expect(mocks.registerCalendarAdapter).toHaveBeenCalledWith('microsoft', microsoftCalendarAdapter);
  });
});
