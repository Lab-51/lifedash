// === FILE PURPOSE ===
// Schema definition for the project_agent_messages table.
// Stores conversation history between users and per-project AI agents.

import { pgTable, uuid, varchar, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { projects } from './projects';

export const projectAgentMessages = pgTable('project_agent_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 20 }).notNull(), // 'user' | 'assistant' | 'tool'
  content: text('content'),
  toolCalls: jsonb('tool_calls'),    // [{ id, name, args }]
  toolResults: jsonb('tool_results'), // [{ toolCallId, toolName, result }]
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
