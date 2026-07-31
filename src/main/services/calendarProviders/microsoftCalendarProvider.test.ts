// Unit tests for the Microsoft Graph calendar adapter (Phase G, Task 3). All OAuth
// is delegated to (and here mocked from) calendarAuthService; all network is mocked.
// MS-specific guarantees asserted: (a) NO client_secret on any token/authorize request
// (public client, PKCE only); (b) the Graph `$select` NEVER requests bodyPreview or
// location, requests `body` ONLY under a Calendars.Read grant (CAL-UX.2b), and falls
// back to the byte-identical legacy `$select` for a ReadBasic-only token.
// Plus normalization + `microsoft:` prefixing, isCancelled/isAllDay/seriesMaster
// filtering, window params on the URL, refresh-then-retry on 401, needsReauth on
// refresh failure, and never-throw-out-of-fetch.

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { CalendarClientConfig, CalendarTokens } from '../../../shared/types/calendar';

// --- Mocks (declared before importing the module under test) -----------------------
const mocks = vi.hoisted(() => {
  class MockReauthError extends Error {
    constructor(message = 'Calendar authorization expired') {
      super(message);
      this.name = 'CalendarReauthRequiredError';
    }
  }
  return {
    runAuthorizationCodeFlow: vi.fn(),
    refreshAccessToken: vi.fn(),
    loadCalendarClientConfig: vi.fn(),
    markCalendarNeedsReauth: vi.fn().mockResolvedValue(undefined),
    registerCalendarAdapter: vi.fn(),
    CalendarReauthRequiredError: MockReauthError,
  };
});
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
  vi.useRealTimers();
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
    // CAL-UX.2b: descriptions require Calendars.Read — ReadBasic excludes event bodies.
    expect(req.endpoints.scope).toBe('openid email offline_access Calendars.Read');
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
  it('builds the calendarView URL with window params, $top/$orderby, and (legacy grant) a body-free $select', async () => {
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
    expect(url.searchParams.get('$top')).toBe('250');
    expect(url.searchParams.get('$orderby')).toBe('start/dateTime');

    // MS-specific (b): with no recorded scope the grant is treated as ReadBasic-only,
    // so the select stays body-free — and never asks for bodyPreview or location.
    const select = url.searchParams.get('$select') ?? '';
    expect(select).toBe('subject,start,end,attendees,seriesMasterId,isCancelled,isAllDay,type');
    expect(select).not.toContain('body');
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

// === CAL-UX.2b: scope-gated body request + description mapping ======================

describe('microsoftCalendarAdapter.fetchUpcoming — description (CAL-UX.2b)', () => {
  const READ_SCOPE = 'openid email offline_access Calendars.Read';
  const READBASIC_SCOPE = 'openid email offline_access Calendars.ReadBasic';
  /** The pre-CAL-UX.2b URL, byte for byte — a legacy grant must still produce EXACTLY this. */
  const LEGACY_URL =
    'https://graph.microsoft.com/v1.0/me/calendarView' +
    '?startDateTime=2026-07-31T10%3A00%3A00.000Z' +
    '&endDateTime=2026-08-01T10%3A00%3A00.000Z' +
    '&%24select=subject%2Cstart%2Cend%2Cattendees%2CseriesMasterId%2CisCancelled%2CisAllDay%2Ctype' +
    '&%24top=250' +
    '&%24orderby=start%2FdateTime';
  /** Same URL with `body` appended to $select — the only difference under Calendars.Read. */
  const READ_SCOPE_URL = LEGACY_URL.replace('%2Ctype&', '%2Ctype%2Cbody&');

  function stubGraph(value: unknown[]) {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
    fetchMock.mockResolvedValue(jsonResponse(200, { value }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  function graphEventWithBody(body?: { contentType?: string; content?: string }) {
    return {
      id: 'evt-d',
      subject: 'Sync',
      start: { dateTime: '2026-08-01T10:00:00.0000000' },
      end: { dateTime: '2026-08-01T10:30:00.0000000' },
      type: 'singleInstance',
      ...(body === undefined ? {} : { body }),
    };
  }

  it('requests body in $select and plain-texts an HTML body when the grant carries Calendars.Read', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T10:00:00.000Z'));
    const fetchMock = stubGraph([
      graphEventWithBody({
        contentType: 'html',
        content: '<html><body><p>Agenda &amp; goals</p><br/><br/><br/><br/>Line&nbsp;two <b>bold</b></body></html>',
      }),
    ]);

    const events = await microsoftCalendarAdapter.fetchUpcoming(tokens({ scope: READ_SCOPE }), MS_CONFIG, 24);

    expect(fetchMock.mock.calls[0][0]).toBe(READ_SCOPE_URL);
    expect(fetchMock.mock.calls[0][0]).toContain('%2Cbody');
    expect(events[0].description).toBe('Agenda & goals\n\nLine two bold');
  });

  it('keeps a text body verbatim and caps any body at 4000 chars', async () => {
    stubGraph([graphEventWithBody({ contentType: 'text', content: '  Bring the <deck>.  ' })]);
    const [textEvent] = await microsoftCalendarAdapter.fetchUpcoming(tokens({ scope: READ_SCOPE }), MS_CONFIG, 24);
    expect(textEvent.description).toBe('Bring the <deck>.');

    stubGraph([graphEventWithBody({ contentType: 'text', content: 'x'.repeat(5000) })]);
    const [longEvent] = await microsoftCalendarAdapter.fetchUpcoming(tokens({ scope: READ_SCOPE }), MS_CONFIG, 24);
    expect(longEvent.description).toHaveLength(4000);
  });

  it('is undefined for an empty body even under Calendars.Read', async () => {
    stubGraph([graphEventWithBody({ contentType: 'html', content: '<html><body>\n</body></html>' })]);
    const [e] = await microsoftCalendarAdapter.fetchUpcoming(tokens({ scope: READ_SCOPE }), MS_CONFIG, 24);
    expect(e.description).toBeUndefined();
  });

  it('DEGRADES for a legacy ReadBasic-only token: byte-identical old URL, no description', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T10:00:00.000Z'));
    // Graph would never return a body for such a token; if it somehow did, we never asked.
    const fetchMock = stubGraph([graphEventWithBody()]);

    const events = await microsoftCalendarAdapter.fetchUpcoming(tokens({ scope: READBASIC_SCOPE }), MS_CONFIG, 24);

    expect(fetchMock.mock.calls[0][0]).toBe(LEGACY_URL);
    expect(fetchMock.mock.calls[0][0]).not.toContain('body');
    expect(events[0].description).toBeUndefined();
  });

  it('treats an unrecorded (undefined) scope as lacking Calendars.Read', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T10:00:00.000Z'));
    const fetchMock = stubGraph([graphEventWithBody()]);

    await microsoftCalendarAdapter.fetchUpcoming(tokens(), MS_CONFIG, 24);

    expect(fetchMock.mock.calls[0][0]).toBe(LEGACY_URL);
  });

  it('never mistakes Calendars.ReadWrite for the read grant (word-boundary match)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T10:00:00.000Z'));
    const fetchMock = stubGraph([graphEventWithBody()]);

    await microsoftCalendarAdapter.fetchUpcoming(
      tokens({ scope: 'openid email offline_access Calendars.ReadWrite' }),
      MS_CONFIG,
      24,
    );

    expect(fetchMock.mock.calls[0][0]).toBe(LEGACY_URL);
  });
});

describe('microsoftCalendarAdapter.fetchUpcoming — calendar selection (CAL-UX.1)', () => {
  function stubFetch(...responses: Response[]) {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
    for (const res of responses) fetchMock.mockResolvedValueOnce(res);
    if (responses.length === 0) fetchMock.mockResolvedValue(jsonResponse(200, { value: [] }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  function graphEvent(id: string, startsAt: string) {
    return {
      id,
      subject: id,
      start: { dateTime: startsAt },
      end: { dateTime: startsAt },
      type: 'singleInstance',
    };
  }

  it('with NO selection hits the account-default /me/calendarView with the exact legacy URL', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T10:00:00.000Z'));
    const fetchMock = stubFetch();

    await microsoftCalendarAdapter.fetchUpcoming(tokens(), MS_CONFIG, 24);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://graph.microsoft.com/v1.0/me/calendarView' +
        '?startDateTime=2026-07-31T10%3A00%3A00.000Z' +
        '&endDateTime=2026-08-01T10%3A00%3A00.000Z' +
        '&%24select=subject%2Cstart%2Cend%2Cattendees%2CseriesMasterId%2CisCancelled%2CisAllDay%2Ctype' +
        '&%24top=250' +
        '&%24orderby=start%2FdateTime',
    );
  });

  it('treats an EMPTY selection exactly like no selection', async () => {
    const fetchMock = stubFetch();

    await microsoftCalendarAdapter.fetchUpcoming(tokens(), MS_CONFIG, 24, []);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe('https://graph.microsoft.com/v1.0/me/calendarView');
  });

  it('requests one per-calendar calendarView per selected id, url-encoding the id', async () => {
    const fetchMock = stubFetch(jsonResponse(200, { value: [] }), jsonResponse(200, { value: [] }));

    await microsoftCalendarAdapter.fetchUpcoming(tokens(), MS_CONFIG, 24, ['AAA=', 'B/B']);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const paths = fetchMock.mock.calls.map((c) => {
      const u = new URL(c[0] as string);
      return u.origin + u.pathname;
    });
    expect(paths).toEqual([
      'https://graph.microsoft.com/v1.0/me/calendars/AAA%3D/calendarView',
      'https://graph.microsoft.com/v1.0/me/calendars/B%2FB/calendarView',
    ]);
    for (const call of fetchMock.mock.calls) {
      const u = new URL(call[0] as string);
      expect(u.searchParams.get('$top')).toBe('250');
      expect(u.searchParams.get('$select')).toBe(
        'subject,start,end,attendees,seriesMasterId,isCancelled,isAllDay,type',
      );
    }
  });

  it('merges calendars, dedupes a shared event id, and sorts by start time', async () => {
    stubFetch(
      jsonResponse(200, { value: [graphEvent('shared', '2026-08-01T12:00:00.0000000')] }),
      jsonResponse(200, {
        value: [
          graphEvent('shared', '2026-08-01T12:00:00.0000000'),
          graphEvent('earlier', '2026-08-01T08:00:00.0000000'),
        ],
      }),
    );

    const events = await microsoftCalendarAdapter.fetchUpcoming(tokens(), MS_CONFIG, 24, ['a', 'b']);

    expect(events.map((e) => e.eventId)).toEqual(['earlier', 'shared']);
  });

  it('skips a calendar that fails (404) without sinking the batch', async () => {
    stubFetch(
      jsonResponse(404, { error: { message: 'Not Found' } }),
      jsonResponse(200, { value: [graphEvent('kept', '2026-08-01T09:00:00.0000000')] }),
    );

    const events = await microsoftCalendarAdapter.fetchUpcoming(tokens(), MS_CONFIG, 24, ['deleted-cal', 'good-cal']);

    expect(events.map((e) => e.eventId)).toEqual(['kept']);
  });

  it('still throws when EVERY selected calendar fails (the poller must record lastError)', async () => {
    stubFetch(
      jsonResponse(404, { error: { message: 'Not Found' } }),
      jsonResponse(404, { error: { message: 'Not Found' } }),
    );

    await expect(microsoftCalendarAdapter.fetchUpcoming(tokens(), MS_CONFIG, 24, ['a', 'b'])).rejects.toThrow(
      /HTTP 404/,
    );
  });
});

describe('microsoftCalendarAdapter.listCalendars', () => {
  it('requests /me/calendars with a minimal $select and maps isDefaultCalendar → isPrimary', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        value: [
          { id: 'cal-1', name: 'Calendar', isDefaultCalendar: true },
          { id: 'cal-2', name: 'Team' },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const calendars = await microsoftCalendarAdapter.listCalendars(tokens(), MS_CONFIG);

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe('https://graph.microsoft.com/v1.0/me/calendars');
    expect(url.searchParams.get('$select')).toBe('id,name,isDefaultCalendar');
    expect(url.searchParams.get('$top')).toBe('50');
    expect(calendars).toEqual([
      { id: 'cal-1', name: 'Calendar', isPrimary: true },
      { id: 'cal-2', name: 'Team', isPrimary: false },
    ]);
  });

  it('refreshes once and retries on 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(jsonResponse(200, { value: [{ id: 'after', name: 'After refresh' }] }));
    vi.stubGlobal('fetch', fetchMock);
    mocks.refreshAccessToken.mockResolvedValue(tokens({ accessToken: 'fresh-access' }));

    const calendars = await microsoftCalendarAdapter.listCalendars(tokens(), MS_CONFIG);

    expect(calendars.map((c) => c.id)).toEqual(['after']);
    const retryHeaders = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(retryHeaders.Authorization).toBe('Bearer fresh-access');
  });

  it('throws with the HTTP status when the list request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(403, { error: { message: 'no permission' } })),
    );
    await expect(microsoftCalendarAdapter.listCalendars(tokens(), MS_CONFIG)).rejects.toThrow(/HTTP 403/);
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

  it('propagates the refresh failure so the poll orchestrator can flip needsReauth', async () => {
    // The adapter no longer classifies errors — it lets the refresh failure propagate and
    // must NOT flip needsReauth itself.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(401, { error: { code: 'InvalidAuthenticationToken' } })),
    );
    mocks.refreshAccessToken.mockRejectedValue(new Error('Calendar authorization expired'));

    await expect(microsoftCalendarAdapter.fetchUpcoming(tokens(), MS_CONFIG, 24)).rejects.toThrow(
      /authorization expired/i,
    );
    expect(mocks.markCalendarNeedsReauth).not.toHaveBeenCalled();
  });

  it('throws a non-reauth error when the retry after refresh still fails', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(401, {})).mockResolvedValueOnce(jsonResponse(401, {}));
    vi.stubGlobal('fetch', fetchMock);
    mocks.refreshAccessToken.mockResolvedValue(tokens({ accessToken: 'fresh' }));

    // A 401 after a SUCCESSFUL refresh is a permission/config problem, not expired auth.
    await expect(microsoftCalendarAdapter.fetchUpcoming(tokens(), MS_CONFIG, 24)).rejects.toThrow(/HTTP 401/);
    expect(mocks.markCalendarNeedsReauth).not.toHaveBeenCalled();
  });
});

describe('microsoftCalendarAdapter.fetchUpcoming — error propagation', () => {
  it('throws a non-reauth error (with the HTTP status) on a non-401 HTTP error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(500, { error: 'boom' })),
    );
    await expect(microsoftCalendarAdapter.fetchUpcoming(tokens(), MS_CONFIG, 24)).rejects.toThrow(/HTTP 500/);
    expect(mocks.markCalendarNeedsReauth).not.toHaveBeenCalled();
  });

  it('propagates a network error to the caller (the poll orchestrator handles it)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    await expect(microsoftCalendarAdapter.fetchUpcoming(tokens(), MS_CONFIG, 24)).rejects.toThrow('network down');
  });
});

describe('registerMicrosoftCalendarAdapter', () => {
  it('registers the adapter instance under the microsoft provider key', () => {
    registerMicrosoftCalendarAdapter();
    expect(mocks.registerCalendarAdapter).toHaveBeenCalledWith('microsoft', microsoftCalendarAdapter);
  });
});
