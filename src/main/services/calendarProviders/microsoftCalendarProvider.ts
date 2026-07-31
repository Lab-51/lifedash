// === FILE PURPOSE ===
// Microsoft Graph calendar provider adapter (Phase G, Task 3). A THIN adapter that
// implements the frozen `CalendarProviderAdapter` by DELEGATING all OAuth to the
// provider-agnostic, live-preflight-proven engine in `calendarAuthService`. It owns
// only the Microsoft-specific endpoints/scope and the Graph `calendarView` fetch +
// metadata-only normalization.
//
// === PRIVACY (STRUCTURAL) ===
// The `$select` requests `body` (CAL-UX.2b) — plain-texted + capped via
// eventDescription.ts, cached locally, never synced. It still NEVER requests
// `location` or attachments, and `CalendarEvent` has no field to hold them.
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
  CalendarReauthRequiredError,
  type AuthorizationRequest,
  type OAuthProviderEndpoints,
} from '../calendarAuthService';
import { createLogger } from '../logger';
import { normalizeDescription } from './eventDescription';
import type {
  CalendarClientConfig,
  CalendarEvent,
  CalendarInfo,
  CalendarProviderAdapter,
  CalendarTokens,
} from '../../../shared/types/calendar';

const log = createLogger('MicrosoftCalendar');

// === Microsoft endpoints ===========================================================

/**
 * Scope requested for Microsoft. `offline_access` is REQUIRED to receive a refresh
 * token; `openid email` yield the id_token we decode for the display account email.
 *
 * WHY `Calendars.Read` AND NOT `Calendars.ReadBasic` (CAL-UX.2b): ReadBasic is the
 * least-privilege read scope, but it EXCLUDES the event body/attachments outright —
 * a ReadBasic token simply cannot return a description. Reading descriptions therefore
 * requires the full `Calendars.Read`. It is still read-only and still excludes nothing
 * we deliberately skip (we never request location or attachments).
 */
const MICROSOFT_SCOPE = 'openid email offline_access Calendars.Read';

const MICROSOFT_ENDPOINTS: OAuthProviderEndpoints = {
  authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  scope: MICROSOFT_SCOPE,
  // Public client — PKCE only. The engine omits client_secret when this is false.
  sendClientSecret: false,
};

/** Default (no explicit selection) view across the user's default calendar. */
const GRAPH_CALENDAR_VIEW_URL = 'https://graph.microsoft.com/v1.0/me/calendarView';
/** The account's calendars; also the base for per-calendar calendarView requests. */
const GRAPH_CALENDARS_URL = 'https://graph.microsoft.com/v1.0/me/calendars';

/**
 * Max rows requested PER CALENDAR. Honest hard cap — Graph paging is deliberately not
 * implemented; a 7-day window on one calendar does not realistically exceed it.
 */
const GRAPH_TOP = '250';

/** Fields requested from /me/calendars — id + display name + default flag only. */
const GRAPH_CALENDAR_SELECT = 'id,name,isDefaultCalendar';

/**
 * Fields requested from Graph under a legacy `Calendars.ReadBasic` grant — BYTE-IDENTICAL
 * to the pre-CAL-UX.2b select (a test pins it). MUST NOT contain body/bodyPreview: a
 * ReadBasic token cannot return them, and asking would break a request that works today.
 */
const GRAPH_SELECT_LEGACY = 'subject,start,end,attendees,seriesMasterId,isCancelled,isAllDay,type';

/**
 * Fields requested from Graph under a `Calendars.Read` grant — the legacy select plus
 * `body` (CAL-UX.2b). MUST NOT contain bodyPreview or location (structural privacy —
 * a test asserts this). `type` + `seriesMasterId` + `isCancelled` + `isAllDay` are
 * needed only to FILTER, not to surface.
 */
const GRAPH_SELECT = `${GRAPH_SELECT_LEGACY},body`;

/**
 * Whether a stored grant may request event bodies. Word-boundary match so
 * `Calendars.ReadBasic` (and `Calendars.ReadWrite`, which Graph writes differently)
 * never satisfy it; `undefined` means we never recorded the granted scopes, which is
 * indistinguishable from a pre-CAL-UX.2b grant ⇒ treat as lacking it.
 *
 * DEGRADATION (load-bearing): an existing connection holds a ReadBasic-only token until
 * the user reconnects. Those requests keep the legacy select verbatim, so they behave
 * EXACTLY as before and simply yield no description.
 */
function hasCalendarsReadScope(scope: string | undefined): boolean {
  return scope !== undefined && /\bCalendars\.Read\b/.test(scope);
}

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

interface GraphItemBody {
  /** 'html' | 'text' — Graph returns HTML for most events. */
  contentType?: string;
  content?: string;
}

interface GraphEvent {
  id?: string;
  subject?: string;
  /** Only present when the grant carries Calendars.Read (see GRAPH_SELECT_LEGACY). */
  body?: GraphItemBody;
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

interface GraphCalendar {
  id?: string;
  name?: string;
  isDefaultCalendar?: boolean;
}

interface GraphCalendarsResponse {
  value?: GraphCalendar[];
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

/**
 * Plain-text description from a Graph body. Anything not explicitly `text` goes through
 * the HTML strip pass — Graph's default is HTML, and mistakenly stripping plain text is
 * far less harmful than leaking markup into the modal and the prep prompt.
 */
function toDescription(body: GraphItemBody | undefined): string | undefined {
  const isHtml = (body?.contentType ?? 'html').toLowerCase() !== 'text';
  return normalizeDescription(body?.content, { html: isHtml });
}

/** Map a raw Graph occurrence to a CalendarEvent (id/eventId prefixed). */
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
  // Absent under a legacy ReadBasic grant (body was never requested) ⇒ stays undefined.
  const description = toDescription(ev.body);
  if (description) event.description = description;
  return event;
}

/** Drop cancelled, all-day, and series-master rows — only real occurrences are meetings. */
function isMeetingOccurrence(ev: GraphEvent): boolean {
  return ev.isCancelled !== true && ev.isAllDay !== true && ev.type !== 'seriesMaster';
}

/**
 * Build the Graph calendarView URL for the [now, now+windowHours] window. Without a
 * calendarId this is the account-default view — the EXACT pre-picker request shape.
 * `includeBody` false reproduces the pre-CAL-UX.2b URL byte for byte (legacy grants).
 */
function buildCalendarViewUrl(windowHours: number, calendarId: string | undefined, includeBody: boolean): string {
  const now = Date.now();
  const base = calendarId
    ? `${GRAPH_CALENDARS_URL}/${encodeURIComponent(calendarId)}/calendarView`
    : GRAPH_CALENDAR_VIEW_URL;
  const url = new URL(base);
  url.searchParams.set('startDateTime', new Date(now).toISOString());
  url.searchParams.set('endDateTime', new Date(now + windowHours * 60 * 60 * 1000).toISOString());
  url.searchParams.set('$select', includeBody ? GRAPH_SELECT : GRAPH_SELECT_LEGACY);
  url.searchParams.set('$top', GRAPH_TOP);
  url.searchParams.set('$orderby', 'start/dateTime');
  return url.toString();
}

/** One authenticated Graph GET. */
function graphGet(url: string, accessToken: string): Promise<Response> {
  return fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      Prefer: 'outlook.timezone="UTC"',
    },
  });
}

/** A Graph GET with the single refresh-then-retry-on-401 semantics; returns the
 *  response plus the (possibly rotated) tokens so a batch reuses the fresh one. */
async function authorizedGet(
  url: string,
  tokens: CalendarTokens,
  config: CalendarClientConfig,
): Promise<{ res: Response; tokens: CalendarTokens }> {
  let active = tokens;
  let res = await graphGet(url, active.accessToken);
  if (res.status === 401) {
    // Access token likely expired — refresh once (invalid_grant propagates as
    // CalendarReauthRequiredError) and retry.
    active = await refreshAccessToken(buildRequest(config.clientId), active.refreshToken);
    res = await graphGet(url, active.accessToken);
  }
  return { res, tokens: active };
}

/** Map the selected/filtered Graph occurrences of one response body. */
function parseCalendarView(json: GraphCalendarViewResponse): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (const ev of json.value ?? []) {
    if (!isMeetingOccurrence(ev)) continue;
    const normalized = normalizeEvent(ev);
    if (normalized) events.push(normalized);
  }
  return events;
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

  async listCalendars(tokens: CalendarTokens, config: CalendarClientConfig): Promise<CalendarInfo[]> {
    const url = new URL(GRAPH_CALENDARS_URL);
    url.searchParams.set('$select', GRAPH_CALENDAR_SELECT);
    url.searchParams.set('$top', '50');
    const { res } = await authorizedGet(url.toString(), tokens, config);
    if (!res.ok) {
      throw new Error(`Microsoft calendar list failed (HTTP ${res.status}): ${await readErrorDetail(res)}`);
    }
    const json = (await res.json()) as GraphCalendarsResponse;
    const out: CalendarInfo[] = [];
    for (const cal of json.value ?? []) {
      if (!cal.id) continue;
      out.push({ id: cal.id, name: cal.name ?? cal.id, isPrimary: !!cal.isDefaultCalendar });
    }
    return out;
  },

  async fetchUpcoming(
    tokens: CalendarTokens,
    config: CalendarClientConfig,
    windowHours: number,
    selectedCalendarIds?: string[],
  ): Promise<CalendarEvent[]> {
    // NOTE: this may THROW — the poll orchestrator (Task 4) catches and classifies:
    // CalendarReauthRequiredError (dead refresh token → invalid_grant) flips needsReauth;
    // ANY OTHER error is recorded as lastError WITHOUT flipping needsReauth. A 401/403 with
    // a valid token is a permission problem (e.g. the Calendars.Read Graph permission not
    // granted on the app registration) — NOT an expired authorization — so we surface
    // it plainly instead of forcing a pointless reconnect.
    // No selection ⇒ ONE request against the account-default /me/calendarView (unchanged).
    const targets: (string | undefined)[] = selectedCalendarIds?.length ? selectedCalendarIds : [undefined];
    // Legacy ReadBasic grants (until the user reconnects) keep the OLD request verbatim.
    const includeBody = hasCalendarsReadScope(tokens.scope);
    let active = tokens;
    // Dedupe across calendars: the same event on two calendars keeps ONE row (the cache
    // PK is `${provider}:${eventId}`, so duplicates would collide anyway).
    const merged = new Map<string, CalendarEvent>();
    let firstError: unknown;
    let succeeded = 0;

    for (const calendarId of targets) {
      try {
        const attempt = await authorizedGet(buildCalendarViewUrl(windowHours, calendarId, includeBody), active, config);
        active = attempt.tokens;
        if (!attempt.res.ok) {
          throw new Error(
            `Microsoft Calendar fetch failed (HTTP ${attempt.res.status}): ${await readErrorDetail(attempt.res)}`,
          );
        }
        for (const event of parseCalendarView((await attempt.res.json()) as GraphCalendarViewResponse)) {
          if (!merged.has(event.id)) merged.set(event.id, event);
        }
        succeeded += 1;
      } catch (err) {
        // A dead refresh token is account-wide — never retry it per calendar.
        if (err instanceof CalendarReauthRequiredError) throw err;
        // One calendar failing (e.g. 404 after deletion) must not sink the batch, but a
        // batch where EVERY calendar failed still surfaces its error so the poller can
        // record lastError instead of silently reporting an empty agenda.
        log.warn(`Skipping calendar "${calendarId ?? 'default'}":`, err instanceof Error ? err.message : err);
        firstError ??= err;
      }
    }

    if (succeeded === 0 && firstError !== undefined) throw firstError;
    return [...merged.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
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
