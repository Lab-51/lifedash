// === FILE PURPOSE ===
// Unit tests for ensureInboxColumn — covers the three main cases:
// existing Inbox, no Inbox (creates + shifts), Inbox at non-zero position.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before imports
// ---------------------------------------------------------------------------

const mockReturning = vi.fn();
const mockValues = vi.fn(() => ({ returning: mockReturning }));
const mockInsert = vi.fn(() => ({ values: mockValues }));

const mockWhere = vi.fn();
const mockOrderBy = vi.fn(() => ({ returning: mockReturning }));
const mockSet = vi.fn(() => ({ where: mockWhere }));
const mockUpdate = vi.fn(() => ({ set: mockSet }));
const mockSelect = vi.fn();

/** Builds a chainable select mock that resolves to `rows`. */
function makeSelect(rows: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue(rows),
  };
  return vi.fn(() => chain);
}

/** tx mock returned inside db.transaction callback */
function makeTxMock(insertResult: unknown[]) {
  const txWhere = vi.fn().mockResolvedValue(undefined);
  const txSet = vi.fn(() => ({ where: txWhere }));
  const txUpdate = vi.fn(() => ({ set: txSet }));

  const txReturning = vi.fn().mockResolvedValue(insertResult);
  const txValues = vi.fn(() => ({ returning: txReturning }));
  const txInsert = vi.fn(() => ({ values: txValues }));

  return { update: txUpdate, insert: txInsert, _txWhere: txWhere };
}

let mockDb: ReturnType<typeof buildMockDb>;

function buildMockDb(selectRows: unknown[], txInsertResult: unknown[]) {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue(selectRows),
  };
  const selectFn = vi.fn(() => selectChain);

  const tx = makeTxMock(txInsertResult);
  const transaction = vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(tx));

  return { select: selectFn, update: mockUpdate, insert: mockInsert, transaction, _tx: tx, _chain: selectChain };
}

vi.mock('../../db/connection', () => ({
  getDb: vi.fn(() => mockDb),
}));

vi.mock('../../db/schema', () => ({
  columns: {
    $inferSelect: {},
    boardId: 'boardId',
    name: 'name',
    position: 'position',
    id: 'id',
    color: 'color',
    createdAt: 'createdAt',
  },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { ensureInboxColumn } from '../inboxColumnService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeColumnRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'col-1',
    boardId: 'board-1',
    name: 'Todo',
    position: 0,
    color: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ensureInboxColumn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Case (a): Inbox already exists at position 0
  it('returns existing Inbox without inserting when Inbox already exists', async () => {
    const inboxRow = makeColumnRow({ id: 'inbox-col', name: 'Inbox', position: 0 });
    mockDb = buildMockDb([inboxRow], []);

    const result = await ensureInboxColumn(mockDb as never, 'board-1');

    expect(result.id).toBe('inbox-col');
    expect(result.name).toBe('Inbox');
    // transaction should NOT have been called
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  // Case (b): No Inbox column exists — should insert at position 0 and shift
  it('creates Inbox at position 0 and shifts existing columns when Inbox absent', async () => {
    const existingCol = makeColumnRow({ id: 'col-todo', name: 'Todo', position: 0 });
    const newInboxRow = makeColumnRow({ id: 'new-inbox', name: 'Inbox', position: 0 });
    mockDb = buildMockDb([existingCol], [newInboxRow]);

    const result = await ensureInboxColumn(mockDb as never, 'board-1');

    expect(result.id).toBe('new-inbox');
    expect(result.name).toBe('Inbox');
    expect(result.position).toBe(0);
    // transaction must have been called
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
  });

  // Case (c): Inbox exists at position 3 — should return it without re-shifting
  it('returns Inbox at position 3 without modifying other columns', async () => {
    const todoCol = makeColumnRow({ id: 'col-todo', name: 'Todo', position: 0 });
    const inprogressCol = makeColumnRow({ id: 'col-ip', name: 'In Progress', position: 1 });
    const doneCol = makeColumnRow({ id: 'col-done', name: 'Done', position: 2 });
    const inboxCol = makeColumnRow({ id: 'col-inbox', name: 'Inbox', position: 3 });
    mockDb = buildMockDb([todoCol, inprogressCol, doneCol, inboxCol], []);

    const result = await ensureInboxColumn(mockDb as never, 'board-1');

    expect(result.id).toBe('col-inbox');
    expect(result.position).toBe(3);
    // transaction should NOT have been called
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });
});
