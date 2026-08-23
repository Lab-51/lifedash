// === FILE PURPOSE ===
// Unit tests for AI-RESIL.1 Task 2 — memory-index hygiene. Against a REAL
// PGlite instance (same convention as embeddingService.test.ts — mocked AI SDK
// embed(), real drizzle schema), proves:
//   - the write-side guard skips sentinel-prefixed brief content on BOTH the
//     post-session hook path (handlePostSession) and the backfill path
//     (runBackfill / collectBackfillJobs) — proven separately, not with one
//     shared assertion;
//   - the guard does NOT skip a normal brief that merely mentions failure
//     mid-text (prefix semantics via isFailedBriefText, never `includes`);
//   - sweepFailedBriefEmbeddings() deletes ONLY sentinel-prefixed `brief`
//     rows — normal briefs and non-brief entity types survive, asserted
//     positively (not just the deleted count);
//   - a second sweep run deletes 0 — the one-shot gate holds, proven by
//     inserting a NEW sentinel row between the two runs so a broken gate
//     would have something to (wrongly) delete.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Mocks (declared before importing the module under test)
// ---------------------------------------------------------------------------

vi.mock('../ai-provider', () => ({ embed: vi.fn(), resolveTaskModel: vi.fn() }));
vi.mock('../recordingState', () => ({ getIsRecording: vi.fn(() => false), setIsRecording: vi.fn() }));
vi.mock('../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));

// ---------------------------------------------------------------------------
// Imports (after mocks) — schema is REAL so drizzle hits the real PGlite tables.
// ---------------------------------------------------------------------------

import * as service from '../embeddingService';
import { getDb } from '../../db/connection';
import { embed, resolveTaskModel } from '../ai-provider';
import * as schema from '../../db/schema';
import { embeddings, embeddingIndexMeta, meetings, meetingBriefs, projects, settings } from '../../db/schema';
import { BRIEF_FAILURE_SENTINEL } from '../../../shared/briefSentinel';

type Db = ReturnType<typeof drizzle<typeof schema>>;
let pg: PGlite;
let db: Db;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function vec768(): number[] {
  return new Array<number>(768).fill(0.0123);
}

function localProvider() {
  return {
    providerId: 'lms',
    providerName: 'lmstudio',
    apiKeyEncrypted: null,
    baseUrl: null,
    model: 'text-embedding-x',
  };
}

/** embed() mock that echoes a given model id (mirrors embeddingService.test.ts). */
function embedEchoing(model = 'model-A') {
  return vi.fn(async (texts: string[]) => ({
    embeddings: texts.map(() => vec768()),
    model,
    usage: { tokens: texts.length },
  }));
}

async function seedProject(name = 'Proj'): Promise<string> {
  const [p] = await db.insert(projects).values({ name, sortOrder: 0 }).returning();
  return p.id;
}

async function seedMeeting(projectId: string | null): Promise<string> {
  const [m] = await db
    .insert(meetings)
    .values({ title: 'M', startedAt: new Date(), status: 'completed', projectId })
    .returning();
  return m.id;
}

async function seedBrief(meetingId: string, summary: string): Promise<string> {
  const [b] = await db.insert(meetingBriefs).values({ meetingId, summary }).returning();
  return b.id;
}

/**
 * Insert an `embeddings` row directly, bypassing the pipeline. entityId has no
 * FK (polymorphic reference — see schema), so this needs no real parent row.
 * Used to seed already-indexed rows for the sweep tests, mirroring the
 * pre-Task-1 index state that real user databases already contain.
 */
async function seedEmbeddingRow(opts: {
  entityType: 'brief' | 'card' | 'transcript_chunk';
  entityId: string;
  content: string;
}): Promise<string> {
  const [row] = await db
    .insert(embeddings)
    .values({
      entityType: opts.entityType,
      entityId: opts.entityId,
      content: opts.content,
      embedding: vec768(),
    })
    .returning();
  return row.id;
}

async function countRows(entityType: 'brief' | 'card' | 'transcript_chunk'): Promise<number> {
  const rows = await db.select().from(embeddings).where(eq(embeddings.entityType, entityType));
  return rows.length;
}

// ---------------------------------------------------------------------------
// Suite lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  pg = new PGlite({ extensions: { vector } });
  db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
}, 60000);

afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(getDb).mockReturnValue(db as never);
  vi.mocked(resolveTaskModel).mockResolvedValue(localProvider() as never);
  vi.mocked(embed).mockImplementation(embedEchoing());
  service._reset();

  // Wipe every table this file writes to (child → parent).
  await db.delete(embeddings);
  await db.delete(embeddingIndexMeta);
  await db.delete(settings);
  await db.delete(meetingBriefs);
  await db.delete(meetings);
  await db.delete(projects);
});

// ---------------------------------------------------------------------------
// Write-side guard — post-session hook path
// ---------------------------------------------------------------------------

describe('write-side guard — post-session hook path (handlePostSession)', () => {
  it('skips a sentinel-prefixed brief (with a Task 1 reason paragraph) and never embeds it', async () => {
    const projectId = await seedProject();
    const meetingId = await seedMeeting(projectId);
    const briefId = randomUUID();
    const failureText = `${BRIEF_FAILURE_SENTINEL}\n\nReason: openai/gpt-4o-mini — the local AI server is not reachable`;

    await service.handlePostSession({
      meetingId,
      brief: { id: briefId, meetingId, summary: failureText, structure: null, createdAt: '' },
    });
    await service.flushQueue();

    expect(embed).not.toHaveBeenCalled();
    expect(await countRows('brief')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Write-side guard — backfill path
// ---------------------------------------------------------------------------

describe('write-side guard — backfill path (runBackfill / collectBackfillJobs)', () => {
  it('skips a bare historical sentinel brief (no reason paragraph) and never embeds it', async () => {
    const projectId = await seedProject();
    const meetingId = await seedMeeting(projectId);
    await seedBrief(meetingId, BRIEF_FAILURE_SENTINEL);

    await service.runBackfill();

    expect(embed).not.toHaveBeenCalled();
    expect(await countRows('brief')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Write-side guard — prefix semantics, not `includes`
// ---------------------------------------------------------------------------

describe('write-side guard — prefix semantics (isFailedBriefText, not includes)', () => {
  it('does NOT skip a normal brief that merely mentions failure mid-text', async () => {
    const projectId = await seedProject();
    const meetingId = await seedMeeting(projectId);
    const briefId = randomUUID();
    // Contains the full sentinel string, but NOT as a prefix — a real brief,
    // not a failure card. `includes`-style matching would wrongly skip this.
    const mentionsFailureText = `The deployment failed last week, but the team recovered quickly. ${BRIEF_FAILURE_SENTINEL}`;

    await service.handlePostSession({
      meetingId,
      brief: { id: briefId, meetingId, summary: mentionsFailureText, structure: null, createdAt: '' },
    });
    await service.flushQueue();

    expect(embed).toHaveBeenCalledTimes(1);
    expect(await countRows('brief')).toBe(1);
    const [row] = await db.select().from(embeddings).where(eq(embeddings.entityType, 'brief'));
    expect(row.content).toBe(mentionsFailureText);
  });
});

// ---------------------------------------------------------------------------
// sweepFailedBriefEmbeddings — one-shot cleanup of already-indexed rows
// ---------------------------------------------------------------------------

describe('sweepFailedBriefEmbeddings', () => {
  it('deletes only sentinel-prefixed brief rows — normal briefs and non-brief types survive', async () => {
    const sentinelBareId = await seedEmbeddingRow({
      entityType: 'brief',
      entityId: randomUUID(),
      content: BRIEF_FAILURE_SENTINEL,
    });
    const sentinelWithReasonId = await seedEmbeddingRow({
      entityType: 'brief',
      entityId: randomUUID(),
      content: `${BRIEF_FAILURE_SENTINEL}\n\nReason: openai/gpt-4o-mini — the model did not respond in time`,
    });
    const normalBriefId = await seedEmbeddingRow({
      entityType: 'brief',
      entityId: randomUUID(),
      content: 'A perfectly normal brief about the roadmap.',
    });
    // Prefix, not substring: this row CONTAINS the sentinel but does not
    // START with it — must survive a correctly-scoped SQL LIKE pattern.
    const mentionsFailureBriefId = await seedEmbeddingRow({
      entityType: 'brief',
      entityId: randomUUID(),
      content: `The deployment failed last week. ${BRIEF_FAILURE_SENTINEL}`,
    });
    const cardId = await seedEmbeddingRow({ entityType: 'card', entityId: randomUUID(), content: 'A card title' });
    const transcriptId = await seedEmbeddingRow({
      entityType: 'transcript_chunk',
      entityId: randomUUID(),
      content: 'Some transcript text',
    });

    // Prove the fixtures actually exist before sweeping — a "0 rows remain"
    // assertion later is meaningless if nothing was ever there (Past Learnings).
    expect(await countRows('brief')).toBe(4);
    expect(await countRows('card')).toBe(1);
    expect(await countRows('transcript_chunk')).toBe(1);

    const deletedCount = await service.sweepFailedBriefEmbeddings();

    expect(deletedCount).toBe(2);
    const remainingIds = (await db.select({ id: embeddings.id }).from(embeddings)).map((r) => r.id);
    // Deletions.
    expect(remainingIds).not.toContain(sentinelBareId);
    expect(remainingIds).not.toContain(sentinelWithReasonId);
    // Survivors, asserted positively.
    expect(remainingIds).toContain(normalBriefId);
    expect(remainingIds).toContain(mentionsFailureBriefId);
    expect(remainingIds).toContain(cardId);
    expect(remainingIds).toContain(transcriptId);
    expect(remainingIds).toHaveLength(4);
  });

  it('a second run deletes 0 — the one-shot gate holds against the real call sequence', async () => {
    await seedEmbeddingRow({ entityType: 'brief', entityId: randomUUID(), content: BRIEF_FAILURE_SENTINEL });
    expect(await countRows('brief')).toBe(1);

    const firstRun = await service.sweepFailedBriefEmbeddings();
    expect(firstRun).toBe(1);
    expect(await countRows('brief')).toBe(0);

    // A NEW sentinel row appears after the first run (e.g. a fresh failure
    // card) — a genuinely one-shot gate must skip it too, not just find
    // nothing left over from before.
    await seedEmbeddingRow({ entityType: 'brief', entityId: randomUUID(), content: BRIEF_FAILURE_SENTINEL });

    const secondRun = await service.sweepFailedBriefEmbeddings();

    expect(secondRun).toBe(0);
    expect(await countRows('brief')).toBe(1); // untouched — proves the gate, not mere emptiness
  });
});
