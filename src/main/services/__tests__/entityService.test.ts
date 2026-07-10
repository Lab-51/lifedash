// === FILE PURPOSE ===
// Unit tests for the entity-extraction service (V3.4 Task 6 — the Brain's first
// semantic layer). Proves the load-bearing contracts:
//   - the ENTITY post-session hook is boot-registered AND runs AFTER the FACTS hook
//     (registration order = run order — the plan requires facts-before-entities);
//   - extractEntities reads ONLY the brief (never the raw transcript), routes through
//     the twin_learning task, is gated by isLearningPaused (paused ⇒ no-op), and skips
//     cleanly with no model / no brief / bad output;
//   - it REUSES twinResearchService.generateValidated (mocked) — no third pipeline;
//   - dedupe by normalizedName (within the batch), the ≤8/session cap, insert-or-get
//     (an existing entity is REUSED, not duplicated), and a provenanced entity_links
//     row per resolved entity;
//   - it is defensive — a DB failure returns skipped/failed and NEVER throws.
// The REAL post-session dispatcher + REAL twinMemoryService are used (to prove wiring
// + hook order); the DB, ai-provider, and the shared extraction helper are mocked.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../ai-provider', () => ({ resolveTaskModel: vi.fn() }));
vi.mock('../twinResearchService', () => ({ generateValidated: vi.fn() }));
vi.mock('../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));
vi.mock('../../db/schema', () => ({
  entities: { __table: 'entities', id: 'id', name: 'name', normalizedName: 'normalizedName', kind: 'kind' },
  entityLinks: { __table: 'entityLinks', entityId: 'entityId', meetingId: 'meetingId' },
  meetingBriefs: { __table: 'meetingBriefs', meetingId: 'meetingId', summary: 'summary', createdAt: 'createdAt' },
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
  desc: (x: unknown) => x,
  eq: (...a: unknown[]) => ({ eq: a }),
}));

import { extractEntities, entityPostSessionHook, normalizeEntityName } from '../entityService';
import { resolveTaskModel } from '../ai-provider';
import { generateValidated } from '../twinResearchService';
import { getDb } from '../../db/connection';
import { dispatchPostSession } from '../postSessionDispatcher';
import type { MeetingBrief } from '../../../shared/types';

// ---------------------------------------------------------------------------
// A table-routed Drizzle mock. select() routes by the .from(table) marker (and
// honors an eq(normalizedName, x) filter for the insert-or-get fallback lookup).
// insert(entities).values().onConflictDoNothing().returning() echoes a fresh id —
// UNLESS the normalizedName pre-exists (a conflict → [] → the fallback select
// resolves the existing id). insert(entityLinks).values().onConflictDoNothing() is
// awaited directly and records the links.
// ---------------------------------------------------------------------------

type Rows = Record<string, unknown>[];
interface DbConfig {
  settings?: Rows;
  meetingBriefs?: Rows;
  twinFacts?: Rows;
  liveSuggestions?: Rows;
  /** normalizedName → existing entity id (pre-existing rows insert-or-get reuses). */
  existingByNormalized?: Record<string, string>;
  /** When set, getDb().insert throws (exercises extractEntities's defensiveness). */
  insertThrows?: boolean;
}

const insertedEntities: Rows = [];
const insertedLinks: Rows = [];
let entitySeq = 0;

function makeDb(cfg: DbConfig) {
  const existing = cfg.existingByNormalized ?? {};

  const selectBuilder = (table: string) => {
    let normalizedFilter: string | null = null;
    const q: Record<string, unknown> = {
      from: () => q,
      where: (cond?: { eq?: unknown[] }) => {
        const pair = cond?.eq;
        if (Array.isArray(pair) && pair[0] === 'normalizedName') normalizedFilter = pair[1] as string;
        return q;
      },
      orderBy: () => q,
      limit: () => q,
      then: (res: (v: Rows) => unknown, rej: (e: unknown) => unknown) => {
        let out: Rows = [];
        if (table === 'meetingBriefs') out = cfg.meetingBriefs ?? [];
        else if (table === 'settings') out = cfg.settings ?? [];
        else if (table === 'twinFacts') out = cfg.twinFacts ?? [];
        else if (table === 'liveSuggestions') out = cfg.liveSuggestions ?? [];
        else if (table === 'entities' && normalizedFilter) {
          const id = existing[normalizedFilter];
          out = id ? [{ id }] : [];
        }
        return Promise.resolve(out).then(res, rej);
      },
    };
    return q;
  };

  return {
    select: () => ({ from: (t: { __table: string }) => selectBuilder(t.__table) }),
    insert: (t: { __table: string }) => {
      const table = t.__table;
      return {
        values: (vals: Record<string, unknown> | Rows) => {
          const chain: Record<string, unknown> = {
            onConflictDoNothing: () => chain,
            // entities insert-or-get (one row at a time): conflict ⇒ [], else a new id.
            returning: () => {
              if (cfg.insertThrows) throw new Error('insert boom');
              const v = (Array.isArray(vals) ? vals[0] : vals) as Record<string, unknown>;
              if (existing[v.normalizedName as string]) return Promise.resolve([]);
              const id = `ent-${entitySeq++}`;
              insertedEntities.push({ id, ...v });
              return Promise.resolve([{ id }]);
            },
            // entityLinks bulk insert (no returning) — awaited directly.
            then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
              if (cfg.insertThrows) return Promise.reject(new Error('insert boom')).then(res, rej);
              const arr = Array.isArray(vals) ? vals : [vals];
              if (table === 'entityLinks') insertedLinks.push(...arr);
              return Promise.resolve(undefined).then(res, rej);
            },
          };
          return chain;
        },
      };
    },
  };
}

function setDb(cfg: DbConfig) {
  vi.mocked(getDb).mockReturnValue(makeDb(cfg) as never);
}

const PROVIDER = { providerId: 'p1', providerName: 'lmstudio', apiKeyEncrypted: null, baseUrl: null, model: 'local' };
const MEETING_ID = 'meeting-1';
const BRIEF: MeetingBrief = { id: 'b1', meetingId: MEETING_ID, summary: 'Discussed billing.', createdAt: 'x' };

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Default happy path: not paused, a model, a brief to extract from. */
function happyDb(extra: Partial<DbConfig> = {}) {
  setDb({ settings: [], meetingBriefs: [{ summary: 'Acme is migrating billing to Stripe with Dana Lee.' }], ...extra });
}

beforeEach(() => {
  vi.clearAllMocks();
  insertedEntities.length = 0;
  insertedLinks.length = 0;
  entitySeq = 0;
  vi.mocked(resolveTaskModel).mockResolvedValue(PROVIDER as never);
  vi.mocked(generateValidated).mockResolvedValue([]);
  happyDb();
});

// ---------------------------------------------------------------------------
// Post-session hook wiring + order (facts BEFORE entities)
// ---------------------------------------------------------------------------

describe('post-session hook wiring + order', () => {
  it('is boot-registered and runs AFTER the facts hook (registration order = run order)', async () => {
    // Rely on import-time self-registration of BOTH hooks on the REAL dispatcher —
    // entityService imports twinMemoryService, so the FACTS hook registers first.
    setDb({
      settings: [],
      meetingBriefs: [{ summary: 'Discussed Acme billing.' }],
      liveSuggestions: [],
      twinFacts: [],
    });
    vi.mocked(generateValidated).mockResolvedValue([]); // both pipelines reach the model; neither writes

    dispatchPostSession({ meetingId: MEETING_ID, brief: BRIEF });
    await flush();

    const labels = vi.mocked(generateValidated).mock.calls.map((c) => (c[0] as { label: string }).label);
    const factsIdx = labels.findIndex((l) => l.startsWith('Fact extraction'));
    const entIdx = labels.findIndex((l) => l.startsWith('Entity extraction'));

    expect(factsIdx).toBeGreaterThanOrEqual(0); // facts pipeline boot-reachable
    expect(entIdx).toBeGreaterThanOrEqual(0); // entity pipeline boot-reachable
    expect(entIdx).toBeGreaterThan(factsIdx); // facts run BEFORE entities
  });

  it('the real hook is defensive — extractEntities swallows a DB failure and never throws', async () => {
    vi.mocked(getDb).mockImplementation(() => {
      throw new Error('db down');
    });
    await expect(entityPostSessionHook({ meetingId: MEETING_ID, brief: BRIEF })).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Gating + skip paths
// ---------------------------------------------------------------------------

describe('extractEntities — pause gate', () => {
  it('is a no-op when learning is paused (no model call, no writes)', async () => {
    setDb({ settings: [{ value: 'true' }], meetingBriefs: [{ summary: 'x' }] });

    const result = await extractEntities(MEETING_ID);

    expect(result).toEqual({ status: 'skipped', reason: 'paused', entities: [] });
    expect(vi.mocked(resolveTaskModel)).not.toHaveBeenCalled();
    expect(vi.mocked(generateValidated)).not.toHaveBeenCalled();
    expect(insertedEntities).toHaveLength(0);
    expect(insertedLinks).toHaveLength(0);
  });
});

describe('extractEntities — skip paths', () => {
  it('skips with no-model when no provider resolves', async () => {
    vi.mocked(resolveTaskModel).mockResolvedValue(null);
    const result = await extractEntities(MEETING_ID);
    expect(result).toEqual({ status: 'skipped', reason: 'no-model', entities: [] });
    expect(vi.mocked(generateValidated)).not.toHaveBeenCalled();
  });

  it('skips with failed when there is no brief (no material)', async () => {
    setDb({ settings: [], meetingBriefs: [] });
    const result = await extractEntities(MEETING_ID);
    expect(result).toEqual({ status: 'skipped', reason: 'failed', entities: [] });
    expect(vi.mocked(generateValidated)).not.toHaveBeenCalled();
  });

  it('skips with failed when extraction output is unusable (generateValidated → null)', async () => {
    vi.mocked(generateValidated).mockResolvedValue(null);
    const result = await extractEntities(MEETING_ID);
    expect(result).toEqual({ status: 'skipped', reason: 'failed', entities: [] });
  });

  it('returns ok with no entities when the model finds nothing concrete', async () => {
    vi.mocked(generateValidated).mockResolvedValue([]);
    const result = await extractEntities(MEETING_ID);
    expect(result).toEqual({ status: 'ok', entities: [] });
    expect(insertedEntities).toHaveLength(0);
    expect(insertedLinks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Routing + inputs (brief only, twin_learning)
// ---------------------------------------------------------------------------

describe('extractEntities — routing + inputs', () => {
  it('routes through the twin_learning task and feeds ONLY the brief (never a transcript)', async () => {
    setDb({ settings: [], meetingBriefs: [{ summary: 'Q3 billing migration with Dana Lee.' }] });
    vi.mocked(generateValidated).mockResolvedValue([{ name: 'Dana Lee', kind: 'person' }]);

    await extractEntities(MEETING_ID);

    expect(vi.mocked(resolveTaskModel)).toHaveBeenCalledWith('twin_learning');
    const opts = vi.mocked(generateValidated).mock.calls[0][0];
    expect(opts.taskType).toBe('twin_learning');
    expect(opts.context).toContain('Q3 billing migration with Dana Lee.');
    expect(opts.context.startsWith('Meeting brief:')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dedupe, cap, insert-or-get, provenance
// ---------------------------------------------------------------------------

describe('extractEntities — dedupe, cap, insert-or-get, provenance', () => {
  it('dedupes by normalizedName within the batch (first spelling wins)', async () => {
    vi.mocked(generateValidated).mockResolvedValue([
      { name: 'Acme Corp', kind: 'topic' },
      { name: 'acme corp', kind: 'topic' }, // normalized dup of the first
      { name: 'Bob', kind: 'person' },
    ]);

    const result = await extractEntities(MEETING_ID);

    expect(result.status).toBe('ok');
    expect(result.entities.map((e) => e.name)).toEqual(['Acme Corp', 'Bob']);
    expect(insertedEntities).toHaveLength(2);
    expect(insertedLinks).toHaveLength(2);
  });

  it('caps a session at 8 entities', async () => {
    vi.mocked(generateValidated).mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ({ name: `Topic ${i}`, kind: 'topic' as const })),
    );
    const result = await extractEntities(MEETING_ID);
    expect(result.entities).toHaveLength(8);
    expect(insertedEntities).toHaveLength(8);
    expect(insertedLinks).toHaveLength(8);
  });

  it('REUSES an existing entity (insert-or-get) instead of duplicating it', async () => {
    // "Dana Lee" already exists; only the genuinely-new topic is inserted, but BOTH
    // get a link to this session (provenance).
    setDb({
      settings: [],
      meetingBriefs: [{ summary: 'x' }],
      existingByNormalized: { 'dana lee': 'existing-dana' },
    });
    vi.mocked(generateValidated).mockResolvedValue([
      { name: 'Dana Lee', kind: 'person' }, // existing → reused
      { name: 'New Topic', kind: 'topic' }, // new → inserted
    ]);

    const result = await extractEntities(MEETING_ID);

    expect(result.entities.map((e) => e.name)).toEqual(['Dana Lee', 'New Topic']);
    // Only the new entity row was inserted; Dana Lee was resolved to her existing row.
    expect(insertedEntities.map((r) => r.name)).toEqual(['New Topic']);
    // Both entities are linked to THIS session — every link carries provenance.
    expect(insertedLinks).toContainEqual({ entityId: 'existing-dana', meetingId: MEETING_ID });
    expect(insertedLinks.every((l) => l.meetingId === MEETING_ID)).toBe(true);
    expect(insertedLinks).toHaveLength(2);
  });

  it('never throws even if the DB insert fails (defensive — returns skipped/failed)', async () => {
    happyDb({ insertThrows: true });
    vi.mocked(generateValidated).mockResolvedValue([{ name: 'Dana Lee', kind: 'person' }]);
    const result = await extractEntities(MEETING_ID);
    expect(result).toEqual({ status: 'skipped', reason: 'failed', entities: [] });
  });
});

// ---------------------------------------------------------------------------
// normalizeEntityName (the dedupe/lookup key)
// ---------------------------------------------------------------------------

describe('normalizeEntityName', () => {
  it('lowercases, collapses whitespace, and trims', () => {
    expect(normalizeEntityName('  Acme   Corp ')).toBe('acme corp');
    expect(normalizeEntityName('DANA lee')).toBe('dana lee');
  });
});
