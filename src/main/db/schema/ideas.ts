// === FILE PURPOSE ===
// Schema definitions for ideas and idea_tags tables.
// Ideas are standalone items that can optionally be linked to a project.
// idea_tags is a many-to-many junction using freeform tag strings.

import { pgTable, uuid, varchar, text, timestamp, pgEnum, primaryKey, index } from 'drizzle-orm/pg-core';
import { projects } from './projects';

export const ideaStatusEnum = pgEnum('idea_status', ['new', 'exploring', 'active', 'archived']);
export const effortEnum = pgEnum('effort_level', ['trivial', 'small', 'medium', 'large', 'epic']);
export const impactEnum = pgEnum('impact_level', ['minimal', 'low', 'medium', 'high', 'critical']);

export const ideas = pgTable('ideas', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  title: varchar('title', { length: 500 }).notNull(),
  description: text('description'),
  status: ideaStatusEnum('status').default('new').notNull(),
  effort: effortEnum('effort'),
  impact: impactEnum('impact'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const ideaTags = pgTable(
  'idea_tags',
  {
    ideaId: uuid('idea_id')
      .notNull()
      .references(() => ideas.id, { onDelete: 'cascade' }),
    tag: varchar('tag', { length: 100 }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.ideaId, table.tag] }), index('idea_tags_idea_id_idx').on(table.ideaId)],
);
