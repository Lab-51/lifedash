// === FILE PURPOSE ===
// Factory reset against a real migrated PGlite database (TWIN-LOOP.2 Task 4). The old reset
// deleted a hand-listed ~35 tables with no transaction and left the twin's profile and facts,
// entities, calendar events and the search index behind. Contract: every schema table is
// emptied in ONE transaction, drizzle's migrations table is untouched, a failure changes nothing.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { getTableColumns, is, sql } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from '../../db/schema';
import { boards, cards, columns, meetings, projects, twinFacts } from '../../db/schema';

vi.mock('../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
const holder = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof drizzle> }));
vi.mock('../../db/connection', () => ({ getDb: () => holder.db }));
const ipc = vi.hoisted(() => ({ handlers: new Map<string, () => Promise<unknown>>() }));
vi.mock('electron', () => ({
  app: { getPath: () => '' },
  dialog: {},
  shell: {},
  ipcMain: { handle: (channel: string, fn: () => Promise<unknown>) => ipc.handlers.set(channel, fn) },
}));

import { factoryResetAllTables, getFactoryResetTableNames } from '../factoryReset';
import { getBackupTables, EXCLUDED_FROM_BACKUP } from '../backupSchema';
import { registerSettingsHandlers } from '../../ipc/settings';

let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite({ extensions: { vector } });
  holder.db = drizzle(pg, { schema });
  await migrate(holder.db as never, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  registerSettingsHandlers({} as never);
});

beforeEach(async () => {
  await pg.query('TRUNCATE TABLE ' + getFactoryResetTableNames().join(', ') + ' CASCADE');
});

async function rowCount(tableName: string): Promise<number> {
  const res = await pg.query<{ n: string }>(`SELECT count(*)::text AS n FROM "${tableName}"`);
  return Number(res.rows[0].n);
}

async function countAll(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const name of getFactoryResetTableNames()) out[name] = await rowCount(name);
  return out;
}

const migrationRows = async () =>
  (await pg.query<{ n: string }>('SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations')).rows[0].n;

/** A minimal valid row: only the NOT NULL columns without a default, typed from column metadata. */
function minimalRow(table: PgTable): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [key, col] of Object.entries(getTableColumns(table))) {
    if (!col.notNull || col.hasDefault) continue;
    const c = col as unknown as { dataType: string; columnType: string; enumValues?: string[]; dimensions?: number };
    if (c.enumValues?.length) row[key] = c.enumValues[0];
    else if (c.columnType === 'PgUUID') row[key] = crypto.randomUUID();
    else if (c.columnType === 'PgVector') row[key] = new Array(c.dimensions).fill(0);
    else if (c.dataType === 'string') row[key] = 'x';
    else if (c.dataType === 'number') row[key] = 1;
    else if (c.dataType === 'boolean') row[key] = false;
    else if (c.dataType === 'date') row[key] = new Date();
    else if (c.dataType === 'json') row[key] = {};
    else throw new Error(`seed: no value for ${getTableConfig(table).name}.${key} (${c.columnType})`);
  }
  return row;
}

/** One row in EVERY schema table; FKs are not enforced while seeding (rows only need to exist). */
async function seedEveryTable(): Promise<void> {
  await holder.db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL session_replication_role = replica`);
    for (const { table } of getBackupTables()) await tx.insert(table).values(minimalRow(table));
  });
}

describe('factory reset - table list', () => {
  it('guard: covers every pgTable exported by the schema, the search index included', () => {
    const exported = (Object.values(schema) as unknown[])
      .filter((value): value is PgTable => is(value, PgTable))
      .map((table) => getTableConfig(table).name);
    expect(exported.length).toBeGreaterThan(40);
    const listed = new Set(getFactoryResetTableNames());
    expect(exported.filter((name) => !listed.has(name))).toEqual([]);
    // Backup skips these on purpose; a reset must not.
    for (const key of EXCLUDED_FROM_BACKUP) {
      const t = (schema as unknown as Record<string, PgTable>)[key];
      expect(listed.has(getTableConfig(t).name)).toBe(true);
    }
  });

  it('guard: covers every table that exists in the migrated database, not only the schema exports', async () => {
    const res = await pg.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    const listed = new Set(getFactoryResetTableNames());
    expect(res.rows.map((r) => r.table_name).filter((name) => !listed.has(name))).toEqual([]);
  });
});

describe('factory reset - on a real database', () => {
  it('empties every schema table and leaves the migrations table intact', async () => {
    await seedEveryTable();
    const before = await countAll();
    expect(Object.values(before).every((n) => n === 1)).toBe(true); // the seed really reached every table
    const migrationsBefore = await migrationRows();

    await factoryResetAllTables();

    const after = await countAll();
    expect(Object.values(after).every((n) => n === 0)).toBe(true);
    expect(await migrationRows()).toBe(migrationsBefore);
    expect(Number(migrationsBefore)).toBeGreaterThan(0);
  });

  it('clears the undeclared FK cards.source_meeting_id and a purged twin tombstone', async () => {
    const [p] = await holder.db.insert(projects).values({ name: 'P' }).returning();
    const [b] = await holder.db.insert(boards).values({ projectId: p.id, name: 'B' }).returning();
    const [col] = await holder.db.insert(columns).values({ boardId: b.id, name: 'C' }).returning();
    const [m] = await holder.db.insert(meetings).values({ title: 'M', startedAt: new Date() }).returning();
    await holder.db.insert(cards).values({ columnId: col.id, title: 'K', sourceMeetingId: m.id });
    await holder.db.insert(twinFacts).values({
      fact: '',
      category: 'person',
      status: 'forgotten',
      fingerprint: 'a'.repeat(64),
      purgedAt: new Date(),
    });

    await factoryResetAllTables();

    for (const name of ['cards', 'meetings', 'columns', 'boards', 'projects', 'twin_facts']) {
      expect(await rowCount(name)).toBe(0);
    }
  });

  it('a failure mid-reset rolls back: every row is still there', async () => {
    await seedEveryTable();
    const before = await countAll();
    const real = holder.db;
    // The TRUNCATE really runs inside the transaction, then the transaction body throws.
    holder.db = new Proxy(real, {
      get(target, prop, receiver) {
        if (prop !== 'transaction') return Reflect.get(target, prop, receiver);
        return (cb: (tx: unknown) => Promise<unknown>) =>
          target.transaction(async (tx) =>
            cb(
              new Proxy(tx, {
                get(t, p, r) {
                  if (p !== 'execute') return Reflect.get(t, p, r);
                  return async (...args: Parameters<typeof tx.execute>) => {
                    await tx.execute(...args);
                    throw new Error('forced failure after the truncate ran');
                  };
                },
              }),
            ),
          );
      },
    });
    try {
      await expect(factoryResetAllTables()).rejects.toThrow('forced failure');
    } finally {
      holder.db = real;
    }
    expect(await countAll()).toEqual(before);
  });
});

describe('settings:factory-reset handler', () => {
  it('keeps the { success } / { success: false, error } contract', async () => {
    await seedEveryTable();
    const handler = ipc.handlers.get('settings:factory-reset')!;
    expect(await handler()).toEqual({ success: true });
    expect(Object.values(await countAll()).every((n) => n === 0)).toBe(true);

    const real = holder.db;
    holder.db = new Proxy(real, {
      get(target, prop, receiver) {
        if (prop === 'transaction') return () => Promise.reject(new Error('boom'));
        return Reflect.get(target, prop, receiver);
      },
    });
    try {
      expect(await handler()).toEqual({ success: false, error: 'boom' });
    } finally {
      holder.db = real;
    }
  });
});
