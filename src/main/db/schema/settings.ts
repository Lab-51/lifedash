// === FILE PURPOSE ===
// Schema for the settings table — generic key-value store for app configuration.
// Used for theme preference, task model assignments (JSON), and other settings.

import { pgTable, varchar, text, timestamp } from 'drizzle-orm/pg-core';

export const settings = pgTable('settings', {
  key: varchar('key', { length: 255 }).primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
