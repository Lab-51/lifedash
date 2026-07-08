// === FILE PURPOSE ===
// Unit tests for the Digital Twin "Build from my history" service (V3.3.5 Task 3).
// Proves the load-bearing contracts:
//   - getResearchHistoryInfo assembles counts + a provider label with ZERO model
//     calls (the hard privacy invariant — the consent descriptor never sends
//     anything anywhere) and derives isLocal per the app's local/cloud convention.
//   - assembleCorpus caps the corpus (≤10 meetings, per-meeting excerpt budget) and
//     only counts meetings that actually carry transcript content.
//   - mineProfile runs per-section validate-retry-skip: partial success is success,
//     a section retries once then skips, an empty corpus short-circuits (no model
//     call), and "nothing extracted" degrades to skipped/failed.
// ai-provider (resolveTaskModel/generate) and the DB layer are mocked — no real
// model or PGlite is touched.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../ai-provider', () => ({ resolveTaskModel: vi.fn(), generate: vi.fn() }));
vi.mock('../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));
vi.mock('../../db/schema', () => ({
  meetings: { __table: 'meetings' },
  transcripts: { __table: 'transcripts' },
  meetingBriefs: { __table: 'meetingBriefs' },
  projects: { __table: 'projects' },
  cards: { __table: 'cards' },
}));
vi.mock('drizzle-orm', () => ({
  desc: (x: unknown) => x,
  asc: (x: unknown) => x,
  eq: (...a: unknown[]) => a,
  and: (...a: unknown[]) => a,
  inArray: (...a: unknown[]) => a,
}));

import {
  getResearchHistoryInfo,
  researchHistory,
  assembleCorpus,
  mineProfile,
  type Corpus,
} from '../twinResearchService';
import { resolveTaskModel, generate } from '../ai-provider';
import { getDb } from '../../db/connection';

// ---------------------------------------------------------------------------
// A minimal chainable Drizzle mock: `.from(table)` selects a dataset, `.limit(n)`
// slices it (so the corpus caps are exercised), and every stage is awaitable.
// ---------------------------------------------------------------------------

type Rows = Record<string, unknown>[];
interface Data {
  meetings?: Rows;
  transcripts?: Rows;
  meetingBriefs?: Rows;
  projects?: Rows;
  cards?: Rows;
}

function makeDb(data: Data) {
  const build = (rows: Rows) => {
    let out = rows;
    const b = {
      where: () => b,
      orderBy: () => b,
      limit: (n: number) => {
        out = rows.slice(0, n);
        return b;
      },
      then: (res: (v: Rows) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(out).then(res, rej),
    };
    return b;
  };
  return { select: () => ({ from: (t: { __table: keyof Data }) => build(data[t.__table] ?? []) }) };
}

const LOCAL = {
  providerId: 'p1',
  providerName: 'lmstudio',
  apiKeyEncrypted: null,
  baseUrl: null,
  model: 'local',
  temperature: 0,
  maxTokens: 512,
};
const CLOUD = { ...LOCAL, providerName: 'openai' };

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// getResearchHistoryInfo — the consent descriptor (ZERO model calls)
// ---------------------------------------------------------------------------

describe('getResearchHistoryInfo — consent descriptor', () => {
  it('reports corpus counts + provider WITHOUT ever calling a model', async () => {
    vi.mocked(getDb).mockReturnValue(
      makeDb({
        meetings: [
          { id: 'm1', title: 'Sync', startedAt: new Date('2026-07-01') },
          { id: 'm2', title: 'Planning', startedAt: new Date('2026-07-02') },
        ],
        transcripts: [
          { meetingId: 'm1', content: 'We discussed billing', speaker: 'Sarah', startTime: 0 },
          { meetingId: 'm2', content: 'Roadmap for Q3', speaker: 'Tom', startTime: 0 },
        ],
        meetingBriefs: [{ id: 'b1', meetingId: 'm1', summary: 'Billing summary' }],
        projects: [{ id: 'pr1', name: 'Replatform', description: 'Stripe' }],
        cards: [
          { id: 'c1', title: 'Ship invoices' },
          { id: 'c2', title: 'Fix login' },
        ],
      }) as never,
    );
    vi.mocked(resolveTaskModel).mockResolvedValue(CLOUD as never);

    const info = await getResearchHistoryInfo();

    expect(info).toEqual({
      excerptCount: 2,
      briefCount: 1,
      projectCount: 1,
      cardCount: 2,
      providerLabel: 'openai',
      isLocal: false,
    });
    // The HARD privacy invariant: the descriptor sends nothing to any model.
    expect(generate).not.toHaveBeenCalled();
    expect(resolveTaskModel).toHaveBeenCalledWith('twin_interview');
  });

  it('marks a local provider isLocal (no model call)', async () => {
    vi.mocked(getDb).mockReturnValue(makeDb({ meetings: [], projects: [], cards: [] }) as never);
    vi.mocked(resolveTaskModel).mockResolvedValue(LOCAL as never);

    const info = await getResearchHistoryInfo();

    expect(info.isLocal).toBe(true);
    expect(info.providerLabel).toBe('lmstudio');
    expect(generate).not.toHaveBeenCalled();
  });

  it('reports "No model configured" (isLocal false) when nothing resolves — still no model call', async () => {
    vi.mocked(getDb).mockReturnValue(makeDb({ meetings: [], projects: [], cards: [] }) as never);
    vi.mocked(resolveTaskModel).mockResolvedValue(null);

    const info = await getResearchHistoryInfo();

    expect(info.providerLabel).toBe('No model configured');
    expect(info.isLocal).toBe(false);
    expect(generate).not.toHaveBeenCalled();
  });

  it('excludes meetings with no transcript from the excerpt count', async () => {
    vi.mocked(getDb).mockReturnValue(
      makeDb({
        meetings: [
          { id: 'm1', title: 'Has transcript', startedAt: new Date('2026-07-01') },
          { id: 'm2', title: 'No transcript', startedAt: new Date('2026-07-02') },
        ],
        transcripts: [{ meetingId: 'm1', content: 'hello', speaker: null, startTime: 0 }],
        projects: [],
        cards: [],
      }) as never,
    );
    vi.mocked(resolveTaskModel).mockResolvedValue(LOCAL as never);

    const info = await getResearchHistoryInfo();
    expect(info.excerptCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// assembleCorpus — caps + budgets
// ---------------------------------------------------------------------------

describe('assembleCorpus — caps + budgets', () => {
  it('caps recent meetings at 10 and clips each excerpt to the per-meeting budget', async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      id: `m${i}`,
      title: `Meeting ${i}`,
      startedAt: new Date(2026, 0, i + 1),
    }));
    const longContent = 'x'.repeat(5000);
    const trs = many.map((m) => ({ meetingId: m.id, content: longContent, speaker: null, startTime: 0 }));
    vi.mocked(getDb).mockReturnValue(makeDb({ meetings: many, transcripts: trs, projects: [], cards: [] }) as never);

    const corpus = await assembleCorpus();

    expect(corpus.meetings.length).toBe(10); // .limit(10) enforced by the query
    // Each excerpt is clipped well under the raw 5000 chars (1200 budget + ellipsis).
    expect(corpus.meetings[0].excerpt.length).toBeLessThanOrEqual(1201);
  });

  it('ranks the most frequent speakers first', async () => {
    vi.mocked(getDb).mockReturnValue(
      makeDb({
        meetings: [{ id: 'm1', title: 'Sync', startedAt: new Date('2026-07-01') }],
        transcripts: [
          { meetingId: 'm1', content: 'a', speaker: 'Sarah', startTime: 0 },
          { meetingId: 'm1', content: 'b', speaker: 'Sarah', startTime: 1 },
          { meetingId: 'm1', content: 'c', speaker: 'Tom', startTime: 2 },
        ],
        projects: [],
        cards: [],
      }) as never,
    );

    const corpus = await assembleCorpus();
    expect(corpus.speakers).toEqual(['Sarah', 'Tom']);
  });
});

// ---------------------------------------------------------------------------
// mineProfile — validate-retry-skip, partial success, empty corpus
// ---------------------------------------------------------------------------

const richCorpus = (): Corpus => ({
  meetings: [{ id: 'm1', title: 'Sync', dateLabel: '2026-07-01', excerpt: 'we ship billing; MRR grew' }],
  briefs: [{ id: 'b1', label: 'Sync', summary: 'billing summary' }],
  projects: [{ id: 'pr1', name: 'Replatform', description: 'Stripe' }],
  cards: [{ id: 'c1', title: 'Ship invoices' }],
  speakers: ['Sarah'],
});

/** Route the mock model by the section-identifying markers in the system prompt. */
function routeGenerate(byMarker: Record<string, string>) {
  vi.mocked(generate).mockImplementation((async (opts: { system?: string }) => {
    const s = opts.system ?? '';
    for (const [marker, text] of Object.entries(byMarker)) {
      if (s.includes(marker)) return { text };
    }
    return { text: '[]' };
  }) as never);
}

describe('mineProfile — extraction discipline', () => {
  it('returns ok with the sections that parsed and omits the rest (partial success)', async () => {
    routeGenerate({
      '"industry"': '{"industry":"SaaS","company":"Acme"}', // domain — object
      'active projects': '[{"name":"Replatform"}]', // projects — array
      '"org"': 'not json at all', // people — fails both attempts → skipped
      jargon: '[{"term":"MRR","meaning":"monthly recurring revenue"}]', // vocabulary
      'goals or priorities': '[]', // goals — empty → omitted
    });

    const result = await mineProfile(richCorpus(), LOCAL as never);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.draft.domain).toEqual({ industry: 'SaaS', company: 'Acme' });
    expect(result.draft.projects).toEqual([{ name: 'Replatform' }]);
    expect(result.draft.vocabulary).toEqual([{ term: 'MRR', meaning: 'monthly recurring revenue' }]);
    expect(result.draft.people).toBeUndefined(); // failed → skipped
    expect(result.draft.goals).toBeUndefined(); // empty → not counted
    // Sources attribute every corpus kind.
    expect(result.sources.map((x) => x.kind).sort()).toEqual(['brief', 'card', 'meeting', 'project']);
    expect(result.sources.find((x) => x.kind === 'meeting')?.label).toContain('Sync');
  });

  it('retries a section once on malformed output, then succeeds', async () => {
    let projectCalls = 0;
    vi.mocked(generate).mockImplementation((async (opts: { system?: string }) => {
      const s = opts.system ?? '';
      if (s.includes('active projects')) {
        projectCalls++;
        return { text: projectCalls === 1 ? 'garbage' : '[{"name":"X"}]' };
      }
      return { text: '[]' };
    }) as never);

    const corpus: Corpus = {
      meetings: [],
      briefs: [],
      projects: [{ id: 'pr1', name: 'X', description: null }],
      cards: [],
      speakers: [],
    };
    const result = await mineProfile(corpus, LOCAL as never);

    expect(projectCalls).toBe(2); // one retry
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.draft.projects).toEqual([{ name: 'X' }]);
  });

  it('skips a section without burning the retry when generation throws', async () => {
    vi.mocked(generate).mockRejectedValue(new Error('model offline'));
    const corpus: Corpus = {
      meetings: [],
      briefs: [],
      projects: [{ id: 'pr1', name: 'X', description: null }],
      cards: [],
      speakers: [],
    };

    const result = await mineProfile(corpus, LOCAL as never);
    expect(result).toEqual({ status: 'skipped', reason: 'failed' });
  });

  it('returns skipped/failed when nothing at all could be extracted', async () => {
    vi.mocked(generate).mockResolvedValue({ text: 'not json' } as never);
    const corpus: Corpus = {
      meetings: [{ id: 'm1', title: 'S', dateLabel: '', excerpt: 'hi' }],
      briefs: [],
      projects: [],
      cards: [],
      speakers: [],
    };

    const result = await mineProfile(corpus, LOCAL as never);
    expect(result).toEqual({ status: 'skipped', reason: 'failed' });
  });

  it('short-circuits an empty corpus to skipped/failed with no model call', async () => {
    const result = await mineProfile(
      { meetings: [], briefs: [], projects: [], cards: [], speakers: [] },
      LOCAL as never,
    );
    expect(result).toEqual({ status: 'skipped', reason: 'failed' });
    expect(generate).not.toHaveBeenCalled();
  });

  it('never sends the diarizer speaker block to the people miner (finding #6.3 — egress fully disclosed)', async () => {
    // People come from real names in the excerpts; the generic "Speaker N" labels
    // must never be sent (they were undisclosed by the consent descriptor).
    routeGenerate({ '"org"': '[{"name":"Sarah Chen","role":"PM"}]' });
    const corpus: Corpus = {
      meetings: [{ id: 'm1', title: 'Sync', dateLabel: '2026-07-01', excerpt: 'Sarah Chen led the roadmap review' }],
      briefs: [],
      projects: [],
      cards: [],
      speakers: ['Speaker 1', 'Speaker 2'],
    };

    await mineProfile(corpus, LOCAL as never);

    const peopleCall = vi
      .mocked(generate)
      .mock.calls.find(([opts]) => (opts as { system?: string }).system?.includes('"org"'));
    expect(peopleCall).toBeDefined();
    const prompt = (peopleCall![0] as { prompt?: string }).prompt ?? '';
    expect(prompt).toContain('Sarah Chen led the roadmap review'); // real names come from excerpts
    expect(prompt).not.toMatch(/Speaker \d/); // generic diarizer labels never leave the machine
    expect(prompt).not.toContain('who spoke');
  });
});

// ---------------------------------------------------------------------------
// researchHistory — end-to-end (resolve → assemble → mine)
// ---------------------------------------------------------------------------

describe('researchHistory', () => {
  it('skips with no-model when no provider resolves (nothing read, nothing sent)', async () => {
    vi.mocked(resolveTaskModel).mockResolvedValue(null);
    const result = await researchHistory();
    expect(result).toEqual({ status: 'skipped', reason: 'no-model' });
    expect(generate).not.toHaveBeenCalled();
  });

  it('assembles the corpus and mines a draft', async () => {
    vi.mocked(getDb).mockReturnValue(
      makeDb({
        meetings: [{ id: 'm1', title: 'Sync', startedAt: new Date('2026-07-01') }],
        transcripts: [{ meetingId: 'm1', content: 'billing and MRR', speaker: 'Sarah', startTime: 0 }],
        projects: [{ id: 'pr1', name: 'Replatform', description: 'Stripe' }],
        cards: [{ id: 'c1', title: 'Ship invoices' }],
      }) as never,
    );
    vi.mocked(resolveTaskModel).mockResolvedValue(LOCAL as never);
    routeGenerate({ 'active projects': '[{"name":"Replatform"}]' });

    const result = await researchHistory();

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.draft.projects).toEqual([{ name: 'Replatform' }]);
      expect(result.sources.find((s) => s.kind === 'meeting')?.label).toContain('Sync');
    }
  });
});
