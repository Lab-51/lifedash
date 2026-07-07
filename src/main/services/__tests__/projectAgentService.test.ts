// === FILE PURPOSE ===
// Unit tests for projectAgentService.createMoveCardTool — the shared board tool
// reused by BOTH the project agent and the Live Assistant. Verifies the direct
// DB write path broadcasts data:changed exactly once (so the embedded board
// live-updates when the assistant moves a card mid-meeting) and does NOT emit
// when the move short-circuits (missing card / missing target column).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports. dataChangeNotifier is mocked so the
// notifier import is test-safe (no electron) AND the emit is assertable.
// ---------------------------------------------------------------------------

vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));

vi.mock('../../db/schema', () => ({
  projects: { id: 'id', name: 'name' },
  boards: { id: 'id', projectId: 'project_id', name: 'name', position: 'position' },
  columns: { id: 'id', boardId: 'board_id', name: 'name', position: 'position' },
  cards: { id: 'id', columnId: 'column_id', title: 'title', priority: 'priority', archived: 'archived' },
  cardActivities: { id: 'id', cardId: 'card_id', action: 'action', details: 'details' },
  meetings: { id: 'id', title: 'title', projectId: 'project_id' },
  meetingBriefs: { id: 'id', meetingId: 'meeting_id', summary: 'summary', createdAt: 'created_at' },
  actionItems: { id: 'id', meetingId: 'meeting_id', status: 'status' },
  projectAgentMessages: { id: 'id', projectId: 'project_id', threadId: 'thread_id' },
  projectAgentThreads: { id: 'id', projectId: 'project_id', createdAt: 'created_at' },
}));

vi.mock('../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('../dataChangeNotifier', () => ({ notifyDataChanged: vi.fn() }));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { createMoveCardTool } from '../projectAgentService';
import { getDb } from '../../db/connection';
import { notifyDataChanged } from '../dataChangeNotifier';

type AnyTool = { execute: (input: Record<string, unknown>) => Promise<unknown> };

/** Sequential select().from().where() responses matching createMoveCardTool's query order. */
function buildMoveCardDb(selectResults: unknown[][]) {
  let call = 0;
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(selectResults[call++] ?? [])),
      })),
    })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) })),
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
  };
}

beforeEach(() => vi.clearAllMocks());

describe('createMoveCardTool — data:changed broadcast', () => {
  it('emits scope=cards with the resolved projectId exactly once on a successful move', async () => {
    const db = buildMoveCardDb([
      [{ id: 'card-1', title: 'Fix bug', columnId: 'col-source' }], // card lookup
      [{ name: 'To Do' }], // source column
      [{ name: 'Done' }], // target column
      [{ boardId: 'board-1' }], // projectIdForColumn: column -> boardId
      [{ projectId: 'proj-1' }], // projectIdForColumn: board -> projectId
    ]);
    vi.mocked(getDb).mockReturnValue(db as never);

    const tool = createMoveCardTool() as unknown as AnyTool;
    const result = await tool.execute({ cardId: 'card-1', targetColumnId: 'col-target' });

    expect(result).toEqual({ success: true, cardTitle: 'Fix bug', fromColumn: 'To Do', toColumn: 'Done' });
    expect(notifyDataChanged).toHaveBeenCalledTimes(1);
    expect(notifyDataChanged).toHaveBeenCalledWith({ scope: 'cards', projectId: 'proj-1' });
  });

  it('does NOT emit when the card does not exist', async () => {
    const db = buildMoveCardDb([[]]); // card lookup returns nothing
    vi.mocked(getDb).mockReturnValue(db as never);

    const tool = createMoveCardTool() as unknown as AnyTool;
    const result = await tool.execute({ cardId: 'missing', targetColumnId: 'col-target' });

    expect(result).toEqual({ success: false, error: 'Card not found' });
    expect(notifyDataChanged).not.toHaveBeenCalled();
  });

  it('does NOT emit when the target column does not exist', async () => {
    const db = buildMoveCardDb([
      [{ id: 'card-1', title: 'Fix bug', columnId: 'col-source' }],
      [{ name: 'To Do' }],
      [], // target column missing
    ]);
    vi.mocked(getDb).mockReturnValue(db as never);

    const tool = createMoveCardTool() as unknown as AnyTool;
    const result = await tool.execute({ cardId: 'card-1', targetColumnId: 'missing' });

    expect(result).toEqual({ success: false, error: 'Target column not found' });
    expect(notifyDataChanged).not.toHaveBeenCalled();
  });
});
