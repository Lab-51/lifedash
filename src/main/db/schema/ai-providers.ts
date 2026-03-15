// === FILE PURPOSE ===
// Schema for AI provider configuration and usage tracking tables.
// ai_providers stores configured LLM providers with encrypted API keys.
// ai_usage is an append-only log of AI API calls for cost tracking.

import { pgTable, uuid, varchar, text, boolean, integer, real, timestamp } from 'drizzle-orm/pg-core';

export const aiProviders = pgTable('ai_providers', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  displayName: varchar('display_name', { length: 255 }),
  enabled: boolean('enabled').default(true).notNull(),
  apiKeyEncrypted: text('api_key_encrypted'),
  baseUrl: varchar('base_url', { length: 500 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const aiUsage = pgTable('ai_usage', {
  id: uuid('id').defaultRandom().primaryKey(),
  providerId: uuid('provider_id'),
  model: varchar('model', { length: 255 }).notNull(),
  taskType: varchar('task_type', { length: 100 }).notNull(),
  promptTokens: integer('prompt_tokens').notNull(),
  completionTokens: integer('completion_tokens').notNull(),
  totalTokens: integer('total_tokens').notNull(),
  estimatedCost: real('estimated_cost'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
