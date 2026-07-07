// === FILE PURPOSE ===
// Unit tests for meetingService.updateMeeting — covers the link-time auto-push
// hook (null→non-null projectId transition).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports
// ---------------------------------------------------------------------------

vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));

vi.mock('../../db/schema', () => ({
  meetings: {
    id: 'id',
    projectId: 'projectId',
    title: 'title',
    template: 'template',
    startedAt: 'startedAt',
    endedAt: 'endedAt',
    audioPath: 'audioPath',
    status: 'status',
    prepBriefing: 'prepBriefing',
    transcriptionLanguage: 'transcriptionLanguage',
    createdAt: 'createdAt',
  },
  transcripts: {},
  meetingBriefs: {},
  actionItems: {
    id: 'id',
    meetingId: 'meetingId',
    status: 'status',
    cardId: 'cardId',
    description: 'description',
    createdAt: 'createdAt',
  },
}));

vi.mock('../autoPushService', () => ({
  autoPushActionItems: vi.fn().mockResolvedValue({ pushedCount: 1, skippedCount: 0, cards: [] }),
  readAutoPushSetting: vi.fn().mockResolvedValue(true),
}));

vi.mock('../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../dataChangeNotifier', () => ({ notifyDataChanged: vi.fn() }));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { updateMeeting } from '../meetingService';
import { autoPushActionItems, readAutoPushSetting } from '../autoPushService';
import { notifyDataChanged } from '../dataChangeNotifier';
import { getDb } from '../../db/connection';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMeetingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'meeting-1',
    projectId: null,
    title: 'Test Meeting',
    template: 'none',
    startedAt: new Date('2025-01-01T10:00:00Z'),
    endedAt: null,
    audioPath: null,
    status: 'completed',
    prepBriefing: null,
    transcriptionLanguage: null,
    unassignedPending: false,
    createdAt: new Date('2025-01-01T10:00:00Z'),
    ...overrides,
  };
}

function makeActionItemRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'action-1',
    meetingId: 'meeting-1',
    cardId: null,
    description: 'Follow up on the proposal',
    status: 'pending',
    createdAt: new Date('2025-01-01T10:05:00Z'),
    ...overrides,
  };
}

/**
 * Build a DB mock for updateMeeting scenarios.
 *
 * selectResponses controls what each successive .select() call returns:
 *  - [0]: project-id pre-read (current meeting's projectId column)
 *  - [1]: pending action items query
 *  - [2]: readAutoPushSetting settings lookup (only when autoPushService is NOT mocked at DB level)
 *
 * updateReturning: what the .update().set().where().returning() resolves to
 */
function buildDb(opts: { selectResponses: unknown[][]; updateReturning?: unknown[] }) {
  let selectIdx = 0;

  const selectFn = vi.fn(() => {
    const response = opts.selectResponses[selectIdx] ?? [];
    selectIdx++;
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(response),
    };
    // Allow awaiting .where() directly (action items query has no .limit)
    (chain.where as ReturnType<typeof vi.fn>).mockReturnValue({
      ...chain,
      then: (resolve: (v: unknown) => void) => resolve(response),
    });
    return chain;
  });

  const updateReturning = vi.fn().mockResolvedValue(opts.updateReturning ?? [makeMeetingRow()]);
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const updateFn = vi.fn(() => ({ set: updateSet }));

  const db = {
    select: selectFn,
    update: updateFn,
    _updateReturning: updateReturning,
  };

  vi.mocked(getDb).mockReturnValue(db as never);
  return db;
}

// ---------------------------------------------------------------------------
// updateMeeting — link-time auto-push hook tests
// ---------------------------------------------------------------------------

describe('updateMeeting — link-time auto-push hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(autoPushActionItems).mockResolvedValue({ pushedCount: 1, skippedCount: 0, cards: [] });
    vi.mocked(readAutoPushSetting).mockResolvedValue(true);
  });

  // ---------------------------------------------------------------------------
  // Happy path: null → non-null with pending items
  // ---------------------------------------------------------------------------

  it('fires auto-push on null→non-null projectId transition when pending items exist', async () => {
    const currentMeeting = makeMeetingRow({ projectId: null });
    const pendingItem = makeActionItemRow();
    const updatedMeeting = makeMeetingRow({ projectId: 'proj-1' });

    buildDb({
      selectResponses: [
        [currentMeeting], // pre-read: current projectId
        [pendingItem], // pending items query
      ],
      updateReturning: [updatedMeeting],
    });

    await updateMeeting('meeting-1', { projectId: 'proj-1' });

    expect(autoPushActionItems).toHaveBeenCalledOnce();
    expect(autoPushActionItems).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingId: 'meeting-1',
        projectId: 'proj-1',
        actionItems: expect.arrayContaining([expect.objectContaining({ id: 'action-1', status: 'pending' })]),
      }),
    );
  });

  // ---------------------------------------------------------------------------
  // Non-null → non-null: project A → project B must NOT trigger auto-push
  // ---------------------------------------------------------------------------

  it('does NOT fire auto-push when changing from one project to another (non-null→non-null)', async () => {
    const currentMeeting = makeMeetingRow({ projectId: 'proj-old' });
    const updatedMeeting = makeMeetingRow({ projectId: 'proj-new' });

    buildDb({
      selectResponses: [
        [currentMeeting], // pre-read
      ],
      updateReturning: [updatedMeeting],
    });

    await updateMeeting('meeting-1', { projectId: 'proj-new' });

    expect(autoPushActionItems).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Null → non-null but NO pending items — auto-push must not be called
  // ---------------------------------------------------------------------------

  it('does NOT fire auto-push when null→non-null transition but no pending items exist', async () => {
    const currentMeeting = makeMeetingRow({ projectId: null });
    const updatedMeeting = makeMeetingRow({ projectId: 'proj-1' });

    buildDb({
      selectResponses: [
        [currentMeeting], // pre-read
        [], // no pending items
      ],
      updateReturning: [updatedMeeting],
    });

    await updateMeeting('meeting-1', { projectId: 'proj-1' });

    expect(autoPushActionItems).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Auto-push throws — meeting update must still succeed
  // ---------------------------------------------------------------------------

  it('still returns the updated meeting when auto-push throws', async () => {
    vi.mocked(autoPushActionItems).mockRejectedValueOnce(new Error('Push failed'));

    const currentMeeting = makeMeetingRow({ projectId: null });
    const pendingItem = makeActionItemRow();
    const updatedMeeting = makeMeetingRow({ projectId: 'proj-1' });

    buildDb({
      selectResponses: [[currentMeeting], [pendingItem]],
      updateReturning: [updatedMeeting],
    });

    const result = await updateMeeting('meeting-1', { projectId: 'proj-1' });

    expect(result.id).toBe('meeting-1');
    expect(result.projectId).toBe('proj-1');
    // Auto-push was attempted
    expect(autoPushActionItems).toHaveBeenCalledOnce();
  });

  // ---------------------------------------------------------------------------
  // No projectId in update data — pre-read skipped entirely
  // ---------------------------------------------------------------------------

  it('skips the pre-read when projectId is not part of the update', async () => {
    const updatedMeeting = makeMeetingRow({ title: 'New Title' });

    buildDb({
      selectResponses: [],
      updateReturning: [updatedMeeting],
    });

    const result = await updateMeeting('meeting-1', { title: 'New Title' });

    expect(result.title).toBe('New Title');
    expect(autoPushActionItems).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// updateMeeting — data:changed broadcast on a project link change
// (the Brain / project-keyed boards refresh only on this event)
// ---------------------------------------------------------------------------

describe('updateMeeting — data:changed on project link change', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(autoPushActionItems).mockResolvedValue({ pushedCount: 0, skippedCount: 0, cards: [] });
    vi.mocked(readAutoPushSetting).mockResolvedValue(true);
  });

  it('broadcasts data:changed{projects} when the linked project SWITCHES', async () => {
    buildDb({
      selectResponses: [[makeMeetingRow({ projectId: 'proj-1' })]], // pre-read: old project
      updateReturning: [makeMeetingRow({ projectId: 'proj-2' })],
    });

    await updateMeeting('meeting-1', { projectId: 'proj-2' });

    expect(notifyDataChanged).toHaveBeenCalledWith({ scope: 'projects', projectId: 'proj-2' });
  });

  it('broadcasts on UNLINK (project → null), carrying the old project id', async () => {
    buildDb({
      selectResponses: [[makeMeetingRow({ projectId: 'proj-1' })]],
      updateReturning: [makeMeetingRow({ projectId: null })],
    });

    await updateMeeting('meeting-1', { projectId: null });

    expect(notifyDataChanged).toHaveBeenCalledWith({ scope: 'projects', projectId: 'proj-1' });
  });

  it('does NOT broadcast for a non-project edit (title only) — no refresh storm', async () => {
    buildDb({
      selectResponses: [],
      updateReturning: [makeMeetingRow({ title: 'Renamed' })],
    });

    await updateMeeting('meeting-1', { title: 'Renamed' });

    expect(notifyDataChanged).not.toHaveBeenCalled();
  });
});
