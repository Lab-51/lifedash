// === FILE PURPOSE ===
// Unit tests for the V3.4 "Learned from sessions" injection added to the twin
// profile context builder. Proves the load-bearing contracts:
//   - learned facts are appended as the LOWEST-priority block (profile strictly
//     OUTRANKS facts on trim — a dropped profile section is never replaced by a
//     fact), most-recent first, with whole-ITEM trim (never mid-fact).
//   - the byte-identical guarantee: with NO profile AND no active facts (or paused
//     with none applied), the builder returns '' — byte-identical to pre-twin.
//   - injection is gated by the learning kill-switch: paused ⇒ inject NO facts;
//     otherwise only ACTIVE facts (listFacts({ status: 'active' })) are injected.
// serializeProfileContext is pure (tested directly); buildProfileContext's DB +
// twinMemoryService dependencies are mocked.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));
vi.mock('../../db/schema', () => ({
  twinProfile: { id: 'id' },
  TWIN_PROFILE_ID: 'singleton',
}));
vi.mock('../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../twinMemoryService', () => ({
  isLearningPaused: vi.fn().mockResolvedValue(false),
  listFacts: vi.fn().mockResolvedValue([]),
}));

import { serializeProfileContext, buildProfileContext } from '../twinProfileService';
import { getDb } from '../../db/connection';
import { isLearningPaused, listFacts } from '../twinMemoryService';
import type { TwinProfileSections, TwinFact } from '../../../shared/types/twin';

const HEADER = 'User profile (the professional you assist):';
const LEARNED_HEADER = 'Learned from sessions:';

const EMPTY: TwinProfileSections = {
  brief: {},
  identity: {},
  domain: {},
  projects: [],
  people: [],
  vocabulary: [],
  goals: [],
  preferences: {},
};

function withBrief(statement: string, extra: Partial<TwinProfileSections> = {}): TwinProfileSections {
  return { ...EMPTY, brief: { statement }, ...extra };
}

/** Mock getDb so getProfile() resolves to `rows` (a profile row, or none). */
function mockProfileRows(rows: unknown[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  vi.mocked(getDb).mockReturnValue({ select } as never);
}

function fact(over: Partial<TwinFact>): TwinFact {
  return {
    id: 'f',
    fact: 'a fact',
    category: 'domain',
    sourceMeetingId: 'm1',
    status: 'active',
    createdAt: '2026-07-08T00:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isLearningPaused).mockResolvedValue(false);
  vi.mocked(listFacts).mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// serializeProfileContext — learned-facts block (pure)
// ---------------------------------------------------------------------------

describe('serializeProfileContext — learned facts', () => {
  it('appends a "Learned from sessions" block AFTER the profile, in supplied (recency) order', () => {
    const out = serializeProfileContext(withBrief('A senior PM'), 'live_assistant', 100000, [
      'Acme adopted Stripe',
      'Sarah is the PM',
    ]);
    expect(out).toContain(`${LEARNED_HEADER}\n- Acme adopted Stripe\n- Sarah is the PM`);
    // Profile brief block comes before the learned block.
    expect(out.indexOf('Brief: A senior PM')).toBeLessThan(out.indexOf(LEARNED_HEADER));
  });

  it('injects facts even with NO profile (empty sections + facts ⇒ facts-only block)', () => {
    const out = serializeProfileContext(EMPTY, 'live_assistant', 100000, ['Acme adopted Stripe']);
    expect(out).toBe(`${HEADER}\n\n${LEARNED_HEADER}\n- Acme adopted Stripe`);
  });

  it('profile strictly OUTRANKS facts — a dropped profile section is never replaced by a fact', () => {
    // Budget fits header + the Brief block but NOT the next (Domain) block.
    const profile = withBrief('A senior PM', { domain: { industry: 'SaaS', company: 'Acme', focus: 'billing' } });
    const briefBlock = 'Brief: A senior PM';
    const budget = HEADER.length + 2 + briefBlock.length + 4; // no room for Domain (or any fact)

    const out = serializeProfileContext(profile, 'summarization', budget, ['x']);

    expect(out).toContain(briefBlock);
    expect(out).not.toContain('Domain'); // higher-priority profile block dropped...
    expect(out).not.toContain(LEARNED_HEADER); // ...so the lower-priority fact is dropped too
    expect(out.length).toBeLessThanOrEqual(budget);
  });

  it('trims facts whole-item (most-recent first) — never mid-fact', () => {
    // Empty profile so profile always fits; budget admits the header + first two facts only.
    const facts = ['newest fact here', 'second fact here', 'third fact dropped'];
    const twoFacts = [LEARNED_HEADER, '- newest fact here', '- second fact here'].join('\n');
    const budget = HEADER.length + 2 + twoFacts.length + 3; // not enough for the 3rd fact

    const out = serializeProfileContext(EMPTY, 'live_assistant', budget, facts);

    expect(out).toContain('- newest fact here');
    expect(out).toContain('- second fact here');
    expect(out).not.toContain('third fact dropped'); // whole least-recent fact dropped
    expect(out.endsWith('- ')).toBe(false); // never a dangling partial line
    expect(out.length).toBeLessThanOrEqual(budget);
  });

  it('BYTE-IDENTICAL: empty profile + no facts is "" and identical to the no-facts call', () => {
    const noFacts = serializeProfileContext(EMPTY, 'live_assistant');
    expect(noFacts).toBe('');
    expect(serializeProfileContext(EMPTY, 'live_assistant', undefined, [])).toBe('');
    // Adding an (all-blank) fact list changes nothing.
    expect(serializeProfileContext(EMPTY, 'live_assistant', undefined, ['   '])).toBe(noFacts);
  });

  it('a profile with facts is byte-identical to that profile alone when facts is empty', () => {
    const alone = serializeProfileContext(withBrief('A senior PM'), 'live_assistant');
    expect(serializeProfileContext(withBrief('A senior PM'), 'live_assistant', undefined, [])).toBe(alone);
  });
});

// ---------------------------------------------------------------------------
// buildProfileContext — gated injection + byte-identical no-op
// ---------------------------------------------------------------------------

describe('buildProfileContext — learned-fact injection', () => {
  it('BYTE-IDENTICAL no-op: no profile AND no active facts ⇒ "" (pre-twin behavior)', async () => {
    mockProfileRows([]); // no profile row
    vi.mocked(listFacts).mockResolvedValue([]);
    expect(await buildProfileContext('summarization')).toBe('');
  });

  it('injects ACTIVE facts (most-recent first) alongside the profile', async () => {
    mockProfileRows([
      {
        id: 'singleton',
        brief: { statement: 'A senior PM' },
        identity: {},
        domain: {},
        projects: [],
        people: [],
        vocabulary: [],
        goals: [],
        preferences: {},
        updatedAt: new Date('2026-07-08T00:00:00Z'),
      },
    ]);
    vi.mocked(listFacts).mockResolvedValue([fact({ fact: 'Acme adopted Stripe' }), fact({ fact: 'Sarah is the PM' })]);

    const out = await buildProfileContext('live_assistant');

    expect(out).toContain('Brief: A senior PM');
    expect(out).toContain(`${LEARNED_HEADER}\n- Acme adopted Stripe\n- Sarah is the PM`);
    // Only ACTIVE facts are requested (forgotten facts are excluded at the query).
    expect(vi.mocked(listFacts)).toHaveBeenCalledWith({ status: 'active' });
  });

  it('injects facts even when no profile exists (facts-only)', async () => {
    mockProfileRows([]);
    vi.mocked(listFacts).mockResolvedValue([fact({ fact: 'Acme adopted Stripe' })]);
    const out = await buildProfileContext('live_assistant');
    expect(out).toBe(`${HEADER}\n\n${LEARNED_HEADER}\n- Acme adopted Stripe`);
  });

  it('paused ⇒ NO facts injected and listFacts is never queried', async () => {
    mockProfileRows([]);
    vi.mocked(isLearningPaused).mockResolvedValue(true);
    // Even if facts existed, paused short-circuits before the query.
    const out = await buildProfileContext('summarization');
    expect(out).toBe('');
    expect(vi.mocked(listFacts)).not.toHaveBeenCalled();
  });

  it('paused with a profile ⇒ profile injected, learned facts suppressed', async () => {
    mockProfileRows([
      {
        id: 'singleton',
        brief: { statement: 'A senior PM' },
        identity: {},
        domain: {},
        projects: [],
        people: [],
        vocabulary: [],
        goals: [],
        preferences: {},
        updatedAt: new Date('2026-07-08T00:00:00Z'),
      },
    ]);
    vi.mocked(isLearningPaused).mockResolvedValue(true);

    const out = await buildProfileContext('live_assistant');

    expect(out).toContain('Brief: A senior PM');
    expect(out).not.toContain(LEARNED_HEADER);
    expect(vi.mocked(listFacts)).not.toHaveBeenCalled();
  });

  it('degrades to profile-only when the fact lookup throws (never breaks the prompt build)', async () => {
    mockProfileRows([
      {
        id: 'singleton',
        brief: { statement: 'A senior PM' },
        identity: {},
        domain: {},
        projects: [],
        people: [],
        vocabulary: [],
        goals: [],
        preferences: {},
        updatedAt: new Date('2026-07-08T00:00:00Z'),
      },
    ]);
    vi.mocked(listFacts).mockRejectedValue(new Error('facts table gone'));

    const out = await buildProfileContext('live_assistant');
    expect(out).toContain('Brief: A senior PM');
    expect(out).not.toContain(LEARNED_HEADER);
  });
});
