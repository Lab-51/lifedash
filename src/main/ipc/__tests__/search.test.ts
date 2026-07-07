// === FILE PURPOSE ===
// IPC behavior tests for search:query (V3.1 Task 6). Verifies the handler
// validates the query string and delegates to searchService, and that invalid
// input is rejected before reaching it.

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

vi.mock('../../services/searchService', () => ({
  search: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { registerSearchHandlers } from '../search';
import * as searchService from '../../services/searchService';

function makeEvent() {
  return {};
}

beforeAll(() => {
  registerSearchHandlers();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('search:query', () => {
  it('validates the query and delegates to searchService.search', async () => {
    const results = { sessions: [], cards: [], projects: [] };
    vi.mocked(searchService.search).mockResolvedValue(results as never);

    const handler = registeredHandlers.get('search:query')!;
    const result = await handler(makeEvent(), 'roadmap');

    expect(searchService.search).toHaveBeenCalledWith('roadmap');
    expect(result).toBe(results);
  });

  it('rejects a non-string query before reaching the service', async () => {
    const handler = registeredHandlers.get('search:query')!;
    await expect(handler(makeEvent(), 42)).rejects.toThrow('Validation failed');
    expect(searchService.search).not.toHaveBeenCalled();
  });

  it('rejects an empty query before reaching the service', async () => {
    const handler = registeredHandlers.get('search:query')!;
    await expect(handler(makeEvent(), '')).rejects.toThrow('Validation failed');
    expect(searchService.search).not.toHaveBeenCalled();
  });
});
