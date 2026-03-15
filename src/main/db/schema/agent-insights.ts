// === FILE PURPOSE ===
// Schema definition for the agent_insights table.
// Stores AI-generated insights produced by background agents for each project.

import { pgTable, uuid, varchar, text, jsonb, timestamp, integer, index } from 'drizzle-orm/pg-core';
import { projects } from './projects';

export const agentInsights = pgTable(
  'agent_insights',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 50 }).notNull(), // InsightType
    severity: varchar('severity', { length: 20 }).notNull(), // InsightSeverity
    status: varchar('status', { length: 20 }).notNull().default('new'), // InsightStatus
    title: varchar('title', { length: 500 }).notNull(),
    summary: text('summary').notNull(),
    details: jsonb('details'), // Record<string, unknown> | null
    relatedCardIds: jsonb('related_card_ids').notNull().default([]), // string[]
    tokenCost: integer('token_cost').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  },
  (table) => [
    index('agent_insights_project_id_status_idx').on(table.projectId, table.status),
    index('agent_insights_created_at_idx').on(table.createdAt),
  ],
);
