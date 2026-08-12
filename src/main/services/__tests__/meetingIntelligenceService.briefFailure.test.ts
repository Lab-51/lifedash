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

// NEW for AI-RESIL.1 (unlike the raceAbsorption/twinProfile siblings, which
// leave the real fire-and-forget dispatcher in place): these tests must PROVE
// dispatch happened exactly once on success and never on any failure path, so
// the call needs to be a spy, not a real no-op with zero registered hooks.
vi.mock('../postSessionDispatcher', () => ({ dispatchPostSession: vi.fn() }));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { generateBrief } from '../meetingIntelligenceService';
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveTaskModel).mockResolvedValue(DEFAULT_PROVIDER as never);
  vi.mocked(generate).mockResolvedValue({ text: 'Generated content' } as never);
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
