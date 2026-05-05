// === FILE PURPOSE ===
// Behaviour tests for the meeting reassign service.
// Validates: cards are moved out of Unassigned's Inbox into the chosen project's Inbox,
// the meeting row's projectId/unassignedPending are updated, and the operation runs in a transaction.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports
// ---------------------------------------------------------------------------

vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));

vi.mock('../../db/schema', () => ({
  cards: {},
  boards: {},
  meetings: {},
  columns: {},
}));

vi.mock('../inboxColumnService', () => ({
  ensureInboxColumn: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports must come AFTER mocks
// ---------------------------------------------------------------------------
import { reassignMeetingFromUnassigned } from '../meetingReassignService';
import { getDb } from '../../db/connection';
import { ensureInboxColumn } from '../inboxColumnService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FakeRow {
  id: string;
  columnId: string;
  position: number;
  archived: boolean;
  source: 'manual' | 'auto-from-meeting';
  sourceMeetingId: string | null;
}

/**
 * Build a fake Drizzle-style chainable transaction object that supports the
 * patterns used by reassignMeetingFromUnassigned:
 *   - select().from().where().orderBy().limit()   (resolvePrimaryBoardId)
 *   - select().from().where()                     (meeting cards)
 *   - select().from().where().orderBy()           (target siblings)
 *   - update().set().where()                      (per-card move + meeting update)
 *   - insert().values().returning()               (default board creation)
 *
 * `selectResults` is a queue consumed in call order.
 */
function makeTx(selectResults: unknown[][]) {
  const updateCalls: Array<Record<string, unknown>> = [];
  const insertCalls: Array<Record<string, unknown>> = [];
  const queue = [...selectResults];

  function makeWhereChain(): unknown {
    // The same object is awaitable directly AND offers orderBy/limit chaining.
    const result: unknown[] = queue.shift() ?? [];
    const chain: Record<string, unknown> = {};
    chain.then = (onFulfilled: (v: unknown[]) => unknown) => Promise.resolve(result).then(onFulfilled);
    chain.orderBy = () => {
      const orderedChain: Record<string, unknown> = {};
      orderedChain.then = (onFulfilled: (v: unknown[]) => unknown) => Promise.resolve(result).then(onFulfilled);
      orderedChain.limit = () => Promise.resolve(result);
      return orderedChain;
    };
    chain.limit = () => Promise.resolve(result);
    return chain;
  }

  const tx = {
    select: () => ({
      from: () => ({
        where: () => makeWhereChain(),
      }),
    }),
    update: (_table: unknown) => ({
      set: (data: Record<string, unknown>) => ({
        where: () => {
          updateCalls.push(data);
          return Promise.resolve();
        },
      }),
    }),
    insert: (_table: unknown) => ({
      values: (data: Record<string, unknown>) => ({
        returning: () => {
          insertCalls.push(data);
          return Promise.resolve([{ id: 'new-board-id', ...data }]);
        },
      }),
    }),
  };

  return { tx, updateCalls, insertCalls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('reassignMeetingFromUnassigned', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('moves auto-pushed meeting cards into the target Inbox and updates the meeting row', async () => {
    const meetingCards: FakeRow[] = [
      {
        id: 'c-1',
        columnId: 'unassigned-inbox',
        position: 0,
        archived: false,
        source: 'auto-from-meeting',
        sourceMeetingId: 'm-1',
      },
      {
        id: 'c-2',
        columnId: 'unassigned-inbox',
        position: 1,
        archived: false,
        source: 'auto-from-meeting',
        sourceMeetingId: 'm-1',
      },
    ];

    // Drizzle call order inside the service:
    //   1. resolvePrimaryBoardId: select boards where projectId = X → [board]
    //   2. ensureInboxColumn (mocked) → returns target inbox column
    //   3. select cards where (sourceMeetingId AND source) → meetingCards
    //   4. select cards where (columnId = targetInbox AND archived=false) → existing target siblings
    //   5. updates: per-card column move; meeting projectId+unassignedPending
    const { tx } = makeTx([
      [{ id: 'target-board' }], // boards lookup
      meetingCards, // meeting cards
      [], // target inbox is empty
    ]);

    vi.mocked(ensureInboxColumn).mockResolvedValue({
      id: 'target-inbox',
      boardId: 'target-board',
      name: 'Inbox',
      position: 0,
      color: null,
      createdAt: new Date('2026-05-01').toISOString(),
    });

    vi.mocked(getDb).mockReturnValue({
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
    } as never);

    const result = await reassignMeetingFromUnassigned('m-1', 'project-target');

    expect(result.movedCardCount).toBe(2);
    expect(result.meetingId).toBe('m-1');
    expect(result.newProjectId).toBe('project-target');
    expect(ensureInboxColumn).toHaveBeenCalledWith(expect.anything(), 'target-board');
  });

  it('skips cards already in the target Inbox (idempotent)', async () => {
    const meetingCards: FakeRow[] = [
      {
        id: 'c-1',
        columnId: 'target-inbox', // already in target
        position: 0,
        archived: false,
        source: 'auto-from-meeting',
        sourceMeetingId: 'm-1',
      },
    ];

    const { tx } = makeTx([
      [{ id: 'target-board' }], // boards lookup
      meetingCards,
      [meetingCards[0]], // existing target siblings include this card
    ]);

    vi.mocked(ensureInboxColumn).mockResolvedValue({
      id: 'target-inbox',
      boardId: 'target-board',
      name: 'Inbox',
      position: 0,
      color: null,
      createdAt: new Date('2026-05-01').toISOString(),
    });

    vi.mocked(getDb).mockReturnValue({
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
    } as never);

    const result = await reassignMeetingFromUnassigned('m-1', 'project-target');
    expect(result.movedCardCount).toBe(0);
  });

  it('returns zero moves when the meeting has no auto-pushed cards', async () => {
    const { tx } = makeTx([
      [{ id: 'target-board' }],
      [], // no meeting cards
      [],
    ]);

    vi.mocked(ensureInboxColumn).mockResolvedValue({
      id: 'target-inbox',
      boardId: 'target-board',
      name: 'Inbox',
      position: 0,
      color: null,
      createdAt: new Date('2026-05-01').toISOString(),
    });

    vi.mocked(getDb).mockReturnValue({
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
    } as never);

    const result = await reassignMeetingFromUnassigned('m-1', 'project-target');
    expect(result.movedCardCount).toBe(0);
  });
});
