// TWIN-LOOP.2 Task 3 — prove migration 0053 (twin_facts.fingerprint + purged_at)
// applies on a FRESH database and on an EXISTING one at 0052 that already holds
// twin facts: both columns land nullable, and every pre-existing row survives
// untouched with both new columns NULL (i.e. not purged). The 0052 database is built
// by migrating a copy of drizzle/ whose journal stops at 0052. Fixtures are synthetic.

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

const MIGRATIONS = path.join(process.cwd(), 'drizzle');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lifedash-0053-'));
const opened: PGlite[] = [];

afterAll(async () => {
  for (const pg of opened) await pg.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

/** A copy of drizzle/ whose journal ends at migration `lastIdx`. */
function migrationsUpTo(lastIdx: number): string {
  const dir = path.join(tmpRoot, `upto-${lastIdx}`);
  fs.cpSync(MIGRATIONS, dir, { recursive: true });
  const journalPath = path.join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as { entries: { idx: number }[] };
  journal.entries = journal.entries.filter((e) => e.idx <= lastIdx);
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

async function openDb() {
  const pg = new PGlite({ extensions: { vector } });
  opened.push(pg);
  return { pg, db: drizzle(pg) };
}

async function newColumns(pg: PGlite) {
  const res = await pg.query<{ column_name: string; data_type: string; is_nullable: string }>(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_name = 'twin_facts' AND column_name IN ('fingerprint', 'purged_at') ORDER BY column_name`,
  );
  return res.rows;
}

const EXPECTED_COLUMNS = [
  { column_name: 'fingerprint', data_type: 'text', is_nullable: 'YES' },
  { column_name: 'purged_at', data_type: 'timestamp with time zone', is_nullable: 'YES' },
];

// Each test runs every migration from scratch on real PGlite (the second one twice), which can pass
// vitest's 5 s default under full-suite load — measured 5.1 s in the TWIN-LOOP.2 closing gate.
const MIGRATION_TEST_TIMEOUT_MS = 30_000;

describe('migration 0053 — twin fact purge columns (real PGlite)', () => {
  it('applies on a fresh database', { timeout: MIGRATION_TEST_TIMEOUT_MS }, async () => {
    const { pg, db } = await openDb();
    await migrate(db, { migrationsFolder: MIGRATIONS });
    expect(await newColumns(pg)).toEqual(EXPECTED_COLUMNS);
  });

  it(
    'applies on a database at 0052 and leaves existing facts intact and unpurged',
    { timeout: MIGRATION_TEST_TIMEOUT_MS },
    async () => {
      const { pg, db } = await openDb();
      await migrate(db, { migrationsFolder: migrationsUpTo(52) });
      expect(await newColumns(pg)).toEqual([]); // really at 0052

      await pg.exec(`
      INSERT INTO twin_facts (fact, label, category, status) VALUES
        ('Prefers written agendas.', 'Written agendas', 'preference', 'active'),
        ('Used to run the old pipeline.', NULL, 'project', 'forgotten');
    `);
      const existing = `SELECT id, fact, label, category, status, created_at FROM twin_facts ORDER BY fact`;
      const before = await pg.query(existing);

      await migrate(db, { migrationsFolder: MIGRATIONS });

      expect(await newColumns(pg)).toEqual(EXPECTED_COLUMNS);
      expect((await pg.query(existing)).rows).toEqual(before.rows);
      const purgeColumns = await pg.query<{ fingerprint: string | null; purged_at: Date | null }>(
        `SELECT fingerprint, purged_at FROM twin_facts`,
      );
      expect(purgeColumns.rows).toEqual([
        { fingerprint: null, purged_at: null },
        { fingerprint: null, purged_at: null },
      ]);
    },
  );
});
