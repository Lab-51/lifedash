// BRAIN-UX.1, Task 1 — prove migration 0044 applies cleanly on a FRESH DB (mirrors
// the calendar migration harness). Confirms the entity_facts table lands with its
// FKs, and that its cascade-on-meeting-delete provenance guarantee actually holds:
// deleting a fact's source meeting removes the fact structurally (never leaves an
// orphaned, unprovenanced row).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '../schema';
import { entities, entityFacts, meetings } from '../schema';

type Db = ReturnType<typeof drizzle<typeof schema>>;

describe('migration 0044 — entity_facts (real PGlite)', () => {
  let pg: PGlite;
  let db: Db;

  beforeAll(async () => {
    pg = new PGlite({ extensions: { vector } });
    db = drizzle(pg, { schema });
    await migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  });

  afterAll(async () => {
    await pg.close();
  });

  it('creates the entity_facts table', async () => {
    const res = await pg.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'entity_facts'`,
    );
    expect(res.rows).toHaveLength(1);
  });

  it('has entity_id and source_meeting_id as NOT NULL foreign keys', async () => {
    const res = await pg.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_name = 'entity_facts' AND column_name IN ('entity_id', 'source_meeting_id')`,
    );
    expect(res.rows.map((r) => r.column_name).sort()).toEqual(['entity_id', 'source_meeting_id']);
    expect(res.rows.every((r) => r.is_nullable === 'NO')).toBe(true);
  });

  it('round-trips a fact row, joined back to its entity and source meeting', async () => {
    const [entity] = await db
      .insert(entities)
      .values({ name: 'Ada Lovelace', normalizedName: 'ada lovelace', kind: 'person' })
      .returning();
    const [meeting] = await db
      .insert(meetings)
      .values({ title: 'Weekly sync', startedAt: new Date('2026-08-01T10:00:00Z'), status: 'completed' })
      .returning();

    const [fact] = await db
      .insert(entityFacts)
      .values({ entityId: entity.id, content: 'Ada leads the analytics engine rewrite.', sourceMeetingId: meeting.id })
      .returning();

    expect(fact.entityId).toBe(entity.id);
    expect(fact.sourceMeetingId).toBe(meeting.id);
    expect(fact.content).toBe('Ada leads the analytics engine rewrite.');
  });

  it('cascades delete: removing the source meeting removes its entity facts', async () => {
    const [entity] = await db
      .insert(entities)
      .values({ name: 'Project Nimbus', normalizedName: 'project nimbus', kind: 'topic' })
      .returning();
    const [meeting] = await db
      .insert(meetings)
      .values({ title: 'Nimbus kickoff', startedAt: new Date('2026-08-02T10:00:00Z'), status: 'completed' })
      .returning();
    const [fact] = await db
      .insert(entityFacts)
      .values({ entityId: entity.id, content: 'Nimbus ships in Q4.', sourceMeetingId: meeting.id })
      .returning();

    await db.delete(meetings).where(eq(meetings.id, meeting.id));

    const remaining = await db.select().from(entityFacts).where(eq(entityFacts.id, fact.id));
    expect(remaining).toHaveLength(0);
  });
});
