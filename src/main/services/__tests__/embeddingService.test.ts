// === FILE PURPOSE ===
// Tests for the V3.4 embedding pipeline (embeddingService) against a REAL PGlite
// instance (pgvector, migrated from drizzle/) with the AI SDK embed() + the
// recording signal mocked. Proves the load-bearing guarantees:
//   - chunking at SEGMENT boundaries (never mid-segment),
//   - the serial queue PAUSES while recording and drains after,
//   - content-hash idempotency: a re-run embeds nothing new,
//   - model mismatch surfaces a non-blocking rebuild affordance (never mixes spaces),
//   - a cloud route is used only on an explicit choice; unconfigured ⇒ graceful no-op.
//   - BRIEF-QUAL.2 Task 4: a brief carrying a structure indexes chunk 0 (the
//     summary, byte-identical to today) PLUS notes chunks 1..n (chunkLines over
//     the rendered record), on the SAME entityId, on both the post-session and
//     backfill paths — and the AI-RESIL.1 sentinel guard still skips everything.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, and } from 'drizzle-orm';
import { structureToText } from '../../../shared/utils/briefRecordText';
import type { MeetingStructure } from '../../../shared/types/briefStructure';
import { BRIEF_FAILURE_SENTINEL } from '../../../shared/briefSentinel';

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

/**
 * A validated (BRIEF-QUAL.1) structure fixture — all invented fixture text, no
 * real meeting content. Large enough (several hundred chars per section) that
 * its rendered notes comfortably exceed TARGET_CHUNK_CHARS (1000), so the
 * wiring tests below exercise real multi-chunk packing, not just a single
 * pass-through chunk.
 */
const SAMPLE_STRUCTURE: MeetingStructure = {
  topics: [
    {
      title: 'Pricing tiers',
      detail: 'Discussed the packaging change and how it affects the enterprise tier rollout timeline for next quarter',
    },
    {
      title: 'Renewal timeline',
      detail: 'Reviewed the Q4 renewal schedule and the risk of slipping past the fiscal year boundary this cycle',
    },
    {
      title: 'Support escalation',
      detail:
        'Walked through the on-call rotation changes and the new escalation policy for the highest-severity issues',
    },
    {
      title: 'Onboarding flow',
      detail:
        'Covered the revised onboarding checklist and the removal of the redundant welcome email step in the flow',
    },
  ],
  decisions: [
    {
      statement: 'Adopt the new tier structure',
      rationale: 'It better matches the usage patterns observed across the last two quarters of account activity',
    },
    {
      statement: 'Delay the renewal reminder change',
      rationale: 'The team wants more data before committing to the new cadence for outbound renewal notices',
    },
  ],
  commitments: [{ owner: 'Priya', task: 'Draft the updated pricing page copy', due: 'Friday', explicit: true }],
  openQuestions: ['Should the legacy tier be sunset entirely or grandfathered for existing accounts?'],
  terms: ['ARR', 'sev-1'],
  provenance: { provider: 'openai', model: 'gpt-x', passes: 1, extractedAt: '2026-08-01T00:00:00Z', schemaVersion: 1 },
};

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

/** `structure` is optional — omitted keeps every pre-Task-4 call site unchanged. */
async function seedBrief(meetingId: string, summary: string, structure?: unknown): Promise<string> {
  const [b] = await db.insert(meetingBriefs).values({ meetingId, summary, structure }).returning();
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
// chunkLines — BRIEF-QUAL.2 Task 4: line-structured notes, never chunkTranscript
// ---------------------------------------------------------------------------

describe('chunkLines', () => {
  it('never splits a line — chunk boundaries fall on line boundaries', () => {
    const a = 'A'.repeat(600);
    const b = 'B'.repeat(600);
    const c = 'C'.repeat(600);
    const chunks = service.chunkLines(`${a}\n${b}\n${c}`, 1000);
    // Each 600-char line can't share a 1000-char chunk with another → 3 chunks,
    // each exactly one whole line, in input order.
    expect(chunks).toEqual([a, b, c]);
  });

  it('packs multiple short lines into one chunk under the target, joined with \\n (not a space)', () => {
    const chunks = service.chunkLines('hello\nworld', 1000);
    expect(chunks).toEqual(['hello\nworld']); // '\n' join, NOT chunkTranscript's ' ' join
  });

  it('drops blank lines (including the blank line between structureToText sections)', () => {
    const chunks = service.chunkLines('### Topics\n- one\n\n### Decisions\n- two', 1000);
    expect(chunks).toEqual(['### Topics\n- one\n### Decisions\n- two']);
  });

  it('a single line longer than target becomes its own chunk (never split mid-line)', () => {
    const short = 'short line';
    const long = 'L'.repeat(1500); // longer than the 1000-char target
    const chunks = service.chunkLines(`${short}\n${long}`, 1000);
    expect(chunks).toEqual([short, long]); // long line is whole, never truncated or split
    expect(chunks[1]).toHaveLength(1500);
  });

  it('an all-blank input yields no chunks', () => {
    expect(service.chunkLines('', 1000)).toEqual([]);
    expect(service.chunkLines('   \n\n  \n', 1000)).toEqual([]);
  });

  it('every chunk is a contiguous, whole-line sub-sequence of the input lines (no fragment, no loss, no reorder)', () => {
    const lines = ['alpha', 'B'.repeat(700), 'C'.repeat(700), 'delta', 'epsilon'];
    const chunks = service.chunkLines(lines.join('\n'), 1000);
    // Reassembling every chunk's lines, in chunk order, must reproduce the exact
    // input line sequence — proves no line was dropped, duplicated, or reordered,
    // and (combined with the two tests above) that no line was ever fragmented.
    const reassembled = chunks.flatMap((chunk) => chunk.split('\n'));
    expect(reassembled).toEqual(lines);
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
      brief: { id: briefId, meetingId, summary: 'the brief', structure: null, createdAt: '' },
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

  it('BRIEF-QUAL.2: a structure appends notes chunks 1..n on the SAME entityId, chunk 0 unchanged (byte-identical)', async () => {
    const projectId = await seedProject();
    const meetingId = await seedMeeting(projectId);
    const briefId = randomUUID();
    const summary = 'Acme is migrating billing to Stripe.';

    await service.handlePostSession({
      meetingId,
      brief: { id: briefId, meetingId, summary, structure: SAMPLE_STRUCTURE, createdAt: '' },
    });
    await service.flushQueue();

    const briefRows = await db.select().from(embeddings).where(eq(embeddings.entityType, 'brief'));
    const chunk0 = briefRows.find((r) => r.chunkIndex === 0);
    expect(chunk0).toBeDefined();
    expect(chunk0!.content).toBe(summary); // byte-identical to today's summary job
    expect(chunk0!.entityId).toBe(briefId);

    const notesRows = briefRows.filter((r) => r.chunkIndex > 0).sort((a, b) => a.chunkIndex - b.chunkIndex);
    expect(notesRows.length).toBeGreaterThanOrEqual(1); // n ≥ 1 notes chunks
    // Exactly what chunkLines(structureToText(...)) produces — ties the wiring to
    // the already-proven pure function instead of re-deriving packing here, and
    // (by construction of chunkLines) proves every chunk is a contiguous,
    // whole-line sub-sequence of the rendered record with nothing dropped.
    expect(notesRows.map((r) => r.content)).toEqual(service.chunkLines(structureToText(SAMPLE_STRUCTURE)));
    expect(notesRows.map((r) => r.chunkIndex)).toEqual(notesRows.map((_, i) => i + 1)); // 1..n, contiguous
    for (const r of notesRows) {
      expect(r.entityId).toBe(briefId); // the SAME entityId as chunk 0
      expect(r.meetingId).toBe(meetingId);
      expect(r.projectId).toBe(projectId);
      expect(r.embedding).toHaveLength(768);
    }
  });

  it('AI-RESIL.1: a failed-brief sentinel WITH a structure still skips everything (chunk 0 AND every notes chunk)', async () => {
    const projectId = await seedProject();
    const meetingId = await seedMeeting(projectId);
    const briefId = randomUUID();

    await service.handlePostSession({
      meetingId,
      brief: { id: briefId, meetingId, summary: BRIEF_FAILURE_SENTINEL, structure: SAMPLE_STRUCTURE, createdAt: '' },
    });
    await service.flushQueue();

    expect(embed).not.toHaveBeenCalled();
    expect(await countRows('brief')).toBe(0);
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

// ---------------------------------------------------------------------------
// BRIEF-QUAL.2 Task 4 — the backfill mirrors the post-session notes-chunk expansion
// ---------------------------------------------------------------------------

describe('backfill mirrors the notes-chunk expansion', () => {
  it('embeds brief chunk 0 + notes chunks 1..n for a historical brief that carries a structure', async () => {
    const projectId = await seedProject();
    const meetingId = await seedMeeting(projectId);
    const summary = 'Acme is migrating billing to Stripe.';
    const briefId = await seedBrief(meetingId, summary, SAMPLE_STRUCTURE);

    await service.runBackfill();

    const briefRows = await db.select().from(embeddings).where(eq(embeddings.entityType, 'brief'));
    const chunk0 = briefRows.find((r) => r.chunkIndex === 0);
    expect(chunk0).toBeDefined();
    expect(chunk0!.content).toBe(summary); // byte-identical to today's summary job
    expect(chunk0!.entityId).toBe(briefId);

    const notesRows = briefRows.filter((r) => r.chunkIndex > 0).sort((a, b) => a.chunkIndex - b.chunkIndex);
    expect(notesRows.length).toBeGreaterThanOrEqual(1);
    expect(notesRows.map((r) => r.content)).toEqual(service.chunkLines(structureToText(SAMPLE_STRUCTURE)));
    for (const r of notesRows) {
      expect(r.entityId).toBe(briefId); // the SAME entityId as chunk 0
      expect(r.meetingId).toBe(meetingId);
      expect(r.projectId).toBe(projectId);
    }
  });

  it('a historical brief with NO structure backfills to EXACTLY chunk 0 (mirrors the null-structure session path)', async () => {
    const projectId = await seedProject();
    const meetingId = await seedMeeting(projectId);
    await seedBrief(meetingId, 'plain brief, no structure');

    await service.runBackfill();

    const briefRows = await db.select().from(embeddings).where(eq(embeddings.entityType, 'brief'));
    expect(briefRows).toHaveLength(1);
    expect(briefRows[0].chunkIndex).toBe(0);
    expect(briefRows[0].content).toBe('plain brief, no structure');
  });

  it('a sentinel-prefixed historical brief WITH a structure is still skipped entirely by the backfill', async () => {
    const projectId = await seedProject();
    const meetingId = await seedMeeting(projectId);
    await seedBrief(meetingId, BRIEF_FAILURE_SENTINEL, SAMPLE_STRUCTURE);

    await service.runBackfill();

    expect(await countRows('brief')).toBe(0);
  });
});
