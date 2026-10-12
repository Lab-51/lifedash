// === FILE PURPOSE ===
// Backup and restore against a real migrated PGlite database and real backup files.
// The contract (BACKUP-SAFE.1): a restore replaces what the backup holds and never
// destroys what it does not — the old restore cascade-deleted entity facts/links,
// checklist items and agent threads for every meeting and card, and dropped every
// API key. Rows whose parent is genuinely gone follow that FK's on-delete rule.

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, sql } from 'drizzle-orm';
import * as schema from '../../db/schema';
import {
  aiProviders,
  boards,
  cardChecklistItems,
  cards,
  columns,
  embeddings,
  entities,
  entityFacts,
  entityLinks,
  meetings,
  projects,
  settings,
  twinFacts,
} from '../../db/schema';

vi.mock('../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
const holder = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof drizzle> }));
vi.mock('../../db/connection', () => ({ getDb: () => holder.db }));
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lifedash-backup-restore-'));
vi.mock('electron', () => ({ app: { getPath: () => tmpRoot } }));

import { createBackup, restoreBackup, listBackups, cleanOldBackups } from '../backupService';
import { getBackupTables } from '../backupSchema';

/** The 21 tables a v1 (pre-BACKUP-SAFE.1) backup held. */
const V1_TABLES = [
  'projects',
  'settings',
  'aiProviders',
  'boards',
  'labels',
  'columns',
  'meetings',
  'ideas',
  'brainstormSessions',
  'cards',
  'aiUsage',
  'transcripts',
  'meetingBriefs',
  'actionItems',
  'cardLabels',
  'cardComments',
  'cardRelationships',
  'cardActivities',
  'cardAttachments',
  'ideaTags',
  'brainstormMessages',
];

beforeAll(async () => {
  const pg = new PGlite({ extensions: { vector } });
  holder.db = drizzle(pg, { schema });
  await migrate(holder.db as never, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
});

afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

beforeEach(async () => {
  for (const t of [...getBackupTables()].reverse()) await holder.db.delete(t.table);
  fs.rmSync(path.join(tmpRoot, 'backups'), { recursive: true, force: true });
});

async function seedMeeting(title: string): Promise<string> {
  const [m] = await holder.db.insert(meetings).values({ title, startedAt: new Date() }).returning();
  return m.id;
}

async function seedCard(columnId: string, title: string): Promise<string> {
  const [c] = await holder.db.insert(cards).values({ columnId, title }).returning();
  return c.id;
}

async function seedColumn(): Promise<string> {
  const [p] = await holder.db.insert(projects).values({ name: 'P' }).returning();
  const [b] = await holder.db.insert(boards).values({ projectId: p.id, name: 'B' }).returning();
  const [c] = await holder.db.insert(columns).values({ boardId: b.id, name: 'C' }).returning();
  return c.id;
}

/** Everything a meeting carries that a v1 backup never held. */
async function seedMeetingKnowledge(meetingId: string, label: string): Promise<string> {
  const [entity] = await holder.db
    .insert(entities)
    .values({ name: label, normalizedName: label.toLowerCase(), kind: 'person' })
    .returning();
  await holder.db.insert(entityLinks).values({ entityId: entity.id, meetingId });
  await holder.db
    .insert(entityFacts)
    .values({ entityId: entity.id, content: `${label} fact`, sourceMeetingId: meetingId });
  await holder.db
    .insert(twinFacts)
    .values({ fact: `${label} twin fact`, category: 'person', sourceMeetingId: meetingId });
  return entity.id;
}

/** A v1 file exactly as the old createBackup wrote it: 21 tables, no API keys. */
async function writeV1Backup(): Promise<string> {
  const byKey = new Map(getBackupTables().map((t) => [t.key, t]));
  const tables: Record<string, unknown[]> = {};
  for (const key of V1_TABLES) {
    const rows = (await holder.db.select().from(byKey.get(key)!.table)) as Record<string, unknown>[];
    tables[key] = rows.map((row) => {
      const copy = { ...row };
      delete copy.apiKeyEncrypted;
      return copy;
    });
  }
  const file = path.join(tmpRoot, 'v1-backup.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, createdAt: new Date().toISOString(), tableCount: 21, tables }));
  return file;
}

describe('backupSchema', () => {
  it('covers every schema table once, parents before children, and leaves only the search index out', () => {
    const tables = getBackupTables();
    const keys = tables.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(48);
    const position = new Map(keys.map((key, i) => [key, i]));
    for (const t of tables)
      for (const fk of t.fks) expect(position.get(fk.parentKey)!).toBeLessThan(position.get(t.key)!);
    expect(
      tables
        .filter((t) => !t.includedInBackup)
        .map((t) => t.key)
        .sort(),
    ).toEqual(['embeddingIndexMeta', 'embeddings']);
  });
});

describe('restoring a v1 backup (21 tables) over newer data', () => {
  it('keeps knowledge, checklist items and API keys for rows the backup holds; drops only what lost its parent', async () => {
    const columnId = await seedColumn();
    const kept = await seedMeeting('kept meeting');
    const keptEntity = await seedMeetingKnowledge(kept, 'Alice');
    const keptCard = await seedCard(columnId, 'kept card');
    await holder.db.insert(cardChecklistItems).values({ cardId: keptCard, title: 'kept item' });
    const [provider] = await holder.db
      .insert(aiProviders)
      .values({ name: 'openai', apiKeyEncrypted: 'encrypted-key' })
      .returning();
    const file = await writeV1Backup();

    // After the backup: a new meeting and card, each with their own dependents.
    const gone = await seedMeeting('meeting created after the backup');
    await seedMeetingKnowledge(gone, 'Bob');
    const goneCard = await seedCard(columnId, 'card created after the backup');
    await holder.db.insert(cardChecklistItems).values({ cardId: goneCard, title: 'gone item' });

    await restoreBackup(file);

    expect((await holder.db.select().from(meetings)).map((m) => m.id)).toEqual([kept]);
    // Kept meeting: its links, facts and twin facts survive the restore (the old restore wiped them).
    expect(await holder.db.select().from(entityLinks).where(eq(entityLinks.meetingId, kept))).toHaveLength(1);
    expect(await holder.db.select().from(entityFacts).where(eq(entityFacts.entityId, keptEntity))).toHaveLength(1);
    expect((await holder.db.select().from(twinFacts)).map((f) => f.fact).sort()).toEqual([
      'Alice twin fact',
      'Bob twin fact', // set null: the twin fact outlives its meeting, unlinked
    ]);
    expect(
      (await holder.db.select().from(twinFacts).where(eq(twinFacts.fact, 'Bob twin fact')))[0].sourceMeetingId,
    ).toBeNull();
    // Gone meeting: cascade rules remove what hung off it.
    expect(await holder.db.select().from(entityLinks).where(eq(entityLinks.meetingId, gone))).toHaveLength(0);
    expect(await holder.db.select().from(entityFacts).where(eq(entityFacts.sourceMeetingId, gone))).toHaveLength(0);
    // Checklist: kept card's item survives, the newer card's item goes with its card.
    expect((await holder.db.select().from(cardChecklistItems)).map((i) => i.title)).toEqual(['kept item']);
    // API key carried over even though the backup never contained it.
    const [restoredProvider] = await holder.db.select().from(aiProviders).where(eq(aiProviders.id, provider.id));
    expect(restoredProvider.apiKeyEncrypted).toBe('encrypted-key');
  });
});

describe('a v2 backup', () => {
  it('round-trips every table it holds and keeps the search index rows of surviving meetings', async () => {
    const meetingId = await seedMeeting('2026-10-10T12:00:00Z'); // a date-like TITLE must stay text
    await seedMeetingKnowledge(meetingId, 'Carol');
    await holder.db.insert(embeddings).values({
      entityType: 'brief',
      entityId: meetingId,
      content: 'chunk',
      embedding: Array.from({ length: 768 }, () => 0.1),
      meetingId,
    });
    const backup = await createBackup();
    const written = JSON.parse(fs.readFileSync(backup.filePath, 'utf-8'));
    expect(written.version).toBe(2);
    expect(Object.keys(written.tables)).toHaveLength(46);

    await holder.db.delete(twinFacts);
    await seedMeeting('created after the backup');

    await restoreBackup(backup.filePath);

    const restored = await holder.db.select().from(meetings);
    expect(restored.map((m) => m.title)).toEqual(['2026-10-10T12:00:00Z']);
    expect(await holder.db.select().from(twinFacts)).toHaveLength(1);
    expect(await holder.db.select().from(entityFacts)).toHaveLength(1);
    expect(await holder.db.select().from(embeddings)).toHaveLength(1);
  });
});

describe('refusals leave the database untouched', () => {
  it('refuses a backup naming a table this version does not know', async () => {
    await seedMeeting('still here');
    const file = path.join(tmpRoot, 'future.json');
    fs.writeFileSync(
      file,
      JSON.stringify({ version: 2, createdAt: '', tableCount: 1, tables: { meetings: [], futureTable: [] } }),
    );

    await expect(restoreBackup(file)).rejects.toThrow(/futureTable/);
    expect(await holder.db.select().from(meetings)).toHaveLength(1);
  });

  it('aborts when the safety backup cannot be written', async () => {
    await seedMeeting('still here');
    const backup = await createBackup();
    await seedMeeting('also still here');
    const writeSpy = vi.spyOn(fs.promises, 'writeFile').mockRejectedValueOnce(new Error('disk full'));

    await expect(restoreBackup(backup.filePath)).rejects.toThrow(/safety backup/);
    expect(await holder.db.select().from(meetings)).toHaveLength(2);
    writeSpy.mockRestore();
  });
});

describe('review findings (BACKUP-SAFE.1 adversarial review)', () => {
  it('knows every foreign key the database enforces, including ones the drizzle schema does not declare', async () => {
    const result = await holder.db.execute(
      sql`SELECT conrelid::regclass::text AS child, a.attname AS col, confrelid::regclass::text AS parent
          FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
          WHERE c.contype = 'f'`,
    );
    const unquote = (s: string) => s.replace(/"/g, '');
    const inDb = (result.rows as { child: string; col: string; parent: string }[])
      .map((r) => `${unquote(r.child)}.${r.col}->${unquote(r.parent)}`)
      .sort();
    const tables = getBackupTables();
    const sqlNameOf = new Map(tables.map((t) => [t.key, t.sqlName]));
    const inMetadata = tables
      .flatMap((t) =>
        [...t.fks, ...t.selfFks].map((fk) => `${t.sqlName}.${fk.columnSql}->${sqlNameOf.get(fk.parentKey)}`),
      )
      .sort();
    expect(inMetadata).toEqual(inDb);
  });

  it('restores a card whose source meeting is not in the backup, unlinking it instead of failing', async () => {
    const columnId = await seedColumn();
    const meetingId = await seedMeeting('source meeting');
    await holder.db.insert(cards).values({ columnId, title: 'auto card', sourceMeetingId: meetingId });
    const backup = await createBackup();
    const data = JSON.parse(fs.readFileSync(backup.filePath, 'utf-8'));
    data.tables.meetings = []; // a dump where the card's meeting is missing
    const file = path.join(tmpRoot, 'card-without-meeting.json');
    fs.writeFileSync(file, JSON.stringify(data));

    await restoreBackup(file);

    const [card] = await holder.db.select().from(cards);
    expect(card.title).toBe('auto card');
    expect(card.sourceMeetingId).toBeNull();
  });

  it('merges settings: machine state is never rolled back or removed, user choices are restored', async () => {
    await holder.db.insert(settings).values([
      { key: 'sync.refreshToken', value: 'token-at-backup-time' },
      { key: 'ui.theme', value: 'dark' },
    ]);
    const backup = await createBackup();
    await holder.db.update(settings).set({ value: 'current-token' }).where(eq(settings.key, 'sync.refreshToken'));
    await holder.db.update(settings).set({ value: 'light' }).where(eq(settings.key, 'ui.theme'));
    await holder.db.insert(settings).values([
      { key: 'maintenance:recording-orphan-sweep:v1', value: 'true' }, // written after the backup
      { key: 'ui.newPreference', value: 'kept' },
    ]);

    await restoreBackup(backup.filePath);

    const value = async (key: string) =>
      (await holder.db.select().from(settings).where(eq(settings.key, key)))[0]?.value;
    expect(await value('maintenance:recording-orphan-sweep:v1')).toBe('true'); // sweep must not re-arm
    expect(await value('sync.refreshToken')).toBe('current-token');
    expect(await value('ui.theme')).toBe('dark');
    expect(await value('ui.newPreference')).toBe('kept');
  });

  it('undoing a restore through the safety backup keeps every API key', async () => {
    await holder.db.insert(aiProviders).values({ name: 'old', apiKeyEncrypted: 'k-old' });
    const backup = await createBackup();
    const original = path.join(tmpRoot, 'original.json');
    fs.renameSync(backup.filePath, original); // keep the backups folder for the safety backup alone
    await holder.db.insert(aiProviders).values({ name: 'new', apiKeyEncrypted: 'k-new' });

    await restoreBackup(original);
    expect((await holder.db.select().from(aiProviders)).map((p) => p.name)).toEqual(['old']);
    const [safety] = await listBackups();
    await restoreBackup(safety.filePath);

    const providers = await holder.db.select().from(aiProviders);
    expect(providers.map((p) => [p.name, p.apiKeyEncrypted]).sort()).toEqual([
      ['new', 'k-new'],
      ['old', 'k-old'],
    ]);
  });

  it('refuses a file that tries to replace the search index', async () => {
    await seedMeeting('still here');
    const file = path.join(tmpRoot, 'with-index.json');
    fs.writeFileSync(file, JSON.stringify({ version: 2, createdAt: '', tableCount: 1, tables: { embeddings: [] } }));

    await expect(restoreBackup(file)).rejects.toThrow(/embeddings/);
    expect(await holder.db.select().from(meetings)).toHaveLength(1);
  });
});

describe('review round 2 findings', () => {
  it('never rolls back the auto-backup schedule or the calendar client a token is bound to', async () => {
    await holder.db.insert(settings).values([
      { key: 'autoBackup.retention', value: '5' },
      { key: 'autoBackup.lastRun', value: '2026-01-01T00:00:00.000Z' },
      { key: 'calendar:google:client', value: 'OLD-CLIENT' },
    ]);
    const backup = await createBackup();
    await holder.db.update(settings).set({ value: '30' }).where(eq(settings.key, 'autoBackup.retention'));
    await holder.db.update(settings).set({ value: 'today' }).where(eq(settings.key, 'autoBackup.lastRun'));
    await holder.db.update(settings).set({ value: 'NEW-CLIENT' }).where(eq(settings.key, 'calendar:google:client'));

    await restoreBackup(backup.filePath);

    const value = async (key: string) =>
      (await holder.db.select().from(settings).where(eq(settings.key, key)))[0]?.value;
    expect(await value('autoBackup.retention')).toBe('30'); // an old retention would delete newer backups
    expect(await value('autoBackup.lastRun')).toBe('today');
    expect(await value('calendar:google:client')).toBe('NEW-CLIENT');
  });

  it("keeps this machine's twin fingerprint key over another machine's key in the file", async () => {
    await holder.db.insert(settings).values({ key: 'twin.fingerprintKey', value: 'OTHER-MACHINE-CIPHERTEXT' });
    const backup = await createBackup();
    await holder.db
      .update(settings)
      .set({ value: 'THIS-MACHINE-CIPHERTEXT' })
      .where(eq(settings.key, 'twin.fingerprintKey'));

    await restoreBackup(backup.filePath);

    const [row] = await holder.db.select().from(settings).where(eq(settings.key, 'twin.fingerprintKey'));
    expect(row?.value).toBe('THIS-MACHINE-CIPHERTEXT');
  });

  it("keeps this machine's working API key over a key carried in the file", async () => {
    const [provider] = await holder.db
      .insert(aiProviders)
      .values({ name: 'openai', apiKeyEncrypted: 'MACHINE-B-WORKING' })
      .returning();
    const backup = await createBackup();
    const data = JSON.parse(fs.readFileSync(backup.filePath, 'utf-8'));
    data.tables.aiProviders[0].apiKeyEncrypted = 'MACHINE-A-BLOB'; // e.g. a safety file from another PC
    const file = path.join(tmpRoot, 'other-machine.json');
    fs.writeFileSync(file, JSON.stringify(data));

    await restoreBackup(file);

    const [restored] = await holder.db.select().from(aiProviders).where(eq(aiProviders.id, provider.id));
    expect(restored.apiKeyEncrypted).toBe('MACHINE-B-WORKING');
  });

  it('the safety backup never overwrites the file being restored, even within the same second', async () => {
    await seedMeeting('m');
    const backup = await createBackup();
    const before = fs.readFileSync(backup.filePath, 'utf-8');

    await restoreBackup(backup.filePath);

    expect(fs.readFileSync(backup.filePath, 'utf-8')).toBe(before);
    const names = (await listBackups()).map((b) => b.fileName);
    expect(names).toContain(backup.fileName);
    expect(names.some((n) => n.endsWith('-pre-restore.json'))).toBe(true);
  });
});

describe('review round 3 findings', () => {
  it('never loosens a privacy control the user has since tightened', async () => {
    await holder.db.insert(settings).values([
      { key: 'transcription:localOnly', value: 'false' },
      { key: 'diagnostics.sendCrashReports', value: 'true' },
    ]);
    const backup = await createBackup();
    await holder.db.update(settings).set({ value: 'true' }).where(eq(settings.key, 'transcription:localOnly'));
    await holder.db.update(settings).set({ value: 'false' }).where(eq(settings.key, 'diagnostics.sendCrashReports'));

    await restoreBackup(backup.filePath);

    const value = async (key: string) =>
      (await holder.db.select().from(settings).where(eq(settings.key, key)))[0]?.value;
    expect(await value('transcription:localOnly')).toBe('true');
    expect(await value('diagnostics.sendCrashReports')).toBe('false');
  });

  it('retention counts regular backups only and keeps just the newest pre-restore file', async () => {
    const dir = path.join(tmpRoot, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const names = [
      'backup-2026-10-01-00-00-00.json',
      'backup-2026-10-02-00-00-00.json',
      'backup-2026-10-03-00-00-00.json',
      'backup-2026-10-04-00-00-00-pre-restore.json',
      'backup-2026-10-05-00-00-00-pre-restore.json',
    ];
    names.forEach((name, i) => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, '{}');
      const t = new Date(Date.UTC(2026, 9, 1 + i));
      fs.utimesSync(file, t, t); // listBackups sorts by mtime
    });

    await cleanOldBackups(2);

    expect(fs.readdirSync(dir).sort()).toEqual([
      'backup-2026-10-02-00-00-00.json',
      'backup-2026-10-03-00-00-00.json',
      'backup-2026-10-05-00-00-00-pre-restore.json',
    ]);
  });
});
