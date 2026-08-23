// === FILE PURPOSE ===
// Unit tests for MEET-DEL.1 race absorption in generateBrief / generateActionItems.
// Reproduces the production bug (2026-08-06): a meeting deleted while an in-flight
// LLM call is still running must resolve as a benign, logged, typed no-op — never
// a raw SQL/FK error (which would carry the generated summary/action text) reaching
// the renderer. Each writer is guarded by TWO independent signals: a fresh
// getMeeting() recheck immediately before the write, and catching the insert's own
// foreign_key_violation (23503) for the narrower gap the recheck cannot close.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports
// ---------------------------------------------------------------------------

// Hoisted so the mock factory (itself hoisted above imports by Vitest) can close
// over ONE shared log-mock instance — needed to assert on log.info call content.
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

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { generateBrief, generateActionItems } from '../meetingIntelligenceService';
import { getMeeting } from '../meetingService';
import { generate, resolveTaskModel } from '../ai-provider';
import { autoPushActionItems } from '../autoPushService';
import { getDb } from '../../db/connection';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MEETING_ID = 'meeting-1';

/** A fixed projectId sidesteps the auto-detect path entirely (not the concern of
 *  this file — covered by meetingIntelligenceService.threading.test.ts) so
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
  summary: 'AI brief text',
  createdAt: new Date('2025-01-01T00:00:00Z'),
};

const DEFAULT_ACTION_ROW = {
  id: 'action-1',
  meetingId: MEETING_ID,
  cardId: null,
  description: 'Follow up on the proposal',
  status: 'pending',
  createdAt: new Date('2025-01-01T00:00:00Z'),
};

/**
 * Build a minimal table-routed DB mock.
 * - select().from(projects).where(...) → [{system:true}], short-circuiting
 *   fetchPriorBriefs to [] with no further query (the only select generateBrief
 *   issues once resolvedProjectId is already set).
 * - insert(meetingBriefs | actionItems).values(...).returning() resolves the
 *   configured row(s), or rejects with the configured error.
 */
function buildDb(
  opts: {
    briefInsertReturning?: Record<string, unknown>[];
    briefInsertRejects?: unknown;
    actionItemInsertReturning?: Record<string, unknown>[];
    actionItemInsertRejects?: unknown;
  } = {},
) {
  const briefReturning = vi.fn();
  if (opts.briefInsertRejects !== undefined) briefReturning.mockRejectedValue(opts.briefInsertRejects);
  else briefReturning.mockResolvedValue(opts.briefInsertReturning ?? [DEFAULT_BRIEF_ROW]);

  const actionReturning = vi.fn();
  if (opts.actionItemInsertRejects !== undefined) actionReturning.mockRejectedValue(opts.actionItemInsertRejects);
  else actionReturning.mockResolvedValue(opts.actionItemInsertReturning ?? [DEFAULT_ACTION_ROW]);

  const insertFn = vi.fn((table: { __table?: string }) => ({
    values: () => ({
      returning: table.__table === 'actionItems' ? actionReturning : briefReturning,
    }),
  }));

  // `where()` is awaitable AND chainable: BRIEF-QUAL.1's structure read goes
  // through getBrief, which adds .orderBy().limit(). [] there is "no brief yet",
  // keeping generateActionItems on the legacy text-extraction path.
  const selectFn = vi.fn(() => ({
    from: (table: { __table?: string }) => ({
      where: () => {
        const rows = table.__table === 'projects' ? [{ system: true }] : [];
        return {
          orderBy: () => ({ limit: () => Promise.resolve([]) }),
          then: (resolve: (v: unknown) => void) => resolve(rows),
        };
      },
    }),
  }));

  const db = { select: selectFn, insert: insertFn };
  vi.mocked(getDb).mockReturnValue(db as never);
  return db;
}

/** A DatabaseError shape mirroring PGlite's (extends Error, carries the Postgres
 *  SQLSTATE on `.code`) — the exact shape isForeignKeyViolation() checks for. */
function fkViolation(table: string): Error {
  return Object.assign(new Error(`insert into ${table} violates foreign key constraint`), { code: '23503' });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveTaskModel).mockResolvedValue({
    providerId: 'p1',
    providerName: 'openai',
    apiKeyEncrypted: 'enc',
    baseUrl: null,
    model: 'gpt-4o-mini',
    temperature: 0,
    maxTokens: 500,
  } as never);
  vi.mocked(generate).mockResolvedValue({ text: 'Generated content' } as never);
  buildDb();
});

// ---------------------------------------------------------------------------
// generateBrief — MEET-DEL.1 deleted-meeting race
// ---------------------------------------------------------------------------

describe('generateBrief — MEET-DEL.1 deleted-meeting race', () => {
  it('resolves null when the meeting is deleted between generation start and the write (existence recheck)', async () => {
    // 1st call (top of generateBrief): meeting exists. 2nd call (pre-write
    // recheck): gone — simulates a delete landing during the generate() call.
    vi.mocked(getMeeting)
      .mockResolvedValueOnce(makeMeeting() as never)
      .mockResolvedValueOnce(null);

    const result = await generateBrief(MEETING_ID);

    expect(result).toBeNull();
    expect(vi.mocked(getMeeting)).toHaveBeenCalledTimes(2);
    expect(logMock.info).toHaveBeenCalledTimes(1);
    expect(logMock.info).toHaveBeenCalledWith(expect.stringContaining(MEETING_ID));
    expect(logMock.info).toHaveBeenCalledWith(expect.stringContaining('discarded'));
    expect(logMock.error).not.toHaveBeenCalled();
  });

  it('resolves null when the delete lands AFTER the existence check (FK violation on insert)', async () => {
    // Both calls see the meeting — the delete happens in the gap between the
    // recheck and the insert itself, surfacing as a foreign_key_violation.
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    buildDb({ briefInsertRejects: fkViolation('meeting_briefs') });

    const result = await generateBrief(MEETING_ID);

    expect(result).toBeNull();
    expect(logMock.info).toHaveBeenCalledTimes(1);
    expect(logMock.info).toHaveBeenCalledWith(expect.stringContaining('discarded'));
    expect(logMock.error).not.toHaveBeenCalled();
  });

  it('never leaks the generated summary text in a log — the FK path logs the standard message only', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    vi.mocked(generate).mockResolvedValue({ text: 'SENSITIVE SUMMARY CONTENT' } as never);
    buildDb({ briefInsertRejects: fkViolation('meeting_briefs') });

    await generateBrief(MEETING_ID);

    for (const call of logMock.info.mock.calls) {
      expect(call.join(' ')).not.toContain('SENSITIVE SUMMARY CONTENT');
    }
    for (const call of logMock.error.mock.calls) {
      expect(call.join(' ')).not.toContain('SENSITIVE SUMMARY CONTENT');
    }
  });

  it('a generic (non-FK) insert failure still propagates — never silently absorbed as meeting-deleted', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    buildDb({ briefInsertRejects: new Error('a real bug, unrelated to any deleted meeting') });

    await expect(generateBrief(MEETING_ID)).rejects.toThrow('a real bug, unrelated to any deleted meeting');
  });
});

// ---------------------------------------------------------------------------
// generateActionItems — MEET-DEL.1 deleted-meeting race
// ---------------------------------------------------------------------------

describe('generateActionItems — MEET-DEL.1 deleted-meeting race', () => {
  it('resolves [] when the meeting is deleted between generation start and the write (existence recheck)', async () => {
    vi.mocked(getMeeting)
      .mockResolvedValueOnce(makeMeeting() as never)
      .mockResolvedValueOnce(null);

    const result = await generateActionItems(MEETING_ID);

    expect(result).toEqual([]);
    expect(vi.mocked(getMeeting)).toHaveBeenCalledTimes(2);
    expect(logMock.info).toHaveBeenCalledTimes(1);
    expect(logMock.info).toHaveBeenCalledWith(expect.stringContaining(MEETING_ID));
    expect(logMock.info).toHaveBeenCalledWith(expect.stringContaining('discarded'));
    expect(logMock.error).not.toHaveBeenCalled();
    expect(autoPushActionItems).not.toHaveBeenCalled();
  });

  it('resolves [] when the delete lands AFTER the existence check (FK violation on insert)', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    buildDb({ actionItemInsertRejects: fkViolation('action_items') });

    const result = await generateActionItems(MEETING_ID);

    expect(result).toEqual([]);
    expect(logMock.info).toHaveBeenCalledTimes(1);
    expect(logMock.info).toHaveBeenCalledWith(expect.stringContaining('discarded'));
    expect(logMock.error).not.toHaveBeenCalled();
    expect(autoPushActionItems).not.toHaveBeenCalled();
  });

  it('a generic (non-FK) insert failure still propagates — never silently absorbed as meeting-deleted', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    buildDb({ actionItemInsertRejects: new Error('a real bug, unrelated to any deleted meeting') });

    await expect(generateActionItems(MEETING_ID)).rejects.toThrow('a real bug, unrelated to any deleted meeting');
  });
});
