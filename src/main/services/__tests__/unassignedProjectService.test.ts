// === FILE PURPOSE ===
// Unit tests for ensureUnassignedProject — covers idempotency (existing system
// project is returned rather than duplicated).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before imports
// ---------------------------------------------------------------------------

// Mock ensureInboxColumn so we don't need a full column setup
vi.mock('../inboxColumnService', () => ({
  ensureInboxColumn: vi.fn().mockResolvedValue({
    id: 'inbox-col',
    name: 'Inbox',
    position: 0,
    boardId: 'board-1',
    color: null,
    createdAt: '2025-01-01T00:00:00.000Z',
  }),
}));

vi.mock('../../db/schema', () => ({
  projects: { system: 'system', $inferSelect: {} },
  boards: { projectId: 'projectId', $inferSelect: {} },
}));

// Shared insert stub — reset per test
let insertReturning: ReturnType<typeof vi.fn>;

function makeSelectChain(resolveValue: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(resolveValue),
  };
}

let mockDb: {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
};

vi.mock('../../db/connection', () => ({
  getDb: vi.fn(() => mockDb),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { ensureUnassignedProject } from '../unassignedProjectService';
import { ensureInboxColumn } from '../inboxColumnService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProjectRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'proj-unassigned',
    name: 'Unassigned',
    description: null,
    color: '#6b7280',
    archived: false,
    pinned: false,
    system: true,
    hourlyRate: null,
    sortOrder: 0,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeBoardRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'board-1',
    projectId: 'proj-unassigned',
    name: 'Board',
    position: 0,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ensureUnassignedProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Idempotency — system project already exists
  it('returns the existing system project without creating a duplicate', async () => {
    const existingProject = makeProjectRow();
    const existingBoard = makeBoardRow();

    // First select call: finds existing system project
    // Second select call: finds existing board
    let selectCallCount = 0;
    mockDb = {
      select: vi.fn(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return makeSelectChain([existingProject]);
        }
        return makeSelectChain([existingBoard]);
      }),
      insert: vi.fn(),
    };

    const result = await ensureUnassignedProject(mockDb as never);

    expect(result.id).toBe('proj-unassigned');
    expect(result.name).toBe('Unassigned');
    expect(result.system).toBe(true);
    // insert should NOT have been called (project already exists)
    expect(mockDb.insert).not.toHaveBeenCalled();
    // ensureInboxColumn should have been called once
    expect(ensureInboxColumn).toHaveBeenCalledTimes(1);
  });

  // Creation — system project does not exist yet
  it('creates the system project when none exists', async () => {
    const createdProject = makeProjectRow();
    insertReturning = vi.fn().mockResolvedValue([createdProject]);
    const insertValues = vi.fn(() => ({ returning: insertReturning }));

    let selectCallCount = 0;
    mockDb = {
      select: vi.fn(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          // No existing system project
          return makeSelectChain([]);
        }
        // No existing boards either
        return makeSelectChain([]);
      }),
      insert: vi.fn(() => ({ values: insertValues })),
    };

    const result = await ensureUnassignedProject(mockDb as never);

    expect(result.id).toBe('proj-unassigned');
    expect(result.system).toBe(true);
    // insert was called (at least once — for project, and once for board)
    expect(mockDb.insert).toHaveBeenCalled();
  });
});
