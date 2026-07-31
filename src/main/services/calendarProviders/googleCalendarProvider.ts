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
  type AuthorizationRequest,
  type OAuthProviderEndpoints,
} from '../calendarAuthService';
import type {
  CalendarClientConfig,
  CalendarEvent,
  CalendarEventAttendee,
  CalendarProviderAdapter,
  CalendarTokens,
} from '../../../shared/types/calendar';

/**
 * Google OAuth + Calendar endpoints. `access_type=offline` + `prompt=consent` are
 * REQUIRED for Google to return a refresh_token (proven in the live preflight — do
 * not omit). `sendClientSecret` is true: Google Desktop clients exchange with a secret.
 */
const GOOGLE_ENDPOINTS: OAuthProviderEndpoints = {
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  scope: 'openid email https://www.googleapis.com/auth/calendar.events.readonly',
  sendClientSecret: true,
  extraAuthParams: { access_type: 'offline', prompt: 'consent' },
};

/** Base URL for the Google Calendar events list (primary calendar). */
const GOOGLE_EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

/** Refresh when the access token is within this many ms of expiry. */
const EXPIRY_SKEW_MS = 60_000;

/** Max events requested per poll. */
const MAX_RESULTS = 50;

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

/** Build the Google Calendar events-list URL for the [now, now+windowHours] window. */
function buildEventsUrl(windowHours: number): string {
  const now = Date.now();
  const url = new URL(GOOGLE_EVENTS_URL);
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('timeMin', new Date(now).toISOString());
  url.searchParams.set('timeMax', new Date(now + windowHours * 3_600_000).toISOString());
  url.searchParams.set('maxResults', String(MAX_RESULTS));
  return url.toString();
}

async function requestEvents(accessToken: string, windowHours: number): Promise<Response> {
  return fetch(buildEventsUrl(windowHours), {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
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

  async fetchUpcoming(
    tokens: CalendarTokens,
    config: CalendarClientConfig,
    windowHours: number,
  ): Promise<CalendarEvent[]> {
    // NOTE: this may THROW — the poll orchestrator (Task 4) catches and classifies the
    // error: a CalendarReauthRequiredError (dead refresh token → invalid_grant) flips
    // needsReauth; ANY OTHER error is recorded as lastError WITHOUT flipping needsReauth.
    // A 401/403 with a valid token is a permission / API-config problem (e.g. the Google
    // Calendar API not being enabled, or insufficient scope) — NOT an expired
    // authorization — so we surface it plainly instead of forcing a pointless reconnect.
    let active = tokens;
    let res = await requestEvents(active.accessToken, windowHours);

    if (res.status === 401) {
      // Access token likely expired — refresh once (invalid_grant propagates as
      // CalendarReauthRequiredError) and retry.
      active = await refreshAccessToken(toRequest(config), active.refreshToken);
      res = await requestEvents(active.accessToken, windowHours);
    }

    if (!res.ok) {
      throw new Error(`Google Calendar fetch failed (HTTP ${res.status}): ${await readErrorDetail(res)}`);
    }
    return await parseEvents(res);
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
