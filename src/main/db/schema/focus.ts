// === FILE PURPOSE ===
// Schema definitions for focus mode gamification tables.
// focus_sessions stores completed focus sessions, focus_achievements stores unlocked achievements.

import { pgTable, uuid, varchar, text, integer, timestamp } from 'drizzle-orm/pg-core';
import { cards } from './cards';

export const focusSessions = pgTable('focus_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  cardId: uuid('card_id').references(() => cards.id, { onDelete: 'set null' }),
  durationMinutes: integer('duration_minutes').notNull(),
  note: text('note'),
  completedAt: timestamp('completed_at', { withTimezone: true }).defaultNow().notNull(),
});

export const focusAchievements = pgTable('focus_achievements', {
  id: varchar('id', { length: 50 }).primaryKey(),
  unlockedAt: timestamp('unlocked_at', { withTimezone: true }).defaultNow().notNull(),
});
