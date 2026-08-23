// === FILE PURPOSE ===
// Unit tests for the context budget in both transcript-consuming paths of
// meetingIntelligenceService (generateBrief, generateActionItems) — AI-CTX.1's
// gate, as re-shaped by BRIEF-QUAL.1's extract-then-write pipeline.
//
// Two halves, and the first matters as much as the second:
//   1. The fits case must assemble EXACTLY the request this file pins. The pins
//      are not hand-written from reading the code — they were captured by running
//      the code over this very fixture, and the sha256 is over
//      `system + '\0' + prompt`, so a single byte moving anywhere in either
//      string (or across the system/user boundary) fails the test.
//   2. A transcript that does NOT fit is extracted part-by-part by
//      briefExtractionService and WRITTEN once; a failing or empty part must
//      yield AI-RESIL.1's classified failure card — never a partial brief, never
//      a dispatch — and a multi-part run must say so in the persisted brief.
//
// PIN RE-CAPTURE (BRIEF-QUAL.1, 2026-08-21). The brief pins moved because the
// writer prompt replaced the summarization prompt and the user prompt now leads
// with the structured notes; ACTION_FINGERPRINT_PIN moved because the extraction
// prompt's "Maximum 10 items" line became "List every concrete action — there is
// no maximum". They were re-captured by RUNNING the new code over this fixture,
// then PROVEN non-vacuous by mutation before being trusted:
//
//   * production `Transcript:` -> `Transcript :` (meetingIntelligenceService's
//     buildWriterUserPrompt) => BOTH brief pins failed (the literal on the
//     `toBe`, the digest on the fingerprint); reverted => both pass again.
//   * production `List every concrete action` -> `List every concrete actions`
//     (BASE_ACTION_EXTRACTION_PROMPT) => ACTION_FINGERPRINT_PIN failed while
//     ACTION_PROMPT_PIN (a user-prompt literal, correctly blind to a system-prompt
//     edit) passed; reverted => the fingerprint passes again.
//
// Neither pin can therefore be passing vacuously. Do NOT edit FITS_SEGMENTS,
// makeMeeting or EXTRACTED_STRUCTURE without repeating that procedure.
//
// Mocking style follows meetingIntelligenceService.briefFailure.test.ts (same
// file under test); 'electron' is mocked only because promptBudget.ts reaches
// llamaRuntimeConfig.ts for the REAL builtin --ctx-size, and that module imports
// `app` at module scope. Nothing here touches `app`.

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { createHash } from 'node:crypto';

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
  meetingBriefs: { __table: 'meetingBriefs', meetingId: 'meetingId', summary: 'summary', createdAt: 'createdAt' },
  actionItems: {
    __table: 'actionItems',
    id: 'id',
    meetingId: 'meetingId',
    status: 'status',
    cardId: 'cardId',
    description: 'description',
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
}));

vi.mock('../unassignedProjectService', () => ({
  ensureUnassignedProject: vi.fn().mockResolvedValue({ id: 'unassigned-id', name: 'Unassigned', system: true }),
}));

vi.mock('../projectDetectionService', () => ({ detectProjectFromTranscript: vi.fn() }));

vi.mock('../../../shared/utils/action-item-parser', () => ({ parseActionItems: vi.fn() }));

vi.mock('../../../shared/types', () => ({ MEETING_TEMPLATES: [] }));

vi.mock('../twinProfileService', () => ({ buildProfileContext: vi.fn().mockResolvedValue('') }));

// ---------------------------------------------------------------------------
// BRIEF-QUAL.1 seams — generateBrief is extract-then-write now
// ---------------------------------------------------------------------------
// The extraction pass is a separate service with its own suite
// (briefExtractionService.test.ts). Mocking it here keeps this file testing
// exactly what it always tested — the WRITER call and everything wrapped around
// it — and keeps generate() at ONE call per brief. The roster is empty and the
// brief language is English, so the writer system prompt is BRIEF_WRITER_PROMPT
// with nothing appended (formatRosterBlock's own empty-input contract is covered
// by participantRosterService.test.ts).
const { EXTRACTED_STRUCTURE } = vi.hoisted(() => ({
  EXTRACTED_STRUCTURE: {
    topics: [{ title: 'Launch timeline', detail: 'The beta slips to April so the blocking bugs can land first.' }],
    decisions: [{ statement: 'Push the beta to April', rationale: 'Three blocking bugs are still open' }],
    commitments: [{ owner: 'Alex', task: 'Send the updated timeline', due: 'Friday', explicit: true }],
    openQuestions: ['Who signs off on QA?'],
    terms: ['beta'],
    provenance: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      passes: 1,
      extractedAt: '2026-01-01T00:00:00.000Z',
      schemaVersion: 1,
    },
  },
}));

vi.mock('../briefExtractionService', () => ({
  extractMeetingStructure: vi.fn(async () => ({ structure: EXTRACTED_STRUCTURE })),
}));

vi.mock('../participantRosterService', () => ({
  buildRoster: vi.fn(async () => []),
  formatRosterBlock: vi.fn(() => ''),
}));

vi.mock('../briefLanguageSettings', () => ({ readBriefLanguageSetting: vi.fn(async () => 'en') }));

vi.mock('../postSessionDispatcher', () => ({ dispatchPostSession: vi.fn() }));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { generateBrief, generateActionItems, mergeActionDescriptions } from '../meetingIntelligenceService';
import { getMeeting } from '../meetingService';
import { generate, resolveTaskModel } from '../ai-provider';
import { getDb } from '../../db/connection';
import { dispatchPostSession } from '../postSessionDispatcher';
import { extractMeetingStructure } from '../briefExtractionService';
import { buildProfileContext } from '../twinProfileService';
import { parseActionItems } from '../../../shared/utils/action-item-parser';
import { BRIEF_FAILURE_SENTINEL, isFailedBriefText } from '../../../shared/briefSentinel';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MEETING_ID = 'meeting-fits';

/** Three short segments — the fits-case transcript the pins were captured from.
 *  Do not edit without re-capturing both digests (and re-running the mutation
 *  proof recorded in the file header). The same applies to EXTRACTED_STRUCTURE,
 *  which the writer prompt now renders verbatim. */
const FITS_SEGMENTS = [
  { id: 's1', meetingId: MEETING_ID, startTime: 0, endTime: 5000, content: 'Kickoff and agenda review.' },
  { id: 's2', meetingId: MEETING_ID, startTime: 65_000, endTime: 70_000, content: 'Budget numbers look healthy.' },
  { id: 's3', meetingId: MEETING_ID, startTime: 125_000, endTime: 130_000, content: 'Sarah will send the timeline.' },
];

/** ~120k chars of transcript — comfortably past the built-in sidecar's 16384-token
 *  window (39,424 prompt chars), so the budget gate must chunk it. */
const BIG_SEGMENTS = Array.from({ length: 60 }, (_, i) => ({
  id: `big-${i}`,
  meetingId: MEETING_ID,
  startTime: i * 60_000,
  endTime: i * 60_000 + 5000,
  content: `${'lorem ipsum dolor sit amet '.repeat(76)}segment ${i}`,
}));

function makeMeeting(overrides: Record<string, unknown> = {}) {
  return {
    id: MEETING_ID,
    projectId: 'proj-1',
    title: 'Quarterly Planning',
    template: 'none',
    transcriptionLanguage: null,
    calendarEventId: null,
    segments: FITS_SEGMENTS,
    brief: null,
    actionItems: [],
    status: 'completed',
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T01:00:00.000Z',
    audioPath: null,
    prepBriefing: 'Cover the Q3 budget and the launch timeline.',
    unassignedPending: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Cloud provider: a 100k-token window, so the fits-case fixture never chunks. */
const CLOUD_PROVIDER = {
  providerId: 'p1',
  providerName: 'openai',
  apiKeyEncrypted: 'enc',
  baseUrl: null,
  model: 'gpt-4o-mini',
  temperature: 0,
  maxTokens: 500,
};

/** The built-in sidecar: a 16384-token window (llamaRuntimeConfig's CHAT_CTX_SIZE),
 *  which is the exact configuration the field failure was reported on. */
const BUILTIN_PROVIDER = {
  providerId: 'builtin',
  providerName: 'builtin',
  apiKeyEncrypted: null,
  baseUrl: 'http://127.0.0.1:1234/v1',
  model: 'Meta-Llama-3.1-8B-Instruct-Q4_K_M',
  temperature: 0,
  maxTokens: undefined,
};

// ---------------------------------------------------------------------------
// DB double — dispatches select() by the shape of the requested field set, so
// call ORDER never matters (mirrors liveSuppression.test.ts's approach).
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

const DEFAULT_PRIORS = [
  { summary: 'PRIOR_ONE summary text', createdAt: new Date('2026-01-02') },
  { summary: 'PRIOR_TWO summary text', createdAt: new Date('2026-01-01') },
];

function buildDb(
  opts: {
    priors?: { summary: string; createdAt: Date }[];
    confirmed?: { type: string; title: string; description: string | null }[];
    suppressed?: string[];
  } = {},
) {
  const briefReturning = vi
    .fn()
    .mockResolvedValue([
      { id: 'brief-1', meetingId: MEETING_ID, summary: 'stored row', createdAt: new Date('2026-01-01T00:00:00Z') },
    ]);
  const briefValues = vi.fn(() => ({ returning: briefReturning }));

  const actionValues = vi.fn((vals: { description?: string }) => ({
    returning: vi.fn().mockResolvedValue([
      {
        id: `action-${actionValues.mock.calls.length}`,
        meetingId: MEETING_ID,
        cardId: null,
        description: vals.description,
        status: 'pending',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]),
  }));

  const insertFn = vi.fn((table: { __table?: string }) => ({
    values: table.__table === 'meetingBriefs' ? briefValues : actionValues,
  }));

  const responses: Record<SelectShape, () => unknown[]> = {
    system: () => [{ system: false }],
    summary: () => opts.priors ?? DEFAULT_PRIORS,
    confirmed: () => opts.confirmed ?? [{ type: 'decision', title: 'Ship in April', description: null }],
    suppression: () => (opts.suppressed ?? ['Ship the beta']).map((title) => ({ title })),
    unknown: () => [],
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

/** The `summary` text a generateBrief run tried to persist. */
function persistedSummary(briefValues: ReturnType<typeof vi.fn>): string {
  const call = briefValues.mock.calls[0]?.[0] as { summary?: string } | undefined;
  return call?.summary ?? '';
}

/** The `structure` payload a generateBrief run tried to persist on the brief row
 *  (BRIEF-QUAL.1) — null on every failure path. */
function persistedStructure(briefValues: ReturnType<typeof vi.fn>): unknown {
  const call = briefValues.mock.calls[0]?.[0] as { structure?: unknown } | undefined;
  return call?.structure ?? null;
}

/** Every `prompt`/`system` pair handed to generate(), in call order. */
function generateCalls(): { prompt: string; system: string }[] {
  return vi.mocked(generate).mock.calls.map((c) => ({
    prompt: c[0].prompt,
    system: c[0].system ?? '',
  }));
}

/** Byte-exact fingerprint of one assembled request. The NUL separator makes the
 *  system/user split itself part of what is pinned — moving a character across
 *  the boundary changes the digest. */
function fingerprint(system: string, prompt: string): string {
  return createHash('sha256').update(`${system}\u0000${prompt}`, 'utf8').digest('hex');
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
  vi.mocked(generate).mockResolvedValue({ text: 'Generated content' } as never);
  vi.mocked(buildProfileContext).mockResolvedValue('');
  vi.mocked(parseActionItems).mockReturnValue(['Follow up']);
  // Reset the extraction seam to the shared success fixture: tests below steer it
  // per-case with mockResolvedValue, and vi.clearAllMocks() does NOT undo an
  // implementation — without this, one test's failureReason would leak into the
  // next and the pins would depend on declaration order.
  vi.mocked(extractMeetingStructure).mockResolvedValue({ structure: EXTRACTED_STRUCTURE } as never);
  buildDb();
});

// ---------------------------------------------------------------------------
// A. Fits-case regression pins — the whole point of the phase is that the
//    common path did not move.
// ---------------------------------------------------------------------------

describe('BRIEF-QUAL.1 — a transcript that fits is assembled byte-identically', () => {
  // Captured by running generateBrief against this exact fixture with the
  // extraction pass mocked to EXTRACTED_STRUCTURE (threading preamble + prep
  // section + LIVE.2 confirmed context all present). See the mutation proof in
  // the file header before trusting a green run.
  const BRIEF_PROMPT_PIN =
    'Confirmed during the meeting (accepted live via the Live Assistant) — treat as established, do not contradict:\n' +
    '\n' +
    '- [Decision] Ship in April\n' +
    '\n' +
    'Recent context from this project (last meetings, most recent first):\n' +
    '\n' +
    '1. PRIOR_ONE summary text\n' +
    '2. PRIOR_TWO summary text\n' +
    '\n' +
    'Use these to maintain continuity in your brief. Do NOT repeat their content unless this meeting explicitly refers back to them. Treat them as background context only.\n' +
    '\n' +
    'Meeting: Quarterly Planning\n' +
    '\n' +
    'Structured notes (authoritative — every item must appear):\n' +
    '{\n' +
    '  "topics": [\n' +
    '    {\n' +
    '      "title": "Launch timeline",\n' +
    '      "detail": "The beta slips to April so the blocking bugs can land first."\n' +
    '    }\n' +
    '  ],\n' +
    '  "decisions": [\n' +
    '    {\n' +
    '      "statement": "Push the beta to April",\n' +
    '      "rationale": "Three blocking bugs are still open"\n' +
    '    }\n' +
    '  ],\n' +
    '  "commitments": [\n' +
    '    {\n' +
    '      "owner": "Alex",\n' +
    '      "task": "Send the updated timeline",\n' +
    '      "due": "Friday",\n' +
    '      "explicit": true\n' +
    '    }\n' +
    '  ],\n' +
    '  "openQuestions": [\n' +
    '    "Who signs off on QA?"\n' +
    '  ],\n' +
    '  "terms": [\n' +
    '    "beta"\n' +
    '  ]\n' +
    '}\n' +
    '\n' +
    'Transcript:\n' +
    '[00:00] Kickoff and agenda review.\n' +
    '[01:05] Budget numbers look healthy.\n' +
    '[02:05] Sarah will send the timeline.\n' +
    '\n' +
    '## Pre-Meeting Prep Reference\n' +
    'The following prep briefing was generated before this meeting:\n' +
    '---\n' +
    'Cover the Q3 budget and the launch timeline.\n' +
    '---\n' +
    '\n' +
    'IMPORTANT: After generating the summary, add a section:\n' +
    '## Items Not Discussed\n' +
    'List any topics from the prep briefing that were NOT covered in this meeting.\n' +
    'If all prep items were addressed, write "All prep items were discussed."';

  /** sha256 of `system + '\0' + prompt`, same fixture. Covers the WRITER system
   *  prompt too, which is far too long to pin inline without burying the test —
   *  the twin-baseline assertion below states what that system prompt IS. */
  const BRIEF_FINGERPRINT_PIN = '38b6778f8f6dc0182f670dad3c75f63f817ba16eb5b032bcff2dbe899cbb5b57';

  const ACTION_PROMPT_PIN =
    'Meeting: Quarterly Planning\n' +
    '\n' +
    'Transcript:\n' +
    '[00:00] Kickoff and agenda review.\n' +
    '[01:05] Budget numbers look healthy.\n' +
    '[02:05] Sarah will send the timeline.';

  const ACTION_FINGERPRINT_PIN = '222c98ce6ca4d0830a516eac1bfbd0cf32840673958fe683defb1c0ff4c01e58';

  it('generateBrief: one writer call with the pinned prompt, byte for byte', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    const { briefValues } = buildDb();
    vi.mocked(generate).mockResolvedValue({ text: 'A real generated brief' } as never);

    await generateBrief(MEETING_ID);

    const calls = generateCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].prompt).toBe(BRIEF_PROMPT_PIN);
    expect(fingerprint(calls[0].system, calls[0].prompt)).toBe(BRIEF_FINGERPRINT_PIN);

    // …and the fits path still behaves exactly as before around that call.
    expect(persistedSummary(briefValues)).toBe('A real generated brief');
    expect(persistedSummary(briefValues)).not.toContain('Summarized in');
    expect(dispatchPostSession).toHaveBeenCalledTimes(1);
  });

  it('generateActionItems (legacy path): one generate() call with the pinned prompt, byte for byte', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    buildDb();
    vi.mocked(generate).mockResolvedValue({ text: '- Follow up' } as never);

    await generateActionItems(MEETING_ID);

    const calls = generateCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].prompt).toBe(ACTION_PROMPT_PIN);
    expect(fingerprint(calls[0].system, calls[0].prompt)).toBe(ACTION_FINGERPRINT_PIN);
  });

  it('the fingerprint is not vacuous: a one-character drift fails it', () => {
    const calls = [{ system: 'S', prompt: 'P' }];
    expect(fingerprint(calls[0].system, calls[0].prompt)).not.toBe(BRIEF_FINGERPRINT_PIN);
    expect(fingerprint('S', 'P')).toBe(fingerprint('S', 'P'));
    expect(fingerprint('S', 'P')).not.toBe(fingerprint('S', 'P ')); // one trailing space
    expect(fingerprint('S', 'P')).not.toBe(fingerprint('SP', '')); // same bytes, different split
  });
});

// ---------------------------------------------------------------------------
// B. Long-meeting brief path — extraction in parts, ONE writer pass
// ---------------------------------------------------------------------------
// BRIEF-QUAL.1 removed the map-reduce over CHUNK SUMMARIES (summarizing a summary
// is the compression this phase exists to delete). briefExtractionService is the
// elastic path now, and it has its own suite; what generateBrief still owes is
// tested here: honest pass labelling, an aborted run on a failing part, and a
// transcript dropped from the writer prompt when it no longer fits.
// ---------------------------------------------------------------------------

describe('BRIEF-QUAL.1 — a transcript that overflows the window is extracted in parts', () => {
  /** A structure as the extraction pass returns it after N parts. */
  function structureFrom(passes: number) {
    return {
      topics: [{ title: 'Launch timeline', detail: 'The beta slips to April so the blocking bugs can land first.' }],
      decisions: [{ statement: 'Push the beta to April', rationale: 'Three blocking bugs are still open' }],
      commitments: [{ owner: 'Alex', task: 'Send the updated timeline', due: 'Friday', explicit: true }],
      openQuestions: ['Who signs off on QA?'],
      terms: ['beta'],
      provenance: {
        provider: 'builtin',
        model: BUILTIN_PROVIDER.model,
        passes,
        extractedAt: '2026-01-01T00:00:00.000Z',
        schemaVersion: 1,
      },
    };
  }

  it('writes the brief in ONE pass from the merged structure and labels the passes honestly', async () => {
    vi.mocked(resolveTaskModel).mockResolvedValue(BUILTIN_PROVIDER as never);
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting({ segments: BIG_SEGMENTS }) as never);
    vi.mocked(buildProfileContext).mockResolvedValue('User profile (the professional you assist): Dana');
    vi.mocked(extractMeetingStructure).mockResolvedValue({ structure: structureFrom(3) } as never);
    const { briefValues } = buildDb();
    vi.mocked(generate).mockResolvedValue({ text: 'THE FINAL BRIEF' } as never);

    const result = await generateBrief(MEETING_ID);

    // Exactly one model call from THIS file: the writer. The extraction pass's
    // own N calls belong to briefExtractionService (mocked here).
    const calls = generateCalls();
    expect(calls).toHaveLength(1);

    // The writer works from the notes, and — because this transcript cannot fit
    // the built-in window — from the notes ALONE.
    expect(calls[0].prompt).toContain('Structured notes (authoritative — every item must appear):');
    expect(calls[0].prompt).toContain('Push the beta to April');
    expect(calls[0].prompt).not.toContain('Transcript:');
    expect(calls[0].prompt).not.toContain('lorem ipsum');

    // …while every preamble the fits path carries still lands.
    expect(calls[0].prompt).toContain('Recent context from this project');
    expect(calls[0].prompt).toContain('PRIOR_ONE summary text');
    expect(calls[0].prompt).toContain('Confirmed during the meeting');
    expect(calls[0].prompt).toContain('Pre-Meeting Prep Reference');
    expect(calls[0].system).toContain('User profile');

    // Real output, honestly labelled (3 extraction parts + the writer = 4), and
    // the twin still learns from it.
    const summary = persistedSummary(briefValues);
    expect(summary).toContain('THE FINAL BRIEF');
    expect(summary.endsWith('_Summarized in 4 passes (long meeting)._')).toBe(true);
    expect(isFailedBriefText(summary)).toBe(false);
    expect(dispatchPostSession).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
  });

  it('a single-part extraction gets NO passes footer', async () => {
    vi.mocked(resolveTaskModel).mockResolvedValue(BUILTIN_PROVIDER as never);
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting({ segments: BIG_SEGMENTS }) as never);
    vi.mocked(extractMeetingStructure).mockResolvedValue({ structure: structureFrom(1) } as never);
    const { briefValues } = buildDb();
    vi.mocked(generate).mockResolvedValue({ text: 'THE FINAL BRIEF' } as never);

    await generateBrief(MEETING_ID);

    expect(persistedSummary(briefValues)).not.toContain('Summarized in');
  });

  it('a failing extraction part stops the run with a classified card — no writer call, no dispatch', async () => {
    vi.mocked(resolveTaskModel).mockResolvedValue(BUILTIN_PROVIDER as never);
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting({ segments: BIG_SEGMENTS }) as never);
    vi.mocked(extractMeetingStructure).mockResolvedValue({
      failureReason: 'part 2 of 4 failed — the model did not respond in time',
    } as never);
    const { briefValues } = buildDb();

    const result = await generateBrief(MEETING_ID);

    // Stopped AT the failure: the writer never ran.
    expect(generate).not.toHaveBeenCalled();

    const summary = persistedSummary(briefValues);
    expect(summary.startsWith(BRIEF_FAILURE_SENTINEL)).toBe(true);
    expect(isFailedBriefText(summary)).toBe(true);
    expect(summary).toContain(`Reason: ${BUILTIN_PROVIDER.providerName}/${BUILTIN_PROVIDER.model}`);
    expect(summary).toMatch(/part 2 of \d+ failed/);
    expect(summary).toContain('the model did not respond in time');
    expect(dispatchPostSession).not.toHaveBeenCalled();
    expect(result).not.toBeNull(); // the card IS persisted — Regenerate must work
  });

  it('an empty extraction part is a failure too — same card, same skipped dispatch', async () => {
    vi.mocked(resolveTaskModel).mockResolvedValue(BUILTIN_PROVIDER as never);
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting({ segments: BIG_SEGMENTS }) as never);
    vi.mocked(extractMeetingStructure).mockResolvedValue({
      failureReason: 'part 2 of 4 returned an empty response',
    } as never);
    const { briefValues } = buildDb();

    await generateBrief(MEETING_ID);

    expect(generate).not.toHaveBeenCalled();
    const summary = persistedSummary(briefValues);
    expect(isFailedBriefText(summary)).toBe(true);
    expect(summary).toMatch(/part 2 of \d+ returned an empty response/);
    expect(dispatchPostSession).not.toHaveBeenCalled();
  });

  it('a failure card carries NO structure, so nothing can derive action items from it', async () => {
    vi.mocked(resolveTaskModel).mockResolvedValue(BUILTIN_PROVIDER as never);
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting({ segments: BIG_SEGMENTS }) as never);
    vi.mocked(extractMeetingStructure).mockResolvedValue({ failureReason: 'part 1 of 2 failed' } as never);
    const { briefValues } = buildDb();

    await generateBrief(MEETING_ID);

    expect(persistedStructure(briefValues)).toBeNull();
  });

  it('a successful brief persists the structure it was written from', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    vi.mocked(extractMeetingStructure).mockResolvedValue({ structure: structureFrom(1) } as never);
    const { briefValues } = buildDb();
    vi.mocked(generate).mockResolvedValue({ text: 'A real generated brief' } as never);

    await generateBrief(MEETING_ID);

    expect(persistedStructure(briefValues)).toEqual(structureFrom(1));
  });
});

// ---------------------------------------------------------------------------
// C. Chunked action-item path
// ---------------------------------------------------------------------------

describe('AI-CTX.1 — action items from an overflowing transcript (legacy text path)', () => {
  // projectId null keeps MEET-INTEL.1's auto-push (and its post-push re-query)
  // out of the picture, so the returned array IS what was extracted.
  it('extracts per part and merges, dropping a boundary-duplicated item', async () => {
    vi.mocked(resolveTaskModel).mockResolvedValue(BUILTIN_PROVIDER as never);
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting({ segments: BIG_SEGMENTS, projectId: null }) as never);
    const { actionValues } = buildDb();

    // Part 2 restates part 1's commitment with different casing/spacing — the
    // classic chunk-boundary repeat.
    let call = 0;
    vi.mocked(generate).mockImplementation((async () => {
      call += 1;
      if (call === 1) return { text: 'Ship the beta|Draft release notes' };
      if (call === 2) return { text: '  ship   THE beta  |Book the venue' };
      return { text: `Extra item ${call}` };
    }) as never);
    vi.mocked(parseActionItems).mockImplementation(((text: string) =>
      text
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean)) as never);

    const items = await generateActionItems(MEETING_ID);

    expect(vi.mocked(generate).mock.calls.length).toBeGreaterThanOrEqual(2);
    // Every part pass gets the SAME action system prompt (template + language +
    // suppression + twin), unlike the brief's deliberately stripped chunk prompt.
    for (const c of generateCalls()) {
      expect(c.system).toContain('do NOT re-extract');
      expect(c.system).toContain('Ship the beta');
    }

    const persisted = actionValues.mock.calls.map((c) => (c[0] as { description: string }).description);
    expect(persisted.filter((d) => /^\s*ship\s+the\s+beta\s*$/i.test(d))).toHaveLength(1);
    expect(persisted).toContain('Ship the beta'); // first spelling wins
    expect(persisted).toContain('Draft release notes');
    expect(persisted).toContain('Book the venue');
    expect(new Set(persisted).size).toBe(persisted.length);
    expect(items).toHaveLength(persisted.length);
  });

  it('a failing part yields no action items at all rather than a partial list', async () => {
    vi.mocked(resolveTaskModel).mockResolvedValue(BUILTIN_PROVIDER as never);
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting({ segments: BIG_SEGMENTS, projectId: null }) as never);
    const { actionValues } = buildDb();

    let call = 0;
    vi.mocked(generate).mockImplementation((async () => {
      call += 1;
      if (call === 2) throw new Error('connect ECONNREFUSED 127.0.0.1:1234');
      return { text: 'An item' };
    }) as never);
    vi.mocked(parseActionItems).mockImplementation(((text: string) => [text]) as never);

    await expect(generateActionItems(MEETING_ID)).resolves.toEqual([]);
    expect(actionValues).not.toHaveBeenCalled();
  });
});

describe('mergeActionDescriptions', () => {
  it('keeps part order and the first spelling of a repeat', () => {
    expect(
      mergeActionDescriptions([
        ['Ship the beta', 'Draft release notes'],
        ['  ship   THE beta ', 'Book the venue'],
        ['BOOK THE VENUE'],
      ]),
    ).toEqual(['Ship the beta', 'Draft release notes', 'Book the venue']);
  });

  it('drops blank descriptions and tolerates empty parts', () => {
    expect(mergeActionDescriptions([[], ['  ', 'Real one'], []])).toEqual(['Real one']);
  });
});

// ---------------------------------------------------------------------------
// D. Overflow classification — belt-and-braces behind the gate
// ---------------------------------------------------------------------------

describe('AI-CTX.1 — a context-overflow error is named as a gate bug, not noise', () => {
  it.each([
    'the request (22202 tokens) exceeds the available context size (16384 tokens)',
    "This model's maximum context length is 8192 tokens, however you requested 9000",
    'context_window exceeded for this request',
  ])('classifies %j as an outgrown context window', async (message) => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    const { briefValues } = buildDb();
    vi.mocked(generate).mockRejectedValue(new Error(message));

    await generateBrief(MEETING_ID);

    const summary = persistedSummary(briefValues);
    expect(isFailedBriefText(summary)).toBe(true);
    expect(summary).toContain('outgrew the model context window');
    expect(summary).toContain('the chunking gate should have prevented it');
    expect(summary).not.toContain(message); // never falls through to the raw catch-all
    expect(dispatchPostSession).not.toHaveBeenCalled();
  });

  it('leaves the built-in runtime classifications it sits next to untouched', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    const { briefValues } = buildDb();
    vi.mocked(generate).mockRejectedValue(new Error('llama-server did not become healthy within 60000ms'));

    await generateBrief(MEETING_ID);

    const summary = persistedSummary(briefValues);
    expect(summary).toContain('the built-in model did not finish loading in time');
    expect(summary).not.toContain('outgrew the model context window');
  });
});
