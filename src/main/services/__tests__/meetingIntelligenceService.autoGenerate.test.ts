// === FILE PURPOSE ===
// Unit tests for TWIN-LEARN.1 Task 1 — main-process auto-generation when a
// meeting completes. A recording that reaches status 'completed' must ALWAYS get
// its brief, action items and post-session learning, whether or not the session
// page is ever opened; and the resulting double-fire (main's auto-run + the
// renderer's own autoGenerate effect, which lands moments later because
// stopRecording navigates straight to the session page) must collapse into ONE
// generation.
//
// Mirrors the mocking style of meetingIntelligenceService.briefFailure.test.ts /
// .raceAbsorption.test.ts (same file under test), with ONE deliberate addition:
// '../meetingService' is only PARTIALLY mocked. The real updateMeeting and the
// real hook registry are what the transition seam is made of, so mocking them
// away would leave the seam itself untested — only getMeeting is replaced, which
// is what the siblings actually use the mock for.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports
// ---------------------------------------------------------------------------

// Hoisted so the mock factory (itself hoisted above imports by Vitest) can close
// over ONE shared log-mock instance — shared by BOTH services under test, which
// is what lets the "silent skip" assertions below check every log level at once.
const { logMock } = vi.hoisted(() => ({
  logMock: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../logger', () => ({ createLogger: () => logMock }));

vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));

vi.mock('../../db/schema', () => ({
  meetings: { __table: 'meetings', id: 'id', projectId: 'projectId', status: 'status', startedAt: 'startedAt' },
  transcripts: { __table: 'transcripts', meetingId: 'meetingId', startTime: 'startTime' },
  twinFacts: { __table: 'twinFacts', sourceMeetingId: 'sourceMeetingId', createdAt: 'createdAt' },
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
  projects: { __table: 'projects', id: 'id', system: 'system' },
  liveSuggestions: {
    __table: 'liveSuggestions',
    meetingId: 'meetingId',
    type: 'type',
    title: 'title',
    description: 'description',
    status: 'status',
  },
  calendarEvents: { __table: 'calendarEvents', id: 'id' },
}));

// PARTIAL mock: the real updateMeeting + the real meeting-completed registry are
// exactly what is under test here; only getMeeting is replaced (same role it
// plays in the sibling suites).
vi.mock('../meetingService', async (importActual) => {
  const actual = await importActual<typeof import('../meetingService')>();
  return { ...actual, getMeeting: vi.fn() };
});

// The real one imports electron (BrowserWindow) — nothing in this file exercises
// a project relink, so a spy is enough.
vi.mock('../dataChangeNotifier', () => ({ notifyDataChanged: vi.fn() }));

vi.mock('../ai-provider', () => ({
  generate: vi.fn(),
  resolveTaskModel: vi.fn(),
}));

vi.mock('../autoPushService', () => ({
  autoPushActionItems: vi.fn().mockResolvedValue({ pushedCount: 0, skippedCount: 0, cards: [] }),
  readAutoPushSetting: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../../shared/utils/action-item-parser', () => ({
  parseActionItems: vi.fn().mockReturnValue(['Follow up on the proposal']),
}));

vi.mock('../../../shared/types', () => ({
  MEETING_TEMPLATES: [],
}));

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

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  ensurePostSessionGeneration,
  generateBriefShared,
  generateActionItemsShared,
} from '../meetingIntelligenceService';
import {
  getMeeting,
  updateMeeting,
  registerMeetingCompletedHook,
  _resetMeetingCompletedHooks,
} from '../meetingService';
import { generate, resolveTaskModel } from '../ai-provider';
import { getDb } from '../../db/connection';
import { BRIEF_FAILURE_SENTINEL } from '../../../shared/briefSentinel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MEETING_ID = 'meeting-1';

/** A fixed projectId sidesteps the auto-detect path entirely (not the concern of
 *  this file), and the `projects` row below reports `system: true` so threading
 *  short-circuits before its join query — the same trick the sibling suites use. */
function makeMeeting(overrides: Record<string, unknown> = {}) {
  return {
    id: MEETING_ID,
    projectId: 'proj-1',
    title: 'Test Meeting',
    template: 'none',
    transcriptionLanguage: null,
    calendarEventId: null,
    segments: [
      {
        id: 'seg-1',
        meetingId: MEETING_ID,
        startTime: 0,
        endTime: 5000,
        content: 'Discuss the proposal',
        speaker: null,
        createdAt: new Date().toISOString(),
      },
    ],
    brief: null,
    actionItems: [],
    status: 'completed',
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    audioPath: null,
    prepBriefing: null,
    unassignedPending: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** The DB row shape updateMeeting's `returning()` yields — real Date objects,
 *  because toMeeting() calls .toISOString() on them. */
const DEFAULT_MEETING_ROW = {
  id: MEETING_ID,
  projectId: 'proj-1',
  title: 'Test Meeting',
  template: 'none',
  startedAt: new Date('2026-08-12T09:00:00Z'),
  endedAt: new Date('2026-08-12T10:00:00Z'),
  audioPath: null,
  status: 'completed',
  prepBriefing: null,
  transcriptionLanguage: null,
  unassignedPending: false,
  calendarEventId: null,
  calendarSeriesId: null,
  createdAt: new Date('2026-08-12T09:00:00Z'),
};

const DEFAULT_BRIEF_ROW = {
  id: 'brief-1',
  meetingId: MEETING_ID,
  summary: 'A real generated brief',
  createdAt: new Date('2026-08-12T10:01:00Z'),
};

const DEFAULT_ACTION_ROW = {
  id: 'action-1',
  meetingId: MEETING_ID,
  cardId: null,
  description: 'Follow up on the proposal',
  status: 'pending',
  createdAt: new Date('2026-08-12T10:02:00Z'),
};

const DEFAULT_PROVIDER = {
  providerId: 'p1',
  providerName: 'openai',
  apiKeyEncrypted: 'enc',
  baseUrl: null,
  model: 'gpt-4o-mini',
  temperature: 0,
  maxTokens: 500,
};

/**
 * Table-routed DB mock covering BOTH services:
 *  - select().from(meetings) → updateMeeting's pre-update read (the row whose
 *    `status` decides whether this write is the completion TRANSITION).
 *  - update(meetings)...returning() → the persisted new row.
 *  - select().from(projects) → [{system:true}], short-circuiting fetchPriorBriefs.
 *  - insert(meetingBriefs|actionItems).values(...).returning() → the rows above.
 * `briefValues` / `actionValues` are the spies that prove what was persisted —
 * the positive assertion the skip tests need (not just "it did not throw").
 */
function buildDb(opts: { previousStatus?: string; nextStatus?: string } = {}) {
  // The inserts ECHO what they were given, exactly as a real `returning()` does.
  // This matters beyond realism: generateBrief classifies its own result from the
  // RETURNED row's summary, so a mock returning a fixed happy-path row would make
  // a persisted failure card read back as a successful brief.
  const echo = (base: Record<string, unknown>) => (values: Record<string, unknown>) => ({
    returning: vi.fn().mockResolvedValue([{ ...base, ...values }]),
  });
  const briefValues = vi.fn(echo(DEFAULT_BRIEF_ROW));
  const actionValues = vi.fn(echo(DEFAULT_ACTION_ROW));

  const insertFn = vi.fn((table: { __table?: string }) => ({
    values: table.__table === 'meetingBriefs' ? briefValues : actionValues,
  }));

  const rowsFor: Record<string, unknown[]> = {
    meetings: [{ projectId: 'proj-1', status: opts.previousStatus ?? 'recording' }],
    projects: [{ system: true }],
  };
  // `where()` is awaitable AND chainable: BRIEF-QUAL.1's structure read goes
  // through getBrief, which adds .orderBy().limit(). [] there is "no brief yet",
  // keeping generateActionItems on the legacy text-extraction path.
  const selectFn = vi.fn(() => ({
    from: (table: { __table?: string }) => ({
      where: () => {
        const rows = rowsFor[table.__table ?? ''] ?? [];
        return {
          orderBy: () => ({ limit: () => Promise.resolve([]) }),
          then: (resolve: (v: unknown) => void) => resolve(rows),
        };
      },
    }),
  }));

  const updateReturning = vi
    .fn()
    .mockResolvedValue([{ ...DEFAULT_MEETING_ROW, status: opts.nextStatus ?? 'completed' }]);
  const updateFn = vi.fn(() => ({ set: () => ({ where: () => ({ returning: updateReturning }) }) }));

  const db = { select: selectFn, insert: insertFn, update: updateFn };
  vi.mocked(getDb).mockReturnValue(db as never);
  return { db, briefValues, actionValues };
}

/** The two system prompts are distinguishable by their opening line, so the
 *  provider spy can be counted per KIND of call — which is what "exactly one
 *  brief generation" has to mean when action extraction uses the same provider. */
function generateCallsMatching(marker: string) {
  return vi
    .mocked(generate)
    .mock.calls.filter(([args]) => String((args as { system?: string } | undefined)?.system ?? '').includes(marker));
}
const briefCalls = () => generateCallsMatching('the meeting brief from authoritative structured notes');
const actionCalls = () => generateCallsMatching('meeting action item extractor');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Exactly ONE registered hook at the start of every test, whatever the previous
  // test did to the registry — the module-scope self-registration is re-applied
  // rather than relied upon, so these tests are order-independent.
  _resetMeetingCompletedHooks();
  registerMeetingCompletedHook(ensurePostSessionGeneration);
  vi.mocked(resolveTaskModel).mockResolvedValue(DEFAULT_PROVIDER as never);
  vi.mocked(generate).mockResolvedValue({ text: 'A real generated brief' } as never);
  vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
  buildDb();
});

// ---------------------------------------------------------------------------
// The seam itself: updateMeeting fires meeting-completed hooks on the TRANSITION
// ---------------------------------------------------------------------------

describe('updateMeeting — meeting-completed hook seam', () => {
  it('fires hooks when the status transitions into completed', async () => {
    _resetMeetingCompletedHooks();
    const hook = vi.fn();
    registerMeetingCompletedHook(hook);
    buildDb({ previousStatus: 'recording' });

    await updateMeeting(MEETING_ID, { status: 'completed', endedAt: new Date().toISOString() });

    await vi.waitFor(() => expect(hook).toHaveBeenCalledTimes(1));
    expect(hook).toHaveBeenCalledWith(MEETING_ID);
  });

  it('does NOT fire when the meeting was already completed (repeat write of the same status)', async () => {
    _resetMeetingCompletedHooks();
    const hook = vi.fn();
    registerMeetingCompletedHook(hook);
    buildDb({ previousStatus: 'completed' });

    await updateMeeting(MEETING_ID, { status: 'completed' });
    await Promise.resolve();

    expect(hook).not.toHaveBeenCalled();
  });

  it('does NOT fire when the update does not touch status (a plain title edit)', async () => {
    _resetMeetingCompletedHooks();
    const hook = vi.fn();
    registerMeetingCompletedHook(hook);
    buildDb({ previousStatus: 'recording', nextStatus: 'recording' });

    await updateMeeting(MEETING_ID, { title: 'Renamed' });
    await Promise.resolve();

    expect(hook).not.toHaveBeenCalled();
  });

  it('a hook REJECTION is logged and never reaches updateMeeting', async () => {
    _resetMeetingCompletedHooks();
    registerMeetingCompletedHook(() => Promise.reject(new Error('hook exploded')));
    buildDb({ previousStatus: 'recording' });

    await expect(updateMeeting(MEETING_ID, { status: 'completed' })).resolves.toMatchObject({ id: MEETING_ID });

    await vi.waitFor(() =>
      expect(logMock.error).toHaveBeenCalledWith(
        expect.stringContaining('Meeting-completed hook failed'),
        expect.any(Error),
      ),
    );
  });

  it('a hook that THROWS synchronously never reaches updateMeeting either', async () => {
    _resetMeetingCompletedHooks();
    registerMeetingCompletedHook(() => {
      throw new Error('hook exploded synchronously');
    });
    buildDb({ previousStatus: 'recording' });

    await expect(updateMeeting(MEETING_ID, { status: 'completed' })).resolves.toMatchObject({ id: MEETING_ID });
    await vi.waitFor(() => expect(logMock.error).toHaveBeenCalled());
  });

  it('a hook that never settles cannot DELAY updateMeeting', async () => {
    _resetMeetingCompletedHooks();
    registerMeetingCompletedHook(() => new Promise<void>(() => {}));
    buildDb({ previousStatus: 'recording' });

    // Resolving at all is the assertion: an awaited hook would hang here forever.
    await expect(updateMeeting(MEETING_ID, { status: 'completed' })).resolves.toMatchObject({ id: MEETING_ID });
  });

  it('one failing hook does not stop the next one', async () => {
    _resetMeetingCompletedHooks();
    const second = vi.fn();
    registerMeetingCompletedHook(() => Promise.reject(new Error('first hook exploded')));
    registerMeetingCompletedHook(second);
    buildDb({ previousStatus: 'recording' });

    await updateMeeting(MEETING_ID, { status: 'completed' });

    await vi.waitFor(() => expect(second).toHaveBeenCalledWith(MEETING_ID));
  });
});

// ---------------------------------------------------------------------------
// End-to-end: completing a meeting generates brief + action items, page unopened
// ---------------------------------------------------------------------------

describe('auto-generation on completion', () => {
  it('a completed meeting gets its brief and then its action items with no page ever opened', async () => {
    const { briefValues, actionValues } = buildDb({ previousStatus: 'recording' });

    await updateMeeting(MEETING_ID, { status: 'completed', endedAt: new Date().toISOString() });

    await vi.waitFor(() => expect(actionValues).toHaveBeenCalled());
    expect(briefCalls()).toHaveLength(1);
    expect(briefValues).toHaveBeenCalledTimes(1);
    expect((briefValues.mock.calls[0]?.[0] as { summary?: string }).summary).toBe('A real generated brief');
    expect(actionCalls()).toHaveLength(1);
    expect(actionValues).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Guards — every one a SILENT skip: nothing persisted, nothing logged above debug
// ---------------------------------------------------------------------------

describe('ensurePostSessionGeneration — silent guards', () => {
  it('skips a recording with zero transcript segments, persisting NO failure card', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting({ segments: [] }) as never);
    const { briefValues } = buildDb();

    await ensurePostSessionGeneration(MEETING_ID);

    expect(generate).not.toHaveBeenCalled();
    expect(briefValues).not.toHaveBeenCalled();
    expect(logMock.debug).toHaveBeenCalledWith(expect.stringContaining('no transcript segments'));
    expect(logMock.error).not.toHaveBeenCalled();
    expect(logMock.warn).not.toHaveBeenCalled();
  });

  it('skips a meeting that already has a brief — regeneration stays manual', async () => {
    vi.mocked(getMeeting).mockResolvedValue(
      makeMeeting({ brief: { id: 'brief-0', meetingId: MEETING_ID, summary: 'existing', createdAt: 'now' } }) as never,
    );
    const { briefValues } = buildDb();

    await ensurePostSessionGeneration(MEETING_ID);

    expect(generate).not.toHaveBeenCalled();
    expect(briefValues).not.toHaveBeenCalled();
    expect(logMock.debug).toHaveBeenCalledWith(expect.stringContaining('a brief already exists'));
  });

  // AI-RESIL.1: a failure card IS a brief row. Auto-retrying it every time the
  // meeting is touched is exactly the loop the manual Regenerate button exists
  // to avoid.
  it('treats an existing FAILURE CARD as a brief and does not auto-retry it', async () => {
    vi.mocked(getMeeting).mockResolvedValue(
      makeMeeting({
        brief: {
          id: 'brief-0',
          meetingId: MEETING_ID,
          summary: `${BRIEF_FAILURE_SENTINEL}\n\nReason: openai/gpt-4o-mini — the model did not respond in time`,
          createdAt: 'now',
        },
      }) as never,
    );
    const { briefValues } = buildDb();

    await ensurePostSessionGeneration(MEETING_ID);

    expect(generate).not.toHaveBeenCalled();
    expect(briefValues).not.toHaveBeenCalled();
  });

  it('skips silently when no model resolves for summarization — no throw, nothing persisted', async () => {
    vi.mocked(resolveTaskModel).mockResolvedValue(null);
    const { briefValues } = buildDb();

    await expect(ensurePostSessionGeneration(MEETING_ID)).resolves.toBeUndefined();

    expect(generate).not.toHaveBeenCalled();
    expect(briefValues).not.toHaveBeenCalled();
    expect(logMock.debug).toHaveBeenCalledWith(expect.stringContaining('no model resolves for summarization'));
    expect(logMock.error).not.toHaveBeenCalled();
  });

  it('skips a meeting that vanished between the status write and this read', async () => {
    vi.mocked(getMeeting).mockResolvedValue(null);
    const { briefValues } = buildDb();

    await expect(ensurePostSessionGeneration(MEETING_ID)).resolves.toBeUndefined();

    expect(generate).not.toHaveBeenCalled();
    expect(briefValues).not.toHaveBeenCalled();
    expect(logMock.error).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AI-CTX.1(e) / AI-RESIL.1: a failed brief aborts the WHOLE run
// ---------------------------------------------------------------------------

describe('ensurePostSessionGeneration — failure semantics', () => {
  it('does NOT extract action items when the brief came back as a failure card', async () => {
    // generate() rejecting is what makes generateBrief persist a classified
    // failure card and return it (rather than throw) — see briefFailure.test.ts.
    vi.mocked(generate).mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:1234'));
    const { briefValues, actionValues } = buildDb();

    await ensurePostSessionGeneration(MEETING_ID);

    expect(briefValues).toHaveBeenCalledTimes(1);
    expect(String((briefValues.mock.calls[0]?.[0] as { summary?: string }).summary)).toContain(BRIEF_FAILURE_SENTINEL);
    expect(actionCalls()).toHaveLength(0);
    expect(actionValues).not.toHaveBeenCalled();
  });

  it('does NOT extract action items when the meeting was deleted mid-generation (null brief)', async () => {
    // Three reads on this path: ensurePostSessionGeneration's own guard, then
    // generateBrief's, then persistBriefAndDispatch's pre-write recheck — which
    // is the one that must see the meeting gone for generateBrief to resolve
    // null rather than throw "Meeting not found".
    vi.mocked(getMeeting)
      .mockResolvedValueOnce(makeMeeting() as never)
      .mockResolvedValueOnce(makeMeeting() as never)
      .mockResolvedValueOnce(null);
    const { actionValues } = buildDb();

    await expect(ensurePostSessionGeneration(MEETING_ID)).resolves.toBeUndefined();

    expect(actionValues).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Single-flight: the renderer's double-fire joins the run already in progress
// ---------------------------------------------------------------------------

describe('single-flight dedup with the IPC path', () => {
  it('an explicit generateBrief while the auto-run is in flight JOINS it — one generation, one row', async () => {
    const gate = deferred<{ text: string }>();
    vi.mocked(generate).mockReturnValueOnce(gate.promise as never);
    const { briefValues } = buildDb();

    const autoRun = ensurePostSessionGeneration(MEETING_ID);
    // Park until the auto-run is actually inside generate() — otherwise the
    // "concurrent" call would simply be the first one and prove nothing.
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));

    const viaIpc = generateBriefShared(MEETING_ID); // what the IPC handler calls
    gate.resolve({ text: 'A real generated brief' });
    const [, brief] = await Promise.all([autoRun, viaIpc]);

    expect(briefCalls()).toHaveLength(1);
    expect(briefValues).toHaveBeenCalledTimes(1);
    expect(brief).toMatchObject({ id: DEFAULT_BRIEF_ROW.id });
  });

  it('an explicit generateActionItems while an extraction is in flight JOINS it — one extraction', async () => {
    const gate = deferred<{ text: string }>();
    vi.mocked(generate).mockReturnValueOnce(gate.promise as never);
    const { actionValues } = buildDb();

    const first = generateActionItemsShared(MEETING_ID);
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));

    const second = generateActionItemsShared(MEETING_ID);
    gate.resolve({ text: '- Follow up on the proposal' });
    const [a, b] = await Promise.all([first, second]);

    expect(actionCalls()).toHaveLength(1);
    expect(actionValues).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('releases the slot when a run finishes, so a later explicit call runs again', async () => {
    buildDb();

    await generateBriefShared(MEETING_ID);
    await generateBriefShared(MEETING_ID);

    expect(briefCalls()).toHaveLength(2);
  });

  it('releases the slot when a run FAILS, so a failed meeting is never wedged', async () => {
    // A non-FK insert failure is generateBrief's one genuine throw path.
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn(() => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({ limit: () => Promise.resolve([]) }),
            then: (resolve: (v: unknown) => void) => resolve([{ system: true }]),
          }),
        }),
      })),
      insert: vi.fn(() => ({ values: () => ({ returning: vi.fn().mockRejectedValue(new Error('disk on fire')) }) })),
    } as never);

    await expect(generateBriefShared(MEETING_ID)).rejects.toThrow('disk on fire');
    await expect(generateBriefShared(MEETING_ID)).rejects.toThrow('disk on fire');

    expect(briefCalls()).toHaveLength(2);
  });
});
