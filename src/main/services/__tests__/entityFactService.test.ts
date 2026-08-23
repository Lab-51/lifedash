// === FILE PURPOSE ===
// Unit tests for entityFactService (BRAIN-UX.1 Tasks 1 + 3) — the entity_facts
// auditable-memory store AND its two extraction entry points. Proves:
//   - listFacts returns rows newest-first with the source meeting's title joined
//     in, and forgetFact issues a real hard DELETE (not a soft status flip);
//   - the post-session hook is boot-registered on the REAL dispatcher and runs
//     AFTER entity extraction, yet is self-sufficient: it no-ops honestly (no
//     model call, no writes) when no entities are linked, when the session was
//     already mined (idempotence via sourceMeetingId), when learning is paused,
//     and when no model is configured — and it NEVER throws into the dispatcher;
//   - mineFactsForMeeting persists provenanced facts (entityId + sourceMeetingId)
//     only for entities linked to that session, caps ~5 per entity, never pads,
//     char-budgets the transcript (dropping the OLD end + disclosing truncation),
//     and routes through `twin_learning` + the shared validate-retry-skip pipeline;
//   - analyzeHistory mines ONLY unmined meetings, SEQUENTIALLY (never concurrent
//     model calls), reports honest counts, and fails with a typed user-facing
//     error when no model is configured.
// The REAL postSessionDispatcher / entityService / twinMemoryService are used (to
// prove wiring + hook order); the DB, ai-provider, and the shared extraction
// helper are mocked.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted so the mock factory (itself hoisted above imports by Vitest) can close
// over ONE shared log-mock instance — needed to assert on log.info call content
// for the MEET-DEL.1 race-absorption tests below.
const { logMock } = vi.hoisted(() => ({
  logMock: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../logger', () => ({ createLogger: () => logMock }));
vi.mock('../ai-provider', () => ({ resolveTaskModel: vi.fn() }));
vi.mock('../twinResearchService', () => ({ generateValidated: vi.fn() }));
vi.mock('../meetingService', () => ({ getMeeting: vi.fn() }));
vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));
vi.mock('../../db/schema', () => ({
  entityFacts: {
    __table: 'entityFacts',
    id: 'id',
    entityId: 'entityId',
    content: 'content',
    sourceMeetingId: 'sourceMeetingId',
    createdAt: 'createdAt',
  },
  meetings: { __table: 'meetings', id: 'id', title: 'title' },
  entities: { __table: 'entities', id: 'id', name: 'name', normalizedName: 'normalizedName', kind: 'kind' },
  entityLinks: { __table: 'entityLinks', entityId: 'entityId', meetingId: 'meetingId', createdAt: 'createdAt' },
  meetingBriefs: { __table: 'meetingBriefs', meetingId: 'meetingId', summary: 'summary', createdAt: 'createdAt' },
  transcripts: {
    __table: 'transcripts',
    meetingId: 'meetingId',
    content: 'content',
    speaker: 'speaker',
    startTime: 'startTime',
  },
  settings: { __table: 'settings', key: 'key', value: 'value' },
  twinFacts: { __table: 'twinFacts', fact: 'fact', status: 'status' },
  liveSuggestions: {
    __table: 'liveSuggestions',
    meetingId: 'meetingId',
    type: 'type',
    title: 'title',
    description: 'description',
    status: 'status',
  },
}));
vi.mock('drizzle-orm', () => ({
  and: (...a: unknown[]) => ({ and: a }),
  asc: (x: unknown) => ({ asc: x }),
  desc: (x: unknown) => ({ desc: x }),
  eq: (...a: unknown[]) => ({ eq: a }),
}));

import {
  listFacts,
  forgetFact,
  analyzeHistory,
  mineFactsForMeeting,
  mineFactsForSession,
  entityFactPostSessionHook,
  buildTranscriptExcerpt,
  buildBriefBlockText,
  NO_MODEL_ERROR_MESSAGE,
} from '../entityFactService';
import { getDb } from '../../db/connection';
import { resolveTaskModel } from '../ai-provider';
import { generateValidated } from '../twinResearchService';
import { getMeeting } from '../meetingService';
import { dispatchPostSession } from '../postSessionDispatcher';
import type { MeetingBrief } from '../../../shared/types';
import type { MeetingStructure } from '../../../shared/types/briefStructure';

const ENTITY_ID = 'e1';
const MEETING_ID = 'm1';
const PROVIDER = { providerId: 'p1', providerName: 'lmstudio', apiKeyEncrypted: null, baseUrl: null, model: 'local' };
const DANA = { id: ENTITY_ID, name: 'Dana Lee', kind: 'person' as const };
const BRIEF: MeetingBrief = {
  id: 'b1',
  meetingId: MEETING_ID,
  summary: 'Discussed billing.',
  structure: null,
  createdAt: 'x',
};

// ---------------------------------------------------------------------------
// A table-routed Drizzle mock. select().from(table) routes by the table marker and
// by the eq(...) filters collected from where(); insert(table).values(...) records
// the written rows (entity_facts) or echoes ids (entityService's insert-or-get).
// ---------------------------------------------------------------------------

type Rows = Record<string, unknown>[];

interface Fixture {
  settings?: Rows; // twinMemoryService's learning-pause gate
  twinFacts?: Rows;
  liveSuggestions?: Rows;
  /** meetingId → brief rows. */
  briefsByMeeting?: Record<string, Rows>;
  /** meetingId → transcript segment rows. */
  transcriptsByMeeting?: Record<string, Rows>;
  /** entityId → the entity row itself. */
  entitiesById?: Record<string, Record<string, unknown>>;
  /** meetingId → entities linked to that session. */
  linksByMeeting?: Record<string, Rows>;
  /** entityId → the sessions that entity is linked to. */
  linksByEntity?: Record<string, Rows>;
  /** entityId → existing entity_facts rows (the (entity, meeting) dedupe key). */
  factsByEntity?: Record<string, Rows>;
  /** sourceMeetingId → existing entity_facts rows (the per-session idempotence check). */
  factsByMeeting?: Record<string, Rows>;
  /** When set, the entityFacts insert rejects with THIS error instead of
   *  succeeding — used to simulate an FK-violation-coded DatabaseError (MEET-DEL.1). */
  insertError?: unknown;
}

let fx: Fixture = {};
const insertedFacts: Rows = [];

/** Flatten eq()/and() markers into a { column: value } filter map. */
function collectFilters(cond: unknown, into: Record<string, unknown>): void {
  const c = cond as { eq?: unknown[]; and?: unknown[] } | undefined;
  if (!c || typeof c !== 'object') return;
  if (Array.isArray(c.eq)) into[String(c.eq[0])] = c.eq[1];
  if (Array.isArray(c.and)) for (const sub of c.and) collectFilters(sub, into);
}

/** One resolver per table — which fixture bucket a select() reads, and by which filter. */
const ROW_RESOLVERS: Record<string, (f: Record<string, unknown>) => Rows | undefined> = {
  settings: () => fx.settings,
  twinFacts: () => fx.twinFacts,
  liveSuggestions: () => fx.liveSuggestions,
  meetingBriefs: (f) => fx.briefsByMeeting?.[String(f.meetingId)],
  transcripts: (f) => fx.transcriptsByMeeting?.[String(f.meetingId)],
  entities: (f) => {
    const row = fx.entitiesById?.[String(f.id)];
    return row ? [row] : [];
  },
  entityLinks: (f) =>
    'meetingId' in f ? fx.linksByMeeting?.[String(f.meetingId)] : fx.linksByEntity?.[String(f.entityId)],
  entityFacts: (f) =>
    'sourceMeetingId' in f ? fx.factsByMeeting?.[String(f.sourceMeetingId)] : fx.factsByEntity?.[String(f.entityId)],
};

function rowsFor(table: string, f: Record<string, unknown>): Rows {
  return ROW_RESOLVERS[table]?.(f) ?? [];
}

function makeDb() {
  const selectBuilder = () => {
    let table = '';
    const filters: Record<string, unknown> = {};
    const q: Record<string, unknown> = {
      from: (t: { __table: string }) => {
        table = t.__table;
        return q;
      },
      innerJoin: () => q,
      leftJoin: () => q,
      where: (cond: unknown) => {
        collectFilters(cond, filters);
        return q;
      },
      orderBy: () => q,
      limit: () => q,
      then: (res: (v: Rows) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(rowsFor(table, filters)).then(res, rej),
    };
    return q;
  };

  let entitySeq = 0;
  return {
    select: () => selectBuilder(),
    insert: (t: { __table: string }) => ({
      values: (vals: Record<string, unknown> | Rows) => {
        const arr = Array.isArray(vals) ? vals : [vals];
        const chain: Record<string, unknown> = {
          onConflictDoNothing: () => chain,
          // entityService's insert-or-get echoes a fresh entity id.
          returning: () => Promise.resolve([{ id: `ent-${entitySeq++}` }]),
          then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
            if (t.__table === 'entityFacts') {
              if (fx.insertError !== undefined) return Promise.reject(fx.insertError).then(res, rej);
              insertedFacts.push(...arr);
            }
            return Promise.resolve(undefined).then(res, rej);
          },
        };
        return chain;
      },
    }),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  insertedFacts.length = 0;
  fx = {
    settings: [], // learning NOT paused
    twinFacts: [],
    liveSuggestions: [],
    briefsByMeeting: { [MEETING_ID]: [{ summary: 'Dana Lee owns the pricing decision.' }] },
    entitiesById: { [ENTITY_ID]: DANA },
    linksByMeeting: { [MEETING_ID]: [DANA] },
  };
  vi.mocked(getDb).mockReturnValue(makeDb() as never);
  vi.mocked(resolveTaskModel).mockResolvedValue(PROVIDER as never);
  vi.mocked(generateValidated).mockResolvedValue([]);
  // Default: the meeting still exists at the MEET-DEL.1 pre-write recheck — most
  // tests are not exercising the deleted-meeting race and need mining to proceed
  // to the insert as before.
  vi.mocked(getMeeting).mockResolvedValue({ id: MEETING_ID } as never);
});

// ---------------------------------------------------------------------------
// listFacts / forgetFact (Task 1 contracts — unchanged by the un-stubbing)
// ---------------------------------------------------------------------------

describe('listFacts', () => {
  it('returns facts newest-first with the source meeting title joined in', async () => {
    const rows = [
      {
        id: 'f-new',
        entityId: ENTITY_ID,
        content: 'Newer fact',
        sourceMeetingId: 'm2',
        sourceMeetingTitle: 'Second sync',
        createdAt: new Date('2026-08-02T00:00:00Z'),
      },
      {
        id: 'f-old',
        entityId: ENTITY_ID,
        content: 'Older fact',
        sourceMeetingId: 'm1',
        sourceMeetingTitle: 'First sync',
        createdAt: new Date('2026-08-01T00:00:00Z'),
      },
    ];

    const where = vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue(rows) });
    const leftJoin = vi.fn().mockReturnValue({ where });
    const from = vi.fn().mockReturnValue({ leftJoin });
    const select = vi.fn().mockReturnValue({ from });
    vi.mocked(getDb).mockReturnValue({ select } as never);

    const result = await listFacts(ENTITY_ID);

    expect(result).toEqual([
      {
        id: 'f-new',
        entityId: ENTITY_ID,
        content: 'Newer fact',
        sourceMeetingId: 'm2',
        sourceMeetingTitle: 'Second sync',
        createdAt: '2026-08-02T00:00:00.000Z',
      },
      {
        id: 'f-old',
        entityId: ENTITY_ID,
        content: 'Older fact',
        sourceMeetingId: 'm1',
        sourceMeetingTitle: 'First sync',
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    ]);
    // Order is preserved exactly as returned by the query's ORDER BY desc(createdAt)
    // — the service does no re-sorting of its own.
    expect(result.map((f) => f.id)).toEqual(['f-new', 'f-old']);
  });

  it('returns [] when the entity has no facts', async () => {
    const where = vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue([]) });
    const leftJoin = vi.fn().mockReturnValue({ where });
    const from = vi.fn().mockReturnValue({ leftJoin });
    const select = vi.fn().mockReturnValue({ from });
    vi.mocked(getDb).mockReturnValue({ select } as never);

    expect(await listFacts(ENTITY_ID)).toEqual([]);
  });

  it('omits sourceMeetingTitle when the join resolves no title', async () => {
    const rows = [
      {
        id: 'f1',
        entityId: ENTITY_ID,
        content: 'A fact',
        sourceMeetingId: 'm1',
        sourceMeetingTitle: null,
        createdAt: new Date('2026-08-01T00:00:00Z'),
      },
    ];
    const where = vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue(rows) });
    const leftJoin = vi.fn().mockReturnValue({ where });
    const from = vi.fn().mockReturnValue({ leftJoin });
    const select = vi.fn().mockReturnValue({ from });
    vi.mocked(getDb).mockReturnValue({ select } as never);

    const [fact] = await listFacts(ENTITY_ID);
    expect(fact.sourceMeetingTitle).toBeUndefined();
  });
});

describe('forgetFact', () => {
  it('issues a real hard DELETE on entity_facts (not a soft status flip)', async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const del = vi.fn().mockReturnValue({ where });
    vi.mocked(getDb).mockReturnValue({ delete: del } as never);

    await forgetFact('f1');

    expect(del).toHaveBeenCalledWith({
      __table: 'entityFacts',
      id: 'id',
      entityId: 'entityId',
      content: 'content',
      sourceMeetingId: 'sourceMeetingId',
      createdAt: 'createdAt',
    });
    expect(where).toHaveBeenCalledWith({ eq: ['id', 'f1'] });
  });
});

// ---------------------------------------------------------------------------
// Post-session hook wiring + honest no-ops
// ---------------------------------------------------------------------------

describe('post-session hook wiring', () => {
  it('is boot-registered and runs AFTER the facts and entity hooks (registration order = run order)', async () => {
    // Relies on import-time self-registration of ALL THREE hooks on the REAL
    // dispatcher — entityFactService imports entityService, which imports
    // twinMemoryService, so the order is facts → entities → entity facts.
    dispatchPostSession({ meetingId: MEETING_ID, brief: BRIEF });
    await flush();

    const labels = vi.mocked(generateValidated).mock.calls.map((c) => c[0].label);
    const factsIdx = labels.findIndex((l) => l.startsWith('Fact extraction'));
    const entityIdx = labels.findIndex((l) => l.startsWith('Entity extraction'));
    const entityFactIdx = labels.findIndex((l) => l.startsWith('Entity fact mining'));

    expect(factsIdx).toBeGreaterThanOrEqual(0);
    expect(entityIdx).toBeGreaterThan(factsIdx);
    // Entity facts are mined only AFTER this session's entities exist.
    expect(entityFactIdx).toBeGreaterThan(entityIdx);
  });

  it('no-ops honestly when no entities are linked to the session yet (no model call, no writes)', async () => {
    fx.linksByMeeting = {};

    const result = await mineFactsForSession(MEETING_ID);

    expect(result).toEqual({ status: 'skipped', reason: 'no-entities', newFacts: 0 });
    expect(vi.mocked(generateValidated)).not.toHaveBeenCalled();
    expect(insertedFacts).toHaveLength(0);
  });

  it('is idempotent — a session that already produced facts is never re-mined', async () => {
    fx.factsByMeeting = { [MEETING_ID]: [{ id: 'existing-fact' }] };

    const result = await mineFactsForSession(MEETING_ID);

    expect(result).toEqual({ status: 'skipped', reason: 'already-mined', newFacts: 0 });
    expect(vi.mocked(generateValidated)).not.toHaveBeenCalled();
    expect(insertedFacts).toHaveLength(0);
  });

  it('no-ops when learning is paused (no model call, no writes)', async () => {
    fx.settings = [{ value: 'true' }];

    const result = await mineFactsForSession(MEETING_ID);

    expect(result).toEqual({ status: 'skipped', reason: 'paused', newFacts: 0 });
    expect(vi.mocked(generateValidated)).not.toHaveBeenCalled();
    expect(insertedFacts).toHaveLength(0);
  });

  it('logs and skips (never throws) when no model is configured — unlike the user-initiated path', async () => {
    vi.mocked(resolveTaskModel).mockResolvedValue(null);

    await expect(mineFactsForSession(MEETING_ID)).resolves.toEqual({
      status: 'skipped',
      reason: 'no-model',
      newFacts: 0,
    });
    expect(vi.mocked(generateValidated)).not.toHaveBeenCalled();
  });

  it('is defensive — the hook swallows a DB failure and never throws into the dispatcher', async () => {
    vi.mocked(getDb).mockImplementation(() => {
      throw new Error('db down');
    });
    await expect(entityFactPostSessionHook({ meetingId: MEETING_ID, brief: BRIEF })).resolves.toBeUndefined();
  });

  it('mines and persists provenanced facts on the happy path', async () => {
    vi.mocked(generateValidated).mockResolvedValue([{ entity: 'Dana Lee', fact: 'Owns the pricing decision' }]);

    const result = await mineFactsForSession(MEETING_ID);

    expect(result).toEqual({ status: 'ok', newFacts: 1 });
    expect(insertedFacts).toEqual([
      { entityId: ENTITY_ID, content: 'Owns the pricing decision', sourceMeetingId: MEETING_ID },
    ]);
  });
});

// ---------------------------------------------------------------------------
// mineFactsForMeeting — the shared extraction core
// ---------------------------------------------------------------------------

describe('mineFactsForMeeting', () => {
  it('persists each fact with full provenance (entityId + sourceMeetingId)', async () => {
    vi.mocked(generateValidated).mockResolvedValue([
      { entity: 'Dana Lee', fact: 'Owns the pricing decision' },
      { entity: 'dana  lee', fact: 'Raised concerns about the Q3 timeline' }, // normalized match
    ]);

    const result = await mineFactsForMeeting(MEETING_ID, [DANA], PROVIDER as never);

    expect(result).toEqual({ status: 'ok', newFacts: 2 });
    expect(insertedFacts).toEqual([
      { entityId: ENTITY_ID, content: 'Owns the pricing decision', sourceMeetingId: MEETING_ID },
      { entityId: ENTITY_ID, content: 'Raised concerns about the Q3 timeline', sourceMeetingId: MEETING_ID },
    ]);
  });

  it('drops facts about entities that are not linked to the session (never invents an entity)', async () => {
    vi.mocked(generateValidated).mockResolvedValue([
      { entity: 'Someone Else', fact: 'Owns the roadmap' },
      { entity: 'Dana Lee', fact: 'Owns the pricing decision' },
    ]);

    const result = await mineFactsForMeeting(MEETING_ID, [DANA], PROVIDER as never);

    expect(result.newFacts).toBe(1);
    expect(insertedFacts).toEqual([
      { entityId: ENTITY_ID, content: 'Owns the pricing decision', sourceMeetingId: MEETING_ID },
    ]);
  });

  it('caps an entity at 5 facts per session and drops in-batch duplicates', async () => {
    vi.mocked(generateValidated).mockResolvedValue([
      ...Array.from({ length: 8 }, (_, i) => ({ entity: 'Dana Lee', fact: `Fact ${i}` })),
      { entity: 'Dana Lee', fact: 'Fact 0.' }, // normalized duplicate of "Fact 0"
    ]);

    const result = await mineFactsForMeeting(MEETING_ID, [DANA], PROVIDER as never);

    expect(result.newFacts).toBe(5);
    expect(insertedFacts.map((r) => r.content)).toEqual(['Fact 0', 'Fact 1', 'Fact 2', 'Fact 3', 'Fact 4']);
  });

  it('NEVER pads — an empty model result persists nothing and still reports ok', async () => {
    vi.mocked(generateValidated).mockResolvedValue([]);

    const result = await mineFactsForMeeting(MEETING_ID, [DANA], PROVIDER as never);

    expect(result).toEqual({ status: 'ok', newFacts: 0 });
    expect(insertedFacts).toHaveLength(0);
  });

  it('persists nothing when the output stays unusable after generateValidated retries (retry-then-skip)', async () => {
    vi.mocked(generateValidated).mockResolvedValue(null); // the shared pipeline's skip signal

    const result = await mineFactsForMeeting(MEETING_ID, [DANA], PROVIDER as never);

    expect(result).toEqual({ status: 'skipped', reason: 'failed', newFacts: 0 });
    expect(insertedFacts).toHaveLength(0);
  });

  it('routes through twin_learning with a schema that rejects malformed JSON output', async () => {
    await mineFactsForMeeting(MEETING_ID, [DANA], PROVIDER as never);

    const opts = vi.mocked(generateValidated).mock.calls[0][0];
    expect(opts.taskType).toBe('twin_learning');
    expect(vi.mocked(resolveTaskModel)).not.toHaveBeenCalled(); // caller resolves once
    // The schema handed to the shared validate-retry-skip pipeline is what rejects
    // malformed output (one retry inside generateValidated, then skip).
    expect(opts.schema.safeParse([{ entity: 'Dana Lee', fact: 'Owns pricing' }]).success).toBe(true);
    expect(opts.schema.safeParse([{ entity: 'Dana Lee' }]).success).toBe(false);
    expect(opts.schema.safeParse({ facts: ['nope'] }).success).toBe(false);
    expect(opts.schema.safeParse([{ entity: '', fact: '' }]).success).toBe(false);
  });

  it('skips without a model call when the session has no brief and no transcript', async () => {
    fx.briefsByMeeting = {};
    fx.transcriptsByMeeting = {};

    const result = await mineFactsForMeeting(MEETING_ID, [DANA], PROVIDER as never);

    expect(result).toEqual({ status: 'skipped', reason: 'no-material', newFacts: 0 });
    expect(vi.mocked(generateValidated)).not.toHaveBeenCalled();
  });

  it('char-budgets a huge transcript by dropping the OLD end and discloses the truncation', async () => {
    // 400 segments × ~110 chars ≈ 44k chars — well over the 24k budget.
    const segments = Array.from({ length: 400 }, (_, i) => ({
      content: `${'x'.repeat(100)} segment ${i}`,
      speaker: 'Speaker 1',
      startTime: i,
    }));
    fx.transcriptsByMeeting = { [MEETING_ID]: segments };

    await mineFactsForMeeting(MEETING_ID, [DANA], PROVIDER as never);

    const { context } = vi.mocked(generateValidated).mock.calls[0][0];
    expect(context).toContain('TRUNCATED');
    expect(context).toContain('segment 399'); // newest speech survives
    expect(context).not.toContain('segment 0\n'); // oldest speech dropped
    expect(context.length).toBeLessThan(30_000);
    // The entity list and brief are always present alongside the excerpt.
    expect(context).toContain('Dana Lee (person)');
    expect(context).toContain('Dana Lee owns the pricing decision.');
  });

  it('sends the full transcript with no truncation notice when it fits the budget', async () => {
    fx.transcriptsByMeeting = {
      [MEETING_ID]: [{ content: 'We agreed Dana owns pricing.', speaker: 'Speaker 1', startTime: 0 }],
    };

    await mineFactsForMeeting(MEETING_ID, [DANA], PROVIDER as never);

    const { context } = vi.mocked(generateValidated).mock.calls[0][0];
    expect(context).toContain('Speaker 1: We agreed Dana owns pricing.');
    expect(context).not.toContain('TRUNCATED');
  });

  it('BRIEF-QUAL.2: threads the record structure into the brief block as Full notes', async () => {
    fx.briefsByMeeting = {
      [MEETING_ID]: [
        {
          summary: 'Dana Lee owns the pricing decision.',
          structure: {
            topics: [{ title: 'Pricing tiers', detail: 'Discussed the new packaging' }],
            decisions: [],
            commitments: [],
            openQuestions: [],
            terms: [],
            provenance: { provider: 'openai', model: 'gpt-x', passes: 1, extractedAt: 'x', schemaVersion: 1 },
          },
        },
      ],
    };

    await mineFactsForMeeting(MEETING_ID, [DANA], PROVIDER as never);

    const { context } = vi.mocked(generateValidated).mock.calls[0][0];
    expect(context).toContain('## Full notes');
    expect(context).toContain('Pricing tiers'); // a topic the narrative summary never mentioned
  });
});

// ---------------------------------------------------------------------------
// MEET-DEL.1 — deleted-meeting race absorption. Shared by BOTH entry points
// (the automatic post-session hook AND analyzeHistory's backfill) since both
// route through this one core routine. Resolves to the SAME typed no-op on
// EITHER signal — a fresh existence recheck immediately before the write, or
// the insert's own FK violation catching a delete in the narrower remaining gap.
// ---------------------------------------------------------------------------

describe('mineFactsForMeeting — MEET-DEL.1 deleted-meeting race', () => {
  it('resolves the typed no-op when the meeting is deleted between mining start and the write (existence recheck)', async () => {
    vi.mocked(generateValidated).mockResolvedValue([{ entity: 'Dana Lee', fact: 'Owns the pricing decision' }]);
    // Gone by the pre-write recheck — simulates a delete landing during the
    // (long-running) mining call above.
    vi.mocked(getMeeting).mockResolvedValue(null);

    const result = await mineFactsForMeeting(MEETING_ID, [DANA], PROVIDER as never);

    expect(result).toEqual({ status: 'skipped', reason: 'meeting-deleted', newFacts: 0 });
    expect(insertedFacts).toHaveLength(0);
    expect(logMock.info).toHaveBeenCalledTimes(1);
    expect(logMock.info).toHaveBeenCalledWith(expect.stringContaining(MEETING_ID));
    expect(logMock.info).toHaveBeenCalledWith(expect.stringContaining('discarded'));
    expect(logMock.error).not.toHaveBeenCalled();
  });

  it('resolves the same typed no-op when the delete lands AFTER the existence check (FK violation on insert)', async () => {
    // The recheck still sees the meeting (default getMeeting mock from
    // beforeEach) — the delete happens in the gap between that check and the
    // insert itself, surfacing as a foreign_key_violation (23503) on the write.
    fx.insertError = Object.assign(
      new Error(
        'insert into entity_facts violates foreign key constraint "entity_facts_source_meeting_id_meetings_id_fk"',
      ),
      { code: '23503' },
    );
    vi.mocked(generateValidated).mockResolvedValue([{ entity: 'Dana Lee', fact: 'Owns the pricing decision' }]);

    const result = await mineFactsForMeeting(MEETING_ID, [DANA], PROVIDER as never);

    expect(result).toEqual({ status: 'skipped', reason: 'meeting-deleted', newFacts: 0 });
    expect(insertedFacts).toHaveLength(0);
    expect(logMock.info).toHaveBeenCalledTimes(1);
    expect(logMock.info).toHaveBeenCalledWith(expect.stringContaining('discarded'));
    expect(logMock.error).not.toHaveBeenCalled();
  });

  it('a generic (non-FK) insert failure still propagates — never silently absorbed as meeting-deleted', async () => {
    fx.insertError = new Error('a real bug, unrelated to any deleted meeting'); // no `.code` — not FK-shaped
    vi.mocked(generateValidated).mockResolvedValue([{ entity: 'Dana Lee', fact: 'Owns the pricing decision' }]);

    await expect(mineFactsForMeeting(MEETING_ID, [DANA], PROVIDER as never)).rejects.toThrow(
      'a real bug, unrelated to any deleted meeting',
    );
  });

  it('the automatic post-session hook still absorbs the race silently (typed no-op, never throws into the dispatcher)', async () => {
    vi.mocked(generateValidated).mockResolvedValue([{ entity: 'Dana Lee', fact: 'Owns the pricing decision' }]);
    vi.mocked(getMeeting).mockResolvedValue(null);

    const result = await mineFactsForSession(MEETING_ID);

    expect(result).toEqual({ status: 'skipped', reason: 'meeting-deleted', newFacts: 0 });
  });
});

describe('buildTranscriptExcerpt', () => {
  it('keeps the newest lines under budget and flags truncation', () => {
    const lines = ['aaaa', 'bbbb', 'cccc'];
    expect(buildTranscriptExcerpt(lines, 100)).toEqual({ text: 'aaaa\nbbbb\ncccc', truncated: false });
    expect(buildTranscriptExcerpt(lines, 10)).toEqual({ text: 'bbbb\ncccc', truncated: true });
    expect(buildTranscriptExcerpt(lines, 8)).toEqual({ text: 'cccc', truncated: true });
    expect(buildTranscriptExcerpt([], 10)).toEqual({ text: '', truncated: false });
  });

  it('still returns the newest portion when a single line exceeds the whole budget', () => {
    expect(buildTranscriptExcerpt(['short', 'x'.repeat(50)], 10)).toEqual({ text: 'x'.repeat(10), truncated: true });
  });
});

// ---------------------------------------------------------------------------
// buildBriefBlockText (BRIEF-QUAL.2 Task 3) — the "Meeting brief:" block text.
// The null-structure case must stay byte-identical to the pre-Task-3 slice
// forever; notes are a bounded second input that never crowds out the
// transcript (BRIEF_CHAR_BUDGET = 2000 rarely admits them for a long meeting —
// see the HONEST NOTE in this task's report).
// ---------------------------------------------------------------------------

describe('buildBriefBlockText', () => {
  const SMALL_STRUCTURE: MeetingStructure = {
    topics: [{ title: 'Pricing tiers', detail: 'Discussed the new packaging' }],
    decisions: [],
    commitments: [],
    openQuestions: [],
    terms: [],
    provenance: { provider: 'openai', model: 'gpt-x', passes: 1, extractedAt: 'x', schemaVersion: 1 },
  };

  it('is byte-identical to the pre-Task-3 shape when there is no structure', () => {
    const summary = 'Dana Lee owns the pricing decision.';
    expect(buildBriefBlockText(summary, null)).toBe(summary);
  });

  it('appends a "## Full notes" sub-block when the brief is short and the structure is small', () => {
    const summary = 'Dana Lee owns the pricing decision.';

    const result = buildBriefBlockText(summary, SMALL_STRUCTURE);

    expect(result).toContain(summary);
    expect(result).toContain('## Full notes');
    expect(result).toContain('Pricing tiers'); // a topic the narrative summary never mentioned
  });

  it('drops the notes and slices EXACTLY as before when the summary alone already fills the budget', () => {
    const BUDGET = 2000; // mirrors entityFactService's BRIEF_CHAR_BUDGET (frozen this phase)
    const longSummary = 'x'.repeat(BUDGET + 500);

    const result = buildBriefBlockText(longSummary, SMALL_STRUCTURE);

    expect(result).toBe(longSummary.slice(0, BUDGET));
    expect(result).not.toContain('## Full notes');
    expect(result.length).toBe(BUDGET);
  });
});

// ---------------------------------------------------------------------------
// analyzeHistory — user-initiated sequential backfill
// ---------------------------------------------------------------------------

describe('analyzeHistory', () => {
  const M1 = 'm1';
  const M2 = 'm2';
  const M3 = 'm3';

  function historyFixture(mined: Rows = []) {
    fx.linksByEntity = { [ENTITY_ID]: [{ meetingId: M1 }, { meetingId: M2 }, { meetingId: M3 }] };
    fx.factsByEntity = { [ENTITY_ID]: mined };
    fx.briefsByMeeting = {
      [M1]: [{ summary: 'Dana Lee owns pricing.' }],
      [M2]: [{ summary: 'Dana Lee raised timeline concerns.' }],
      [M3]: [{ summary: 'Dana Lee approved the rollout.' }],
    };
  }

  it('fails honestly with a user-facing error when no model is configured (no writes)', async () => {
    vi.mocked(resolveTaskModel).mockResolvedValue(null);
    historyFixture();

    await expect(analyzeHistory(ENTITY_ID)).rejects.toThrow(NO_MODEL_ERROR_MESSAGE);
    expect(vi.mocked(generateValidated)).not.toHaveBeenCalled();
    expect(insertedFacts).toHaveLength(0);
  });

  it('mines only the sessions with no facts for this entity yet and reports honest counts', async () => {
    historyFixture([{ sourceMeetingId: M2 }]); // m2 already mined for this entity
    vi.mocked(generateValidated).mockResolvedValue([{ entity: 'Dana Lee', fact: 'Owns pricing' }]);

    const result = await analyzeHistory(ENTITY_ID);

    expect(result).toEqual({ status: 'ok', minedMeetings: 2, newFacts: 2, skippedMeetings: 1 });
    const minedMeetingIds = vi.mocked(generateValidated).mock.calls.map((c) => c[0].label);
    expect(minedMeetingIds).toEqual([
      `Entity fact mining (meeting ${M1})`,
      `Entity fact mining (meeting ${M3})`, // m2 was skipped, never re-sent to the model
    ]);
    expect(insertedFacts.map((r) => r.sourceMeetingId)).toEqual([M1, M3]);
    expect(insertedFacts.every((r) => r.entityId === ENTITY_ID)).toBe(true);
  });

  it('adds nothing on a re-run — every session is already mined (dedupe by entity+session)', async () => {
    historyFixture([{ sourceMeetingId: M1 }, { sourceMeetingId: M2 }, { sourceMeetingId: M3 }]);

    const result = await analyzeHistory(ENTITY_ID);

    expect(result).toEqual({ status: 'ok', minedMeetings: 0, newFacts: 0, skippedMeetings: 3 });
    expect(vi.mocked(generateValidated)).not.toHaveBeenCalled();
    expect(insertedFacts).toHaveLength(0);
  });

  it('counts a session with nothing to mine as skipped, not mined', async () => {
    historyFixture();
    fx.briefsByMeeting = { [M1]: [{ summary: 'Dana Lee owns pricing.' }] }; // m2/m3 have no material

    const result = await analyzeHistory(ENTITY_ID);

    expect(result).toEqual({ status: 'ok', minedMeetings: 1, newFacts: 0, skippedMeetings: 2 });
    expect(vi.mocked(generateValidated)).toHaveBeenCalledTimes(1);
  });

  it('mines SEQUENTIALLY — never more than one model call in flight (no Promise.all)', async () => {
    historyFixture();
    let inFlight = 0;
    let maxInFlight = 0;
    vi.mocked(generateValidated).mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return [];
    });

    const result = await analyzeHistory(ENTITY_ID);

    expect(vi.mocked(generateValidated)).toHaveBeenCalledTimes(3);
    expect(maxInFlight).toBe(1);
    expect(result.minedMeetings).toBe(3);
  });

  it('returns honest zeros (no model call) when the entity no longer exists', async () => {
    historyFixture();
    fx.entitiesById = {};

    const result = await analyzeHistory(ENTITY_ID);

    expect(result).toEqual({ status: 'ok', minedMeetings: 0, newFacts: 0, skippedMeetings: 0 });
    expect(vi.mocked(generateValidated)).not.toHaveBeenCalled();
  });
});
