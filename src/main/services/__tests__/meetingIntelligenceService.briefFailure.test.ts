// === FILE PURPOSE ===
// Unit tests for AI-RESIL.1 Task 1 — failure-aware brief persistence.
// generateBrief must persist a classified failure card (BRIEF_FAILURE_SENTINEL
// plus a "Reason: provider/model — ..." paragraph) instead of the bare
// sentinel when generation throws OR resolves empty, and must skip the
// post-session dispatch (persistBriefAndDispatch's new `dispatch` option) on
// every failure path so fact extraction / embedding / entity extraction never
// learn from failure text. Also re-proves the MEET-DEL.1 deleted-meeting race
// contract (null return, FK absorption) survives persistBriefAndDispatch's new
// third parameter.
//
// Mirrors the mocking style of meetingIntelligenceService.raceAbsorption.test.ts
// (same file under test, closest sibling).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports
// ---------------------------------------------------------------------------

// Hoisted so the mock factory (itself hoisted above imports by Vitest) can close
// over ONE shared log-mock instance.
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
  projects: { __table: 'projects', id: 'id', system: 'system' },
  liveSuggestions: {
    __table: 'liveSuggestions',
    meetingId: 'meetingId',
    type: 'type',
    title: 'title',
    description: 'description',
    status: 'status',
  },
}));

vi.mock('../meetingService', () => ({
  registerMeetingCompletedHook: vi.fn(), // module-scope self-registration (TWIN-LEARN.1)
  getMeeting: vi.fn(),
  updateMeeting: vi.fn().mockResolvedValue({}),
}));

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

// NEW for AI-RESIL.1 (unlike the raceAbsorption/twinProfile siblings, which
// leave the real fire-and-forget dispatcher in place): these tests must PROVE
// dispatch happened exactly once on success and never on any failure path, so
// the call needs to be a spy, not a real no-op with zero registered hooks.
vi.mock('../postSessionDispatcher', () => ({ dispatchPostSession: vi.fn() }));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { generateBrief, setBriefReadySender } from '../meetingIntelligenceService';
import { extractMeetingStructure } from '../briefExtractionService';
import { getMeeting } from '../meetingService';
import { generate, resolveTaskModel } from '../ai-provider';
import { getDb } from '../../db/connection';
import { dispatchPostSession } from '../postSessionDispatcher';
import { BRIEF_FAILURE_SENTINEL, isFailedBriefText } from '../../../shared/briefSentinel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MEETING_ID = 'meeting-1';

/** A fixed projectId sidesteps the auto-detect path entirely (not the concern
 *  of this file — covered by meetingIntelligenceService.threading.test.ts) so
 *  fetchPriorBriefs is the only extra `select` these tests need to satisfy. */
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

const DEFAULT_BRIEF_ROW = {
  id: 'brief-1',
  meetingId: MEETING_ID,
  summary: 'stored brief row text',
  createdAt: new Date('2025-01-01T00:00:00Z'),
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

/** A DatabaseError shape mirroring PGlite's (extends Error, carries the Postgres
 *  SQLSTATE on `.code`) — the exact shape isForeignKeyViolation() checks for. */
function fkViolation(table: string): Error {
  return Object.assign(new Error(`insert into ${table} violates foreign key constraint`), { code: '23503' });
}

/**
 * Build a minimal table-routed DB mock (same shape as the race-absorption
 * sibling's buildDb), PLUS a `briefValues` spy exposing exactly what
 * generateBrief tried to persist as the brief row — the positive assertion
 * this file needs (not just "it did not throw").
 */
function buildDb(
  opts: {
    briefInsertReturning?: Record<string, unknown>[];
    briefInsertRejects?: unknown;
  } = {},
) {
  const briefReturning = vi.fn();
  if (opts.briefInsertRejects !== undefined) briefReturning.mockRejectedValue(opts.briefInsertRejects);
  else briefReturning.mockResolvedValue(opts.briefInsertReturning ?? [DEFAULT_BRIEF_ROW]);

  const briefValues = vi.fn(() => ({ returning: briefReturning }));

  const insertFn = vi.fn((table: { __table?: string }) => ({
    values: table.__table === 'meetingBriefs' ? briefValues : vi.fn(() => ({ returning: vi.fn() })),
  }));

  const selectFn = vi.fn(() => ({
    from: (table: { __table?: string }) => ({
      where: () => Promise.resolve(table.__table === 'projects' ? [{ system: true }] : []),
    }),
  }));

  const db = { select: selectFn, insert: insertFn };
  vi.mocked(getDb).mockReturnValue(db as never);
  return { db, briefValues };
}

/** Read the `summary` text generateBrief tried to persist from a briefValues spy. */
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveTaskModel).mockResolvedValue(DEFAULT_PROVIDER as never);
  vi.mocked(generate).mockResolvedValue({ text: 'Generated content' } as never);
  // vi.clearAllMocks() does NOT undo an implementation, so the extraction seam is
  // re-pointed at the success fixture here: without it, one test's failureReason
  // would leak into every later test in the file.
  vi.mocked(extractMeetingStructure).mockResolvedValue({ structure: EXTRACTED_STRUCTURE } as never);
  buildDb();
});

// ---------------------------------------------------------------------------
// generateBrief — AI-RESIL.1 failure-aware persistence
// ---------------------------------------------------------------------------

describe('generateBrief — AI-RESIL.1 failure-aware persistence', () => {
  it('generation throws: persists a classified failure card and never dispatches', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    vi.mocked(generate).mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:1234'));
    const { briefValues } = buildDb();

    const result = await generateBrief(MEETING_ID);

    expect(result).not.toBeNull();
    expect(briefValues).toHaveBeenCalledTimes(1);
    const summary = persistedSummary(briefValues);
    expect(summary.startsWith(BRIEF_FAILURE_SENTINEL)).toBe(true);
    expect(isFailedBriefText(summary)).toBe(true);
    expect(summary).toContain(
      `Reason: ${DEFAULT_PROVIDER.providerName}/${DEFAULT_PROVIDER.model} — the local AI server is not reachable`,
    );
    expect(dispatchPostSession).not.toHaveBeenCalled();
  });

  it('generation throws a timeout-style error: classifies as "did not respond in time"', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    vi.mocked(generate).mockRejectedValue(new Error('The operation timed out after 30000ms'));
    const { briefValues } = buildDb();

    const result = await generateBrief(MEETING_ID);

    expect(result).not.toBeNull();
    const summary = persistedSummary(briefValues);
    expect(isFailedBriefText(summary)).toBe(true);
    expect(summary).toContain('the model did not respond in time');
    expect(dispatchPostSession).not.toHaveBeenCalled();
  });

  // The BUILT-IN runtime (models downloaded and run inside the app) is the local
  // path the reporting user actually runs, and its own startup failures carry
  // neither "timeout" nor "refused" — the exact strings thrown by
  // llamaRuntimeService.waitForHealth are pinned here, so a reworded throw upstream
  // fails this test instead of silently degrading the card to a raw message.
  it('classifies the built-in runtime health-deadline miss and names the model-swap cause', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    vi.mocked(generate).mockRejectedValue(
      new Error('llama-server did not become healthy within 60000ms (last: not ready)'),
    );
    const { briefValues } = buildDb();

    const result = await generateBrief(MEETING_ID);

    expect(result).not.toBeNull();
    const summary = persistedSummary(briefValues);
    expect(isFailedBriefText(summary)).toBe(true);
    expect(summary).toContain('the built-in model did not finish loading in time');
    expect(summary).toContain('switching models between tasks forces a full reload');
    // Must NOT fall through to the raw catch-all.
    expect(summary).not.toContain('llama-server did not become healthy');
    expect(dispatchPostSession).not.toHaveBeenCalled();
  });

  it('classifies a built-in sidecar that dies during startup', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    vi.mocked(generate).mockRejectedValue(new Error('llama-server exited during startup (code 1)'));
    const { briefValues } = buildDb();

    const result = await generateBrief(MEETING_ID);

    expect(result).not.toBeNull();
    const summary = persistedSummary(briefValues);
    expect(isFailedBriefText(summary)).toBe(true);
    expect(summary).toContain('the built-in AI runtime failed to start');
    expect(dispatchPostSession).not.toHaveBeenCalled();
  });

  it('generation resolves empty: takes the failure path and never dispatches', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    vi.mocked(generate).mockResolvedValue({ text: '' } as never);
    const { briefValues } = buildDb();

    const result = await generateBrief(MEETING_ID);

    expect(result).not.toBeNull();
    expect(briefValues).toHaveBeenCalledTimes(1);
    const summary = persistedSummary(briefValues);
    expect(summary.startsWith(BRIEF_FAILURE_SENTINEL)).toBe(true);
    expect(isFailedBriefText(summary)).toBe(true);
    expect(summary).toContain('the model returned an empty response');
    expect(dispatchPostSession).not.toHaveBeenCalled();
  });

  it('generation succeeds: persists the real text and dispatches exactly once', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    vi.mocked(generate).mockResolvedValue({ text: 'A real generated brief' } as never);
    const { briefValues } = buildDb();

    const result = await generateBrief(MEETING_ID);

    expect(result).not.toBeNull();
    const summary = persistedSummary(briefValues);
    expect(summary).toBe('A real generated brief');
    expect(isFailedBriefText(summary)).toBe(false);
    expect(dispatchPostSession).toHaveBeenCalledTimes(1);
    expect(dispatchPostSession).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingId: MEETING_ID,
        brief: expect.objectContaining({ id: DEFAULT_BRIEF_ROW.id }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// BRIEF-QUAL.1 added a THIRD source of failure ahead of the two above: the
// extraction pass, which runs before the writer and never throws — it returns an
// honest reason instead. It must land in exactly the same shape: one classified
// card, no dispatch, and no structure for anything downstream to derive from.
// ---------------------------------------------------------------------------

describe('generateBrief — the extraction pass is the third failure source (BRIEF-QUAL.1)', () => {
  it('an extraction failure persists the classified card and never dispatches', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    vi.mocked(extractMeetingStructure).mockResolvedValue({
      failureReason: 'part 2 of 5 failed — the local AI server is not reachable',
    } as never);
    const { briefValues } = buildDb();

    const result = await generateBrief(MEETING_ID);

    // The writer never ran: a brief written from half a meeting is worse than an
    // honest failure card (AI-CTX.1 (e)).
    expect(generate).not.toHaveBeenCalled();
    expect(result).not.toBeNull();
    expect(briefValues).toHaveBeenCalledTimes(1);
    const summary = persistedSummary(briefValues);
    expect(summary.startsWith(BRIEF_FAILURE_SENTINEL)).toBe(true);
    expect(isFailedBriefText(summary)).toBe(true);
    expect(summary).toContain(
      `Reason: ${DEFAULT_PROVIDER.providerName}/${DEFAULT_PROVIDER.model} — part 2 of 5 failed — the local AI server is not reachable`,
    );
    expect(dispatchPostSession).not.toHaveBeenCalled();
  });

  it('and stores no structure, so the failure card can never become action items', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    vi.mocked(extractMeetingStructure).mockResolvedValue({
      failureReason: 'part 1 of 1 returned invalid JSON — topics: expected array',
    } as never);
    const { briefValues } = buildDb();

    await generateBrief(MEETING_ID);

    expect(persistedStructure(briefValues)).toBeNull();
  });

  it('a writer failure AFTER a successful extraction still stores no structure', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    vi.mocked(generate).mockResolvedValue({ text: '' } as never);
    const { briefValues } = buildDb();

    await generateBrief(MEETING_ID);

    const summary = persistedSummary(briefValues);
    expect(isFailedBriefText(summary)).toBe(true);
    expect(summary).toContain('the model returned an empty response');
    expect(persistedStructure(briefValues)).toBeNull();
    expect(dispatchPostSession).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// generateBrief — MEET-DEL.1 deleted-meeting race contract survives the new
// persistBriefAndDispatch `dispatch` option
// ---------------------------------------------------------------------------

describe('generateBrief — MEET-DEL.1 deleted-meeting race (unchanged by AI-RESIL.1)', () => {
  it('meeting deleted before the write (existence recheck): resolves null and never dispatches', async () => {
    // 1st call (top of generateBrief): meeting exists. 2nd call (pre-write
    // recheck): gone — simulates a delete landing during the generate() call.
    // Generation itself SUCCEEDS here, isolating the deletion-race path from
    // the new failure-classification path above.
    vi.mocked(getMeeting)
      .mockResolvedValueOnce(makeMeeting() as never)
      .mockResolvedValueOnce(null);
    vi.mocked(generate).mockResolvedValue({ text: 'Generated content' } as never);
    buildDb();

    const result = await generateBrief(MEETING_ID);

    expect(result).toBeNull();
    expect(logMock.info).toHaveBeenCalledWith(expect.stringContaining('discarded'));
    expect(dispatchPostSession).not.toHaveBeenCalled();
  });

  it('delete lands after the existence check (FK violation on insert): resolves null and never dispatches', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    vi.mocked(generate).mockResolvedValue({ text: 'Generated content' } as never);
    buildDb({ briefInsertRejects: fkViolation('meeting_briefs') });

    const result = await generateBrief(MEETING_ID);

    expect(result).toBeNull();
    expect(logMock.info).toHaveBeenCalledWith(expect.stringContaining('discarded'));
    expect(dispatchPostSession).not.toHaveBeenCalled();
  });

  it('a generic (non-FK) insert failure still propagates — never silently absorbed, never dispatched', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    vi.mocked(generate).mockResolvedValue({ text: 'Generated content' } as never);
    buildDb({ briefInsertRejects: new Error('a real bug, unrelated to any deleted meeting') });

    await expect(generateBrief(MEETING_ID)).rejects.toThrow('a real bug, unrelated to any deleted meeting');
    expect(dispatchPostSession).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST-FLOW.1: meeting:brief-ready fires from persistBriefAndDispatch, the ONE
// choke point every generateBrief return path shares — success and every
// failure-card path alike. The manual-vs-auto notification distinction lives in
// ensurePostSessionGeneration and is covered by
// meetingIntelligenceService.autoGenerate.test.ts; this file only proves the
// emit itself, its `failed` flag, and that a throwing sender can never touch
// persistence (AI-RESIL.1 discipline extended to this event).
// ---------------------------------------------------------------------------

describe('meeting:brief-ready emit (POST-FLOW.1)', () => {
  it('emits failed:false after a successful persist', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    vi.mocked(generate).mockResolvedValue({ text: 'A real generated brief' } as never);
    buildDb();
    const sender = vi.fn();
    setBriefReadySender(sender);

    await generateBrief(MEETING_ID);

    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender).toHaveBeenCalledWith(MEETING_ID, false);
  });

  it('emits failed:true after a classified failure card (thrown generation error)', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    vi.mocked(generate).mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:1234'));
    buildDb();
    const sender = vi.fn();
    setBriefReadySender(sender);

    await generateBrief(MEETING_ID);

    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender).toHaveBeenCalledWith(MEETING_ID, true);
  });

  it('emits failed:true after an extraction-pass failure card', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    vi.mocked(extractMeetingStructure).mockResolvedValue({
      failureReason: 'part 1 of 1 returned invalid JSON — topics: expected array',
    } as never);
    buildDb();
    const sender = vi.fn();
    setBriefReadySender(sender);

    await generateBrief(MEETING_ID);

    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender).toHaveBeenCalledWith(MEETING_ID, true);
  });

  it('does not emit when the meeting was deleted before the write — a discard is not a persist', async () => {
    vi.mocked(getMeeting)
      .mockResolvedValueOnce(makeMeeting() as never)
      .mockResolvedValueOnce(null);
    vi.mocked(generate).mockResolvedValue({ text: 'Generated content' } as never);
    buildDb();
    const sender = vi.fn();
    setBriefReadySender(sender);

    await generateBrief(MEETING_ID);

    expect(sender).not.toHaveBeenCalled();
  });

  it('a throwing sender is error-isolated: brief persistence still succeeds (AI-RESIL.1 discipline)', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    vi.mocked(generate).mockResolvedValue({ text: 'A real generated brief' } as never);
    const { briefValues } = buildDb();
    setBriefReadySender(() => {
      throw new Error('renderer window destroyed mid-send');
    });

    const result = await generateBrief(MEETING_ID);

    expect(result).not.toBeNull();
    expect(briefValues).toHaveBeenCalledTimes(1);
    expect(persistedSummary(briefValues)).toBe('A real generated brief');
    expect(dispatchPostSession).toHaveBeenCalledTimes(1);
  });
});
