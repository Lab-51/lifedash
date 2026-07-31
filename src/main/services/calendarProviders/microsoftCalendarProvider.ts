// === FILE PURPOSE ===
// Microsoft Graph calendar provider adapter (Phase G, Task 3). A THIN adapter that
// implements the frozen `CalendarProviderAdapter` by DELEGATING all OAuth to the
// provider-agnostic, live-preflight-proven engine in `calendarAuthService`. It owns
// only the Microsoft-specific endpoints/scope and the Graph `calendarView` fetch +
// metadata-only normalization.
//
// === PRIVACY (STRUCTURAL) ===
// Metadata only. The `$select` deliberately NEVER requests body/bodyPreview/location,
// and `CalendarEvent` has no field to hold them. A body can never be read or persisted.
//
// === SECURITY ===
// Microsoft is a PUBLIC client: PKCE only, NEVER a client_secret. We build the
// AuthorizationRequest WITHOUT `clientSecret` and with `sendClientSecret: false`, so
// the engine omits the secret on every token leg.

import {
  runAuthorizationCodeFlow,
  refreshAccessToken,
  loadCalendarClientConfig,
  registerCalendarAdapter,
  type AuthorizationRequest,
  type OAuthProviderEndpoints,
} from '../calendarAuthService';
import type {
  CalendarClientConfig,
  CalendarEvent,
  CalendarProviderAdapter,
  CalendarTokens,
} from '../../../shared/types/calendar';

// === Microsoft endpoints ===========================================================

/**
 * Scope requested for Microsoft. `offline_access` is REQUIRED to receive a refresh
 * token; `openid email` yield the id_token we decode for the display account email.
 *
 * FALLBACK: `Calendars.ReadBasic` is the least-privilege read scope. Docs only
 * enumerate what it EXCLUDES (event body/attachments) — they do NOT confirm whether
 * attendees are returned. If a live smoke shows attendees missing under ReadBasic,
 * the sanctioned one-line fix is to switch this constant to `Calendars.Read` (which
 * still excludes nothing we select — we never request body/bodyPreview/location).
 */
const MICROSOFT_SCOPE = 'openid email offline_access Calendars.ReadBasic';

const MICROSOFT_ENDPOINTS: OAuthProviderEndpoints = {
  authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  scope: MICROSOFT_SCOPE,
  // Public client — PKCE only. The engine omits client_secret when this is false.
  sendClientSecret: false,
};

const GRAPH_CALENDAR_VIEW_URL = 'https://graph.microsoft.com/v1.0/me/calendarView';

/**
 * Fields requested from Graph. MUST NOT contain body / bodyPreview / location
 * (structural privacy — a test asserts this). `type` + `seriesMasterId` +
 * `isCancelled` + `isAllDay` are needed only to FILTER, not to surface.
 */
const GRAPH_SELECT = 'subject,start,end,attendees,seriesMasterId,isCancelled,isAllDay,type';

/** Refresh when within this margin of expiry (or already past it). */
const REFRESH_MARGIN_MS = 60_000;

// === Raw Graph shapes (only the fields we select) ==================================

interface GraphDateTime {
  dateTime?: string;
  timeZone?: string;
}

interface GraphAttendee {
  emailAddress?: { name?: string; address?: string };
}

interface GraphEvent {
  id?: string;
  subject?: string;
  start?: GraphDateTime;
  end?: GraphDateTime;
  attendees?: GraphAttendee[];
  seriesMasterId?: string;
  isCancelled?: boolean;
  isAllDay?: boolean;
  type?: string;
}

interface GraphCalendarViewResponse {
  value?: GraphEvent[];
}

// === Helpers =======================================================================

/** Build the Microsoft AuthorizationRequest — clientId only, NEVER a clientSecret. */
function buildRequest(clientId: string): AuthorizationRequest {
  return { provider: 'microsoft', endpoints: MICROSOFT_ENDPOINTS, clientId };
  // NOTE: `clientSecret` intentionally omitted (public client, PKCE only).
}

/**
 * Coerce a Graph dateTime into a proper UTC ISO string. With `Prefer: outlook.timezone="UTC"`
 * Graph returns wall-clock UTC WITHOUT a zone suffix (e.g. "2024-01-15T10:00:00.0000000"),
 * so we append `Z` when no zone is present, then normalize through Date.
 */
function toUtcIso(dateTime: string | undefined): string {
  if (!dateTime) return '';
  const hasZone = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(dateTime);
  const withZone = hasZone ? dateTime : `${dateTime}Z`;
  const d = new Date(withZone);
  return Number.isNaN(d.getTime()) ? dateTime : d.toISOString();
}

/** Map a raw Graph occurrence to a metadata-only CalendarEvent (id/eventId prefixed). */
function normalizeEvent(ev: GraphEvent): CalendarEvent | null {
  const eventId = ev.id;
  if (!eventId) return null;
  const event: CalendarEvent = {
    id: `microsoft:${eventId}`,
    provider: 'microsoft',
    eventId,
    title: ev.subject || '(untitled)',
    startsAt: toUtcIso(ev.start?.dateTime),
    endsAt: toUtcIso(ev.end?.dateTime),
    attendees: (ev.attendees ?? []).map((a) => ({
      name: a.emailAddress?.name,
      email: a.emailAddress?.address,
    })),
  };
  if (ev.seriesMasterId) event.seriesId = `microsoft:${ev.seriesMasterId}`;
  return event;
}

/** Drop cancelled, all-day, and series-master rows — only real occurrences are meetings. */
function isMeetingOccurrence(ev: GraphEvent): boolean {
  return ev.isCancelled !== true && ev.isAllDay !== true && ev.type !== 'seriesMaster';
}

/** Build the Graph calendarView request URL for the [now, now+windowHours] window. */
function buildCalendarViewUrl(windowHours: number): string {
  const now = Date.now();
  const url = new URL(GRAPH_CALENDAR_VIEW_URL);
  url.searchParams.set('startDateTime', new Date(now).toISOString());
  url.searchParams.set('endDateTime', new Date(now + windowHours * 60 * 60 * 1000).toISOString());
  url.searchParams.set('$select', GRAPH_SELECT);
  url.searchParams.set('$top', '50');
  url.searchParams.set('$orderby', 'start/dateTime');
  return url.toString();
}

/** One authenticated GET against calendarView. */
function requestCalendarView(accessToken: string, windowHours: number): Promise<Response> {
  return fetch(buildCalendarViewUrl(windowHours), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      Prefer: 'outlook.timezone="UTC"',
    },
  });
}

// === Adapter =======================================================================

export const microsoftCalendarAdapter: CalendarProviderAdapter = {
  async authorize(config: CalendarClientConfig): Promise<{ tokens: CalendarTokens; accountEmail?: string }> {
    const result = await runAuthorizationCodeFlow(buildRequest(config.clientId));
    return { tokens: result.tokens, accountEmail: result.accountEmail };
  },

  async refreshIfNeeded(tokens: CalendarTokens): Promise<CalendarTokens> {
    if (Date.now() < tokens.expiresAt - REFRESH_MARGIN_MS) return tokens;
    const config = await loadCalendarClientConfig('microsoft');
    // No client config → nothing to refresh with; carry current tokens forward.
    if (!config) return tokens;
    // CalendarReauthRequiredError (invalid_grant) propagates to the caller by design.
    return refreshAccessToken(buildRequest(config.clientId), tokens.refreshToken);
  },

  async fetchUpcoming(
    tokens: CalendarTokens,
    config: CalendarClientConfig,
    windowHours: number,
  ): Promise<CalendarEvent[]> {
    // NOTE: this may THROW — the poll orchestrator (Task 4) catches and classifies:
    // CalendarReauthRequiredError (dead refresh token → invalid_grant) flips needsReauth;
    // ANY OTHER error is recorded as lastError WITHOUT flipping needsReauth. A 401/403 with
    // a valid token is a permission problem (e.g. the Calendars.ReadBasic Graph permission
    // not granted on the app registration) — NOT an expired authorization — so we surface
    // it plainly instead of forcing a pointless reconnect.
    let res = await requestCalendarView(tokens.accessToken, windowHours);

    if (res.status === 401) {
      // Access token likely expired — refresh once (invalid_grant propagates as
      // CalendarReauthRequiredError) and retry.
      const refreshed = await refreshAccessToken(buildRequest(config.clientId), tokens.refreshToken);
      res = await requestCalendarView(refreshed.accessToken, windowHours);
    }

    if (!res.ok) {
      throw new Error(`Microsoft Calendar fetch failed (HTTP ${res.status}): ${await readErrorDetail(res)}`);
    }

    const json = (await res.json()) as GraphCalendarViewResponse;
    const rows = json.value ?? [];
    const events: CalendarEvent[] = [];
    for (const ev of rows) {
      if (!isMeetingOccurrence(ev)) continue;
      const normalized = normalizeEvent(ev);
      if (normalized) events.push(normalized);
    }
    return events;
  },
};

/** Extract a concise human-readable detail from a failed Graph response. Graph 401s
 *  usually carry an EMPTY body and put the real reason in WWW-Authenticate, so include it. */
async function readErrorDetail(res: Response): Promise<string> {
  const wwwAuth = res.headers?.get('www-authenticate');
  const body = await readResponseBody(res);
  return wwwAuth ? `${body || '(empty body)'} [WWW-Authenticate: ${wwwAuth.slice(0, 300)}]` : body;
}

async function readResponseBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      return (parsed.error?.message ?? text).slice(0, 250);
    } catch {
      return text.slice(0, 250);
    }
  } catch {
    return res.statusText;
  }
}

/**
 * Registration seam. Task 4 calls this at boot from main.ts (NOT wired here).
 */
export function registerMicrosoftCalendarAdapter(): void {
  registerCalendarAdapter('microsoft', microsoftCalendarAdapter);
}
