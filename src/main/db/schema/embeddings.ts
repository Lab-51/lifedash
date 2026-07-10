// === FILE PURPOSE ===
// Schema for the V3.4 semantic layer: the `embeddings` store (vector index over
// briefs, cards, and transcript chunks) and the single-row `embedding_index_meta`
// provenance record.
//
// === WHY vector(768) ===
// EMBEDDING_DIM is the SINGLE source of truth for the vector dimension. It was
// MEASURED (not guessed) against the user's chosen local embedding model
// (`text-embedding-embeddinggemma-300m`, multilingual, 768-dim) during the V3.4
// preflight — see src/main/db/__tests__/pgvector.test.ts. The migration, the
// pgvector proof, and the Task 5 embed pipeline all read this constant so a model
// swap only requires changing it in one place (and rebuilding the index, guarded
// by embedding_index_meta below).
//
// === index-meta provenance ===
// `embedding_index_meta` is a singleton (one-row) table, EMPTY at migration time.
// Task 4 writes/updates it when it (re)builds the index, recording the model the
// embeddings were actually produced with (the provider-ECHOED `response.model`,
// not the requested id — LM Studio silently routes an invalid embedding id to the
// loaded model and echoes the real one) plus the dimension. Task 4's mismatch
// guard reads this row: "index built with X @ dim D, current model is Y → rebuild".

import { pgTable, uuid, varchar, text, integer, timestamp, index, pgEnum, vector } from 'drizzle-orm/pg-core';
import { meetings } from './meetings';
import { projects } from './projects';

/**
 * MEASURED embedding dimension for `text-embedding-embeddinggemma-300m` (768).
 * The single source of truth for the vector column width and Task 5's length
 * validation. Never hardcode a different value; a model swap changes it here.
 */
export const EMBEDDING_DIM = 768;

/** The one valid primary-key value — embedding_index_meta holds a single row. */
export const EMBEDDING_INDEX_META_ID = 'singleton';

/** What an embedding row indexes. Polymorphic: entityId points at the matching
 *  table (meeting_briefs / cards / transcripts) — no single FK, so entityId is a
 *  bare uuid. meetingId/projectId below are the denormalized filter/group keys. */
export const embeddingEntityTypeEnum = pgEnum('embedding_entity_type', ['brief', 'card', 'transcript_chunk']);

export const embeddings = pgTable(
  'embeddings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    entityType: embeddingEntityTypeEnum('entity_type').notNull(),
    // Polymorphic reference to the source row (brief/card/transcript). No FK —
    // it spans three tables; cleanup rides the denormalized meetingId FK cascade
    // for session-derived rows, and Task 4 prunes card rows on card delete.
    entityId: uuid('entity_id').notNull(),
    // 0 for whole-entity embeddings; >0 for chunked transcript segments.
    chunkIndex: integer('chunk_index').default(0).notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIM }).notNull(),
    // Denormalized for filter/group without a join. meetingId cascades so a
    // deleted session takes its embeddings with it; projectId nulls out.
    meetingId: uuid('meeting_id').references(() => meetings.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('embeddings_entity_idx').on(table.entityType, table.entityId),
    index('embeddings_meeting_idx').on(table.meetingId),
    index('embeddings_project_idx').on(table.projectId),
  ],
);

/**
 * Single-row provenance record for the embedding index. EMPTY after the
 * migration; Task 4 upserts on {@link EMBEDDING_INDEX_META_ID} at build time with
 * the echoed model + dim so the rebuild-on-mismatch guard has something to compare.
 */
export const embeddingIndexMeta = pgTable('embedding_index_meta', {
  id: varchar('id', { length: 32 }).primaryKey().default(EMBEDDING_INDEX_META_ID),
  // The provider-echoed model id (response.model), NOT the requested id.
  model: varchar('model', { length: 255 }).notNull(),
  dimensions: integer('dimensions').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
