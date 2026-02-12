// === FILE PURPOSE ===
// Schema definition for the labels table.
// Labels are project-scoped and can be attached to cards.

import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';
import { projects } from './projects';

export const labels = pgTable('labels', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  color: varchar('color', { length: 7 }).notNull(), // Hex color
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
