// === FILE PURPOSE ===
// IPC behavior tests for entity:merge-candidates and entity:merge (ENTITY-NAME.1
// Task 3), registered in ipc/brain.ts alongside the other entity:* channels.
// Mirrors brain.entity-facts.test.ts's mocking shape: entityFactService is
// mocked wholesale, so these tests prove the HANDLER's own contract — zod
// validation, thin delegation, and (for entity:merge specifically) that a typed
// `error` result from the service is passed straight through and NEVER
// rethrown across IPC. mergeEntityInto's own guards (self-merge/missing-row/
// cross-kind) are Task 2's contract and are covered by
// entityNameFoldSweep.test.ts, not re-tested here.

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
  listMergeCandidates: vi.fn(),
  mergeEntity: vi.fn(),
}));
// entityService is imported by brain.ts purely for its post-session hook
// side-effect — stub it out so this IPC test doesn't pull in the whole
// twinMemoryService/ai-provider chain (mirrors brain.entity-facts.test.ts).
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
// entity:merge-candidates
// ---------------------------------------------------------------------------

describe('entity:merge-candidates', () => {
  const ENTITY_ID = '11111111-1111-1111-1111-111111111111';

  it('validates the entity id and delegates to entityFactService.listMergeCandidates', async () => {
    const candidates = [
      { id: 'c1', name: 'Blythe', factCount: 3 },
      { id: 'c2', name: 'Corvin', factCount: 0 },
    ];
    vi.mocked(entityFactService.listMergeCandidates).mockResolvedValue(candidates);

    const result = await handler('entity:merge-candidates')(makeEvent(), ENTITY_ID);

    expect(entityFactService.listMergeCandidates).toHaveBeenCalledWith(ENTITY_ID);
    expect(result).toEqual(candidates);
  });

  it('rejects a non-uuid entity id before reaching the service', async () => {
    await expect(handler('entity:merge-candidates')(makeEvent(), 'not-a-uuid')).rejects.toThrow('Validation failed');
    expect(entityFactService.listMergeCandidates).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// entity:merge
// ---------------------------------------------------------------------------

describe('entity:merge', () => {
  const SOURCE_ID = '22222222-2222-2222-2222-222222222222';
  const TARGET_ID = '33333333-3333-3333-3333-333333333333';

  it('validates the payload and delegates to entityFactService.mergeEntity, returning the survivor + counts', async () => {
    vi.mocked(entityFactService.mergeEntity).mockResolvedValue({
      status: 'ok',
      survivorId: TARGET_ID,
      factsRepointed: 4,
      linksMerged: 2,
    });

    const result = await handler('entity:merge')(makeEvent(), { sourceId: SOURCE_ID, targetId: TARGET_ID });

    expect(entityFactService.mergeEntity).toHaveBeenCalledWith(SOURCE_ID, TARGET_ID);
    expect(result).toEqual({ status: 'ok', survivorId: TARGET_ID, factsRepointed: 4, linksMerged: 2 });
  });

  it('passes a cross-kind guard failure through as a typed error, never a rejection', async () => {
    vi.mocked(entityFactService.mergeEntity).mockResolvedValue({
      status: 'error',
      message: 'mergeEntityInto: refusing to merge across kinds (person into topic)',
    });

    const result = await handler('entity:merge')(makeEvent(), { sourceId: SOURCE_ID, targetId: TARGET_ID });

    expect(result).toEqual({
      status: 'error',
      message: 'mergeEntityInto: refusing to merge across kinds (person into topic)',
    });
  });

  it('passes a self-merge guard failure through as a typed error, never a rejection', async () => {
    vi.mocked(entityFactService.mergeEntity).mockResolvedValue({
      status: 'error',
      message: 'mergeEntityInto: refusing to merge an entity into itself',
    });

    // A same-id payload is structurally valid (two well-formed uuids) — the zod
    // schema deliberately does not duplicate mergeEntityInto's self-merge guard.
    const result = await handler('entity:merge')(makeEvent(), { sourceId: SOURCE_ID, targetId: SOURCE_ID });

    expect(entityFactService.mergeEntity).toHaveBeenCalledWith(SOURCE_ID, SOURCE_ID);
    expect(result).toEqual({
      status: 'error',
      message: 'mergeEntityInto: refusing to merge an entity into itself',
    });
  });

  it('passes an unknown-id guard failure through as a typed error, never a rejection', async () => {
    vi.mocked(entityFactService.mergeEntity).mockResolvedValue({
      status: 'error',
      message: `mergeEntityInto: source entity ${SOURCE_ID} does not exist`,
    });

    const result = await handler('entity:merge')(makeEvent(), { sourceId: SOURCE_ID, targetId: TARGET_ID });

    expect(result).toEqual({
      status: 'error',
      message: `mergeEntityInto: source entity ${SOURCE_ID} does not exist`,
    });
  });

  it('rejects a malformed payload before reaching the service', async () => {
    await expect(handler('entity:merge')(makeEvent(), { sourceId: 'nope', targetId: TARGET_ID })).rejects.toThrow(
      'Validation failed',
    );
    expect(entityFactService.mergeEntity).not.toHaveBeenCalled();
  });
});
