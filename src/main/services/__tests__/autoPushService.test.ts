// === FILE PURPOSE ===
// Unit tests for autoPushActionItems — covers happy path, idempotency,
// disabled setting, transaction rollback, zero items, and no-board scenarios.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports
// ---------------------------------------------------------------------------

vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));

vi.mock('../../db/schema', () => ({
  actionItems: { id: 'id', status: 'status', cardId: 'cardId' },
  boards: { id: 'id', projectId: 'projectId', position: 'position', name: 'name' },
  cards: {
    $inferSelect: {},
    id: 'id',
    columnId: 'columnId',
    title: 'title',
    description: 'description',
    priority: 'priority',
    position: 'position',
    source: 'source',
    sourceMeetingId: 'sourceMeetingId',
    dueDate: 'dueDate',
    completed: 'completed',
    archived: 'archived',
    recurrenceType: 'recurrenceType',
    recurrenceEndDate: 'recurrenceEndDate',
    sourceRecurringId: 'sourceRecurringId',
    reviewedAt: 'reviewedAt',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  },
  projects: { id: 'id', autoPushEnabled: 'auto_push_enabled' },
  settings: { key: 'key', value: 'value' },
}));

vi.mock('../inboxColumnService', () => ({
  ensureInboxColumn: vi.fn().mockResolvedValue({
    id: 'inbox-col-1',
    boardId: 'board-1',
    name: 'Inbox',
    position: 0,
    color: null,
    createdAt: new Date().toISOString(),
  }),
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

import { autoPushActionItems, readAutoPushSetting, SETTINGS_KEY_AUTO_PUSH } from '../autoPushService';
import { ensureInboxColumn } from '../inboxColumnService';
import { notifyDataChanged } from '../dataChangeNotifier';
import type { ActionItem } from '../../../shared/types/intelligence';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCardRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'card-1',
    columnId: 'inbox-col-1',
    title: 'Do the thing',
    description: 'Do the thing\n\n_From meeting: meeting-1_',
    position: 0,
    priority: 'medium',
    dueDate: null,
    completed: false,
    archived: false,
    recurrenceType: null,
    recurrenceEndDate: null,
    sourceRecurringId: null,
    source: 'auto-from-meeting',
    sourceMeetingId: 'meeting-1',
    reviewedAt: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeActionItem(overrides: Partial<ActionItem> = {}): ActionItem {
  return {
    id: 'action-1',
    meetingId: 'meeting-1',
    cardId: null,
    description: 'Do the thing. More context here.',
    status: 'pending',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Build a select chain mock.
 * `responses` is a list of values that successive `.where()` or `.limit()` terminations return.
 * The chain supports: db.select().from(x).where(y).limit(z) and db.select().from(x).where(y).orderBy(z).limit(n)
 */
function makeSelectChain(response: unknown) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(response),
  };
  // also allow awaiting `.where()` directly (some callers omit .limit)
  (chain.where as ReturnType<typeof vi.fn>).mockReturnValue({
    ...chain,
    // when awaited directly
    then: (resolve: (v: unknown) => void) => resolve(response),
  });
  return chain;
}

/**
 * Build a full DB mock with controlled responses for each select call.
 *
 * selectResponses: array of values returned per select() call (in order).
 *   - [0]: settings lookup (for readAutoPushSetting inside autoPushActionItems — not called here because setting is passed in)
 *   - [1]: boards lookup (resolvePrimaryBoardId)
 *
 * For readAutoPushSetting tests, only [0] is used.
 */
function buildDb(opts: {
  selectResponses: unknown[][];
  boardInsertResult?: unknown[];
  txCardResults?: unknown[][];
  txCountValues?: number[];
  txThrow?: boolean;
}) {
  let selectIdx = 0;
  const selectFn = vi.fn(() => {
    const response = opts.selectResponses[selectIdx] ?? [];
    selectIdx++;
    return makeSelectChain(response);
  });

  // board insert (when no boards exist — resolvePrimaryBoardId creates one)
  const boardInsertReturning = vi
    .fn()
    .mockResolvedValue(
      opts.boardInsertResult ?? [
        { id: 'board-new', projectId: 'proj-1', position: 0, name: 'Board', createdAt: new Date() },
      ],
    );
  const boardInsertValues = vi.fn(() => ({ returning: boardInsertReturning }));
  const insertFn = vi.fn(() => ({ values: boardInsertValues }));

  // transaction — delegates to a tx mock
  let txCardIdx = 0;
  let txCountIdx = 0;

  const txUpdateWhere = vi.fn().mockResolvedValue([]);
  const txUpdateSet = vi.fn(() => ({ where: txUpdateWhere }));
  const txUpdateFn = vi.fn(() => ({ set: txUpdateSet }));

  const txInsertReturning = vi.fn().mockImplementation(() => {
    if (opts.txThrow) throw new Error('TX card insert failed');
    const result = (opts.txCardResults ?? [[makeCardRow()]])[txCardIdx] ?? [makeCardRow()];
    txCardIdx++;
    return Promise.resolve(result);
  });
  const txInsertValues = vi.fn(() => ({ returning: txInsertReturning }));
  const txInsertFn = vi.fn(() => ({ values: txInsertValues }));

  // tx select for count
  const txSelectFn = vi.fn(() => {
    const countVal = (opts.txCountValues ?? [0])[txCountIdx] ?? 0;
    txCountIdx++;
    return {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ value: countVal }]),
    };
  });

  const tx = {
    select: txSelectFn,
    insert: txInsertFn,
    update: txUpdateFn,
  };

  const transactionFn = vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(tx));

  return {
    select: selectFn,
    insert: insertFn,
    transaction: transactionFn,
    _tx: tx,
    _txInsertValues: txInsertValues,
    _txInsertReturning: txInsertReturning,
    _txUpdateWhere: txUpdateWhere,
    _txUpdateSet: txUpdateSet,
    _boardInsertValues: boardInsertValues,
  };
}

// ---------------------------------------------------------------------------
// autoPushActionItems tests
// ---------------------------------------------------------------------------

describe('autoPushActionItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ensureInboxColumn).mockResolvedValue({
      id: 'inbox-col-1',
      boardId: 'board-1',
      name: 'Inbox',
      position: 0,
      color: null,
      createdAt: new Date().toISOString(),
    });
  });

  // ---------------------------------------------------------------------------
  // Happy path
  // ---------------------------------------------------------------------------

  it('pushes N items as N cards into the Inbox column', async () => {
    const item1 = makeActionItem({ id: 'a-1', description: 'Fix the bug. It is urgent.' });
    const item2 = makeActionItem({ id: 'a-2', description: 'Write tests. They are missing.' });

    const db = buildDb({
      selectResponses: [
        [{ id: 'board-1', projectId: 'proj-1', position: 0 }], // boards lookup
      ],
      txCardResults: [[makeCardRow({ id: 'card-1' })], [makeCardRow({ id: 'card-2' })]],
      txCountValues: [0, 1],
    });

    const result = await autoPushActionItems({
      db: db as never,
      meetingId: 'meeting-1',
      projectId: 'proj-1',
      actionItems: [item1, item2],
      userSettings: { autoPushEnabled: true },
    });

    expect(result.pushedCount).toBe(2);
    expect(result.skippedCount).toBe(0);
    expect(result.cards).toHaveLength(2);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(ensureInboxColumn).toHaveBeenCalledWith(db, 'board-1');
    // Broadcasts once so a visible board for this project live-updates.
    expect(notifyDataChanged).toHaveBeenCalledWith({ scope: 'cards', projectId: 'proj-1' });
    expect(notifyDataChanged).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Action items marked converted with cardId
  // ---------------------------------------------------------------------------

  it('marks each pushed action item as converted', async () => {
    const item = makeActionItem({ id: 'a-1' });

    const db = buildDb({
      selectResponses: [[{ id: 'board-1', projectId: 'proj-1', position: 0 }]],
      txCardResults: [[makeCardRow({ id: 'new-card' })]],
      txCountValues: [0],
    });

    await autoPushActionItems({
      db: db as never,
      meetingId: 'meeting-1',
      projectId: 'proj-1',
      actionItems: [item],
      userSettings: { autoPushEnabled: true },
    });

    // update was called once (one action item)
    expect(db._txUpdateWhere).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Idempotency: already-converted items
  // ---------------------------------------------------------------------------

  it('skips already-converted items and counts them as skipped', async () => {
    const convertedItem = makeActionItem({ id: 'a-1', status: 'converted' });
    const pendingItem = makeActionItem({ id: 'a-2', status: 'pending' });

    const db = buildDb({
      selectResponses: [[{ id: 'board-1', projectId: 'proj-1', position: 0 }]],
      txCardResults: [[makeCardRow({ id: 'card-2' })]],
      txCountValues: [0],
    });

    const result = await autoPushActionItems({
      db: db as never,
      meetingId: 'meeting-1',
      projectId: 'proj-1',
      actionItems: [convertedItem, pendingItem],
      userSettings: { autoPushEnabled: true },
    });

    expect(result.pushedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(result.cards).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // Idempotency: dismissed items
  // ---------------------------------------------------------------------------

  it('skips dismissed items and counts them as skipped', async () => {
    const dismissedItem = makeActionItem({ id: 'a-1', status: 'dismissed' });

    const db = buildDb({
      selectResponses: [[{ id: 'board-1', projectId: 'proj-1', position: 0 }]],
      txCardResults: [],
      txCountValues: [],
    });

    const result = await autoPushActionItems({
      db: db as never,
      meetingId: 'meeting-1',
      projectId: 'proj-1',
      actionItems: [dismissedItem],
      userSettings: { autoPushEnabled: true },
    });

    expect(result.pushedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.cards).toHaveLength(0);
    expect(db._tx.insert).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Disabled setting
  // ---------------------------------------------------------------------------

  it('returns early when autoPushEnabled is false and leaves items pending', async () => {
    const item = makeActionItem();
    const db = buildDb({ selectResponses: [] });

    const result = await autoPushActionItems({
      db: db as never,
      meetingId: 'meeting-1',
      projectId: 'proj-1',
      actionItems: [item],
      userSettings: { autoPushEnabled: false },
    });

    expect(result.pushedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.cards).toHaveLength(0);
    expect(db.transaction).not.toHaveBeenCalled();
    expect(ensureInboxColumn).not.toHaveBeenCalled();
    // No cards pushed → no broadcast.
    expect(notifyDataChanged).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Zero items
  // ---------------------------------------------------------------------------

  it('returns zero counts without creating Inbox column when actionItems is empty', async () => {
    const db = buildDb({ selectResponses: [] });

    const result = await autoPushActionItems({
      db: db as never,
      meetingId: 'meeting-1',
      projectId: 'proj-1',
      actionItems: [],
      userSettings: { autoPushEnabled: true },
    });

    expect(result.pushedCount).toBe(0);
    expect(result.skippedCount).toBe(0);
    expect(result.cards).toHaveLength(0);
    expect(ensureInboxColumn).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Transaction rollback — ensureInboxColumn throws
  // ---------------------------------------------------------------------------

  it('throws when ensureInboxColumn fails and does not enter the transaction', async () => {
    const item = makeActionItem();
    vi.mocked(ensureInboxColumn).mockRejectedValueOnce(new Error('Inbox column DB error'));

    const db = buildDb({
      selectResponses: [[{ id: 'board-1', projectId: 'proj-1', position: 0 }]],
    });

    await expect(
      autoPushActionItems({
        db: db as never,
        meetingId: 'meeting-1',
        projectId: 'proj-1',
        actionItems: [item],
        userSettings: { autoPushEnabled: true },
      }),
    ).rejects.toThrow('Inbox column DB error');

    expect(db.transaction).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // No board exists — default board creation
  // ---------------------------------------------------------------------------

  it('creates a default board when the project has no boards', async () => {
    const item = makeActionItem();

    const db = buildDb({
      selectResponses: [
        [], // no boards returned
      ],
      boardInsertResult: [{ id: 'board-new', projectId: 'proj-1', position: 0, name: 'Board', createdAt: new Date() }],
      txCardResults: [[makeCardRow({ id: 'card-1' })]],
      txCountValues: [0],
    });

    const result = await autoPushActionItems({
      db: db as never,
      meetingId: 'meeting-1',
      projectId: 'proj-1',
      actionItems: [item],
      userSettings: { autoPushEnabled: true },
    });

    // Board insert was called with correct values
    expect(db._boardInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-1', name: 'Board', position: 0 }),
    );
    // Inbox ensured on the newly created board
    expect(ensureInboxColumn).toHaveBeenCalledWith(db, 'board-new');
    expect(result.pushedCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// readAutoPushSetting tests
// ---------------------------------------------------------------------------

describe('readAutoPushSetting', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns true when the key does not exist in settings', async () => {
    const db = buildDb({ selectResponses: [[]] });
    const result = await readAutoPushSetting(db as never);
    expect(result).toBe(true);
  });

  it('returns true when the stored value is "true"', async () => {
    const db = buildDb({ selectResponses: [[{ key: SETTINGS_KEY_AUTO_PUSH, value: 'true' }]] });
    const result = await readAutoPushSetting(db as never);
    expect(result).toBe(true);
  });

  it('returns false when the stored value is "false"', async () => {
    const db = buildDb({ selectResponses: [[{ key: SETTINGS_KEY_AUTO_PUSH, value: 'false' }]] });
    const result = await readAutoPushSetting(db as never);
    expect(result).toBe(false);
  });

  it('exports the expected settings key constant', () => {
    expect(SETTINGS_KEY_AUTO_PUSH).toBe('meetings:autoPushEnabled');
  });

  // ---------------------------------------------------------------------------
  // Per-project override
  // ---------------------------------------------------------------------------

  it('returns project override true when project.autoPushEnabled is true (ignores global setting)', async () => {
    const db = buildDb({
      selectResponses: [
        [{ autoPushEnabled: true }], // project lookup
        [{ key: SETTINGS_KEY_AUTO_PUSH, value: 'false' }], // global (should NOT be reached)
      ],
    });
    const result = await readAutoPushSetting(db as never, 'proj-1');
    expect(result).toBe(true);
  });

  it('returns project override false when project.autoPushEnabled is false (ignores global setting)', async () => {
    const db = buildDb({
      selectResponses: [
        [{ autoPushEnabled: false }], // project lookup
        [{ key: SETTINGS_KEY_AUTO_PUSH, value: 'true' }], // global (should NOT be reached)
      ],
    });
    const result = await readAutoPushSetting(db as never, 'proj-1');
    expect(result).toBe(false);
  });

  it('falls back to global setting when project.autoPushEnabled is null', async () => {
    const db = buildDb({
      selectResponses: [
        [{ autoPushEnabled: null }], // project override = null → use global
        [{ key: SETTINGS_KEY_AUTO_PUSH, value: 'false' }], // global setting = false
      ],
    });
    const result = await readAutoPushSetting(db as never, 'proj-1');
    expect(result).toBe(false);
  });

  it('falls back to global when project row is not found', async () => {
    const db = buildDb({
      selectResponses: [
        [], // no project row
        [{ key: SETTINGS_KEY_AUTO_PUSH, value: 'true' }],
      ],
    });
    const result = await readAutoPushSetting(db as never, 'proj-missing');
    expect(result).toBe(true);
  });
});
