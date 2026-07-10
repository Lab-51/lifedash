// === FILE PURPOSE ===
// Unit tests for the Digital Twin living-memory service (V3.4 Task 2). Proves the
// load-bearing contracts:
//   - the post-session hook is self-registered at import (boot-reachability) and,
//     when it (or extraction) throws, the dispatcher isolates it — a learning
//     failure never fails or delays the brief, and later hooks still run.
//   - extractFacts learns from the brief + ACCEPTED live suggestions (never the raw
//     transcript), gated by isLearningPaused (paused ⇒ no-op), skips cleanly with
//     no model / no material / bad output, dedupes against ACTIVE facts + within the
//     batch, caps at ~5, and stores provenance (sourceMeetingId) on every fact.
//   - it REUSES twinResearchService.generateValidated (mocked here) — no second
//     pipeline — routed through the twin_learning task.
//   - listFacts / forgetFact / restoreFact behave against twin_facts.
// The real post-session dispatcher is used (to prove wiring + isolation); the DB,
// ai-provider, and the shared extraction helper are mocked.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../ai-provider', () => ({ resolveTaskModel: vi.fn() }));
vi.mock('../twinResearchService', () => ({ generateValidated: vi.fn() }));
vi.mock('../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));
vi.mock('../../db/schema', () => ({
  settings: { __table: 'settings', key: 'key', value: 'value' },
  twinFacts: {
    __table: 'twinFacts',
    id: 'id',
    fact: 'fact',
    category: 'category',
    status: 'status',
    createdAt: 'createdAt',
  },
  meetingBriefs: { __table: 'meetingBriefs', meetingId: 'meetingId', summary: 'summary', createdAt: 'createdAt' },
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

import { extractFacts, listFacts, forgetFact, restoreFact, learningPostSessionHook } from '../twinMemoryService';
import { resolveTaskModel } from '../ai-provider';
import { generateValidated } from '../twinResearchService';
import { getDb } from '../../db/connection';
import { registerPostSessionHook, dispatchPostSession, _resetPostSessionHooks } from '../postSessionDispatcher';
import type { MeetingBrief } from '../../../shared/types';

// ---------------------------------------------------------------------------
// A table-routed Drizzle mock. select() routes by the .from(table) marker;
// insert().values().returning() echoes the inserted rows (with a generated id +
// createdAt) and records them; update().set().where().returning() echoes a
// preset row merged with the set patch (or [] when "not found").
// ---------------------------------------------------------------------------

type Rows = Record<string, unknown>[];
interface DbConfig {
  settings?: Rows;
  twinFacts?: Rows;
  meetingBriefs?: Rows;
  liveSuggestions?: Rows;
  /** Row echoed by update().returning(); undefined ⇒ [] (not found). */
  updateRow?: Record<string, unknown> | undefined;
  /** When set, getDb().insert throws (to exercise extractFacts's defensiveness). */
  insertThrows?: boolean;
}

const inserted: Rows = [];

function makeDb(cfg: DbConfig) {
  const build = (rows: Rows) => {
    let out = rows;
    const q: Record<string, unknown> = {
      where: (cond?: { eq?: unknown[] }) => {
        // Honor a direct eq(status, X) filter so the 'active' vs 'forgotten' fact
        // loaders return DISTINCT rows (rows with no status default to 'active').
        // Composite (and(...)) conditions carry no top-level `.eq` and are ignored.
        const pair = cond?.eq;
        if (Array.isArray(pair) && pair[0] === 'status') {
          const want = pair[1];
          out = out.filter((r) => ((r.status as string | undefined) ?? 'active') === want);
        }
        return q;
      },
      orderBy: () => q,
      limit: (n: number) => {
        out = out.slice(0, n);
        return q;
      },
      then: (res: (v: Rows) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(out).then(res, rej),
    };
    return q;
  };

  return {
    // Params are intentionally omitted — drizzle passes field projections / table
    // markers that this mock ignores (JS still allows the extra call args).
    select: () => ({
      from: (t: { __table: keyof DbConfig }) => build((cfg[t.__table] as Rows) ?? []),
    }),
    insert: () => ({
      values: (vals: Record<string, unknown> | Record<string, unknown>[]) => ({
        returning: () => {
          if (cfg.insertThrows) throw new Error('insert boom');
          const arr = Array.isArray(vals) ? vals : [vals];
          const rows = arr.map((v, i) => ({
            id: `new-${i}`,
            createdAt: new Date('2026-07-09T00:00:00Z'),
            status: 'active',
            sourceMeetingId: null,
            ...v,
          }));
          inserted.push(...rows);
          return Promise.resolve(rows);
        },
      }),
    }),
    update: () => ({
      set: (s: Record<string, unknown>) => ({
        where: () => ({
          returning: () => Promise.resolve(cfg.updateRow ? [{ ...cfg.updateRow, ...s }] : []),
        }),
      }),
    }),
  };
}

function setDb(cfg: DbConfig) {
  vi.mocked(getDb).mockReturnValue(makeDb(cfg) as never);
}

const PROVIDER = { providerId: 'p1', providerName: 'lmstudio', apiKeyEncrypted: null, baseUrl: null, model: 'local' };
const MEETING_ID = 'meeting-1';
const BRIEF: MeetingBrief = { id: 'b1', meetingId: MEETING_ID, summary: 'Discussed billing.', createdAt: 'x' };

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Default happy path: not paused, a model, a brief to learn from. */
function happyDb(extra: Partial<DbConfig> = {}) {
  setDb({
    settings: [],
    meetingBriefs: [{ summary: 'Acme is migrating billing to Stripe.' }],
    liveSuggestions: [],
    twinFacts: [],
    ...extra,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  inserted.length = 0;
  vi.mocked(resolveTaskModel).mockResolvedValue(PROVIDER as never);
  vi.mocked(generateValidated).mockResolvedValue([]);
  happyDb();
});

// ---------------------------------------------------------------------------
// Post-session hook wiring + error isolation
// ---------------------------------------------------------------------------

describe('post-session hook wiring', () => {
  it('is registered at module import and reaches extraction (boot-reachability)', async () => {
    // No _resetPostSessionHooks() yet — rely on twinMemoryService's import-time
    // self-registration. Dispatching a session must reach the extraction pipeline.
    happyDb();
    vi.mocked(generateValidated).mockResolvedValue([{ fact: 'Acme uses Stripe', category: 'domain' }]);

    dispatchPostSession({ meetingId: MEETING_ID, brief: BRIEF });
    await flush();

    expect(vi.mocked(resolveTaskModel)).toHaveBeenCalledWith('twin_learning');
    expect(vi.mocked(generateValidated)).toHaveBeenCalled();
  });

  it('isolates a throwing hook — never fails/delays the brief, later hooks still run', async () => {
    _resetPostSessionHooks();
    const throwingExtract = vi.fn(async () => {
      throw new Error('extraction boom');
    });
    registerPostSessionHook(() => throwingExtract());
    const laterHook = vi.fn();
    registerPostSessionHook(laterHook);

    // dispatch returns synchronously and NEVER throws even though a hook rejects.
    expect(() => dispatchPostSession({ meetingId: MEETING_ID, brief: BRIEF })).not.toThrow();
    await flush();

    expect(throwingExtract).toHaveBeenCalled();
    expect(laterHook).toHaveBeenCalled(); // isolation held — the throw didn't stop the chain
  });

  it('the real hook is defensive — extractFacts swallows a DB failure and never throws', async () => {
    // getDb throws → extractFacts must catch and return skipped (never throw into
    // the dispatcher). The hook awaits it and resolves cleanly.
    vi.mocked(getDb).mockImplementation(() => {
      throw new Error('db down');
    });
    await expect(learningPostSessionHook({ meetingId: MEETING_ID, brief: BRIEF })).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// extractFacts — gating, skip paths, dedupe, cap, provenance
// ---------------------------------------------------------------------------

describe('extractFacts — pause gate', () => {
  it('is a no-op when learning is paused (no model call, no writes)', async () => {
    setDb({ settings: [{ value: 'true' }], meetingBriefs: [{ summary: 'x' }] });

    const result = await extractFacts(MEETING_ID);

    expect(result).toEqual({ status: 'skipped', reason: 'paused', facts: [] });
    expect(vi.mocked(resolveTaskModel)).not.toHaveBeenCalled();
    expect(vi.mocked(generateValidated)).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });
});

describe('extractFacts — skip paths', () => {
  it('skips with no-model when no provider resolves', async () => {
    vi.mocked(resolveTaskModel).mockResolvedValue(null);
    const result = await extractFacts(MEETING_ID);
    expect(result).toEqual({ status: 'skipped', reason: 'no-model', facts: [] });
    expect(vi.mocked(generateValidated)).not.toHaveBeenCalled();
  });

  it('skips with failed when there is no brief and nothing accepted (no material)', async () => {
    setDb({ settings: [], meetingBriefs: [], liveSuggestions: [], twinFacts: [] });
    const result = await extractFacts(MEETING_ID);
    expect(result).toEqual({ status: 'skipped', reason: 'failed', facts: [] });
    expect(vi.mocked(generateValidated)).not.toHaveBeenCalled();
  });

  it('skips with failed when extraction output is unusable (generateValidated → null)', async () => {
    vi.mocked(generateValidated).mockResolvedValue(null);
    const result = await extractFacts(MEETING_ID);
    expect(result).toEqual({ status: 'skipped', reason: 'failed', facts: [] });
  });

  it('returns ok with no facts when everything deduped away (still no writes)', async () => {
    setDb({
      settings: [],
      meetingBriefs: [{ summary: 'x' }],
      liveSuggestions: [],
      twinFacts: [{ fact: 'Acme uses Stripe' }],
    });
    vi.mocked(generateValidated).mockResolvedValue([{ fact: 'acme uses stripe.', category: 'domain' }]);
    const result = await extractFacts(MEETING_ID);
    expect(result).toEqual({ status: 'ok', facts: [] });
    expect(inserted).toHaveLength(0);
  });
});

describe('extractFacts — extraction routing + inputs', () => {
  it('routes through the twin_learning task and feeds brief + accepted (never a transcript)', async () => {
    setDb({
      settings: [],
      meetingBriefs: [{ summary: 'Q3 billing migration brief.' }],
      liveSuggestions: [{ type: 'decision', title: 'Adopt Stripe', description: 'Team agreed' }],
      twinFacts: [{ fact: 'Sarah leads billing' }],
    });
    vi.mocked(generateValidated).mockResolvedValue([{ fact: 'Acme adopted Stripe', category: 'domain' }]);

    await extractFacts(MEETING_ID);

    expect(vi.mocked(resolveTaskModel)).toHaveBeenCalledWith('twin_learning');
    const opts = vi.mocked(generateValidated).mock.calls[0][0];
    expect(opts.taskType).toBe('twin_learning');
    expect(opts.context).toContain('Q3 billing migration brief.'); // the brief
    expect(opts.context).toContain('Adopt Stripe'); // accepted live suggestion
    expect(opts.context).toContain('Sarah leads billing'); // exclusion list of existing active facts
  });
});

describe('extractFacts — dedupe, cap, provenance', () => {
  it('dedupes against existing active facts AND within the batch', async () => {
    setDb({
      settings: [],
      meetingBriefs: [{ summary: 'x' }],
      liveSuggestions: [],
      twinFacts: [{ fact: 'Acme uses Stripe' }], // existing active
    });
    vi.mocked(generateValidated).mockResolvedValue([
      { fact: 'ACME uses Stripe.', category: 'domain' }, // dup of existing (normalized)
      { fact: 'Sarah is the PM', category: 'person' }, // new
      { fact: 'sarah is the pm', category: 'person' }, // dup within batch
      { fact: 'Roadmap ships in Q3', category: 'project' }, // new
    ]);

    const result = await extractFacts(MEETING_ID);

    expect(result.status).toBe('ok');
    expect(result.facts.map((f) => f.fact)).toEqual(['Sarah is the PM', 'Roadmap ships in Q3']);
    expect(inserted).toHaveLength(2);
  });

  it('caps a session at 5 facts', async () => {
    vi.mocked(generateValidated).mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({ fact: `Fact number ${i}`, category: 'domain' as const })),
    );
    const result = await extractFacts(MEETING_ID);
    expect(result.facts).toHaveLength(5);
    expect(inserted).toHaveLength(5);
  });

  it('stores provenance (sourceMeetingId) + active status on every learned fact', async () => {
    vi.mocked(generateValidated).mockResolvedValue([
      { fact: 'Acme uses Stripe', category: 'domain' },
      { fact: 'Sarah is the PM', category: 'person' },
    ]);
    const result = await extractFacts(MEETING_ID);

    expect(result.facts).toHaveLength(2);
    for (const f of result.facts) {
      expect(f.sourceMeetingId).toBe(MEETING_ID);
      expect(f.status).toBe('active');
    }
    // Every persisted row carried the provenance link.
    expect(inserted.every((r) => r.sourceMeetingId === MEETING_ID)).toBe(true);
  });

  it('never throws even if the DB insert fails (defensive — returns skipped/failed)', async () => {
    happyDb({ insertThrows: true });
    vi.mocked(generateValidated).mockResolvedValue([{ fact: 'Acme uses Stripe', category: 'domain' }]);
    const result = await extractFacts(MEETING_ID);
    expect(result).toEqual({ status: 'skipped', reason: 'failed', facts: [] });
  });
});

describe('extractFacts — forgotten facts are not silently re-learned', () => {
  it('does NOT re-insert a fact the user explicitly Forgot (dedupe spans forgotten)', async () => {
    setDb({
      settings: [],
      meetingBriefs: [{ summary: 'Billing sync brief.' }],
      liveSuggestions: [],
      // The user Forgot this fact: it is NOT active (so it is not in the model's
      // "Already known" list) but it must never be re-learned as a new active row.
      twinFacts: [{ fact: 'Acme uses Stripe', status: 'forgotten' }],
    });
    // The model re-emits the exact forgotten fact (normalized dup) plus a new one.
    vi.mocked(generateValidated).mockResolvedValue([
      { fact: 'ACME uses Stripe.', category: 'domain' },
      { fact: 'Sarah is the PM', category: 'person' },
    ]);

    const result = await extractFacts(MEETING_ID);

    // Only the genuinely-new fact is learned; the forgotten one stays forgotten.
    expect(result.status).toBe('ok');
    expect(result.facts.map((f) => f.fact)).toEqual(['Sarah is the PM']);
    expect(inserted.map((r) => r.fact)).toEqual(['Sarah is the PM']);

    // Privacy: forgotten content is a post-generation FILTER only — never disclosed
    // to the model (it must not leak into the prompt's exclusion list).
    const opts = vi.mocked(generateValidated).mock.calls[0][0];
    expect(opts.context).not.toContain('Acme uses Stripe');
  });
});

// ---------------------------------------------------------------------------
// listFacts / forgetFact / restoreFact
// ---------------------------------------------------------------------------

describe('listFacts', () => {
  it('maps twin_facts rows to the public fact shape', async () => {
    setDb({
      twinFacts: [
        {
          id: 'f1',
          fact: 'Acme uses Stripe',
          category: 'domain',
          sourceMeetingId: 'm1',
          status: 'active',
          createdAt: new Date('2026-07-08T00:00:00Z'),
        },
      ],
    });
    const facts = await listFacts({ status: 'active' });
    expect(facts).toEqual([
      {
        id: 'f1',
        fact: 'Acme uses Stripe',
        category: 'domain',
        sourceMeetingId: 'm1',
        status: 'active',
        createdAt: '2026-07-08T00:00:00.000Z',
      },
    ]);
  });

  it('returns [] when there are no facts', async () => {
    setDb({ twinFacts: [] });
    expect(await listFacts()).toEqual([]);
  });
});

describe('forgetFact / restoreFact', () => {
  const baseRow = {
    id: 'f1',
    fact: 'Acme uses Stripe',
    category: 'domain',
    sourceMeetingId: 'm1',
    status: 'active',
    createdAt: new Date('2026-07-08T00:00:00Z'),
  };

  it('forgetFact soft-deletes (status=forgotten) and returns the updated fact', async () => {
    setDb({ updateRow: baseRow });
    const fact = await forgetFact('f1');
    expect(fact?.status).toBe('forgotten');
    expect(fact?.id).toBe('f1');
  });

  it('restoreFact reactivates (status=active) and returns the updated fact', async () => {
    setDb({ updateRow: { ...baseRow, status: 'forgotten' } });
    const fact = await restoreFact('f1');
    expect(fact?.status).toBe('active');
  });

  it('returns null when the fact does not exist', async () => {
    setDb({ updateRow: undefined });
    expect(await forgetFact('nope')).toBeNull();
    expect(await restoreFact('nope')).toBeNull();
  });
});
