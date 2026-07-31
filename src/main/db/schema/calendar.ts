// === FILE PURPOSE ===
// Local cache table for calendar events (Phase G — Calendar Integration).
// Populated by the poll loop (Tasks 2 & 3) and read by `calendar:get-upcoming`.
//
// === PRIVACY POLICY (STRUCTURAL) ===
// This table stores metadata (title, times, attendee name/email, series id) PLUS the
// event description (CAL-UX.2b) — plain-texted and capped at ~4000 chars at fetch time,
// stored LOCALLY only. Calendar rows are never included in any sync payload, and
// attendee EMAILS never enter an AI prompt.
// Still deliberately absent, and NOT to be added "for completeness": location,
// attachments, and raw HTML bodies (only the stripped plain text is persisted).

import { pgTable, varchar, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import type { CalendarProvider, CalendarEventAttendee } from '../../../shared/types/calendar';

export const calendarEvents = pgTable(
  'calendar_events',
  {
    // Prefixed primary key: `${provider}:${eventId}` (a varchar, not a uuid — the
    // id is derived from the external provider's event id).
    id: varchar('id', { length: 512 }).primaryKey(),
    provider: varchar('provider', { length: 20 }).$type<CalendarProvider>().notNull(),
    eventId: varchar('event_id', { length: 512 }).notNull(),
    title: varchar('title', { length: 500 }).notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    // Attendee name/email only — no other PII.
    attendees: jsonb('attendees').$type<CalendarEventAttendee[]>().notNull(),
    // Plain-texted, length-capped event description (CAL-UX.2b). Nullable: providers
    // often omit it, and legacy Microsoft grants (ReadBasic) cannot return it at all.
    description: text('description'),
    seriesId: varchar('series_id', { length: 512 }),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('calendar_events_provider_idx').on(table.provider),
    index('calendar_events_starts_at_idx').on(table.startsAt),
  ],
);
