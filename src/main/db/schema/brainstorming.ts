// === FILE PURPOSE ===
// Schema for brainstorm sessions and messages.
// Sessions can optionally belong to a project. Messages cascade delete with session.

import { pgTable, uuid, varchar, text, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { projects } from './projects';

export const brainstormSessionStatusEnum = pgEnum('brainstorm_session_status', ['active', 'archived']);
export const brainstormMessageRoleEnum = pgEnum('brainstorm_message_role', ['user', 'assistant']);

export const brainstormSessions = pgTable('brainstorm_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  title: varchar('title', { length: 500 }).notNull(),
  status: brainstormSessionStatusEnum('status').default('active').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const brainstormMessages = pgTable('brainstorm_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  sessionId: uuid('session_id').notNull().references(() => brainstormSessions.id, { onDelete: 'cascade' }),
  role: brainstormMessageRoleEnum('role').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
