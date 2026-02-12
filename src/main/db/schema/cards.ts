// === FILE PURPOSE ===
// Schema definitions for cards and card_labels junction table.
// Cards live in columns and represent individual tasks/items.
// card_labels is a many-to-many junction between cards and labels.

import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  boolean,
  pgEnum,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { columns } from './boards';
import { labels } from './labels';

export const cardPriorityEnum = pgEnum('card_priority', ['low', 'medium', 'high', 'urgent']);

export const cards = pgTable('cards', {
  id: uuid('id').defaultRandom().primaryKey(),
  columnId: uuid('column_id').notNull().references(() => columns.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 500 }).notNull(),
  description: text('description'),
  position: integer('position').default(0).notNull(),
  priority: cardPriorityEnum('priority').default('medium').notNull(),
  dueDate: timestamp('due_date', { withTimezone: true }),
  archived: boolean('archived').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const cardLabels = pgTable('card_labels', {
  cardId: uuid('card_id').notNull().references(() => cards.id, { onDelete: 'cascade' }),
  labelId: uuid('label_id').notNull().references(() => labels.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.cardId, table.labelId] }),
]);
