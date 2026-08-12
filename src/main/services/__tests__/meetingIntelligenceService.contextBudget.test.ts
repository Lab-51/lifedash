// === FILE PURPOSE ===
// Unit tests for AI-CTX.1 Task 3 — the context-budget gate and the bounded
// chunked map-reduce it guards, in both transcript-consuming paths of
// meetingIntelligenceService (generateBrief, generateActionItems).
//
// Two halves, and the first matters as much as the second:
//   1. A transcript that FITS must produce exactly the assembly it produced
//      before this phase existed. The pins below are not hand-written from
//      reading the code — they were captured from the pre-change code running
//      this very fixture, and the sha256 is over `system + '\0' + prompt`, so a
//      single byte moving anywhere in either string fails the test.
//   2. A transcript that does NOT fit must produce a real brief via N part
//      passes plus one reduce pass, and must fall back to AI-RESIL.1's
//      classified failure card — never a partial brief, never a dispatch — on
//      any failing or empty part.
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

vi.mock('../postSessionDispatcher', () => ({ dispatchPostSession: vi.fn() }));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { generateBrief, generateActionItems, mergeActionDescriptions } from '../meetingIntelligenceService';
import { getMeeting } from '../meetingService';
import { generate, resolveTaskModel } from '../ai-provider';
import { getDb } from '../../db/connection';
import { dispatchPostSession } from '../postSessionDispatcher';
import { buildProfileContext } from '../twinProfileService';
import { parseActionItems } from '../../../shared/utils/action-item-parser';
import { BRIEF_FAILURE_SENTINEL, isFailedBriefText } from '../../../shared/briefSentinel';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MEETING_ID = 'meeting-fits';

/** Three short segments — the fits-case transcript the pins were captured from.
 *  Do not edit without re-capturing both digests. */
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
  buildDb();
});

// ---------------------------------------------------------------------------
// A. Fits-case regression pins — the whole point of the phase is that the
//    common path did not move.
// ---------------------------------------------------------------------------

describe('AI-CTX.1 — a transcript that fits is assembled byte-identically', () => {
  // Captured by running the PRE-change generateBrief against this exact fixture
  // (threading preamble + prep section + LIVE.2 confirmed context all present).
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

  /** sha256 of `system + '\0' + prompt` from the PRE-change code, same fixture.
   *  Covers the summarization system prompt too, which is far too long to pin
   *  inline without burying the test. */
  const BRIEF_FINGERPRINT_PIN = 'e195002d1fd65fb2d7481e7e54837aa097da115ac1ec9b4ac5cefb831d23d169';

  const ACTION_PROMPT_PIN =
    'Meeting: Quarterly Planning\n' +
    '\n' +
    'Transcript:\n' +
    '[00:00] Kickoff and agenda review.\n' +
    '[01:05] Budget numbers look healthy.\n' +
    '[02:05] Sarah will send the timeline.';

  const ACTION_FINGERPRINT_PIN = 'b790e5a8de6ea46829acd2222f8705a77168f35eceddc33468ac0567e4369980';

  it('generateBrief: one generate() call with the pre-change prompt, byte for byte', async () => {
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

  it('generateActionItems: one generate() call with the pre-change prompt, byte for byte', async () => {
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
// B. Chunked brief path
// ---------------------------------------------------------------------------

describe('AI-CTX.1 — a transcript that overflows the window is summarized in parts', () => {
  /** Chunk passes answer with a marker; the reduce pass (recognisable by its
   *  "Part summaries" core) answers with the final brief text. */
  function respondPerPass(finalText = 'THE FINAL BRIEF') {
    let chunkIndex = 0;
    vi.mocked(generate).mockImplementation((async (opts: { prompt: string }) => {
      if (opts.prompt.startsWith('Part ')) {
        chunkIndex += 1;
        return { text: `PART_SUMMARY_${chunkIndex}` };
      }
      return { text: finalText };
    }) as never);
  }

  it('runs N part passes then exactly one reduce pass, and labels the brief honestly', async () => {
    vi.mocked(resolveTaskModel).mockResolvedValue(BUILTIN_PROVIDER as never);
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting({ segments: BIG_SEGMENTS }) as never);
    vi.mocked(buildProfileContext).mockResolvedValue('User profile (the professional you assist): Dana');
    const { briefValues } = buildDb();
    respondPerPass();

    const result = await generateBrief(MEETING_ID);

    const calls = generateCalls();
    const chunkCount = calls.length - 1;
    expect(chunkCount).toBeGreaterThanOrEqual(2);

    // Every leading call is a part pass, numbered and totalled correctly.
    calls.slice(0, chunkCount).forEach((call, i) => {
      expect(call.prompt.startsWith(`Part ${i + 1} of ${chunkCount} of meeting "Quarterly Planning"`)).toBe(true);
    });

    // Part passes stay small and factual: no twin voice, no threading, no
    // confirmed-live context, no prep briefing.
    for (const call of calls.slice(0, chunkCount)) {
      expect(call.system).not.toContain('User profile');
      expect(call.prompt).not.toContain('Recent context from this project');
      expect(call.prompt).not.toContain('Confirmed during the meeting');
      expect(call.prompt).not.toContain('Pre-Meeting Prep Reference');
      expect(call.system).toContain('ONE PART of a long meeting transcript');
    }

    // The reduce pass carries every part summary AND every preamble the single
    // pass carries — that is what keeps template/threading/twin continuity.
    const reduce = calls[calls.length - 1];
    expect(reduce.prompt).toContain(`Part summaries (${chunkCount} parts):`);
    for (let i = 1; i <= chunkCount; i++) {
      expect(reduce.prompt).toContain(`PART_SUMMARY_${i}`);
    }
    expect(reduce.prompt).toContain('Recent context from this project');
    expect(reduce.prompt).toContain('PRIOR_ONE summary text');
    expect(reduce.prompt).toContain('Confirmed during the meeting');
    expect(reduce.prompt).toContain('Pre-Meeting Prep Reference');
    expect(reduce.prompt).not.toContain('lorem ipsum'); // raw transcript never re-sent
    expect(reduce.system).toContain('User profile');

    // Real output, honestly labelled, and the twin still learns from it.
    const summary = persistedSummary(briefValues);
    expect(summary).toContain('THE FINAL BRIEF');
    expect(summary.endsWith(`_Summarized in ${chunkCount + 1} passes (long meeting)._`)).toBe(true);
    expect(isFailedBriefText(summary)).toBe(false);
    expect(dispatchPostSession).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
  });

  it('a failing part stops the run with a classified card — no partial brief, no dispatch', async () => {
    vi.mocked(resolveTaskModel).mockResolvedValue(BUILTIN_PROVIDER as never);
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting({ segments: BIG_SEGMENTS }) as never);
    const { briefValues } = buildDb();

    let call = 0;
    vi.mocked(generate).mockImplementation((async () => {
      call += 1;
      if (call === 2) throw new Error('The operation timed out after 30000ms');
      return { text: `PART_SUMMARY_${call}` };
    }) as never);

    await generateBrief(MEETING_ID);

    // Stopped AT the failure — no reduce pass, no later parts.
    expect(vi.mocked(generate)).toHaveBeenCalledTimes(2);

    const summary = persistedSummary(briefValues);
    expect(summary.startsWith(BRIEF_FAILURE_SENTINEL)).toBe(true);
    expect(isFailedBriefText(summary)).toBe(true);
    expect(summary).toContain(`Reason: ${BUILTIN_PROVIDER.providerName}/${BUILTIN_PROVIDER.model}`);
    expect(summary).toMatch(/part 2 of \d+ of the transcript failed/);
    expect(summary).toContain('the model did not respond in time');
    expect(summary).not.toContain('PART_SUMMARY_1');
    expect(dispatchPostSession).not.toHaveBeenCalled();
  });

  it('an empty part is a failure too — same card, same skipped dispatch', async () => {
    vi.mocked(resolveTaskModel).mockResolvedValue(BUILTIN_PROVIDER as never);
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting({ segments: BIG_SEGMENTS }) as never);
    const { briefValues } = buildDb();

    let call = 0;
    vi.mocked(generate).mockImplementation((async () => {
      call += 1;
      return { text: call === 2 ? '' : `PART_SUMMARY_${call}` };
    }) as never);

    await generateBrief(MEETING_ID);

    expect(vi.mocked(generate)).toHaveBeenCalledTimes(2);
    const summary = persistedSummary(briefValues);
    expect(isFailedBriefText(summary)).toBe(true);
    expect(summary).toMatch(/part 2 of \d+ of the transcript returned an empty response/);
    expect(dispatchPostSession).not.toHaveBeenCalled();
  });

  it('a reduce prompt that itself keeps overflowing terminates at the bound with a card', async () => {
    vi.mocked(resolveTaskModel).mockResolvedValue(BUILTIN_PROVIDER as never);
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting({ segments: BIG_SEGMENTS }) as never);
    const { briefValues } = buildDb();

    // Every part summary is itself larger than the whole window, so no reduce
    // prompt can ever fit — the pathological many-hour meeting.
    vi.mocked(generate).mockResolvedValue({ text: 'X'.repeat(60_000) } as never);

    const result = await generateBrief(MEETING_ID);

    // Bounded: it stopped rather than looping. 3 levels (1 map + MAX_REDUCE_LEVELS)
    // over a small number of parts — the exact count is an implementation detail,
    // the FINITE-ness is the contract.
    const callCount = vi.mocked(generate).mock.calls.length;
    expect(callCount).toBeGreaterThan(0);
    expect(callCount).toBeLessThan(40);

    const summary = persistedSummary(briefValues);
    expect(isFailedBriefText(summary)).toBe(true);
    expect(summary).toContain('after 3 rounds of summarization');
    expect(dispatchPostSession).not.toHaveBeenCalled();
    expect(result).not.toBeNull(); // the card IS persisted — Regenerate must work
  });
});

// ---------------------------------------------------------------------------
// C. Chunked action-item path
// ---------------------------------------------------------------------------

describe('AI-CTX.1 — action items from an overflowing transcript', () => {
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
