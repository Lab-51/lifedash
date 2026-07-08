// === FILE PURPOSE ===
// Digital Twin -> triage prompt precision harness (V3.3 Task 5 close-out).
//
// HONESTY NOTE (session decision — no fabricated accuracy claims): this harness
// proves that PROFILE-INJECTION PLUMBING changes the triage system prompt in the
// intended direction — when a twin profile exists, the user's own vocabulary
// reaches the model's system prompt; when it doesn't, the prompt is byte-identical
// to the pre-V3.3 baseline. It demonstrates this with a small, fully scripted mock
// "model" that can only echo a vocabulary term back if that term is actually
// present in the system prompt it was handed. It does NOT invoke a real LLM and
// makes NO claim about a real model's actual precision at using injected context.
// Real precision is judged at the user's manual smoke test (create a twin via the
// wizard, run a real meeting, confirm triage/assistant/briefs visibly use profile
// terms, edit the profile, confirm the next prompt reflects it).
//
// Mirrors the fixture + scoring-helper structure of
// projectDetectionService.fixtures.test.ts: a fixture array, a scoring rule, and
// an aggregate pass/fail assertion across every fixture.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports (mirrors liveTriageService.test.ts)
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({ BrowserWindow: class {} }));

vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));

vi.mock('../../db/schema', () => ({
  liveSuggestions: { meetingId: 'meetingId', title: 'title', type: 'type' },
  twinProfile: { id: 'id' },
  TWIN_PROFILE_ID: 'singleton',
}));

vi.mock('../meetingService', () => ({ getMeeting: vi.fn() }));

vi.mock('../ai-provider', () => ({ resolveTaskModel: vi.fn(), generate: vi.fn() }));

vi.mock('../../ipc/meeting-agent', () => ({ isMeetingAgentStreamActive: vi.fn(() => false) }));

vi.mock('../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// Keep the REAL serializeProfileContext (pure + deterministic — see twinProfileService.ts)
// so fixture profile blocks are built exactly as production does; mock only the
// DB-backed buildProfileContext so each fixture can toggle profile ON/OFF without a DB.
vi.mock('../twinProfileService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../twinProfileService')>();
  return { ...actual, buildProfileContext: vi.fn() };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { buildTriageSystemPrompt, buildSystemPrompt, parseSuggestions } from '../liveTriageService';
import { buildProfileContext, serializeProfileContext } from '../twinProfileService';
import type { TwinProfileSections, TwinVocabularyTerm } from '../../../shared/types/twin';

/**
 * Exact header text the profile block always starts with (V3.3 Task 2 contract —
 * see twinProfileService.ts's CONTEXT_HEADER). Asserted verbatim so this harness
 * also catches an accidental header wording change.
 */
const PROFILE_HEADER = 'User profile (the professional you assist):';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EMPTY_SECTIONS: Omit<TwinProfileSections, 'vocabulary'> = {
  brief: {},
  identity: {},
  domain: {},
  projects: [],
  people: [],
  goals: [],
  preferences: {},
};

function profileWithVocab(vocabulary: TwinVocabularyTerm[]): TwinProfileSections {
  return { ...EMPTY_SECTIONS, vocabulary };
}

interface PrecisionFixture {
  name: string;
  /** A realistic meeting excerpt that would, in a real run, prompt this action item. */
  transcript: string;
  /** The twin profile authored for this "professional". */
  profile: TwinProfileSections;
  /** The vocabulary term the profile should surface into the system prompt. */
  expectedTerm: string;
  /** What the mock model returns when it CAN see expectedTerm in its system prompt. */
  onTitle: string;
  /** What the mock model returns when it CANNOT (profile OFF — generic phrasing). */
  offTitle: string;
  /** Whether the meeting is unlinked (offers the 4th "project" kind) — default false. */
  projectEligible?: boolean;
}

const fixtures: PrecisionFixture[] = [
  {
    name: 'arr-renewal',
    transcript:
      "The customer wants to lock in next year's contract before their renewal date. Finance needs the updated number before Friday.",
    profile: profileWithVocab([{ term: 'ARR', meaning: 'annual recurring revenue' }]),
    expectedTerm: 'ARR',
    onTitle: 'Confirm the updated ARR number with finance before Friday',
    offTitle: 'Confirm the updated number with finance before Friday',
  },
  {
    name: 'nps-survey',
    transcript: "We should check in with last quarter's power users on satisfaction before the renewal push.",
    profile: profileWithVocab([{ term: 'NPS', meaning: 'net promoter score' }]),
    expectedTerm: 'NPS',
    onTitle: "Send the NPS survey to last quarter's power users",
    offTitle: "Send the satisfaction survey to last quarter's power users",
  },
  {
    name: 'sprint-velocity',
    transcript:
      'The team committed to more than they finished last sprint again — we should recheck the numbers before planning.',
    profile: profileWithVocab([{ term: 'velocity', meaning: 'story points completed per sprint' }]),
    expectedTerm: 'velocity',
    onTitle: 'Recalculate team velocity before committing next sprint',
    offTitle: 'Recalculate team capacity before committing next sprint',
  },
  {
    name: 'retention-standup',
    transcript: 'Enterprise cancellations ticked up again this month and nobody has looked into why yet.',
    profile: profileWithVocab([{ term: 'churn', meaning: 'customers who cancel' }]),
    expectedTerm: 'churn',
    onTitle: 'Investigate the spike in churn from enterprise accounts',
    offTitle: 'Investigate the spike in cancellations from enterprise accounts',
  },
  {
    name: 'finance-forecast',
    transcript: 'Once the enterprise deal closes, the revenue forecast needs a refresh before the board meeting.',
    profile: profileWithVocab([{ term: 'MRR', meaning: 'monthly recurring revenue' }]),
    expectedTerm: 'MRR',
    onTitle: 'Reforecast MRR after the enterprise deal closes',
    offTitle: 'Reforecast revenue after the enterprise deal closes',
  },
  {
    name: 'okr-checkin',
    transcript: 'Q3 goals need an update after the roadmap change — the tracker is already stale.',
    profile: profileWithVocab([{ term: 'OKR', meaning: 'objectives and key results' }]),
    expectedTerm: 'OKR',
    onTitle: 'Update the Q3 OKR tracker with the new target',
    offTitle: 'Update the Q3 goal tracker with the new target',
  },
  {
    name: 'runway-review',
    transcript:
      'If we approve the new hire budget, someone needs to redo the cash-out math before the investor update.',
    profile: {
      ...EMPTY_SECTIONS,
      vocabulary: [{ term: 'runway', meaning: 'months of cash remaining' }],
      identity: { name: 'Dana', role: 'Founder' },
      domain: { industry: 'SaaS', company: 'Acme' },
    },
    expectedTerm: 'runway',
    onTitle: 'Recalculate runway after the new hire budget is approved',
    offTitle: 'Recalculate the cash budget after the new hire budget is approved',
  },
  {
    name: 'icp-workshop',
    transcript:
      'Sales keeps prospecting outside our best-fit customer segment — we should write down who actually converts.',
    profile: profileWithVocab([{ term: 'ICP', meaning: 'ideal customer profile' }]),
    expectedTerm: 'ICP',
    onTitle: 'Draft the updated ICP doc for the sales team',
    offTitle: 'Draft the updated customer profile doc for the sales team',
    projectEligible: true,
  },
];

/**
 * The "scored mock model" (per plan): a fully scripted LLM stand-in that rewards
 * vocabulary hits — it can only use the profile's term in its answer if that term
 * is actually present in the system prompt it was given. This is what lets a
 * deterministic test demonstrate DIRECTION (profile ON -> term surfaces in the
 * output, profile OFF -> it structurally can't) without pretending to model real
 * LLM behavior.
 */
function mockModelTitle(systemPrompt: string, fixture: PrecisionFixture): string {
  return systemPrompt.includes(fixture.expectedTerm) ? fixture.onTitle : fixture.offTitle;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the ON (profile injected) and OFF (no profile) triage system prompts for a fixture. */
async function buildPrompts(fixture: PrecisionFixture): Promise<{ on: string; off: string }> {
  const projectEligible = fixture.projectEligible ?? false;

  vi.mocked(buildProfileContext).mockResolvedValueOnce(serializeProfileContext(fixture.profile, 'live_triage'));
  const on = await buildTriageSystemPrompt(projectEligible);

  vi.mocked(buildProfileContext).mockResolvedValueOnce('');
  const off = await buildTriageSystemPrompt(projectEligible);

  return { on, off };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('triage profile precision harness (prompt plumbing, NOT real-model accuracy)', () => {
  it(`covers ${fixtures.length} distinct professional vocabularies (>= 6, all unique)`, () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(6);
    expect(new Set(fixtures.map((f) => f.expectedTerm)).size).toBe(fixtures.length);
  });

  it('profile OFF is byte-identical to the pre-V3.3 base prompt for every fixture (regression guard)', async () => {
    for (const fixture of fixtures) {
      const { off } = await buildPrompts(fixture);
      expect(off).toBe(buildSystemPrompt(fixture.projectEligible ?? false));
      expect(off).not.toContain(PROFILE_HEADER);
      expect(off).not.toContain(fixture.expectedTerm);
    }
  });

  it("profile ON prepends the exact header and the fixture's vocabulary term for every fixture", async () => {
    for (const fixture of fixtures) {
      const { on } = await buildPrompts(fixture);
      expect(on.startsWith(PROFILE_HEADER)).toBe(true);
      expect(on).toContain(fixture.expectedTerm);
      expect(on).toContain('You extract concrete'); // base instructions still present after the block
    }
  });

  it("the scored mock model surfaces the profile's vocabulary ON but never OFF, across every fixture", async () => {
    const results: { name: string; passed: boolean }[] = [];

    for (const fixture of fixtures) {
      const { on, off } = await buildPrompts(fixture);
      const onTitle = mockModelTitle(on, fixture);
      const offTitle = mockModelTitle(off, fixture);

      // parseSuggestions is the REAL validator (not reimplemented) — proves these
      // are well-formed triage drafts the pipeline would actually accept.
      const [onDraft] = parseSuggestions(JSON.stringify([{ type: 'action_item', title: onTitle }]));
      const [offDraft] = parseSuggestions(JSON.stringify([{ type: 'action_item', title: offTitle }]));

      const passed = onDraft.title.includes(fixture.expectedTerm) && !offDraft.title.includes(fixture.expectedTerm);
      results.push({ name: fixture.name, passed });
    }

    const failed = results.filter((r) => !r.passed);
    if (failed.length > 0) {
      throw new Error(`Plumbing did not change direction for: ${failed.map((f) => f.name).join(', ')}`);
    }
    expect(failed).toHaveLength(0);
  });
});
