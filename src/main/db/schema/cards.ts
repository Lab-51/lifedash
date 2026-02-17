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
import { projects } from './projects';

export const cardPriorityEnum = pgEnum('card_priority', ['low', 'medium', 'high', 'urgent']);

export const cards = pgTable('cards', {
  id: uuid('id').defaultRandom().primaryKey(),
  columnId: uuid('column_id').notNull().references(() => columns.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 500 }).notNull(),
  description: text('description'),
  position: integer('position').default(0).notNull(),
  priority: cardPriorityEnum('priority').default('medium').notNull(),
  dueDate: timestamp('due_date', { withTimezone: true }),
  completed: boolean('completed').default(false).notNull(),
  archived: boolean('archived').default(false).notNull(),
  recurrenceType: varchar('recurrence_type', { length: 20 }),
  recurrenceEndDate: timestamp('recurrence_end_date', { withTimezone: true }),
  sourceRecurringId: uuid('source_recurring_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const cardLabels = pgTable('card_labels', {
  cardId: uuid('card_id').notNull().references(() => cards.id, { onDelete: 'cascade' }),
  labelId: uuid('label_id').notNull().references(() => labels.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.cardId, table.labelId] }),
]);

// --- Card Relationships ---

export const cardRelationshipTypeEnum = pgEnum('card_relationship_type', [
  'blocks', 'depends_on', 'related_to',
]);

export const cardRelationships = pgTable('card_relationships', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceCardId: uuid('source_card_id').notNull()
    .references(() => cards.id, { onDelete: 'cascade' }),
  targetCardId: uuid('target_card_id').notNull()
    .references(() => cards.id, { onDelete: 'cascade' }),
  type: cardRelationshipTypeEnum('type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- Card Comments ---

export const cardComments = pgTable('card_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  cardId: uuid('card_id').notNull()
    .references(() => cards.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- Card Activity Log ---

export const cardActivityActionEnum = pgEnum('card_activity_action', [
  'created', 'updated', 'moved', 'commented',
  'archived', 'restored', 'relationship_added', 'relationship_removed',
]);

export const cardActivities = pgTable('card_activities', {
  id: uuid('id').primaryKey().defaultRandom(),
  cardId: uuid('card_id').notNull()
    .references(() => cards.id, { onDelete: 'cascade' }),
  action: cardActivityActionEnum('action').notNull(),
  details: text('details'), // JSON string with context-specific data
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- Card Attachments ---

export const cardAttachments = pgTable('card_attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  cardId: uuid('card_id').notNull()
    .references(() => cards.id, { onDelete: 'cascade' }),
  fileName: varchar('file_name', { length: 500 }).notNull(),
  filePath: text('file_path').notNull(),       // Absolute path in app data dir
  fileSize: integer('file_size').notNull(),     // Bytes
  mimeType: varchar('mime_type', { length: 200 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- Card Checklist Items ---

export const cardChecklistItems = pgTable('card_checklist_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  cardId: uuid('card_id').notNull()
    .references(() => cards.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 500 }).notNull(),
  completed: boolean('completed').default(false).notNull(),
  position: integer('position').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// --- Card Templates ---

export const cardTemplates = pgTable('card_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  priority: cardPriorityEnum('priority').default('medium').notNull(),
  labelNames: text('label_names'), // JSON-stringified array of label name strings
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
