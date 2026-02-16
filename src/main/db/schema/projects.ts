// === FILE PURPOSE ===
// Schema definition for the projects table.
// Projects are the top-level organizational unit in the dashboard.

import { pgTable, uuid, varchar, text, boolean, timestamp } from 'drizzle-orm/pg-core';

export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  color: varchar('color', { length: 7 }), // Hex color e.g. #3b82f6
  archived: boolean('archived').default(false).notNull(),
  pinned: boolean('pinned').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
