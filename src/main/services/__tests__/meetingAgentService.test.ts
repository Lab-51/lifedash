// === FILE PURPOSE ===
// Unit tests for meetingAgentService (Live Assistant, LIVE.1 Phase A; expanded
// toolset LIVE.2 Task 3): transcript window budgeting (drops oldest, keeps
// most recent), transcript search hit/miss with neighbour context,
// createCardInInbox provenance + no-project routing to the Unassigned project,
// the full tool registry, no-project degradation for the reused board tools,
// captureNote's direct live_suggestions write, and a moveCard round trip.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports
// ---------------------------------------------------------------------------

vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));

vi.mock('../../db/schema', () => ({
  cards: {
    id: 'id',
    columnId: 'column_id',
    title: 'title',
    description: 'description',
    priority: 'priority',
    position: 'position',
    source: 'source',
    sourceMeetingId: 'source_meeting_id',
    completed: 'completed',
    archived: 'archived',
    updatedAt: 'updated_at',
    dueDate: 'due_date',
  },
  projects: { id: 'id', name: 'name' },
  boards: { id: 'id', projectId: 'project_id', name: 'name', position: 'position' },
  columns: { id: 'id', boardId: 'board_id', name: 'name', position: 'position' },
  cardActivities: { id: 'id', cardId: 'card_id', action: 'action', details: 'details' },
  liveSuggestions: {
    id: 'id',
    meetingId: 'meeting_id',
    type: 'type',
    title: 'title',
    description: 'description',
    status: 'status',
  },
}));

vi.mock('../meetingService', () => ({
  getMeeting: vi.fn(),
  getTranscripts: vi.fn(),
  updateMeeting: vi.fn(),
}));

vi.mock('../projectService', () => ({
  createProjectRecord: vi.fn(),
}));

vi.mock('../meetingIntelligenceService', () => ({
  fetchPriorBriefs: vi.fn(),
}));

vi.mock('../inboxColumnService', () => ({
  ensureInboxColumn: vi.fn(),
}));

vi.mock('../unassignedProjectService', () => ({
  ensureUnassignedProject: vi.fn(),
}));

vi.mock('../autoPushService', () => ({
  resolvePrimaryBoardId: vi.fn(),
}));

vi.mock('../dataChangeNotifier', () => ({ notifyDataChanged: vi.fn() }));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  buildTranscriptWindow,
  searchSegments,
  createLiveAssistantCard,
  createMeetingAgentTools,
  NO_PROJECT_MESSAGE,
  TRANSCRIPT_WINDOW_CHAR_BUDGET,
} from '../meetingAgentService';
import { getDb } from '../../db/connection';
import { getMeeting, updateMeeting } from '../meetingService';
import { createProjectRecord } from '../projectService';
import { ensureInboxColumn } from '../inboxColumnService';
import { ensureUnassignedProject } from '../unassignedProjectService';
import { resolvePrimaryBoardId } from '../autoPushService';
import { notifyDataChanged } from '../dataChangeNotifier';

// ---------------------------------------------------------------------------
// buildTranscriptWindow
// ---------------------------------------------------------------------------

describe('buildTranscriptWindow', () => {
  it('returns empty for no segments', () => {
    expect(buildTranscriptWindow([], 10)).toEqual({ text: '', keptSegments: 0, truncated: false });
  });

  it('keeps the most recent segments and truncates from the OLD end when over budget', () => {
    const segments = Array.from({ length: 6 }, (_, i) => ({
      content: `SEG${i}-${'x'.repeat(20)}`,
      startTime: i * 1000,
      endTime: i * 1000 + 900,
    }));

    // Large window (keep all by time) but a tiny char budget forces truncation.
    const res = buildTranscriptWindow(segments, 999, 60);

    expect(res.truncated).toBe(true);
    expect(res.text).toContain('SEG5'); // newest kept
    expect(res.text).not.toContain('SEG0'); // oldest dropped
    expect(res.keptSegments).toBeGreaterThan(0);
    expect(res.keptSegments).toBeLessThan(segments.length);
  });

  it('only includes segments within the recent-minutes window', () => {
    const segments = [
      { content: 'OLD talk', startTime: 0, endTime: 1000 },
      { content: 'RECENT talk', startTime: 20 * 60_000, endTime: 20 * 60_000 + 1000 },
    ];

    const res = buildTranscriptWindow(segments, 10, TRANSCRIPT_WINDOW_CHAR_BUDGET);

    expect(res.text).toContain('RECENT talk');
    expect(res.text).not.toContain('OLD talk');
  });

  it('keeps a single over-budget segment sliced rather than returning nothing', () => {
    const segments = [{ content: 'y'.repeat(200), startTime: 0, endTime: 900 }];

    const res = buildTranscriptWindow(segments, 999, 50);

    expect(res.truncated).toBe(true);
    expect(res.keptSegments).toBe(1);
    expect(res.text.length).toBeLessThanOrEqual(50);
  });

  it('formats lines with a mm:ss timestamp', () => {
    const res = buildTranscriptWindow([{ content: 'hello', startTime: 65_000, endTime: 66_000 }], 10);
    expect(res.text).toBe('[01:05] hello');
  });
});

// ---------------------------------------------------------------------------
// searchSegments
// ---------------------------------------------------------------------------

describe('searchSegments', () => {
  const segments = [
    { content: 'We discussed the budget', startTime: 0, endTime: 1000 },
    { content: 'Sarah will send the report', startTime: 1000, endTime: 2000 },
    { content: 'Next week we launch', startTime: 2000, endTime: 3000 },
  ];

  it('returns a hit with its ±1 neighbour segments for context', () => {
    const { results, matchCount } = searchSegments(segments, 'report');

    expect(matchCount).toBe(1);
    expect(results).toHaveLength(3); // match (idx 1) + neighbours idx 0 and 2
    const direct = results.find((r) => r.content.includes('report'));
    expect(direct?.match).toBe(true);
    // neighbours are flagged as non-matches
    expect(results.filter((r) => !r.match)).toHaveLength(2);
  });

  it('is case-insensitive', () => {
    expect(searchSegments(segments, 'BUDGET').matchCount).toBe(1);
  });

  it('returns no results on a miss', () => {
    const { results, matchCount } = searchSegments(segments, 'zzz-not-here');
    expect(matchCount).toBe(0);
    expect(results).toHaveLength(0);
  });

  it('returns empty for a blank query', () => {
    expect(searchSegments(segments, '   ')).toEqual({ results: [], matchCount: 0 });
  });
});

// ---------------------------------------------------------------------------
// createLiveAssistantCard
// ---------------------------------------------------------------------------

function makeInbox(id: string, name = 'Inbox') {
  return { id, boardId: 'board-x', name, position: 0, color: null, createdAt: new Date().toISOString() };
}

/** Minimal db mock: select().from().where() → count row; insert().values(spy).returning() → card row. */
function buildDb(cardCount: number, cardRow: Record<string, unknown>) {
  const valuesSpy = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([cardRow]) });
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ value: cardCount }]) })),
    })),
    insert: vi.fn(() => ({ values: valuesSpy })),
    _valuesSpy: valuesSpy,
  };
}

describe('createLiveAssistantCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sets source=live-assistant and sourceMeetingId, into the project Inbox', async () => {
    vi.mocked(getMeeting).mockResolvedValue({
      id: 'm1',
      projectId: 'proj-1',
      title: 'Roadmap sync',
      startedAt: new Date().toISOString(),
      endedAt: null,
    } as never);
    vi.mocked(resolvePrimaryBoardId).mockResolvedValue('board-1');
    vi.mocked(ensureInboxColumn).mockResolvedValue(makeInbox('inbox-1'));

    const db = buildDb(2, { id: 'card-1', title: 'Follow up with Sarah' });
    vi.mocked(getDb).mockReturnValue(db as never);

    const res = await createLiveAssistantCard('m1', { title: 'Follow up with Sarah' });

    expect(res.success).toBe(true);
    expect(res.cardId).toBe('card-1');
    expect(ensureUnassignedProject).not.toHaveBeenCalled();
    expect(resolvePrimaryBoardId).toHaveBeenCalledWith(db, 'proj-1');

    const insertArg = db._valuesSpy.mock.calls[0][0];
    expect(insertArg.source).toBe('live-assistant');
    expect(insertArg.sourceMeetingId).toBe('m1');
    expect(insertArg.columnId).toBe('inbox-1');
    expect(insertArg.position).toBe(2);
    // Single card-creation path broadcasts once so the visible board live-updates.
    expect(notifyDataChanged).toHaveBeenCalledWith({ scope: 'cards', projectId: 'proj-1' });
  });

  it('routes to the Unassigned project when the meeting has no project (never fails)', async () => {
    vi.mocked(getMeeting).mockResolvedValue({
      id: 'm2',
      projectId: null,
      title: 'Ad-hoc call',
      startedAt: new Date().toISOString(),
      endedAt: null,
    } as never);
    vi.mocked(ensureUnassignedProject).mockResolvedValue({ id: 'unassigned-1', name: 'Unassigned' } as never);
    vi.mocked(resolvePrimaryBoardId).mockResolvedValue('ub-1');
    vi.mocked(ensureInboxColumn).mockResolvedValue(makeInbox('uinbox-1'));

    const db = buildDb(0, { id: 'card-2', title: 'Capture idea' });
    vi.mocked(getDb).mockReturnValue(db as never);

    const res = await createLiveAssistantCard('m2', { title: 'Capture idea' });

    expect(res.success).toBe(true);
    expect(ensureUnassignedProject).toHaveBeenCalledWith(db);
    expect(resolvePrimaryBoardId).toHaveBeenCalledWith(db, 'unassigned-1');

    const insertArg = db._valuesSpy.mock.calls[0][0];
    expect(insertArg.source).toBe('live-assistant');
    expect(insertArg.sourceMeetingId).toBe('m2');
    expect(insertArg.columnId).toBe('uinbox-1');
    // Routed to Unassigned → broadcast carries the Unassigned project id.
    expect(notifyDataChanged).toHaveBeenCalledWith({ scope: 'cards', projectId: 'unassigned-1' });
  });

  it('returns a graceful error object instead of throwing when the meeting is missing', async () => {
    vi.mocked(getMeeting).mockResolvedValue(null as never);
    vi.mocked(getDb).mockReturnValue({} as never);

    const res = await createLiveAssistantCard('missing', { title: 'X' });

    expect(res.success).toBe(false);
    expect(res.error).toBe('Meeting not found');
    // No card created → no broadcast.
    expect(notifyDataChanged).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// createMeetingAgentTools — expanded toolset (LIVE.2 Task 3)
// ---------------------------------------------------------------------------

/** Loose shape for calling `.execute()` directly on a tool built via `tool()` (an identity fn). */
type AnyTool = { execute: (input: Record<string, unknown>) => Promise<unknown> };

async function getTools(meetingId: string): Promise<Record<string, AnyTool>> {
  return (await createMeetingAgentTools(meetingId)) as unknown as Record<string, AnyTool>;
}

function makeMeeting(projectId: string | null) {
  return {
    id: 'm1',
    projectId,
    title: 'Roadmap sync',
    startedAt: new Date().toISOString(),
    endedAt: null,
  };
}

const BOARD_TOOL_NAMES = ['listBoards', 'listColumnCards', 'moveCard', 'getProjectStats', 'searchProjectCards'];

describe('createMeetingAgentTools — tool registry', () => {
  beforeEach(() => vi.clearAllMocks());

  it('includes the transcript/context/card tools plus captureNote and the reused board tools', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting('proj-1') as never);
    vi.mocked(getDb).mockReturnValue({} as never); // board-tool factories call getDb() at construction only

    const tools = await getTools('m1');

    expect(Object.keys(tools).sort()).toEqual(
      [
        'getTranscriptWindow',
        'searchTranscript',
        'getMeetingContext',
        'createCardInInbox',
        'captureNote',
        'createProject',
        ...BOARD_TOOL_NAMES,
      ].sort(),
    );
  });
});

describe('createMeetingAgentTools — no-project degradation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('board tools return the clear message instead of throwing when the meeting has no project', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting(null) as never);

    const tools = await getTools('m1');

    for (const name of BOARD_TOOL_NAMES) {
      const result = await tools[name].execute({});
      expect(result).toBe(NO_PROJECT_MESSAGE);
    }
  });
});

describe('captureNote', () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists a 'decision' as an already-accepted live_suggestions row (no proposal step)", async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting('proj-1') as never);

    const returningSpy = vi
      .fn()
      .mockResolvedValue([
        { id: 'note-1', meetingId: 'm1', type: 'decision', title: 'Go with Postgres', description: null },
      ]);
    const valuesSpy = vi.fn().mockReturnValue({ returning: returningSpy });
    vi.mocked(getDb).mockReturnValue({ insert: vi.fn(() => ({ values: valuesSpy })) } as never);

    const tools = await getTools('m1');
    const result = await tools.captureNote.execute({ type: 'decision', title: 'Go with Postgres' });

    expect(valuesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingId: 'm1',
        type: 'decision',
        title: 'Go with Postgres',
        description: null,
        status: 'accepted',
      }),
    );
    expect(result).toEqual({ success: true, id: 'note-1', type: 'decision', title: 'Go with Postgres' });
  });
});

describe('createProject tool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a project via the shared path and links the meeting when unlinked', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting(null) as never);
    vi.mocked(getDb).mockReturnValue({} as never);
    vi.mocked(createProjectRecord).mockResolvedValue({ id: 'proj-new', name: 'Mobile Revamp' } as never);
    vi.mocked(updateMeeting).mockResolvedValue({} as never);

    const tools = await getTools('m1');
    const result = await tools.createProject.execute({ name: 'Mobile Revamp', description: 'Ship the new app' });

    expect(createProjectRecord).toHaveBeenCalledWith({}, { name: 'Mobile Revamp', description: 'Ship the new app' });
    expect(updateMeeting).toHaveBeenCalledWith('m1', { projectId: 'proj-new' });
    expect(result).toEqual({ success: true, projectId: 'proj-new', name: 'Mobile Revamp' });
  });

  it('refuses (returns a message, never throws) and creates nothing when already linked', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting('proj-1') as never);
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ name: 'Existing Project' }]) })),
      })),
    };
    vi.mocked(getDb).mockReturnValue(db as never);

    const tools = await getTools('m1');
    const result = await tools.createProject.execute({ name: 'Another Initiative' });

    expect(typeof result).toBe('string');
    expect(result).toContain('Existing Project');
    expect(createProjectRecord).not.toHaveBeenCalled();
    expect(updateMeeting).not.toHaveBeenCalled();
  });
});

describe('board tools — moveCard round trip', () => {
  beforeEach(() => vi.clearAllMocks());

  /** Sequential select().from().where() responses: card lookup, then source column, then target column. */
  function buildMoveCardDb(selectResults: unknown[][]) {
    let call = 0;
    const updateWhereSpy = vi.fn().mockResolvedValue(undefined);
    const updateSetSpy = vi.fn(() => ({ where: updateWhereSpy }));
    const insertValuesSpy = vi.fn().mockResolvedValue(undefined);
    return {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve(selectResults[call++] ?? [])),
        })),
      })),
      update: vi.fn(() => ({ set: updateSetSpy })),
      insert: vi.fn(() => ({ values: insertValuesSpy })),
      _insertValuesSpy: insertValuesSpy,
    };
  }

  it('moves a card to the target column and logs the activity', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting('proj-1') as never);

    const db = buildMoveCardDb([
      [{ id: 'card-1', title: 'Fix bug', columnId: 'col-source' }],
      [{ name: 'To Do' }],
      [{ name: 'Done' }],
      [{ boardId: 'board-1' }], // projectIdForColumn: column -> boardId
      [{ projectId: 'proj-1' }], // projectIdForColumn: board -> projectId
    ]);
    vi.mocked(getDb).mockReturnValue(db as never);

    const tools = await getTools('m1');
    const result = await tools.moveCard.execute({ cardId: 'card-1', targetColumnId: 'col-target' });

    expect(result).toEqual({ success: true, cardTitle: 'Fix bug', fromColumn: 'To Do', toColumn: 'Done' });
    expect(db._insertValuesSpy).toHaveBeenCalledWith(expect.objectContaining({ cardId: 'card-1', action: 'moved' }));
    // The live-assistant moveCard writes the DB directly — it must still broadcast once
    // so the embedded board live-updates mid-meeting.
    expect(notifyDataChanged).toHaveBeenCalledWith({ scope: 'cards', projectId: 'proj-1' });
  });

  it("returns an error (not a throw) when the target column doesn't exist", async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting('proj-1') as never);

    const db = buildMoveCardDb([[{ id: 'card-1', title: 'Fix bug', columnId: 'col-source' }], [{ name: 'To Do' }], []]);
    vi.mocked(getDb).mockReturnValue(db as never);

    const tools = await getTools('m1');
    const result = await tools.moveCard.execute({ cardId: 'card-1', targetColumnId: 'missing-column' });

    expect(result).toEqual({ success: false, error: 'Target column not found' });
  });
});
