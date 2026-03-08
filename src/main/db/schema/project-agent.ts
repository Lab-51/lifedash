// === FILE PURPOSE ===
// Schema definition for the project_agent_threads and project_agent_messages tables.
// Stores conversation threads and message history between users and per-project AI agents.

import { pgTable, uuid, varchar, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { projects } from './projects';

export const projectAgentThreads = pgTable('project_agent_threads', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 200 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('project_agent_threads_project_id_idx').on(table.projectId),
]);

export const projectAgentMessages = pgTable('project_agent_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  threadId: uuid('thread_id')
    .references(() => projectAgentThreads.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 20 }).notNull(), // 'user' | 'assistant' | 'tool'
  content: text('content'),
  toolCalls: jsonb('tool_calls'),    // [{ id, name, args }]
  toolResults: jsonb('tool_results'), // [{ toolCallId, toolName, result }]
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('project_agent_messages_project_id_idx').on(table.projectId),
  index('project_agent_messages_thread_id_idx').on(table.threadId),
]);
