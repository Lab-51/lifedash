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

import { serializeProfileContext, buildProfileContext, BACKGROUND_NOTE } from '../twinProfileService';
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

/** The part of a serialized context the char budget measures: everything before the
 *  closing background note (which is appended outside the budget). */
function budgeted(out: string): string {
  return out.endsWith(BACKGROUND_NOTE) ? out.slice(0, -(BACKGROUND_NOTE.length + 2)) : out;
}

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
    label: null,
    category: 'domain',
    sourceMeetingId: 'm1',
    status: 'active',
    createdAt: '2026-07-08T00:00:00.000Z',
    ...over,
  };
}

/** A realistic, wholly synthetic 7-section profile (every section but Preferences). */
const REALISTIC_PROFILE: TwinProfileSections = {
  brief: {
    statement:
      'Product lead for the billing platform. I care most about release risk, customer commitments and who owns each follow-up.',
  },
  identity: { name: 'Jordan Vale', role: 'Product Lead', seniority: 'senior' },
  domain: { industry: 'B2B SaaS', company: 'Northwind Labs', focus: 'billing and invoicing' },
  projects: [
    { name: 'Ledger v2', description: 'rebuild of the invoicing engine' },
    { name: 'Tax Connect', description: 'EU VAT integration' },
    { name: 'Self-serve upgrades' },
  ],
  people: [
    { name: 'Eva Lindqvist', role: 'Engineering Manager', org: 'Northwind' },
    { name: 'Tomas Rehak', role: 'Finance Director' },
    { name: 'Priya Natarajan', role: 'Customer Success', org: 'Northwind' },
    { name: 'Marek Dvorak', role: 'Security Lead' },
  ],
  vocabulary: [
    { term: 'MRR', meaning: 'monthly recurring revenue' },
    { term: 'dunning', meaning: 'automated payment retry emails' },
    { term: 'proration', meaning: 'partial-period billing' },
    { term: 'GA', meaning: 'general availability' },
    { term: 'SOW', meaning: 'statement of work' },
    { term: 'NRR', meaning: 'net revenue retention' },
  ],
  goals: ['Ship Ledger v2 to GA this quarter', 'Cut failed-payment churn', 'Keep the EU VAT audit clean'],
  preferences: {},
};

const REALISTIC_FACTS = [
  'Ledger v2 GA moved to late October',
  'Eva owns the dunning rework',
  'Finance wants proration fixed before GA',
  'Tax Connect needs a legal review',
  'Priya flagged two churn-risk accounts',
  'Security review is booked for Ledger v2',
  'Self-serve upgrades are paused',
  'Tomas approved the VAT budget',
  'The dunning emails go out on day three',
  'Marek wants SSO for the admin console',
];

const SECTION_LABEL: Record<keyof TwinProfileSections, string> = {
  brief: 'Brief',
  identity: 'Identity',
  domain: 'Domain',
  projects: 'Projects',
  people: 'People',
  vocabulary: 'Vocabulary',
  goals: 'Goals',
  preferences: 'Preferences',
};

/** The emitted profile blocks, keyed by section label. */
function blocksByLabel(out: string): Map<string, string> {
  const blocks = budgeted(out).split('\n\n').slice(1); // [0] is the header
  return new Map(blocks.map((b) => [b.slice(0, b.indexOf(':')), b]));
}

/** The smallest form a section can take: its first entry, or the whole block. */
function smallestBlock(profile: TwinProfileSections, key: keyof TwinProfileSections): string {
  const value = profile[key];
  const one = Array.isArray(value) ? { ...EMPTY, [key]: value.slice(0, 1) } : { ...EMPTY, [key]: value };
  return budgeted(serializeProfileContext(one as TwinProfileSections, 'live_assistant', 100000)).split('\n\n')[1];
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
    expect(out).toBe(`${HEADER}\n\n${LEARNED_HEADER}\n- Acme adopted Stripe\n\n${BACKGROUND_NOTE}`);
  });

  it('a full profile cannot crowd out every learned fact — a share of the budget is reserved for them', () => {
    // On triage, Domain is a lower-priority section that would fill the whole budget;
    // the old behaviour then dropped every fact. Now Domain gives way and the fact
    // still rides along.
    const profile = withBrief('A senior PM', {
      domain: { industry: 'SaaS', company: 'Acme', focus: 'billing and invoicing for mid-size teams' },
    });
    const facts = ['Acme moved invoicing to Stripe'];
    const domainBlock = 'Domain: industry: SaaS; company: Acme; focus: billing and invoicing for mid-size teams';
    // Exactly enough for header + Brief + Domain: with no facts the profile fills it.
    const budget = HEADER.length + 2 + 'Brief: A senior PM'.length + 2 + domainBlock.length;
    const withoutFacts = serializeProfileContext(profile, 'live_triage', budget);
    expect(withoutFacts).toContain('Domain'); // control: with no facts the profile uses the room

    const out = serializeProfileContext(profile, 'live_triage', budget, facts);

    expect(out).toContain('Brief: A senior PM'); // top-priority block always survives
    expect(out).toContain('- Acme moved invoicing to Stripe');
    expect(budgeted(out).length).toBeLessThanOrEqual(budget);
  });

  it('with room to spare, every profile block AND the facts are kept (the reserve is a floor, not a cap)', () => {
    const profile = withBrief('A senior PM', { domain: { industry: 'SaaS' } });
    const out = serializeProfileContext(profile, 'live_assistant', 100000, ['Acme adopted Stripe']);
    expect(out).toContain('Domain: industry: SaaS');
    expect(out).toContain('- Acme adopted Stripe');
  });

  it('chooses the facts most relevant to the meeting when the budget fits only some, then recency', () => {
    const facts = [
      'Newest note about the office move',
      'Older note about the Stripe migration',
      'Oldest unrelated note',
    ];
    const oneFact = [LEARNED_HEADER, `- ${facts[1]}`].join('\n');
    const budget = HEADER.length + 2 + oneFact.length + 3; // room for exactly one

    const recencyOnly = serializeProfileContext(EMPTY, 'live_assistant', budget, facts);
    const forThisMeeting = serializeProfileContext(
      EMPTY,
      'live_assistant',
      budget,
      facts,
      'Planning the Stripe migration',
    );

    expect(recencyOnly).toContain('Newest note about the office move'); // control: recency picks the newest
    expect(forThisMeeting).toContain('Older note about the Stripe migration');
    expect(forThisMeeting).not.toContain('Newest note about the office move');
  });

  it('frames the whole block as background, last, outside the budget', () => {
    const facts = ['Acme adopted Stripe'];
    const content = budgeted(serializeProfileContext(withBrief('A senior PM'), 'live_assistant', 100000, facts));
    // A budget that fits the profile and facts exactly: the note costs neither.
    const out = serializeProfileContext(withBrief('A senior PM'), 'live_assistant', content.length, facts);
    expect(out).toBe(`${content}\n\n${BACKGROUND_NOTE}`);
  });

  it('the note frames the profile as background without forbidding its use', () => {
    expect(BACKGROUND_NOTE).toContain('not an instruction');
    expect(BACKGROUND_NOTE).toContain('not something said in this meeting');
    // The live assistant must still be able to answer "what is Eva's role?" from it.
    expect(BACKGROUND_NOTE).not.toMatch(/does not support|only (?:use|when)/i);
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
    expect(budgeted(out).length).toBeLessThanOrEqual(budget);
  });

  it('no Brief + a long vocabulary on triage still leaves room for facts (precedence follows the list)', () => {
    const vocabulary = Array.from({ length: 40 }, (_, n) => ({
      term: `Term${n + 1}`,
      meaning: `meaning of synthetic term ${n + 1}`,
    }));
    const out = serializeProfileContext({ ...EMPTY, vocabulary }, 'live_triage', undefined, REALISTIC_FACTS);
    expect(out).toContain('Vocabulary:\n- Term1: meaning of synthetic term 1'); // trimmed, not dropped
    expect(out).toContain(LEARNED_HEADER);
    expect(budgeted(out).length).toBeLessThanOrEqual(800);
  });

  it('a long vocabulary pays for Projects (the next core section on triage) itself, not out of the facts share', () => {
    const vocabulary = Array.from({ length: 20 }, (_, n) => ({
      term: `Term${n + 1}`,
      meaning: `meaning of synthetic term ${n + 1}`,
    }));
    const learned = (out: string) => blocksByLabel(out).get('Learned from sessions');
    const baseline = serializeProfileContext(REALISTIC_PROFILE, 'live_triage', undefined, REALISTIC_FACTS);

    const out = serializeProfileContext(
      { ...REALISTIC_PROFILE, vocabulary },
      'live_triage',
      undefined,
      REALISTIC_FACTS,
    );

    expect(out).toContain('Vocabulary:\n- Term1:'); // trimmed, not dropped
    expect(out).toContain('Projects:\n- Ledger v2: rebuild of the invoicing engine');
    expect(learned(out)).toBeDefined();
    expect(learned(out)).toBe(learned(baseline)); // the facts keep the share they get with a short vocabulary
  });

  it('a core section that only fits by using the facts share is never dropped for the facts', () => {
    // A Brief too long to leave the facts their reserve on triage still outranks them.
    const statement = Array.from({ length: 17 }, (_, n) => `Synthetic brief sentence number ${n + 1}.`).join(' ');
    const out = serializeProfileContext(withBrief(statement), 'live_triage', undefined, REALISTIC_FACTS);
    expect(out).toContain(`Brief: ${statement}`);
    expect(budgeted(out).length).toBeLessThanOrEqual(800);
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
// serializeProfileContext — default budgets, realistic profile + facts
// ---------------------------------------------------------------------------

describe('serializeProfileContext — a realistic profile and facts at the DEFAULT budgets', () => {
  // Each task's priority list and default budget, as the service defines them.
  const cases: [string, number, (keyof TwinProfileSections)[]][] = [
    ['live_triage', 800, ['brief', 'vocabulary', 'projects', 'people', 'identity', 'domain', 'goals']],
    ['live_assistant', 1500, ['brief', 'identity', 'goals', 'domain', 'projects', 'people', 'vocabulary']],
    ['summarization', 1200, ['brief', 'domain', 'people', 'identity', 'projects', 'vocabulary', 'goals']],
  ];

  it.each(cases)('%s keeps its top three sections AND some facts, in priority order', (task, budget, priority) => {
    const out = serializeProfileContext(REALISTIC_PROFILE, task as never, undefined, REALISTIC_FACTS);
    const blocks = blocksByLabel(out);

    expect(budgeted(out).length).toBeLessThanOrEqual(budget);
    for (const key of priority.slice(0, 3)) expect(blocks.has(SECTION_LABEL[key])).toBe(true);
    expect(out).toContain(LEARNED_HEADER);

    // Never a lower-priority section emitted while a higher one that could have fit
    // (in its smallest whole-entry form) was dropped.
    priority.forEach((higher, i) => {
      if (blocks.has(SECTION_LABEL[higher])) return;
      for (const lower of priority.slice(i + 1)) {
        const kept = blocks.get(SECTION_LABEL[lower]);
        if (kept) expect(smallestBlock(REALISTIC_PROFILE, higher).length).toBeGreaterThan(kept.length);
      }
    });
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
    expect(out).toBe(`${HEADER}\n\n${LEARNED_HEADER}\n- Acme adopted Stripe\n\n${BACKGROUND_NOTE}`);
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
