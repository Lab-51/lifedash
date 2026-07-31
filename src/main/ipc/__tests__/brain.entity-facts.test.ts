// === FILE PURPOSE ===
// IPC behavior tests for the entity:* channels (BRAIN-UX.1 Task 1) registered in
// ipc/brain.ts alongside brain:build-tree. Verifies entity:list-facts and
// entity:forget-fact zod-validate their id parameter and delegate to the
// (mocked) entityFactService, and that entity:analyze-history delegates to the
// service's honest not-implemented stub without ever fabricating success.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports
// ---------------------------------------------------------------------------

const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
      registeredHandlers.set(channel, fn);
    }),
  },
}));

vi.mock('../../services/brainTreeService', () => ({ buildBrainTree: vi.fn() }));
vi.mock('../../services/entityFactService', () => ({
  listFacts: vi.fn(),
  forgetFact: vi.fn(),
  analyzeHistory: vi.fn(),
}));
// entityService is imported by brain.ts purely for its post-session hook
// side-effect (registers onto the real postSessionDispatcher) — stub it out so
// this IPC test doesn't pull in the whole twinMemoryService/ai-provider chain.
vi.mock('../../services/entityService', () => ({}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { registerBrainHandlers } from '../brain';
import * as entityFactService from '../../services/entityFactService';

function makeEvent() {
  return {};
}
const handler = (channel: string) => registeredHandlers.get(channel)!;

beforeAll(() => {
  registerBrainHandlers();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// entity:list-facts
// ---------------------------------------------------------------------------

describe('entity:list-facts', () => {
  const ENTITY_ID = '11111111-1111-1111-1111-111111111111';

  it('validates the entity id and delegates to entityFactService.listFacts', async () => {
    const facts = [
      {
        id: 'f1',
        entityId: ENTITY_ID,
        content: 'Ada leads the rewrite.',
        sourceMeetingId: 'm1',
        sourceMeetingTitle: 'Weekly sync',
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    ];
    vi.mocked(entityFactService.listFacts).mockResolvedValue(facts);

    const result = await handler('entity:list-facts')(makeEvent(), ENTITY_ID);

    expect(entityFactService.listFacts).toHaveBeenCalledWith(ENTITY_ID);
    expect(result).toEqual(facts);
  });

  it('rejects a non-uuid entity id before reaching the service', async () => {
    await expect(handler('entity:list-facts')(makeEvent(), 'not-a-uuid')).rejects.toThrow('Validation failed');
    expect(entityFactService.listFacts).not.toHaveBeenCalled();
  });

  it("returns facts newest-first, exactly as the service returns them (list ordering is the service's contract)", async () => {
    const facts = [
      { id: 'newer', entityId: ENTITY_ID, content: 'B', sourceMeetingId: 'm2', createdAt: '2026-08-02T00:00:00.000Z' },
      { id: 'older', entityId: ENTITY_ID, content: 'A', sourceMeetingId: 'm1', createdAt: '2026-08-01T00:00:00.000Z' },
    ];
    vi.mocked(entityFactService.listFacts).mockResolvedValue(facts);

    const result = (await handler('entity:list-facts')(makeEvent(), ENTITY_ID)) as { id: string }[];
    expect(result.map((f) => f.id)).toEqual(['newer', 'older']);
  });
});

// ---------------------------------------------------------------------------
// entity:forget-fact
// ---------------------------------------------------------------------------

describe('entity:forget-fact', () => {
  const FACT_ID = '22222222-2222-2222-2222-222222222222';

  it('validates the fact id and delegates to entityFactService.forgetFact', async () => {
    vi.mocked(entityFactService.forgetFact).mockResolvedValue(undefined);

    const result = await handler('entity:forget-fact')(makeEvent(), FACT_ID);

    expect(entityFactService.forgetFact).toHaveBeenCalledWith(FACT_ID);
    expect(result).toBeUndefined();
  });

  it('rejects a non-uuid fact id before reaching the service (never deletes on bad input)', async () => {
    await expect(handler('entity:forget-fact')(makeEvent(), 'nope')).rejects.toThrow('Validation failed');
    expect(entityFactService.forgetFact).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// entity:analyze-history — honest stub delegation
// ---------------------------------------------------------------------------

describe('entity:analyze-history', () => {
  const ENTITY_ID = '33333333-3333-3333-3333-333333333333';

  it('delegates to entityFactService.analyzeHistory and passes through its not-implemented result', async () => {
    vi.mocked(entityFactService.analyzeHistory).mockResolvedValue({
      status: 'not-implemented',
      error: 'Analyze past sessions is not implemented yet.',
      minedMeetings: 0,
      newFacts: 0,
      skippedMeetings: 0,
    });

    const result = await handler('entity:analyze-history')(makeEvent(), ENTITY_ID);

    expect(entityFactService.analyzeHistory).toHaveBeenCalledWith(ENTITY_ID);
    expect(result).toEqual({
      status: 'not-implemented',
      error: 'Analyze past sessions is not implemented yet.',
      minedMeetings: 0,
      newFacts: 0,
      skippedMeetings: 0,
    });
  });

  it('rejects a non-uuid entity id before reaching the service', async () => {
    await expect(handler('entity:analyze-history')(makeEvent(), 'nope')).rejects.toThrow('Validation failed');
    expect(entityFactService.analyzeHistory).not.toHaveBeenCalled();
  });
});
