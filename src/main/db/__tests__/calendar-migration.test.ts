// Phase G, Task 1 — prove migration 0043 applies cleanly on a FRESH DB (mirrors the
// pgvector migration harness). Confirms the calendar_events cache table and the two
// nullable meetings columns land, and that the varchar-PK + jsonb row round-trips.
// CAL-UX.2b extends this with migration 0045's nullable `description` column.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '../schema';
import { calendarEvents } from '../schema';

type Db = ReturnType<typeof drizzle<typeof schema>>;

describe('migration 0043 — calendar_events + meetings calendar columns (real PGlite)', () => {
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

  it('creates the calendar_events table', async () => {
    const res = await pg.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'calendar_events'`,
    );
    expect(res.rows).toHaveLength(1);
  });

  it('adds the two nullable calendar columns to meetings', async () => {
    const res = await pg.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_name = 'meetings' AND column_name IN ('calendar_event_id', 'calendar_series_id')`,
    );
    expect(res.rows.map((r) => r.column_name).sort()).toEqual(['calendar_event_id', 'calendar_series_id']);
    expect(res.rows.every((r) => r.is_nullable === 'YES')).toBe(true);
  });

  it('round-trips a cached event through the varchar PK + jsonb attendees', async () => {
    const [row] = await db
      .insert(calendarEvents)
      .values({
        id: 'google:evt-1',
        provider: 'google',
        eventId: 'evt-1',
        title: 'Weekly sync',
        startsAt: new Date('2026-08-01T10:00:00Z'),
        endsAt: new Date('2026-08-01T10:30:00Z'),
        attendees: [{ name: 'Ada', email: 'ada@example.com' }],
        seriesId: 'google:series-9',
      })
      .returning();

    expect(row.id).toBe('google:evt-1');
    expect(row.provider).toBe('google');
    expect(row.attendees).toEqual([{ name: 'Ada', email: 'ada@example.com' }]);
    expect(row.seriesId).toBe('google:series-9');
    // Migration 0045 (CAL-UX.2b): nullable, so an event without one inserts as NULL.
    expect(row.description).toBeNull();
  });

  it('adds the nullable description column (migration 0045) and round-trips long text', async () => {
    const res = await pg.query<{ data_type: string; is_nullable: string }>(
      `SELECT data_type, is_nullable FROM information_schema.columns
        WHERE table_name = 'calendar_events' AND column_name = 'description'`,
    );
    expect(res.rows).toEqual([{ data_type: 'text', is_nullable: 'YES' }]);

    // `text`, not varchar(n): the 4000-char provider cap is the only length limit.
    const description = 'A'.repeat(4000);
    const [row] = await db
      .insert(calendarEvents)
      .values({
        id: 'google:evt-2',
        provider: 'google',
        eventId: 'evt-2',
        title: 'Described',
        startsAt: new Date('2026-08-01T11:00:00Z'),
        endsAt: new Date('2026-08-01T11:30:00Z'),
        attendees: [],
        description,
      })
      .returning();

    expect(row.description).toBe(description);
  });
});
