// === FILE PURPOSE ===
// Schema definition for the card_agent_messages table.
// Stores conversation history between users and per-card AI agents.

import { pgTable, uuid, varchar, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { cards } from './cards';

export const cardAgentMessages = pgTable('card_agent_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  cardId: uuid('card_id').notNull()
    .references(() => cards.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 20 }).notNull(), // 'user' | 'assistant' | 'tool'
  content: text('content'),
  toolCalls: jsonb('tool_calls'),    // [{ id, name, args }]
  toolResults: jsonb('tool_results'), // [{ toolCallId, toolName, result }]
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('card_agent_messages_card_id_idx').on(table.cardId),
]);
