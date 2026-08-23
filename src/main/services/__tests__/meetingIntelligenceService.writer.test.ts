// === FILE PURPOSE ===
// Unit tests for BRIEF-QUAL.1 Task 3 — the WRITER pass and commitments as the
// single source of truth for action items.
//
// What is asserted here, and what deliberately is NOT:
//   - The writer's PROMPT: the structured notes lead it, the transcript rides
//     along only while it fits, and the owner-grouping instruction plus the
//     roster order reach the model. Grouping and "### Unassigned last" are
//     PROMPT-LEVEL assertions on purpose — a unit test cannot assert what a
//     model writes, only what it was told and what it was given.
//   - The pipeline AROUND the writer: honest pass labelling, the twin-profile
//     baseline (SPEC 255), the brief-language matrix, and every failure path
//     still producing a classified card with no dispatch (AI-RESIL.1).
//   - Action items: derived from the structure's commitments with no model call
//     at all, owner trusted only when `explicit`, LIVE.2 suppression applied in
//     code, and the legacy text extractor still running for a brief that carries
//     no usable structure.
//
// The extraction pass itself has its own suite (briefExtractionService.test.ts)
// and is mocked here — this file owns the seam, not the extractor.
//
// participantRosterService is loaded FOR REAL (only `buildRoster` is stubbed) so
// the roster wording in the system prompt is the shipped wording; its transitive
// `entityService` import is stubbed down to the one pure function it uses, which
// keeps that module's post-session hook registration out of this suite.

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

vi.mock('../briefExtractionService', () => ({ extractMeetingStructure: vi.fn() }));

vi.mock('../briefLanguageSettings', () => ({ readBriefLanguageSetting: vi.fn() }));

// The ONE pure helper participantRosterService imports from entityService.
// Stubbed so the real roster module can be loaded without dragging in
// entityService's post-session hook registration and its own dependency tree.
vi.mock('../entityService', () => ({
  normalizeEntityName: (name: string) => name.toLowerCase().replace(/\s+/g, ' ').trim(),
}));

// Real module, except for the DB-backed roster build: `formatRosterBlock` is the
// shipped wording, which is what the system-prompt assertions below are about.
vi.mock('../participantRosterService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../participantRosterService')>()),
  buildRoster: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  BRIEF_WRITER_PROMPT,
  generateActionItems,
  generateBrief,
  ensurePostSessionGeneration,
} from '../meetingIntelligenceService';
import { getMeeting } from '../meetingService';
import { generate, resolveTaskModel } from '../ai-provider';
import { getDb } from '../../db/connection';
import { dispatchPostSession } from '../postSessionDispatcher';
import { buildProfileContext } from '../twinProfileService';
import { extractMeetingStructure } from '../briefExtractionService';
import { readBriefLanguageSetting } from '../briefLanguageSettings';
import { buildRoster } from '../participantRosterService';
import { parseActionItems } from '../../../shared/utils/action-item-parser';
import { isFailedBriefText } from '../../../shared/briefSentinel';
import type { MeetingStructure } from '../../../shared/types/briefStructure';

// ---------------------------------------------------------------------------
// Fixtures — invented content only; no real people, companies or meetings.
// ---------------------------------------------------------------------------

const MEETING_ID = 'meeting-writer';

const SHORT_SEGMENTS = [
  { id: 's1', meetingId: MEETING_ID, startTime: 0, endTime: 5000, content: 'Kickoff and agenda review.' },
  { id: 's2', meetingId: MEETING_ID, startTime: 65_000, endTime: 70_000, content: 'Budget numbers look healthy.' },
];

/** ~120k chars — comfortably past the built-in sidecar's 16384-token window. */
const HUGE_SEGMENTS = Array.from({ length: 60 }, (_, i) => ({
  id: `big-${i}`,
  meetingId: MEETING_ID,
  startTime: i * 60_000,
  endTime: i * 60_000 + 5000,
  content: `${'lorem ipsum dolor sit amet '.repeat(76)}segment ${i}`,
}));

function makeStructure(overrides: Partial<MeetingStructure> = {}): MeetingStructure {
  return {
    topics: [{ title: 'Launch timeline', detail: 'The beta slips to April so the blocking bugs can land first.' }],
    decisions: [{ statement: 'Push the beta to April', rationale: 'Three blocking bugs are still open' }],
    commitments: [{ owner: 'Rina', task: 'Send the updated timeline', due: 'Friday', explicit: true }],
    openQuestions: ['Who signs off on QA?'],
    terms: ['beta'],
    provenance: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      passes: 1,
      extractedAt: '2026-01-01T00:00:00.000Z',
      schemaVersion: 1,
    },
    ...overrides,
  } as MeetingStructure;
}

function makeMeeting(overrides: Record<string, unknown> = {}) {
  return {
    id: MEETING_ID,
    projectId: null,
    title: 'Quarterly Planning',
    template: 'none',
    transcriptionLanguage: null,
    calendarEventId: null,
    segments: SHORT_SEGMENTS,
    brief: null,
    actionItems: [],
    status: 'completed',
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T01:00:00.000Z',
    audioPath: null,
    prepBriefing: null,
    unassignedPending: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const CLOUD_PROVIDER = {
  providerId: 'p1',
  providerName: 'openai',
  apiKeyEncrypted: 'enc',
  baseUrl: null,
  model: 'gpt-4o-mini',
  temperature: 0,
  maxTokens: 500,
};

const BUILTIN_PROVIDER = {
  providerId: 'builtin',
  providerName: 'builtin',
  apiKeyEncrypted: null,
  baseUrl: 'http://127.0.0.1:1234/v1',
  model: 'Qwen3-4B-Instruct',
  temperature: 0,
  maxTokens: undefined,
};

// ---------------------------------------------------------------------------
// DB double — select() is dispatched by the SHAPE of the requested field set, so
// call order never matters (mirrors contextBudget/liveSuppression).
// ---------------------------------------------------------------------------

type SelectShape = 'system' | 'summary' | 'confirmed' | 'suppression' | 'unknown';

function classifyFields(fields?: Record<string, unknown>): SelectShape {
  if (!fields) return 'unknown';
  if ('system' in fields) return 'system';
  if ('summary' in fields) return 'summary';
  if ('type' in fields && 'title' in fields) return 'confirmed';
  if ('title' in fields) return 'suppression';
  return 'unknown';
}

/** `opts.briefRows` answers the fieldless `select()` — which is getBrief's query,
 *  the one generateActionItems reads the persisted structure through. */
function buildDb(opts: { briefRows?: Record<string, unknown>[]; suppressed?: string[] } = {}) {
  // The insert ECHOES what it was given, exactly as a real `returning()` does.
  // This matters beyond realism: ensurePostSessionGeneration classifies the brief
  // from the RETURNED row's summary, so a mock answering with a fixed happy-path
  // row would make a persisted failure card read back as a successful brief.
  const briefValues = vi.fn((vals: Record<string, unknown>) => ({
    returning: vi.fn().mockResolvedValue([{ id: 'brief-1', createdAt: new Date('2026-01-01T00:00:00Z'), ...vals }]),
  }));

  const actionValues = vi.fn((vals: Record<string, unknown>) => ({
    returning: vi.fn().mockResolvedValue([
      {
        id: `action-${actionValues.mock.calls.length}`,
        meetingId: MEETING_ID,
        cardId: null,
        owner: null,
        dueText: null,
        status: 'pending',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        ...vals,
      },
    ]),
  }));

  const insertFn = vi.fn((table: { __table?: string }) => ({
    values: table.__table === 'meetingBriefs' ? briefValues : actionValues,
  }));

  const responses: Record<SelectShape, () => unknown[]> = {
    system: () => [{ system: true }], // Unassigned => threading short-circuits
    summary: () => [],
    confirmed: () => [],
    suppression: () => (opts.suppressed ?? []).map((title) => ({ title })),
    unknown: () => opts.briefRows ?? [],
  };

  const selectFn = vi.fn((fields?: Record<string, unknown>) => {
    const response = responses[classifyFields(fields)]();
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.innerJoin = vi.fn().mockReturnValue(chain);
    chain.orderBy = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockResolvedValue(response);
    chain.where = vi.fn().mockReturnValue({ ...chain, then: (r: (v: unknown) => void) => r(response) });
    return chain;
  });

  vi.mocked(getDb).mockReturnValue({ select: selectFn, insert: insertFn } as never);
  return { briefValues, actionValues };
}

/** Every prompt/system pair handed to generate(), in call order. */
function generateCalls(): { prompt: string; system: string }[] {
  return vi.mocked(generate).mock.calls.map((c) => ({ prompt: c[0].prompt, system: c[0].system ?? '' }));
}

function persistedBrief(briefValues: ReturnType<typeof vi.fn>): { summary: string; structure: unknown } {
  const call = briefValues.mock.calls[0]?.[0] as { summary?: string; structure?: unknown } | undefined;
  return { summary: call?.summary ?? '', structure: call?.structure ?? null };
}

/** A structure row as it comes back from the jsonb column. */
function briefRowWith(structure: MeetingStructure | null) {
  return [
    {
      id: 'brief-1',
      meetingId: MEETING_ID,
      summary: 'a real brief',
      structure,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    },
  ];
}

// The built-in context size is read from the REAL spawn value, including its env
// override — pin it so a developer machine with LIFEDASH_LLAMA_CTX set cannot
// quietly change what "overflow" means here.
const SAVED_CTX_ENV = process.env.LIFEDASH_LLAMA_CTX;
process.env.LIFEDASH_LLAMA_CTX = '16384';
afterAll(() => {
  if (SAVED_CTX_ENV === undefined) delete process.env.LIFEDASH_LLAMA_CTX;
  else process.env.LIFEDASH_LLAMA_CTX = SAVED_CTX_ENV;
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveTaskModel).mockResolvedValue(CLOUD_PROVIDER as never);
  vi.mocked(generate).mockResolvedValue({ text: 'THE BRIEF' } as never);
  vi.mocked(buildProfileContext).mockResolvedValue('');
  vi.mocked(extractMeetingStructure).mockResolvedValue({ structure: makeStructure() } as never);
  vi.mocked(readBriefLanguageSetting).mockResolvedValue('en');
  vi.mocked(buildRoster).mockResolvedValue([]);
  vi.mocked(parseActionItems).mockReturnValue(['Follow up']);
  vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
  buildDb();
});

// ---------------------------------------------------------------------------
// A. The writer's user prompt
// ---------------------------------------------------------------------------

describe('generateBrief — the writer works from the structure', () => {
  it('leads with the structured notes and carries the transcript when it fits', async () => {
    buildDb();

    await generateBrief(MEETING_ID);

    const [call] = generateCalls();
    expect(generateCalls()).toHaveLength(1); // extraction is mocked: ONE writer call
    const notesAt = call.prompt.indexOf('Structured notes (authoritative — every item must appear):');
    const transcriptAt = call.prompt.indexOf('Transcript:');
    expect(notesAt).toBeGreaterThanOrEqual(0);
    expect(transcriptAt).toBeGreaterThan(notesAt); // notes FIRST, transcript after
    expect(call.prompt).toContain('[00:00] Kickoff and agenda review.');
    expect(call.prompt).toContain('"Push the beta to April"');
  });

  it('drops the transcript — and keeps the notes — when the two together do not fit', async () => {
    vi.mocked(resolveTaskModel).mockResolvedValue(BUILTIN_PROVIDER as never);
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting({ segments: HUGE_SEGMENTS }) as never);
    buildDb();

    await generateBrief(MEETING_ID);

    const [call] = generateCalls();
    expect(call.prompt).toContain('Structured notes (authoritative — every item must appear):');
    expect(call.prompt).toContain('"Push the beta to April"');
    expect(call.prompt).not.toContain('Transcript:');
    expect(call.prompt).not.toContain('lorem ipsum');
  });

  it('does not put provenance in the prompt — the model cannot use what it did not produce', async () => {
    buildDb();

    await generateBrief(MEETING_ID);

    const [call] = generateCalls();
    expect(call.prompt).not.toContain('provenance');
    expect(call.prompt).not.toContain('schemaVersion');
  });
});

// ---------------------------------------------------------------------------
// B. Owner grouping — prompt-level, by construction
// ---------------------------------------------------------------------------

describe('generateBrief — follow-ups are grouped by owner', () => {
  it('instructs "### <Owner>" blocks in participant order with "### Unassigned" LAST', () => {
    expect(BRIEF_WRITER_PROMPT).toContain('## Follow-ups');
    expect(BRIEF_WRITER_PROMPT).toContain('"### <Owner>"');
    expect(BRIEF_WRITER_PROMPT).toContain('in the order the participants are listed');
    expect(BRIEF_WRITER_PROMPT).toContain('"### Unassigned" heading placed LAST');
    // The owner-honesty rule the `explicit` flag exists for.
    expect(BRIEF_WRITER_PROMPT).toContain('whose owner the notes do not mark as explicit');
    expect(BRIEF_WRITER_PROMPT).toContain('Never invent an owner, a date or a number');
  });

  it('carries no caps of any kind — a cap is an instruction to drop something', () => {
    expect(BRIEF_WRITER_PROMPT).not.toMatch(/maximum/i);
    expect(BRIEF_WRITER_PROMPT).not.toMatch(/at most/i);
    expect(BRIEF_WRITER_PROMPT).not.toMatch(/\bno more than\b/i);
    expect(BRIEF_WRITER_PROMPT).toContain('MUST appear in the brief');
  });

  it('passes the roster to the model in roster order, spelling included', async () => {
    vi.mocked(buildRoster).mockResolvedValue([
      { name: 'Rina', source: 'participants' },
      { name: 'Tomas', source: 'calendar' },
      { name: 'Nadia', source: 'known' },
    ]);
    buildDb();

    await generateBrief(MEETING_ID);

    const [call] = generateCalls();
    expect(call.system).toContain('Participants (use these exact spellings');
    expect(call.system).toContain('Rina, Tomas, Nadia.');
  });

  it('omits the participants sentence entirely when nobody is known', async () => {
    buildDb();

    await generateBrief(MEETING_ID);

    expect(generateCalls()[0].system).not.toContain('Participants (');
  });
});

// ---------------------------------------------------------------------------
// C. The long-meeting footer
// ---------------------------------------------------------------------------

describe('generateBrief — the passes footer is honest and only appears when earned', () => {
  it('a single-part extraction gets no footer at all', async () => {
    const { briefValues } = buildDb();
    vi.mocked(extractMeetingStructure).mockResolvedValue({
      structure: makeStructure({ provenance: { ...makeStructure().provenance, passes: 1 } }),
    } as never);

    await generateBrief(MEETING_ID);

    expect(persistedBrief(briefValues).summary).toBe('THE BRIEF');
    expect(persistedBrief(briefValues).summary).not.toContain('Summarized in');
  });

  it('three extraction parts plus the writer reads as four passes', async () => {
    const { briefValues } = buildDb();
    vi.mocked(extractMeetingStructure).mockResolvedValue({
      structure: makeStructure({ provenance: { ...makeStructure().provenance, passes: 3 } }),
    } as never);

    await generateBrief(MEETING_ID);

    expect(persistedBrief(briefValues).summary).toBe('THE BRIEF\n\n_Summarized in 4 passes (long meeting)._');
  });
});

// ---------------------------------------------------------------------------
// D. Brief language comes from the SETTING, not from the transcript alone
// ---------------------------------------------------------------------------

describe('generateBrief — brief language matrix', () => {
  it('a Czech-mixed transcript with the default setting still writes English (no language line)', async () => {
    vi.mocked(readBriefLanguageSetting).mockResolvedValue('en');
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting({ transcriptionLanguage: 'cs-mix' }) as never);
    buildDb();

    await generateBrief(MEETING_ID);

    expect(generateCalls()[0].system).not.toContain('Write the entire brief in');
  });

  it("the 'transcript' setting resolves cs-mix to Czech", async () => {
    vi.mocked(readBriefLanguageSetting).mockResolvedValue('transcript');
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting({ transcriptionLanguage: 'cs-mix' }) as never);
    buildDb();

    await generateBrief(MEETING_ID);

    expect(generateCalls()[0].system).toContain('Write the entire brief in Czech.');
  });

  it('the extraction pass is given the same resolved language and roster', async () => {
    vi.mocked(readBriefLanguageSetting).mockResolvedValue('transcript');
    vi.mocked(buildRoster).mockResolvedValue([{ name: 'Rina', source: 'participants' }]);
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting({ transcriptionLanguage: 'cs-mix' }) as never);
    buildDb();

    await generateBrief(MEETING_ID);

    expect(extractMeetingStructure).toHaveBeenCalledWith(
      expect.objectContaining({ langName: 'Czech', roster: [{ name: 'Rina', source: 'participants' }] }),
    );
  });
});

// ---------------------------------------------------------------------------
// E. SPEC 255 — the twin profile is a PREPEND, nothing else
// ---------------------------------------------------------------------------

describe('generateBrief — twin profile baseline (SPEC 255)', () => {
  it('with no profile, no roster and English, the system prompt IS the writer prompt', async () => {
    buildDb();

    await generateBrief(MEETING_ID);

    expect(generateCalls()[0].system).toBe(BRIEF_WRITER_PROMPT);
  });

  it('with a profile, the system prompt is the block, a blank line, then that same baseline', async () => {
    const profile = 'User profile (the professional you assist): Dana, product lead.';
    vi.mocked(buildProfileContext).mockResolvedValue(profile);
    buildDb();

    await generateBrief(MEETING_ID);

    expect(generateCalls()[0].system).toBe(`${profile}\n\n${BRIEF_WRITER_PROMPT}`);
  });
});

// ---------------------------------------------------------------------------
// F. Every failure is still a classified card that teaches the twin nothing
// ---------------------------------------------------------------------------

describe('generateBrief — an extraction failure is a brief failure', () => {
  it('persists a classified card, skips the dispatch and stores NO structure', async () => {
    const { briefValues } = buildDb();
    vi.mocked(extractMeetingStructure).mockResolvedValue({
      failureReason: 'part 2 of 3 failed — the local AI server is not reachable',
    } as never);

    const result = await generateBrief(MEETING_ID);

    expect(generate).not.toHaveBeenCalled(); // the writer never ran
    const { summary, structure } = persistedBrief(briefValues);
    expect(isFailedBriefText(summary)).toBe(true);
    expect(summary).toContain(`Reason: ${CLOUD_PROVIDER.providerName}/${CLOUD_PROVIDER.model}`);
    expect(summary).toContain('part 2 of 3 failed — the local AI server is not reachable');
    expect(structure).toBeNull();
    expect(dispatchPostSession).not.toHaveBeenCalled();
    expect(result).not.toBeNull(); // the card IS persisted — Regenerate must work
  });

  it('and no action items are extracted from it (TWIN-LEARN.1)', async () => {
    const { actionValues } = buildDb();
    vi.mocked(extractMeetingStructure).mockResolvedValue({ failureReason: 'part 1 of 1 failed' } as never);

    await ensurePostSessionGeneration(MEETING_ID);

    expect(actionValues).not.toHaveBeenCalled();
  });

  it('a successful brief persists the structure it was written from and dispatches once', async () => {
    const { briefValues } = buildDb();

    await generateBrief(MEETING_ID);

    expect(persistedBrief(briefValues).structure).toEqual(makeStructure());
    expect(dispatchPostSession).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// G. Commitments ARE the action items
// ---------------------------------------------------------------------------

describe('generateActionItems — derived from the brief structure', () => {
  it('writes one item per commitment with its owner and due, and calls no model at all', async () => {
    const structure = makeStructure({
      commitments: [
        { owner: 'Rina', task: 'Send the updated timeline', due: 'Friday', explicit: true },
        { owner: null, task: 'Book the venue', due: null, explicit: false },
      ],
    });
    const { actionValues } = buildDb({ briefRows: briefRowWith(structure) });

    const items = await generateActionItems(MEETING_ID);

    expect(generate).not.toHaveBeenCalled();
    expect(parseActionItems).not.toHaveBeenCalled();
    expect(actionValues.mock.calls.map((c) => c[0])).toEqual([
      {
        meetingId: MEETING_ID,
        description: 'Send the updated timeline',
        owner: 'Rina',
        dueText: 'Friday',
        status: 'pending',
      },
      { meetingId: MEETING_ID, description: 'Book the venue', owner: null, dueText: null, status: 'pending' },
    ]);
    expect(items.map((i) => ({ description: i.description, owner: i.owner, dueText: i.dueText }))).toEqual([
      { description: 'Send the updated timeline', owner: 'Rina', dueText: 'Friday' },
      { description: 'Book the venue', owner: null, dueText: null },
    ]);
  });

  it('drops an owner the extraction did not mark explicit — attribution is never guessed', async () => {
    const structure = makeStructure({
      commitments: [{ owner: 'Tomas', task: 'Draft the release notes', due: 'next week', explicit: false }],
    });
    const { actionValues } = buildDb({ briefRows: briefRowWith(structure) });

    await generateActionItems(MEETING_ID);

    expect(actionValues.mock.calls[0][0]).toMatchObject({ owner: null, dueText: 'next week' });
  });

  it('suppresses a commitment the user already accepted live (LIVE.2)', async () => {
    const structure = makeStructure({
      commitments: [
        { owner: null, task: 'Ship the beta', due: null, explicit: false },
        { owner: null, task: 'Book the venue', due: null, explicit: false },
      ],
    });
    const { actionValues } = buildDb({ briefRows: briefRowWith(structure), suppressed: ['  ship   THE beta '] });

    await generateActionItems(MEETING_ID);

    expect(actionValues.mock.calls.map((c) => (c[0] as { description: string }).description)).toEqual([
      'Book the venue',
    ]);
  });

  it('dedupes commitments that repeat the same task', async () => {
    const structure = makeStructure({
      commitments: [
        { owner: 'Rina', task: 'Send the timeline', due: 'Friday', explicit: true },
        { owner: null, task: 'send the   TIMELINE', due: null, explicit: false },
      ],
    });
    const { actionValues } = buildDb({ briefRows: briefRowWith(structure) });

    await generateActionItems(MEETING_ID);

    expect(actionValues).toHaveBeenCalledTimes(1);
    expect(actionValues.mock.calls[0][0]).toMatchObject({ description: 'Send the timeline', owner: 'Rina' });
  });

  it('falls back to the legacy text extractor when the brief carries no structure', async () => {
    const { actionValues } = buildDb({ briefRows: briefRowWith(null) });
    vi.mocked(generate).mockResolvedValue({ text: '- Follow up' } as never);

    await generateActionItems(MEETING_ID);

    expect(generate).toHaveBeenCalledTimes(1);
    expect(generateCalls()[0].system).toContain('meeting action item extractor');
    expect(actionValues.mock.calls[0][0]).toMatchObject({ description: 'Follow up', owner: null, dueText: null });
  });

  it('falls back too when the persisted structure no longer validates', async () => {
    const { actionValues } = buildDb({
      briefRows: briefRowWith({ topics: 'not an array' } as unknown as MeetingStructure),
    });
    vi.mocked(generate).mockResolvedValue({ text: '- Follow up' } as never);

    await generateActionItems(MEETING_ID);

    expect(generate).toHaveBeenCalledTimes(1);
    expect(actionValues.mock.calls[0][0]).toMatchObject({ description: 'Follow up' });
  });
});
