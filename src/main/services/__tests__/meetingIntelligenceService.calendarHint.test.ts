// === FILE PURPOSE ===
// Unit tests for the Phase G Task 5 classifier calendar hint wiring in
// meetingIntelligenceService.runProjectDetection (invoked from generateBrief):
// - builds `calendarContext` from the cached calendar_events row's title +
//   attendee NAMES ONLY (never emails) when the meeting has a calendarEventId
// - omits the field (undefined) when there's no calendarEventId, or the
//   cached row is missing (e.g. purged after disconnect)
// - detection — and therefore the calendar lookup — stays SKIPPED when the
//   meeting already has a projectId

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports
// ---------------------------------------------------------------------------

vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));

vi.mock('../../db/schema', () => ({
  meetingBriefs: { meetingId: 'meetingId', summary: 'summary', createdAt: 'createdAt' },
  actionItems: {
    id: 'id',
    meetingId: 'meetingId',
    status: 'status',
    cardId: 'cardId',
    description: 'description',
    createdAt: 'createdAt',
  },
  cards: {},
  meetings: { id: 'id', projectId: 'projectId' },
  projects: { id: 'id', archived: 'archived', system: 'system', name: 'name', description: 'description' },
  liveSuggestions: {
    id: 'id',
    meetingId: 'meetingId',
    type: 'type',
    title: 'title',
    description: 'description',
    status: 'status',
  },
  calendarEvents: { id: 'id', title: 'title', attendees: 'attendees' },
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

vi.mock('../unassignedProjectService', () => ({
  ensureUnassignedProject: vi.fn().mockResolvedValue({ id: 'unassigned-id', name: 'Unassigned', system: true }),
}));

vi.mock('../projectDetectionService', () => ({
  detectProjectFromTranscript: vi.fn(),
}));

vi.mock('../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../../shared/utils/action-item-parser', () => ({
  parseActionItems: vi.fn().mockReturnValue([]),
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

import { generateBrief } from '../meetingIntelligenceService';
import { getMeeting, updateMeeting } from '../meetingService';
import { generate, resolveTaskModel } from '../ai-provider';
import { detectProjectFromTranscript } from '../projectDetectionService';
import { getDb } from '../../db/connection';

const MEETING_ID = 'meeting-1';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMeeting(overrides: Record<string, unknown> = {}) {
  return {
    id: MEETING_ID,
    projectId: null,
    title: 'Test Meeting',
    template: 'none',
    transcriptionLanguage: null,
    segments: [
      {
        id: 's1',
        meetingId: MEETING_ID,
        startTime: 0,
        endTime: 5000,
        content: 'discuss the roadmap',
        speaker: null,
        createdAt: '2025-01-01T00:00:00Z',
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
    calendarEventId: null,
    calendarSeriesId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Queue of responses returned by successive db.select(...).where(...) calls. */
function buildDb(responses: unknown[][]) {
  let idx = 0;
  const selectFn = vi.fn(() => {
    const response = responses[idx] ?? [];
    idx++;
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.innerJoin = vi.fn().mockReturnValue(chain);
    chain.orderBy = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockResolvedValue(response);
    chain.where = vi.fn().mockReturnValue({
      ...chain,
      then: (resolve: (v: unknown) => void) => resolve(response),
    });
    return chain;
  });

  const insertReturning = vi
    .fn()
    .mockResolvedValue([{ id: 'brief-1', meetingId: MEETING_ID, summary: 'ok', createdAt: new Date() }]);
  const db = {
    select: selectFn,
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: insertReturning })) })),
  };
  vi.mocked(getDb).mockReturnValue(db as never);
  return { db, selectFn };
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
  vi.mocked(generate).mockResolvedValue({ text: 'Generated brief content' } as never);
});

// ---------------------------------------------------------------------------
// calendarContext wiring
// ---------------------------------------------------------------------------

describe('runProjectDetection — calendar hint wiring (Phase G Task 5)', () => {
  it('builds calendarContext from the cached calendar_events row — title + attendee NAMES ONLY, never emails', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting({ projectId: null, calendarEventId: 'google:evt-1' }) as never);
    vi.mocked(detectProjectFromTranscript).mockResolvedValue({
      projectId: 'p1',
      confidence: 0.95,
      reason: 'clear match',
    });

    buildDb([
      [{ id: 'p1', name: 'Website', description: null }], // project candidates
      [{ title: 'Weekly Sync', attendees: [{ name: 'Alice' }, { name: 'Bob' }, { email: 'carol@example.com' }] }], // calendar_events row
      [{ system: false }], // proj.system check (threading)
      [], // prior briefs
    ]);

    await generateBrief(MEETING_ID);

    expect(detectProjectFromTranscript).toHaveBeenCalledOnce();
    const detectArgs = vi.mocked(detectProjectFromTranscript).mock.calls[0][0];
    expect(detectArgs.calendarContext).toBe('Weekly Sync; attendees: Alice, Bob');
    expect(detectArgs.calendarContext).not.toContain('carol@example.com');
    expect(detectArgs.calendarContext).not.toContain('@');
    expect(updateMeeting).toHaveBeenCalledWith(MEETING_ID, { projectId: 'p1' });
  });

  it('falls back to "none listed" when the cached event has no attendee names', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting({ projectId: null, calendarEventId: 'google:evt-2' }) as never);
    vi.mocked(detectProjectFromTranscript).mockResolvedValue({ projectId: null, confidence: 0, reason: 'n/a' });

    buildDb([[], [{ title: 'Solo Focus Block', attendees: [{ email: 'only@example.com' }] }], []]);

    await generateBrief(MEETING_ID);

    const detectArgs = vi.mocked(detectProjectFromTranscript).mock.calls[0][0];
    expect(detectArgs.calendarContext).toBe('Solo Focus Block; attendees: none listed');
  });

  it('omits calendarContext when the meeting has no calendarEventId', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting({ projectId: null, calendarEventId: null }) as never);
    vi.mocked(detectProjectFromTranscript).mockResolvedValue({ projectId: null, confidence: 0, reason: 'n/a' });

    buildDb([
      [{ id: 'p1', name: 'Website', description: null }], // project candidates
      [{ system: false }], // proj.system check would only run if resolvedProjectId truthy — unassigned path below
    ]);

    await generateBrief(MEETING_ID);

    const detectArgs = vi.mocked(detectProjectFromTranscript).mock.calls[0][0];
    expect(detectArgs.calendarContext).toBeUndefined();
  });

  it('omits calendarContext when the linked calendar_events row is missing (purged / disconnected)', async () => {
    vi.mocked(getMeeting).mockResolvedValue(
      makeMeeting({ projectId: null, calendarEventId: 'google:evt-purged' }) as never,
    );
    vi.mocked(detectProjectFromTranscript).mockResolvedValue({ projectId: null, confidence: 0, reason: 'n/a' });

    buildDb([
      [{ id: 'p1', name: 'Website', description: null }], // project candidates
      [], // calendar_events lookup — no row found
    ]);

    await generateBrief(MEETING_ID);

    const detectArgs = vi.mocked(detectProjectFromTranscript).mock.calls[0][0];
    expect(detectArgs.calendarContext).toBeUndefined();
  });

  it('does not block brief generation when the calendar_events lookup throws', async () => {
    vi.mocked(getMeeting).mockResolvedValue(
      makeMeeting({ projectId: null, calendarEventId: 'google:evt-err' }) as never,
    );
    vi.mocked(detectProjectFromTranscript).mockResolvedValue({ projectId: null, confidence: 0, reason: 'n/a' });

    let call = 0;
    const selectFn = vi.fn(() => {
      const thisCall = call++;
      if (thisCall === 1) {
        throw new Error('calendar_events query failed');
      }
      const response = thisCall === 0 ? [{ id: 'p1', name: 'Website', description: null }] : [];
      const chain: Record<string, unknown> = {};
      chain.from = vi.fn().mockReturnValue(chain);
      chain.innerJoin = vi.fn().mockReturnValue(chain);
      chain.orderBy = vi.fn().mockReturnValue(chain);
      chain.limit = vi.fn().mockResolvedValue(response);
      chain.where = vi.fn().mockReturnValue({ ...chain, then: (resolve: (v: unknown) => void) => resolve(response) });
      return chain;
    });
    vi.mocked(getDb).mockReturnValue({
      select: selectFn,
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi
            .fn()
            .mockResolvedValue([{ id: 'brief-1', meetingId: MEETING_ID, summary: 'ok', createdAt: new Date() }]),
        })),
      })),
    } as never);

    const result = await generateBrief(MEETING_ID);

    expect(result?.id).toBe('brief-1');
    const detectArgs = vi.mocked(detectProjectFromTranscript).mock.calls[0][0];
    expect(detectArgs.calendarContext).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Skip-when-already-classified guard
// ---------------------------------------------------------------------------

describe('generateBrief — skip detection (and calendar lookup) when projectId is already set', () => {
  it('never calls detectProjectFromTranscript, and never queries calendar_events, when meeting.projectId is set', async () => {
    vi.mocked(getMeeting).mockResolvedValue(
      makeMeeting({ projectId: 'pre-set-project', calendarEventId: 'google:evt-1' }) as never,
    );

    const { selectFn } = buildDb([
      [{ system: false }], // proj.system check (threading)
      [], // prior briefs
      [], // LIVE.2 accepted decisions/questions lookup
    ]);

    await generateBrief(MEETING_ID);

    expect(detectProjectFromTranscript).not.toHaveBeenCalled();
    expect(updateMeeting).not.toHaveBeenCalled();
    // Only the threading + LIVE.2 queries ran (3 selects) — no
    // project-candidates or calendar_events lookups from runProjectDetection.
    expect(selectFn).toHaveBeenCalledTimes(3);
  });
});
