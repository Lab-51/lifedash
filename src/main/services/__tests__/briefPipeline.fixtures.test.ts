// === FILE PURPOSE ===
// Scored structural test for the brief pipeline (BRIEF-QUAL.1 Task 5), against
// the SYNTHETIC fixtures in ./fixtures/briefEvalFixtures.ts. `generate()` is
// mocked to derive a plausible extraction DRAFT straight from the fixture's own
// ground-truth rows (detecting which part it received by which ground-truth
// anchor text — a topic title, a decision statement, a commitment task —
// literally appears in that call's prompt), so this file proves PLUMBING: that
// nothing is lost across chunking + merge, that owner rules survive, and that
// the writer prompt carries every ground-truth item. It does NOT measure model
// quality — that is briefPipeline.live.test.ts's job (AI-CTX.1 (h)).
//
// The REAL `extractMeetingStructure` is obtained via `vi.importActual` inside
// the tests that drive it directly, bypassing the module-level mock below —
// `generateBrief`'s OWN internal call to it stays mocked (the
// meetingIntelligenceService.writer.test.ts pattern), so one file can prove
// both "the real extractor loses nothing" and "the writer renders everything
// the extractor handed it" without the two paths interfering.
//
// `LIFEDASH_LLAMA_CTX` is pinned small for the whole file so the long fixture's
// ~65k-char transcript reliably chunks into several parts under the `builtin`
// provider, and so the writer's own fits-check reliably falls back to the
// structured notes alone (mirrors meetingIntelligenceService.contextBudget.test.ts).

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/tmp', getPath: () => '/tmp' },
}));

const { logMock } = vi.hoisted(() => ({
  logMock: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../logger', () => ({ createLogger: () => logMock }));

vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));

vi.mock('../../db/schema', () => ({
  meetingBriefs: {
    __table: 'meetingBriefs',
    meetingId: 'meetingId',
    summary: 'summary',
    structure: 'structure',
    createdAt: 'createdAt',
  },
  actionItems: {
    __table: 'actionItems',
    id: 'id',
    meetingId: 'meetingId',
    status: 'status',
    cardId: 'cardId',
    description: 'description',
    owner: 'owner',
    dueText: 'dueText',
    createdAt: 'createdAt',
  },
  cards: {},
  meetings: { __table: 'meetings', id: 'id', projectId: 'projectId' },
  projects: { __table: 'projects', id: 'id', system: 'system', archived: 'archived' },
  liveSuggestions: {
    __table: 'liveSuggestions',
    meetingId: 'meetingId',
    type: 'type',
    title: 'title',
    description: 'description',
    status: 'status',
  },
  calendarEvents: { __table: 'calendarEvents', id: 'id', title: 'title', attendees: 'attendees' },
  entities: {},
  entityLinks: {},
  settings: { __table: 'settings', key: 'key', value: 'value' },
}));

vi.mock('../meetingService', () => ({
  registerMeetingCompletedHook: vi.fn(), // module-scope self-registration (TWIN-LEARN.1)
  getMeeting: vi.fn(),
  updateMeeting: vi.fn().mockResolvedValue({}),
}));

vi.mock('../ai-provider', () => ({ generate: vi.fn(), resolveTaskModel: vi.fn() }));

vi.mock('../autoPushService', () => ({
  autoPushActionItems: vi.fn().mockResolvedValue({ pushedCount: 0, skippedCount: 0, cards: [] }),
  readAutoPushSetting: vi.fn().mockResolvedValue(true),
  formatOwnerDueLines: vi.fn(() => ''),
}));

vi.mock('../unassignedProjectService', () => ({
  ensureUnassignedProject: vi.fn().mockResolvedValue({ id: 'unassigned-id', name: 'Unassigned', system: true }),
}));

vi.mock('../projectDetectionService', () => ({ detectProjectFromTranscript: vi.fn() }));

vi.mock('../../../shared/utils/action-item-parser', () => ({ parseActionItems: vi.fn() }));

vi.mock('../../../shared/types', () => ({ MEETING_TEMPLATES: [] }));

vi.mock('../twinProfileService', () => ({ buildProfileContext: vi.fn().mockResolvedValue('') }));

vi.mock('../postSessionDispatcher', () => ({ dispatchPostSession: vi.fn() }));

// generateBrief's OWN extraction call stays mocked (the writer.test.ts pattern);
// the real extractor is reached via vi.importActual in the tests that drive it.
vi.mock('../briefExtractionService', () => ({ extractMeetingStructure: vi.fn() }));

vi.mock('../briefLanguageSettings', () => ({ readBriefLanguageSetting: vi.fn(async () => 'en') }));

// The ONE pure helper participantRosterService imports from entityService.
vi.mock('../entityService', () => ({
  normalizeEntityName: (name: string) => name.toLowerCase().replace(/\s+/g, ' ').trim(),
}));

// Real module except for the DB-backed roster build — formatRosterBlock is the
// shipped wording the system-prompt assertions below check against.
vi.mock('../participantRosterService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../participantRosterService')>()),
  buildRoster: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { generateBrief } from '../meetingIntelligenceService';
import { getMeeting } from '../meetingService';
import { generate, resolveTaskModel, type ResolvedProvider } from '../ai-provider';
import { getDb } from '../../db/connection';
import { extractMeetingStructure } from '../briefExtractionService';
import { buildRoster, formatRosterBlock } from '../participantRosterService';
import { BRIEF_STRUCTURE_SCHEMA_VERSION, type MeetingStructure } from '../../../shared/types/briefStructure';
import {
  LONG_FIXTURE,
  SHORT_FIXTURE,
  scoreStructure,
  type FixtureTruth,
  type LongFixture,
} from './fixtures/briefEvalFixtures';

// ---------------------------------------------------------------------------
// Env pin — see the file header. Mirrors contextBudget.test.ts exactly.
// ---------------------------------------------------------------------------

const SAVED_CTX_ENV = process.env.LIFEDASH_LLAMA_CTX;
process.env.LIFEDASH_LLAMA_CTX = '10000';
afterAll(() => {
  if (SAVED_CTX_ENV === undefined) delete process.env.LIFEDASH_LLAMA_CTX;
  else process.env.LIFEDASH_LLAMA_CTX = SAVED_CTX_ENV;
});

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const BUILTIN_PROVIDER: ResolvedProvider = {
  providerId: 'eval-builtin',
  providerName: 'builtin',
  apiKeyEncrypted: null,
  baseUrl: null,
  model: 'eval-model',
  temperature: 0.3,
  maxTokens: undefined,
};

/** A plausible extraction draft for ONE part's prompt: every ground-truth row
 *  whose anchor text (title/statement/task) literally appears in that prompt.
 *  Detecting membership dynamically (rather than by part index) makes this
 *  correct regardless of exactly how chunkSegments split the transcript. */
function draftForPrompt(prompt: string, fixture: LongFixture): Record<string, unknown> {
  return {
    topics: fixture.topics.filter((t) => prompt.includes(t.title)).map((t) => ({ title: t.title, detail: 'n/a' })),
    decisions: fixture.decisions
      .filter((d) => prompt.includes(d.statement))
      .map((d) => ({ statement: d.statement, rationale: null })),
    commitments: fixture.commitments
      .filter((c) => prompt.includes(c.task))
      .map((c) => ({ owner: c.owner, task: c.task, due: null, explicit: c.owner !== null })),
    openQuestions: [],
    terms: [],
  };
}

function mockExtractionDraftsFrom(fixture: LongFixture): void {
  vi.mocked(generate).mockImplementation((async (opts: { prompt: string }) => ({
    text: JSON.stringify(draftForPrompt(opts.prompt, fixture)),
  })) as never);
}

/** The full MeetingStructure a perfect extraction of `fixture` would produce —
 *  used to drive generateBrief's WRITER pass directly (extraction mocked out). */
function idealStructure(fixture: LongFixture, passes: number): MeetingStructure {
  return {
    topics: fixture.truth.topics.map((t) => ({ title: t.title, detail: '' })),
    decisions: fixture.truth.decisions.map((d) => ({ statement: d.statement, rationale: null })),
    commitments: fixture.truth.commitments.map((c) => ({
      owner: c.owner,
      task: c.task,
      due: null,
      explicit: c.owner !== null,
    })),
    openQuestions: [],
    terms: [],
    provenance: {
      provider: 'builtin',
      model: BUILTIN_PROVIDER.model,
      passes,
      extractedAt: '2026-01-01T00:00:00.000Z',
      schemaVersion: BRIEF_STRUCTURE_SCHEMA_VERSION,
    },
  };
}

function makeMeeting(fixture: LongFixture, overrides: Record<string, unknown> = {}) {
  return {
    id: 'meeting-eval',
    projectId: 'proj-eval',
    title: 'Kestrel Analytics Quarterly Review',
    template: 'none',
    transcriptionLanguage: null,
    calendarEventId: null,
    segments: fixture.segments,
    brief: null,
    actionItems: [],
    status: 'completed',
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T01:30:00.000Z',
    audioPath: null,
    prepBriefing: null,
    unassignedPending: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Every select() resolves empty — short-circuits threading, LIVE.2 confirmed
 *  context and project auto-detect, none of which this file is testing. */
function buildMinimalDb() {
  const briefReturning = vi.fn().mockResolvedValue([
    {
      id: 'brief-1',
      meetingId: 'meeting-eval',
      summary: 'stored',
      structure: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    },
  ]);
  const briefValues = vi.fn(() => ({ returning: briefReturning }));
  const insertFn = vi.fn(() => ({ values: briefValues }));
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.innerJoin = vi.fn().mockReturnValue(chain);
  chain.orderBy = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockResolvedValue([]);
  chain.where = vi.fn().mockReturnValue({ ...chain, then: (r: (v: unknown[]) => void) => r([]) });
  const selectFn = vi.fn(() => chain);
  vi.mocked(getDb).mockReturnValue({ select: selectFn, insert: insertFn } as never);
  return { briefValues };
}

function persistedSummary(briefValues: ReturnType<typeof vi.fn>): string {
  const call = briefValues.mock.calls[0]?.[0] as { summary?: string } | undefined;
  return call?.summary ?? '';
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// A. The REAL extractor over the long fixture — 100% plumbing recall.
// ---------------------------------------------------------------------------

describe('extractMeetingStructure (real) — long fixture, chunked', () => {
  it('loses nothing across >= 3 parts and keeps the owner rules honest', async () => {
    mockExtractionDraftsFrom(LONG_FIXTURE);
    const real = await vi.importActual<typeof import('../briefExtractionService')>('../briefExtractionService');

    const result = await real.extractMeetingStructure({
      provider: BUILTIN_PROVIDER,
      meeting: {
        id: 'meeting-long',
        title: 'Kestrel Analytics Quarterly Review',
        template: 'none',
        segments: LONG_FIXTURE.segments,
      },
      roster: LONG_FIXTURE.truth.roster,
      langName: null,
    });

    expect('structure' in result).toBe(true);
    if (!('structure' in result)) return;
    const structure = result.structure as MeetingStructure;

    const parts = vi.mocked(generate).mock.calls.length;
    expect(parts).toBeGreaterThanOrEqual(3);
    expect(structure.provenance.passes).toBe(parts);

    const score = scoreStructure(structure, LONG_FIXTURE.truth as FixtureTruth);
    expect(score.missed).toEqual({ topics: [], decisions: [], commitments: [] });
    expect(score.topicsRecall).toBe(1);
    expect(score.decisionsRecall).toBe(1);
    expect(score.commitmentsRecall).toBe(1);
    expect(score.inventedOwners).toBe(0);
    expect(score.wrongOwners).toBe(0);

    // The 3 first-person commitments carry no owner.
    for (const task of LONG_FIXTURE.truth.firstPersonTasks) {
      const item = structure.commitments.find((c) => c.task === task);
      expect(item).toBeDefined();
      expect(item?.owner ?? null).toBeNull();
    }

    // Owner spelling equals the roster's own nominative spelling — never a
    // declined form (Jirkovi / s Jirkou / Milanovi / Filipovi never leak through).
    const rosterNames = LONG_FIXTURE.truth.roster.map((r) => r.name);
    for (const c of structure.commitments) {
      if (c.owner !== null) expect(rosterNames).toContain(c.owner);
    }

    // The two deliberate near-duplicates (topic 0 restated, commitment 0
    // restated) collapse to exactly one item each via mergeDrafts.
    expect(structure.topics.filter((t) => t.title === LONG_FIXTURE.topics[0].title)).toHaveLength(1);
    expect(structure.commitments.filter((c) => c.task === LONG_FIXTURE.commitments[0].task)).toHaveLength(1);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// B. generateBrief's WRITER pass — extraction mocked out, prompt carries
//    every ground-truth item plus the roster order.
// ---------------------------------------------------------------------------

describe('generateBrief (real) — writer prompt carries the full structure', () => {
  it('every ground-truth topic/decision/commitment and the roster reach the writer', async () => {
    const structure = idealStructure(LONG_FIXTURE, 4);
    vi.mocked(extractMeetingStructure).mockResolvedValue({ structure } as never);
    vi.mocked(resolveTaskModel).mockResolvedValue(BUILTIN_PROVIDER as never);
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting(LONG_FIXTURE) as never);
    vi.mocked(buildRoster).mockResolvedValue(LONG_FIXTURE.truth.roster as never);
    vi.mocked(generate).mockResolvedValue({ text: 'THE FINAL BRIEF' } as never);
    const { briefValues } = buildMinimalDb();

    await generateBrief('meeting-eval');

    const calls = vi.mocked(generate).mock.calls;
    expect(calls).toHaveLength(1); // extraction mocked out — only the writer calls generate()
    const writerSystem = calls[0][0].system ?? '';
    const writerPrompt = calls[0][0].prompt;
    const writerText = `${writerSystem}\n${writerPrompt}`;

    for (const topic of LONG_FIXTURE.truth.topics) expect(writerText).toContain(topic.title);
    for (const decision of LONG_FIXTURE.truth.decisions) expect(writerText).toContain(decision.statement);
    for (const commitment of LONG_FIXTURE.truth.commitments) expect(writerText).toContain(commitment.task);

    expect(writerSystem).toContain(formatRosterBlock(LONG_FIXTURE.truth.roster, null));

    const summary = persistedSummary(briefValues);
    expect(summary).toContain('Summarized in'); // passes (4) > 1
  }, 30_000);
});

// ---------------------------------------------------------------------------
// C. Short fixture — the pipeline does not pad a small meeting.
// ---------------------------------------------------------------------------

describe('short fixture — no padding', () => {
  it('extracts exactly its 2 topics and the writer prompt carries only those, with no padding language', async () => {
    mockExtractionDraftsFrom(SHORT_FIXTURE);
    const real = await vi.importActual<typeof import('../briefExtractionService')>('../briefExtractionService');

    const extraction = await real.extractMeetingStructure({
      provider: BUILTIN_PROVIDER,
      meeting: {
        id: 'meeting-short',
        title: 'Kestrel Analytics Quick Sync',
        template: 'none',
        segments: SHORT_FIXTURE.segments,
      },
      roster: SHORT_FIXTURE.truth.roster,
      langName: null,
    });
    expect('structure' in extraction).toBe(true);
    if (!('structure' in extraction)) return;
    const structure = extraction.structure as MeetingStructure;

    expect(structure.topics).toHaveLength(SHORT_FIXTURE.truth.topics.length);
    expect(structure.topics.map((t) => t.title).sort()).toEqual(SHORT_FIXTURE.truth.topics.map((t) => t.title).sort());

    vi.mocked(extractMeetingStructure).mockResolvedValue({ structure } as never);
    vi.mocked(resolveTaskModel).mockResolvedValue(BUILTIN_PROVIDER as never);
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting(SHORT_FIXTURE, { id: 'meeting-eval' }) as never);
    vi.mocked(buildRoster).mockResolvedValue(SHORT_FIXTURE.truth.roster as never);
    buildMinimalDb();
    vi.mocked(generate).mockClear();
    vi.mocked(generate).mockResolvedValue({ text: 'SHORT BRIEF' } as never);

    await generateBrief('meeting-eval');

    const writerCall = vi.mocked(generate).mock.calls[0][0];
    const writerText = `${writerCall.system ?? ''}\n${writerCall.prompt}`;
    for (const topic of SHORT_FIXTURE.truth.topics) expect(writerText).toContain(topic.title);
    expect(writerText.toLowerCase()).not.toContain('at least');
    expect(writerText.toLowerCase()).not.toContain('minimum');
  }, 30_000);
});

// ---------------------------------------------------------------------------
// D. Fixture integrity guard — trimming the fixture must update the truth.
// ---------------------------------------------------------------------------

describe('fixture integrity guard', () => {
  it('the long fixture meets every documented minimum', () => {
    expect(LONG_FIXTURE.segments.length).toBeGreaterThanOrEqual(400);
    const totalChars = LONG_FIXTURE.segments.reduce((n, s) => n + s.content.length, 0);
    expect(totalChars).toBeGreaterThanOrEqual(60_000);
    expect(LONG_FIXTURE.truth.topics.length).toBeGreaterThanOrEqual(12);
    expect(LONG_FIXTURE.truth.decisions.length).toBeGreaterThanOrEqual(6);
    expect(LONG_FIXTURE.truth.commitments.length).toBeGreaterThanOrEqual(15);
    expect(LONG_FIXTURE.truth.firstPersonTasks).toHaveLength(3);
    expect(LONG_FIXTURE.truth.roster).toHaveLength(6);
  });

  it('the short fixture stays small', () => {
    expect(SHORT_FIXTURE.truth.topics).toHaveLength(2);
    expect(SHORT_FIXTURE.truth.decisions).toHaveLength(1);
    expect(SHORT_FIXTURE.truth.commitments).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// E. scoreStructure — non-vacuity: it must be able to FAIL, not just pass.
// ---------------------------------------------------------------------------

describe('scoreStructure', () => {
  const truth: FixtureTruth = {
    roster: [{ name: 'Ann Roster', source: 'participants' }],
    topics: [{ title: 'Topic A', forms: ['Topic A'] }],
    decisions: [{ statement: 'Decision A', forms: ['Decision A'] }],
    commitments: [
      { owner: 'Ann Roster', task: 'Do X', forms: ['Do X'] },
      { owner: null, task: 'I will do Y myself', forms: ['I will do Y myself'] },
    ],
    firstPersonTasks: ['I will do Y myself'],
  };

  it('scores a perfect structure at 100% recall with zero owner problems', () => {
    const score = scoreStructure(
      {
        topics: [{ title: 'topic a' }], // case-insensitive
        decisions: [{ statement: 'Decision A' }],
        commitments: [
          { owner: 'Ann Roster', task: 'Do X' },
          { owner: null, task: 'I will do Y myself' },
        ],
      },
      truth,
    );
    expect(score).toMatchObject({
      topicsRecall: 1,
      decisionsRecall: 1,
      commitmentsRecall: 1,
      inventedOwners: 0,
      wrongOwners: 0,
    });
  });

  it('flags an owner not in the roster as invented', () => {
    const score = scoreStructure(
      { topics: [], decisions: [], commitments: [{ owner: 'Someone Else', task: 'Do X' }] },
      truth,
    );
    expect(score.inventedOwners).toBe(1);
  });

  it('flags a non-null owner assigned to a first-person item as wrong', () => {
    const score = scoreStructure(
      { topics: [], decisions: [], commitments: [{ owner: 'Ann Roster', task: 'I will do Y myself' }] },
      truth,
    );
    expect(score.wrongOwners).toBe(1);
  });

  it('reports partial recall and names the missed item when content is absent', () => {
    const score = scoreStructure({ topics: [], decisions: [], commitments: [] }, truth);
    expect(score.topicsRecall).toBe(0);
    expect(score.missed.topics).toEqual(['Topic A']);
  });

  it('is diacritic- and case-insensitive', () => {
    const accented: FixtureTruth = { ...truth, topics: [{ title: 'Nabídka řešení', forms: ['Nabídka řešení'] }] };
    const score = scoreStructure({ topics: [{ title: 'NABIDKA RESENI' }], decisions: [], commitments: [] }, accented);
    expect(score.topicsRecall).toBe(1);
  });
});
