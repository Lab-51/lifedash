// === FILE PURPOSE ===
// Shared contract types for Phase G (Calendar Integration). These are the FROZEN
// public shapes that the renderer, the IPC layer, and the provider adapters
// (Google = Task 2, Microsoft = Task 3) all build against.
//
// === PRIVACY POLICY (STRUCTURAL) ===
// CalendarEvent intentionally has NO body / description / location field. The
// "metadata only, never bodies" policy is enforced *structurally* — there is no
// field to hold an event body, so a body can never be persisted. Do NOT add one.

/** The two calendar providers this phase supports. */
export type CalendarProvider = 'google' | 'microsoft';

/** A single attendee — name and/or email, both optional (providers vary). */
export interface CalendarEventAttendee {
  name?: string;
  email?: string;
}

/**
 * A calendar event as cached and surfaced to the renderer.
 *
 * DELIBERATELY has no body/description/location — see the privacy note above.
 */
export interface CalendarEvent {
  /** Prefixed cache id: `${provider}:${eventId}`. */
  id: string;
  provider: CalendarProvider;
  /** The provider's native event id (unprefixed). */
  eventId: string;
  title: string;
  /** ISO 8601 timestamp. */
  startsAt: string;
  /** ISO 8601 timestamp. */
  endsAt: string;
  attendees: CalendarEventAttendee[];
  /** Recurring-series id, when the event belongs to a series. */
  seriesId?: string;
}

/**
 * Which agenda surface the Sessions-home renders (CAL-UX.2). Persisted under the
 * `calendar:agendaView` settings key; default 'week' when absent/invalid.
 */
export type AgendaViewMode = 'list' | 'week' | 'timeline';

/**
 * Everything LifeDash already KNOWS about one calendar event — assembled by
 * deterministic DB queries only (`calendar:get-event-context`, zero model calls).
 *
 * This is LifeDash-derived context (sessions, briefs, action items, entity facts),
 * never calendar prose: the metadata-only policy above still holds.
 */
export interface CalendarEventContext {
  /** THIS event already has a recorded session. */
  recordedSession: { meetingId: string; title: string } | null;
  /** Most recent COMPLETED session of the same series, excluding this event's own. */
  lastSeriesSession: {
    meetingId: string;
    title: string;
    /** ISO timestamp the session ended (falls back to its start when never stamped). */
    endedAt: string;
    /** First ~240 chars of that session's brief, plain-texted; null when it has none. */
    briefSnippet: string | null;
    /** Still-open action items, capped at 5 — `totalOpenActionItems` keeps the count honest. */
    openActionItems: { id: string; text: string }[];
    totalOpenActionItems: number;
  } | null;
  /** Attendees matched to a known person entity (exact normalized name), capped at 6. */
  attendeeMatches: { entityId: string; name: string; factCount: number }[];
}

/** Per-provider connection status shown in Settings. */
export interface CalendarAccountStatus {
  provider: CalendarProvider;
  connected: boolean;
  /** Display-only account email decoded from the id_token (never an auth input). */
  accountEmail?: string;
  /** True when the refresh token is dead (invalid_grant) and the user must re-consent. */
  needsReauth: boolean;
  /** ISO timestamp of the last successful poll. */
  lastSyncAt?: string;
  /** Human-readable last error, if any. */
  lastError?: string;
}

/**
 * BYO OAuth client config. Google Desktop clients have a client secret; Microsoft
 * public clients do NOT (PKCE only). Modelled as a discriminated union so TypeScript
 * structurally enforces "Microsoft has no secret."
 */
export interface GoogleClientConfig {
  provider: 'google';
  clientId: string;
  clientSecret: string;
}

export interface MicrosoftClientConfig {
  provider: 'microsoft';
  clientId: string;
  // No clientSecret — public client, PKCE only.
}

export type CalendarClientConfig = GoogleClientConfig | MicrosoftClientConfig;

/**
 * OAuth token set returned by the exchange/refresh legs and cached (encrypted).
 * `expiresAt` is epoch milliseconds (compare against Date.now()), NOT an ISO string,
 * because it is used purely for expiry math.
 */
export interface CalendarTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds at which the access token expires. */
  expiresAt: number;
  /** Raw id_token JWT (used only to decode the display email claim; unverified). */
  idToken?: string;
  /** Space-delimited granted scopes, as echoed by the provider. */
  scope?: string;
  /** Usually 'Bearer'. */
  tokenType?: string;
}

/** One calendar in a provider account, as offered by the Settings picker. */
export interface CalendarInfo {
  /** Provider-native calendar id (Google calendarList id / Graph calendar id). */
  id: string;
  /** Display name (user data — render with break-words). */
  name: string;
  /** True for the account's primary/default calendar. */
  isPrimary: boolean;
}

/** Result of `calendar:list-calendars`. */
export interface CalendarListResult {
  /** Available calendars; EMPTY when `needsReconnect` is true (no network call was made). */
  calendars: CalendarInfo[];
  /** Currently stored selection; empty ⇒ provider default (Google primary / MS default view). */
  selectedIds: string[];
  /** True when the stored grant predates the calendar-listing scope — the user must reconnect. */
  needsReconnect: boolean;
}

/**
 * The provider-specific adapter interface. Google (Task 2) and Microsoft (Task 3)
 * each implement this and register it via `registerCalendarAdapter`. The adapter
 * carries its own endpoints/scopes internally and drives the generic OAuth engine
 * in `calendarAuthService`.
 */
export interface CalendarProviderAdapter {
  /** Run the full system-browser + loopback authorization-code + PKCE flow. */
  authorize(config: CalendarClientConfig): Promise<{ tokens: CalendarTokens; accountEmail?: string }>;
  /** Refresh the access token if it is near/after expiry; returns the (possibly rotated) tokens. */
  refreshIfNeeded(tokens: CalendarTokens): Promise<CalendarTokens>;
  /** List the account's calendars for the Settings picker. */
  listCalendars(tokens: CalendarTokens, config: CalendarClientConfig): Promise<CalendarInfo[]>;
  /**
   * Fetch upcoming events within `windowHours` and map them to metadata-only CalendarEvents.
   * `selectedCalendarIds` undefined OR empty ⇒ the provider's DEFAULT behavior (Google
   * `primary`, Microsoft `/me/calendarView`) — i.e. the pre-picker request shape.
   */
  fetchUpcoming(
    tokens: CalendarTokens,
    config: CalendarClientConfig,
    windowHours: number,
    selectedCalendarIds?: string[],
  ): Promise<CalendarEvent[]>;
}

/**
 * Result of `calendar:suggest-project`. Task 5 implements the real matching logic;
 * this task freezes the shape and returns null so Task 4 can call the channel today.
 */
export interface CalendarProjectSuggestion {
  projectId: string;
  projectName: string;
  /** Why this project was suggested (e.g. 'series-history', 'attendee-overlap'). */
  basis: string;
}

// === Settings keys (renderer + main) ===============================================

/**
 * How far ahead every calendar read looks — the SINGLE source of truth shared by the
 * poll scheduler, the post-connect fetch and the Sessions-home agenda (7 days).
 * The imminent-conflict banner during recording deliberately keeps its own short window.
 */
export const CALENDAR_LOOKAHEAD_HOURS = 168;

/** Settings key holding the JSON `string[]` of selected calendar ids for a provider.
 *  ABSENT ⇒ provider default. It is NEVER written as an empty array. */
export function calendarSelectionKey(provider: CalendarProvider): string {
  return `calendar:${provider}:selectedCalendars`;
}

/** Poll frequency in minutes (string KV value). */
export const CALENDAR_SETTING_POLL_INTERVAL_MINUTES = 'calendar:pollIntervalMinutes';
/** Whether to show upcoming-event notifications ('true' | 'false'). */
export const CALENDAR_SETTING_EVENT_NOTIFICATIONS = 'calendar:eventNotifications';

/** Default poll interval when unset. */
export const CALENDAR_DEFAULT_POLL_INTERVAL_MINUTES = '5';
/** Default event-notifications toggle when unset. */
export const CALENDAR_DEFAULT_EVENT_NOTIFICATIONS = 'true';
