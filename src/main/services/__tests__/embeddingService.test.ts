// === FILE PURPOSE ===
// Tests for the V3.4 embedding pipeline (embeddingService) against a REAL PGlite
// instance (pgvector, migrated from drizzle/) with the AI SDK embed() + the
// recording signal mocked. Proves the load-bearing guarantees:
//   - chunking at SEGMENT boundaries (never mid-segment),
//   - the serial queue PAUSES while recording and drains after,
//   - content-hash idempotency: a re-run embeds nothing new,
//   - model mismatch surfaces a non-blocking rebuild affordance (never mixes spaces),
//   - a cloud route is used only on an explicit choice; unconfigured ⇒ graceful no-op.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, and } from 'drizzle-orm';

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
import { getIsRecording } from '../recordingState';
import * as schema from '../../db/schema';
import {
  embeddings,
  embeddingIndexMeta,
  EMBEDDING_INDEX_META_ID,
  meetings,
  transcripts,
  meetingBriefs,
  cards,
  columns,
  boards,
  projects,
  settings,
} from '../../db/schema';

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

function cloudProvider() {
  return {
    providerId: 'oa',
    providerName: 'openai',
    apiKeyEncrypted: 'blob',
    baseUrl: null,
    model: 'text-embedding-3-small',
  };
}

/** embed() mock that echoes a given model id. */
function embedEchoing(model: string) {
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

/** Insert a real card (project → board → column → card) and return its row. */
async function seedCard(
  projectId: string,
  title: string,
  description: string | null,
): Promise<typeof cards.$inferSelect> {
  const [b] = await db.insert(boards).values({ projectId, name: 'B', position: 0 }).returning();
  const [c] = await db.insert(columns).values({ boardId: b.id, name: 'Col', position: 0 }).returning();
  const [card] = await db.insert(cards).values({ columnId: c.id, title, description }).returning();
  return card;
}

async function seedTranscript(meetingId: string, content: string, startTime: number): Promise<void> {
  await db.insert(transcripts).values({ meetingId, content, startTime, endTime: startTime + 1000 });
}

async function seedBrief(meetingId: string, summary: string): Promise<string> {
  const [b] = await db.insert(meetingBriefs).values({ meetingId, summary }).returning();
  return b.id;
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
  vi.mocked(getIsRecording).mockReturnValue(false);
  vi.mocked(resolveTaskModel).mockResolvedValue(localProvider() as never);
  vi.mocked(embed).mockImplementation(embedEchoing('model-A'));
  service._reset();

  // Wipe tables (child → parent).
  await db.delete(embeddings);
  await db.delete(embeddingIndexMeta);
  await db.delete(settings);
  await db.delete(transcripts);
  await db.delete(meetingBriefs);
  await db.delete(cards);
  await db.delete(columns);
  await db.delete(boards);
  await db.delete(meetings);
  await db.delete(projects);
});

afterEach(() => {
  service._reset(); // clear any pending resume timer
});

// ---------------------------------------------------------------------------
// chunkTranscript — segment boundaries
// ---------------------------------------------------------------------------

describe('chunkTranscript', () => {
  it('never splits a segment — chunk boundaries fall on segment boundaries', () => {
    const a = 'A'.repeat(600);
    const b = 'B'.repeat(600);
    const c = 'C'.repeat(600);
    const chunks = service.chunkTranscript(
      [
        { content: c, startTime: 2000 },
        { content: a, startTime: 0 },
        { content: b, startTime: 1000 },
      ],
      1000,
    );
    // Each 600-char segment can't share a 1000-char chunk with another → 3 chunks,
    // each exactly one whole segment, in start-time order.
    expect(chunks).toEqual([a, b, c]);
  });

  it('packs multiple small segments into one chunk under the target', () => {
    const chunks = service.chunkTranscript(
      [
        { content: 'hello', startTime: 0 },
        { content: 'world', startTime: 500 },
      ],
      1000,
    );
    expect(chunks).toEqual(['hello world']);
  });
});

// ---------------------------------------------------------------------------
// Post-session hook — brief + transcript chunks
// ---------------------------------------------------------------------------

describe('handlePostSession', () => {
  it('embeds the brief plus segment-boundary transcript chunks with denormalized keys', async () => {
    const projectId = await seedProject();
    const meetingId = await seedMeeting(projectId);
    await seedTranscript(meetingId, 'X'.repeat(600), 0);
    await seedTranscript(meetingId, 'Y'.repeat(600), 1000);

    const briefId = randomUUID();
    await service.handlePostSession({
      meetingId,
      brief: { id: briefId, meetingId, summary: 'the brief', createdAt: '' },
    });
    await service.flushQueue();

    const briefRows = await db.select().from(embeddings).where(eq(embeddings.entityType, 'brief'));
    expect(briefRows).toHaveLength(1);
    expect(briefRows[0].content).toBe('the brief');
    expect(briefRows[0].entityId).toBe(briefId);
    expect(briefRows[0].meetingId).toBe(meetingId);
    expect(briefRows[0].projectId).toBe(projectId);

    const chunkRows = await db.select().from(embeddings).where(eq(embeddings.entityType, 'transcript_chunk'));
    expect(chunkRows).toHaveLength(2); // two 600-char segments → two whole-segment chunks
    expect(chunkRows.map((r) => r.chunkIndex).sort()).toEqual([0, 1]);
    for (const r of chunkRows) {
      expect(r.entityId).toBe(meetingId);
      expect(r.embedding).toHaveLength(768);
    }
  });
});

// ---------------------------------------------------------------------------
// Queue pauses while recording, drains after
// ---------------------------------------------------------------------------

describe('recording pause', () => {
  it('does not embed while recording, then drains once recording stops', async () => {
    const projectId = await seedProject();
    const card = await seedCard(projectId, 'Ship it', 'do the thing');

    vi.mocked(getIsRecording).mockReturnValue(true);
    service.enqueueCardEmbed(card, projectId);
    await service.flushQueue();

    expect(embed).not.toHaveBeenCalled();
    expect(await countRows('card')).toBe(0);

    // Recording stops → the queued job drains.
    vi.mocked(getIsRecording).mockReturnValue(false);
    await service.flushQueue();

    expect(embed).toHaveBeenCalledTimes(1);
    expect(await countRows('card')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Content-hash idempotency
// ---------------------------------------------------------------------------

describe('idempotency', () => {
  it('a second backfill embeds nothing new (content-hash skip)', async () => {
    const projectId = await seedProject();
    const meetingId = await seedMeeting(projectId);
    await seedBrief(meetingId, 'brief summary');
    await seedCard(projectId, 'Card one', 'desc');
    await seedTranscript(meetingId, 'segment text', 0);

    await service.runBackfill();
    const firstCalls = vi.mocked(embed).mock.calls.length;
    expect(firstCalls).toBeGreaterThan(0);
    const totalRows = (await db.select().from(embeddings)).length;

    vi.mocked(embed).mockClear();
    await service.runBackfill();

    expect(embed).not.toHaveBeenCalled(); // nothing re-embedded
    expect((await db.select().from(embeddings)).length).toBe(totalRows);
  });

  it('re-embeds a card when its content actually changes', async () => {
    const projectId = await seedProject();
    const card = await seedCard(projectId, 'Title', 'first');

    service.enqueueCardEmbed(card, projectId);
    await service.flushQueue();
    expect(await countRows('card')).toBe(1);

    vi.mocked(embed).mockClear();
    service.enqueueCardEmbed({ ...card, description: 'second' }, projectId);
    await service.flushQueue();

    expect(embed).toHaveBeenCalledTimes(1);
    const [row] = await db.select().from(embeddings).where(eq(embeddings.entityType, 'card'));
    expect(row.content).toContain('second');
    expect(await countRows('card')).toBe(1); // replaced, not duplicated
  });
});

// ---------------------------------------------------------------------------
// Model mismatch → rebuild affordance (never mix vector spaces)
// ---------------------------------------------------------------------------

describe('model mismatch', () => {
  it('surfaces a rebuild affordance and does NOT insert a foreign-space vector', async () => {
    const projectId = await seedProject();
    const card1 = await seedCard(projectId, 'One', 'a');

    // Index built with model-A.
    vi.mocked(embed).mockImplementation(embedEchoing('model-A'));
    service.enqueueCardEmbed(card1, projectId);
    await service.flushQueue();

    const [meta1] = await db
      .select()
      .from(embeddingIndexMeta)
      .where(eq(embeddingIndexMeta.id, EMBEDDING_INDEX_META_ID));
    expect(meta1.model).toBe('model-A');

    // A later embed echoes a DIFFERENT model → mismatch.
    const card2 = await seedCard(projectId, 'Two', 'b');
    vi.mocked(embed).mockImplementation(embedEchoing('model-B'));
    service.enqueueCardEmbed(card2, projectId);
    await service.flushQueue();

    // card2 was NOT inserted (foreign space) and meta is unchanged.
    const card2Rows = await db
      .select()
      .from(embeddings)
      .where(and(eq(embeddings.entityType, 'card'), eq(embeddings.entityId, card2.id)));
    expect(card2Rows).toHaveLength(0);
    const [meta2] = await db
      .select()
      .from(embeddingIndexMeta)
      .where(eq(embeddingIndexMeta.id, EMBEDDING_INDEX_META_ID));
    expect(meta2.model).toBe('model-A');

    const status = await service.getEmbeddingStatus();
    expect(status.mismatch).toEqual({ stored: 'model-A', current: 'model-B' });
  });

  it('rebuild re-embeds everything with the current model and clears the mismatch', async () => {
    const projectId = await seedProject();
    const card1 = await seedCard(projectId, 'One', 'a');
    const card2 = await seedCard(projectId, 'Two', 'b');

    vi.mocked(embed).mockImplementation(embedEchoing('model-A'));
    service.enqueueCardEmbed(card1, projectId);
    await service.flushQueue();

    vi.mocked(embed).mockImplementation(embedEchoing('model-B'));
    service.enqueueCardEmbed(card2, projectId);
    await service.flushQueue();
    expect((await service.getEmbeddingStatus()).mismatch).not.toBeNull();

    // Rebuild with model-B — wipes + re-embeds all real cards.
    await service.rebuildIndex();

    const status = await service.getEmbeddingStatus();
    expect(status.mismatch).toBeNull();
    const [meta] = await db.select().from(embeddingIndexMeta).where(eq(embeddingIndexMeta.id, EMBEDDING_INDEX_META_ID));
    expect(meta.model).toBe('model-B');
    expect(await countRows('card')).toBe(2); // both cards now in the model-B space
  });
});

// ---------------------------------------------------------------------------
// Card embeddings are decoupled from the meeting ON DELETE cascade
// ---------------------------------------------------------------------------

describe('card embedding / meeting-cascade decoupling', () => {
  it('stores a card embedding with meetingId null even when the card has a source meeting', async () => {
    const projectId = await seedProject();
    const meetingId = await seedMeeting(projectId);
    const card = await seedCard(projectId, 'Follow-up', 'from the sync');

    service.enqueueCardEmbed({ ...card, sourceMeetingId: meetingId }, projectId);
    await service.flushQueue();

    const [row] = await db.select().from(embeddings).where(eq(embeddings.entityType, 'card'));
    expect(row).toBeTruthy();
    expect(row.meetingId).toBeNull(); // not the source meeting → outside the cascade
    expect(row.entityId).toBe(card.id);
    expect(row.projectId).toBe(projectId); // projectId denorm is preserved
  });

  it("survives deletion of the card's source meeting (pruned only on CARD delete)", async () => {
    const projectId = await seedProject();
    const meetingId = await seedMeeting(projectId);
    const card = await seedCard(projectId, 'Keep me', 'body');

    service.enqueueCardEmbed({ ...card, sourceMeetingId: meetingId }, projectId);
    await service.flushQueue();
    expect(await countRows('card')).toBe(1);

    // The card survives a meeting delete, so its embedding must too (before the fix
    // the embedding carried meetingId and was cascade-deleted with the meeting).
    await db.delete(meetings).where(eq(meetings.id, meetingId));

    expect(await countRows('card')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// No silent cloud + graceful no-op
// ---------------------------------------------------------------------------

describe('provider routing', () => {
  it('no-ops when no embedding model is configured (resolveTaskModel → null)', async () => {
    vi.mocked(resolveTaskModel).mockResolvedValue(null);
    const projectId = await seedProject();
    const card = await seedCard(projectId, 'C', 'd');

    service.enqueueCardEmbed(card, projectId);
    await service.flushQueue();

    expect(embed).not.toHaveBeenCalled();
    expect(await countRows('card')).toBe(0);
    expect((await service.getEmbeddingStatus()).route).toBeNull();
  });

  it('uses a cloud route only when it is explicitly configured, and flags it as non-local', async () => {
    vi.mocked(resolveTaskModel).mockResolvedValue(cloudProvider() as never);
    const projectId = await seedProject();
    const card = await seedCard(projectId, 'C', 'd');

    service.enqueueCardEmbed(card, projectId);
    await service.flushQueue();

    expect(embed).toHaveBeenCalledTimes(1);
    expect(await countRows('card')).toBe(1);
    expect((await service.getEmbeddingStatus()).route).toEqual({ providerName: 'openai', isLocal: false });
  });
});

// ---------------------------------------------------------------------------
// Backfill progress
// ---------------------------------------------------------------------------

describe('backfill progress', () => {
  it('reports indexed / total across briefs, cards, and transcripts', async () => {
    const projectId = await seedProject();
    const briefMeeting = await seedMeeting(projectId);
    await seedBrief(briefMeeting, 'summary');
    await seedCard(projectId, 'Card A', 'x');
    await seedCard(projectId, 'Card B', 'y');
    const transcriptMeeting = await seedMeeting(projectId);
    await seedTranscript(transcriptMeeting, 'hello there', 0);

    const before = await service.getEmbeddingStatus();
    expect(before.total).toBe(4); // 1 brief-meeting + 2 cards + 1 transcript-meeting
    expect(before.indexed).toBe(0);

    await service.runBackfill();

    const after = await service.getEmbeddingStatus();
    expect(after.total).toBe(4);
    expect(after.indexed).toBe(4);
  });

  it('persists a backfill dismissal', async () => {
    expect((await service.getEmbeddingStatus()).backfillDismissed).toBe(false);
    await service.dismissBackfill();
    expect((await service.getEmbeddingStatus()).backfillDismissed).toBe(true);
  });
});
