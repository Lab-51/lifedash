// === FILE PURPOSE ===
// Schema definition for the xp_events table.
// Tracks all XP-earning events across the entire app for unified gamification.

import { pgTable, uuid, varchar, integer, timestamp } from 'drizzle-orm/pg-core';

export const xpEvents = pgTable('xp_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventType: varchar('event_type', { length: 50 }).notNull(),
  xpAmount: integer('xp_amount').notNull(),
  entityId: uuid('entity_id'),
  earnedAt: timestamp('earned_at', { withTimezone: true }).defaultNow().notNull(),
});
