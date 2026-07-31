// === FILE PURPOSE ===
// Local cache table for calendar events (Phase G — Calendar Integration).
// Populated by the poll loop (Tasks 2 & 3) and read by `calendar:get-upcoming`.
//
// === PRIVACY POLICY (STRUCTURAL) ===
// This table stores ONLY metadata: title, times, attendee name/email, series id.
// There is deliberately NO body/description/location column — event bodies are
// NEVER persisted. Do not add such a column "for completeness."

import { pgTable, varchar, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
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
    // Attendee name/email only — no other PII, no event body.
    attendees: jsonb('attendees').$type<CalendarEventAttendee[]>().notNull(),
    seriesId: varchar('series_id', { length: 512 }),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('calendar_events_provider_idx').on(table.provider),
    index('calendar_events_starts_at_idx').on(table.startsAt),
  ],
);
