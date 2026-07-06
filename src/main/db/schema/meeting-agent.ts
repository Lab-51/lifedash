// === FILE PURPOSE ===
// Schema definition for the meeting_agent_threads and meeting_agent_messages tables.
// Stores the in-meeting "Live Assistant" conversation: one thread per meeting
// (unique index on meetingId keeps the drawer UI stateless) plus its message history.
// Mirrors the card-agent schema conventions (see card-agent.ts).

import { pgTable, uuid, varchar, text, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { meetings } from './meetings';

export const meetingAgentThreads = pgTable(
  'meeting_agent_threads',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // One thread per meeting — unique so "open drawer = load THE thread".
  (table) => [uniqueIndex('meeting_agent_threads_meeting_id_idx').on(table.meetingId)],
);

export const meetingAgentMessages = pgTable(
  'meeting_agent_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => meetingAgentThreads.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 20 }).notNull(), // 'user' | 'assistant' | 'tool'
    content: text('content'),
    toolCalls: jsonb('tool_calls'), // [{ id, name, args }]
    toolResults: jsonb('tool_results'), // [{ toolCallId, toolName, result }]
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('meeting_agent_messages_thread_id_idx').on(table.threadId)],
);
