// === FILE PURPOSE ===
// Schema definitions for boards and columns tables.
// Boards belong to projects; columns belong to boards.
// Together they form the Kanban board structure.

import { pgTable, uuid, varchar, integer, timestamp } from 'drizzle-orm/pg-core';
import { projects } from './projects';

export const boards = pgTable('boards', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  position: integer('position').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const columns = pgTable('columns', {
  id: uuid('id').defaultRandom().primaryKey(),
  boardId: uuid('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  position: integer('position').default(0).notNull(),
  color: varchar('color', { length: 7 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
