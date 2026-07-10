// === FILE PURPOSE ===
// V3.4 preflight HARD GATE: prove the pgvector half empirically against a REAL
// PGlite instance (no mocks). Committing the V3.4 schema before this passes would
// be building on belief. This test proves, end to end:
//   1. the pgvector extension registers from '@electric-sql/pglite/vector' and
//      `CREATE EXTENSION vector` (run inside migration 0041) succeeds;
//   2. the full drizzle migration chain (0000..0041) applies on a FRESH DB and
//      creates twin_facts, embeddings, and embedding_index_meta;
//   3. drizzle's NATIVE `vector({ dimensions: 768 })` column round-trips number[]
//      through insert/select;
//   4. a cosine `<=>` ORDER BY (via drizzle cosineDistance AND raw SQL) returns the
//      correct nearest neighbor.
//
// NOTE ON FILENAME: the story specified `pgvector.spec.ts`, but vitest.config.ts's
// `include` matches only `*.test.ts` — a `.spec.ts` would silently never run. Named
// `.test.ts` so it actually executes under `vitest run pgvector` and `npm test`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { cosineDistance } from 'drizzle-orm';
import * as schema from '../schema';
import { embeddings, EMBEDDING_DIM } from '../schema';

type Db = ReturnType<typeof drizzle<typeof schema>>;

/** A length-`dim` unit vector with 1 at `idx` (a one-hot direction). */
function oneHot(dim: number, idx: number): number[] {
  const v = new Array<number>(dim).fill(0);
  v[idx] = 1;
  return v;
}

describe('pgvector + V3.4 migration (real PGlite, no mocks)', () => {
  let pg: PGlite;
  let db: Db;

  beforeAll(async () => {
    // In-memory PGlite with the pgvector extension binary registered — the same
    // registration connection.ts uses. `CREATE EXTENSION vector` is issued by
    // migration 0041 itself, not here, so this proves the real init path.
    pg = new PGlite({ extensions: { vector } });
    db = drizzle(pg, { schema });
    await migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  });

  afterAll(async () => {
    await pg.close();
  });

  it('locks the measured embedding dimension at 768', () => {
    expect(EMBEDDING_DIM).toBe(768);
  });

  it('registers the pgvector extension', async () => {
    const res = await pg.query<{ extname: string }>(`SELECT extname FROM pg_extension WHERE extname = 'vector'`);
    expect(res.rows).toHaveLength(1);
  });

  it('applies the migration on a fresh DB — twin_facts, embeddings, embedding_index_meta exist', async () => {
    const res = await pg.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename IN ('twin_facts', 'embeddings', 'embedding_index_meta')`,
    );
    const names = res.rows.map((r) => r.tablename).sort();
    expect(names).toEqual(['embedding_index_meta', 'embeddings', 'twin_facts']);
  });

  it('applies migration 0042 on the fresh chain — entities + entity_links exist with a UNIQUE normalized_name', async () => {
    // The Brain's first semantic layer (Task 6). The same fresh-chain migrator path
    // proves 0042 lands cleanly on top of 0041.
    const tables = await pg.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename IN ('entities', 'entity_links')`,
    );
    expect(tables.rows.map((r) => r.tablename).sort()).toEqual(['entities', 'entity_links']);

    // normalized_name is UNIQUE — the dedupe/insert-or-get key entityService relies on.
    const unique = await pg.query(
      `SELECT 1 FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'entities' AND c.contype = 'u'`,
    );
    expect(unique.rows.length).toBeGreaterThanOrEqual(1);

    // The composite (entity_id, meeting_id) primary key makes re-extraction idempotent.
    const pk = await pg.query<{ attname: string }>(
      `SELECT a.attname FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
        WHERE t.relname = 'entity_links' AND c.contype = 'p'`,
    );
    expect(pk.rows.map((r) => r.attname).sort()).toEqual(['entity_id', 'meeting_id']);
  });

  it('declares the embedding column as vector(768)', async () => {
    // pgvector reports its typmod via format_type; confirm the width is 768.
    const res = await pg.query<{ type: string }>(
      `SELECT format_type(a.atttypid, a.atttypmod) AS type
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
        WHERE c.relname = 'embeddings' AND a.attname = 'embedding'`,
    );
    expect(res.rows[0]?.type).toBe('vector(768)');
  });

  it('round-trips a 768-dim vector through drizzle-native insert/select', async () => {
    const vec = oneHot(EMBEDDING_DIM, 5);
    const [row] = await db
      .insert(embeddings)
      .values({ entityType: 'brief', entityId: randomUUID(), content: 'roundtrip', embedding: vec })
      .returning();
    expect(row.embedding).toHaveLength(EMBEDDING_DIM);
    expect(row.embedding[5]).toBe(1);
    // clean up so the nearest-neighbor test below has a known, isolated set
    await db.delete(embeddings);
  });

  it('returns the correct cosine nearest neighbor via drizzle cosineDistance (<=>)', async () => {
    const dirA = oneHot(EMBEDDING_DIM, 0);
    const dirB = oneHot(EMBEDDING_DIM, 1);
    const nearA = oneHot(EMBEDDING_DIM, 0);
    nearA[0] = 0.9;
    nearA[1] = 0.1; // still points mostly along axis 0 → close to A, far from B

    await db.insert(embeddings).values([
      { entityType: 'brief', entityId: randomUUID(), content: 'A', embedding: dirA },
      { entityType: 'brief', entityId: randomUUID(), content: 'B', embedding: dirB },
      { entityType: 'brief', entityId: randomUUID(), content: 'C', embedding: nearA },
    ]);

    const query = oneHot(EMBEDDING_DIM, 0);
    const rows = await db
      .select({ content: embeddings.content })
      .from(embeddings)
      .orderBy(cosineDistance(embeddings.embedding, query))
      .limit(3);

    // A (identical direction) nearest, then C (mostly axis-0), then B (orthogonal).
    expect(rows.map((r) => r.content)).toEqual(['A', 'C', 'B']);
  });

  it('supports the raw cosine `<=>` operator directly (independent of drizzle)', async () => {
    // Build a pgvector literal for the query and order by <=> ascending.
    const query = `[${oneHot(EMBEDDING_DIM, 0).join(',')}]`;
    const res = await pg.query<{ content: string }>(
      `SELECT content FROM embeddings ORDER BY embedding <=> $1 LIMIT 1`,
      [query],
    );
    expect(res.rows[0]?.content).toBe('A');
  });
});
