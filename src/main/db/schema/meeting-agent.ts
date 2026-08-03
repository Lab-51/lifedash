// === FILE PURPOSE ===
// Schema definition for the meeting_agent_threads and meeting_agent_messages tables.
// Stores the "Live Assistant" / post-meeting assistant conversation and its
// message history. Mirrors the card-agent schema conventions (see card-agent.ts).
//
// A meeting had exactly ONE thread until the archive feature: the unique index on
// meetingId is now a plain index, and `archivedAt` marks superseded threads.
// "The current thread" = the newest row for the meeting with archivedAt IS NULL,
// so the UI stays as stateless as it was before while old conversations survive
// starting a new one.

import { pgTable, uuid, varchar, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { meetings } from './meetings';

export const meetingAgentThreads = pgTable(
  'meeting_agent_threads',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    // Null = the live thread. Set when the user starts a new chat, which keeps
    // the old conversation readable instead of destroying it.
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('meeting_agent_threads_meeting_id_idx').on(table.meetingId)],
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
