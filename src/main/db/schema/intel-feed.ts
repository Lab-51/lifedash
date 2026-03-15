// === FILE PURPOSE ===
// Schema definitions for intel_sources, intel_items, and intel_briefs tables.
// Intel sources are RSS feeds or manual entries that provide news items.
// Intel items are individual articles/links fetched from sources.
// Intel briefs are AI-generated daily/weekly summaries of intel items.

import { pgTable, uuid, varchar, text, timestamp, pgEnum, boolean, integer, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const intelSourceTypeEnum = pgEnum('intel_source_type', ['rss', 'manual']);

export const intelSources = pgTable('intel_sources', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  url: varchar('url', { length: 1000 }).notNull(),
  type: intelSourceTypeEnum('type').default('rss').notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  iconUrl: varchar('icon_url', { length: 500 }),
  lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const intelItems = pgTable('intel_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  sourceId: uuid('source_id').notNull().references(() => intelSources.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 500 }).notNull(),
  description: text('description'),
  url: varchar('url', { length: 2000 }).notNull(),
  imageUrl: varchar('image_url', { length: 2000 }),
  author: varchar('author', { length: 200 }),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
  isRead: boolean('is_read').default(false).notNull(),
  isBookmarked: boolean('is_bookmarked').default(false).notNull(),
  category: varchar('category', { length: 50 }),
  summary: text('summary'),
  relevanceScore: integer('relevance_score'),
  fullContent: text('full_content'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('intel_items_url_idx').on(table.url),
  index('intel_items_published_at_idx').on(table.publishedAt),
  index('intel_items_source_id_idx').on(table.sourceId),
  index('intel_items_category_idx').on(table.category),
  index('intel_items_relevance_score_idx').on(table.relevanceScore),
]);

export const intelBriefTypeEnum = pgEnum('intel_brief_type', ['daily', 'weekly']);

export const intelBriefs = pgTable('intel_briefs', {
  id: uuid('id').defaultRandom().primaryKey(),
  type: intelBriefTypeEnum('type').notNull(),
  date: varchar('date', { length: 10 }).notNull(),
  content: text('content').notNull(),
  articleCount: integer('article_count').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('intel_briefs_type_date_idx').on(table.type, table.date),
]);
