// === FILE PURPOSE ===
// The Google Calendar provider adapter (Phase G, Task 2). Implements the FROZEN
// `CalendarProviderAdapter` interface by delegating ALL OAuth to the provider-agnostic
// engine in `calendarAuthService` (Authorization-Code + PKCE via system browser +
// loopback). This file only supplies Google's endpoints/scope and normalizes the
// Google Calendar events list into metadata-only `CalendarEvent`s.
//
// === DEPENDENCIES ===
// global fetch (Node 20+/Electron 40), calendarAuthService (OAuth engine), logger.
//
// === PRIVACY (STRUCTURAL) ===
// Normalization NEVER reads `description`/`location`/body from Google events. The
// `CalendarEvent` shape has no field to hold them; a test asserts their absence.

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
import type {
  CalendarClientConfig,
  CalendarEvent,
  CalendarEventAttendee,
  CalendarInfo,
  CalendarProviderAdapter,
  CalendarTokens,
} from '../../../shared/types/calendar';

const log = createLogger('GoogleCalendar');

/**
 * Scopes requested at connect time. `calendar.events.readonly` reads events from ANY
 * of the user's calendars, but it does NOT permit LISTING calendars — that needs
 * `calendar.calendarlist.readonly` (same sensitive-not-restricted class). Grants made
 * before the picker shipped lack it; `hasCalendarListScope` detects that.
 */
const GOOGLE_SCOPE =
  'openid email https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/calendar.calendarlist.readonly';

/**
 * Google OAuth + Calendar endpoints. `access_type=offline` + `prompt=consent` are
 * REQUIRED for Google to return a refresh_token (proven in the live preflight — do
 * not omit). `sendClientSecret` is true: Google Desktop clients exchange with a secret.
 */
const GOOGLE_ENDPOINTS: OAuthProviderEndpoints = {
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  scope: GOOGLE_SCOPE,
  sendClientSecret: true,
  extraAuthParams: { access_type: 'offline', prompt: 'consent' },
};

/** Base URL for a single calendar's events list; `{id}` is URL-encoded per request. */
const GOOGLE_CALENDARS_URL = 'https://www.googleapis.com/calendar/v3/calendars';
/** The user's calendar list (needs the calendarlist scope). */
const GOOGLE_CALENDAR_LIST_URL = 'https://www.googleapis.com/calendar/v3/users/me/calendarList';

/** Calendar id used when the user has not picked any (today's behavior). */
const DEFAULT_CALENDAR_ID = 'primary';

/** Refresh when the access token is within this many ms of expiry. */
const EXPIRY_SKEW_MS = 60_000;

/**
 * Max rows requested PER CALENDAR (events and calendarList alike). This is an honest
 * hard cap: neither request paginates, by design — a 7-day window on one calendar does
 * not realistically exceed it, and the agenda is a preview, not an archive.
 */
const MAX_RESULTS = 250;

/**
 * Whether a stored grant can list calendars. Google echoes the granted scopes back in
 * `tokens.scope`; `undefined` means we never recorded them, which for our purposes is
 * indistinguishable from a pre-picker grant ⇒ treat as stale. Pure (no network) so the
 * IPC layer can gate BEFORE calling the API.
 */
export function hasCalendarListScope(scope: string | undefined): boolean {
  if (!scope) return false;
  return scope.includes('calendar.calendarlist.readonly') || scope.includes('calendar.readonly');
}

// === Request assembly ==============================================================

/** Build the OAuth AuthorizationRequest from a Google client config. */
function toRequest(config: CalendarClientConfig): AuthorizationRequest {
  if (config.provider !== 'google') {
    throw new Error(`googleCalendarProvider received a ${config.provider} config`);
  }
  return {
    provider: 'google',
    endpoints: GOOGLE_ENDPOINTS,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  };
}

/** Resolve the effective Google client config and build a request, or null if none. */
async function loadRequest(): Promise<AuthorizationRequest | null> {
  const config = await loadCalendarClientConfig('google');
  if (!config || config.provider !== 'google') return null;
  return toRequest(config);
}

// === Events normalization ==========================================================

/** The subset of the Google events-list response we read. Body fields are omitted. */
interface GoogleEventTime {
  dateTime?: string;
  date?: string;
}
interface GoogleAttendee {
  displayName?: string;
  email?: string;
}
interface GoogleEvent {
  id?: string;
  status?: string;
  summary?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
  attendees?: GoogleAttendee[];
  recurringEventId?: string;
}
interface GoogleEventsResponse {
  items?: GoogleEvent[];
}
/** The subset of a calendarList entry we read. */
interface GoogleCalendarListEntry {
  id?: string;
  summary?: string;
  summaryOverride?: string;
  primary?: boolean;
  deleted?: boolean;
  hidden?: boolean;
}
interface GoogleCalendarListResponse {
  items?: GoogleCalendarListEntry[];
}

function mapAttendee(a: GoogleAttendee): CalendarEventAttendee {
  const attendee: CalendarEventAttendee = {};
  if (a.displayName) attendee.name = a.displayName;
  if (a.email) attendee.email = a.email;
  return attendee;
}

/**
 * Normalize a single Google event to a metadata-only CalendarEvent, or null when it
 * must be skipped (cancelled, or all-day with no start instant to trigger on).
 * NEVER reads description/location/body.
 */
function normalizeEvent(item: GoogleEvent): CalendarEvent | null {
  if (item.status === 'cancelled') return null;
  const startDateTime = item.start?.dateTime;
  const endDateTime = item.end?.dateTime;
  if (!startDateTime || !item.id) return null; // all-day (start.date only) or malformed

  const eventId = item.id;
  const event: CalendarEvent = {
    id: `google:${eventId}`,
    provider: 'google',
    eventId,
    title: item.summary || '(untitled)',
    startsAt: new Date(startDateTime).toISOString(),
    endsAt: new Date(endDateTime ?? startDateTime).toISOString(),
    attendees: (item.attendees ?? []).map(mapAttendee),
  };
  if (item.recurringEventId) event.seriesId = `google:${item.recurringEventId}`;
  return event;
}

/** Build one calendar's events-list URL for the [now, now+windowHours] window. */
function buildEventsUrl(calendarId: string, windowHours: number): string {
  const now = Date.now();
  const url = new URL(`${GOOGLE_CALENDARS_URL}/${encodeURIComponent(calendarId)}/events`);
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('timeMin', new Date(now).toISOString());
  url.searchParams.set('timeMax', new Date(now + windowHours * 3_600_000).toISOString());
  url.searchParams.set('maxResults', String(MAX_RESULTS));
  return url.toString();
}

/** One authenticated GET with the single refresh-then-retry-on-401 semantics. Returns
 *  the response plus the (possibly rotated) tokens so a batch reuses the fresh one. */
async function authorizedGet(
  url: string,
  tokens: CalendarTokens,
  config: CalendarClientConfig,
): Promise<{ res: Response; tokens: CalendarTokens }> {
  const init = (accessToken: string): RequestInit => ({
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  let active = tokens;
  let res = await fetch(url, init(active.accessToken));
  if (res.status === 401) {
    // Access token likely expired — refresh once (invalid_grant propagates as
    // CalendarReauthRequiredError) and retry.
    active = await refreshAccessToken(toRequest(config), active.refreshToken);
    res = await fetch(url, init(active.accessToken));
  }
  return { res, tokens: active };
}

async function parseEvents(res: Response): Promise<CalendarEvent[]> {
  const json = (await res.json()) as GoogleEventsResponse;
  const out: CalendarEvent[] = [];
  for (const item of json.items ?? []) {
    const normalized = normalizeEvent(item);
    if (normalized) out.push(normalized);
  }
  return out;
}

/** Map a calendarList entry, or null when it must be skipped (deleted/hidden/malformed). */
function normalizeCalendarListEntry(entry: GoogleCalendarListEntry): CalendarInfo | null {
  if (entry.deleted || entry.hidden || !entry.id) return null;
  return {
    id: entry.id,
    name: entry.summaryOverride ?? entry.summary ?? entry.id,
    isPrimary: !!entry.primary,
  };
}

// === Adapter =======================================================================

export const googleCalendarAdapter: CalendarProviderAdapter = {
  async authorize(config: CalendarClientConfig): Promise<{ tokens: CalendarTokens; accountEmail?: string }> {
    const req = toRequest(config);
    const { tokens, accountEmail } = await runAuthorizationCodeFlow(req);
    return { tokens, accountEmail };
  },

  async refreshIfNeeded(tokens: CalendarTokens): Promise<CalendarTokens> {
    if (Date.now() < tokens.expiresAt - EXPIRY_SKEW_MS) return tokens;
    const req = await loadRequest();
    if (!req) return tokens; // no client config resolvable — best effort, fetch will 401
    // Let CalendarReauthRequiredError propagate (invalid_grant → caller flips needsReauth).
    return refreshAccessToken(req, tokens.refreshToken);
  },

  async listCalendars(tokens: CalendarTokens, config: CalendarClientConfig): Promise<CalendarInfo[]> {
    const url = new URL(GOOGLE_CALENDAR_LIST_URL);
    url.searchParams.set('maxResults', String(MAX_RESULTS));
    const { res } = await authorizedGet(url.toString(), tokens, config);
    if (!res.ok) {
      throw new Error(`Google calendar list failed (HTTP ${res.status}): ${await readErrorDetail(res)}`);
    }
    const json = (await res.json()) as GoogleCalendarListResponse;
    const out: CalendarInfo[] = [];
    for (const entry of json.items ?? []) {
      const info = normalizeCalendarListEntry(entry);
      if (info) out.push(info);
    }
    return out;
  },

  async fetchUpcoming(
    tokens: CalendarTokens,
    config: CalendarClientConfig,
    windowHours: number,
    selectedCalendarIds?: string[],
  ): Promise<CalendarEvent[]> {
    // NOTE: this may THROW — the poll orchestrator (Task 4) catches and classifies the
    // error: a CalendarReauthRequiredError (dead refresh token → invalid_grant) flips
    // needsReauth; ANY OTHER error is recorded as lastError WITHOUT flipping needsReauth.
    // A 401/403 with a valid token is a permission / API-config problem (e.g. the Google
    // Calendar API not being enabled, or insufficient scope) — NOT an expired
    // authorization — so we surface it plainly instead of forcing a pointless reconnect.
    const ids = selectedCalendarIds?.length ? selectedCalendarIds : [DEFAULT_CALENDAR_ID];
    let active = tokens;
    // Dedupe across calendars: the same event visible on two calendars keeps ONE row
    // (the cache PK is `${provider}:${eventId}`, so duplicates would collide anyway).
    const merged = new Map<string, CalendarEvent>();
    let firstError: unknown;
    let succeeded = 0;

    for (const calendarId of ids) {
      try {
        const attempt = await authorizedGet(buildEventsUrl(calendarId, windowHours), active, config);
        active = attempt.tokens;
        if (!attempt.res.ok) {
          throw new Error(
            `Google Calendar fetch failed (HTTP ${attempt.res.status}): ${await readErrorDetail(attempt.res)}`,
          );
        }
        for (const event of await parseEvents(attempt.res)) {
          if (!merged.has(event.id)) merged.set(event.id, event);
        }
        succeeded += 1;
      } catch (err) {
        // A dead refresh token is account-wide — never retry it per calendar.
        if (err instanceof CalendarReauthRequiredError) throw err;
        // One calendar failing (e.g. 404 after deletion) must not sink the batch, but a
        // batch where EVERY calendar failed still surfaces its error so the poller can
        // record lastError instead of silently reporting an empty agenda.
        log.warn(`Skipping calendar "${calendarId}":`, err instanceof Error ? err.message : err);
        firstError ??= err;
      }
    }

    if (succeeded === 0 && firstError !== undefined) throw firstError;
    return [...merged.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  },
};

/** Extract a concise human-readable detail from a failed API response body. */
async function readErrorDetail(res: Response): Promise<string> {
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
 * Register the Google adapter with the calendarAuthService registry. Task 4 calls
 * this at boot from main.ts (this file does NOT wire the boot import).
 */
export function registerGoogleCalendarAdapter(): void {
  registerCalendarAdapter('google', googleCalendarAdapter);
}
