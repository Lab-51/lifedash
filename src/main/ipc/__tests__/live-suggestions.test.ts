// === FILE PURPOSE ===
// IPC behavior tests for the live suggestion lifecycle (live-suggestions:*,
// LIVE.2 Task 2). Verifies each handler validates its id param and delegates to
// liveSuggestionService, and that invalid input is rejected before reaching it.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const VALID_ID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_MEETING_ID = '660e8400-e29b-41d4-a716-446655440000';

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

vi.mock('../../services/liveSuggestionService', () => ({
  acceptSuggestion: vi.fn(),
  dismissSuggestion: vi.fn(),
  listSuggestions: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { registerLiveSuggestionHandlers } from '../live-suggestions';
import * as liveSuggestionService from '../../services/liveSuggestionService';

function makeEvent() {
  return {};
}

beforeAll(() => {
  registerLiveSuggestionHandlers();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('live-suggestions:accept', () => {
  it('validates the id and delegates to acceptSuggestion', async () => {
    const suggestion = { id: VALID_ID, status: 'accepted' };
    vi.mocked(liveSuggestionService.acceptSuggestion).mockResolvedValue(suggestion as never);

    const handler = registeredHandlers.get('live-suggestions:accept')!;
    const result = await handler(makeEvent(), VALID_ID);

    expect(liveSuggestionService.acceptSuggestion).toHaveBeenCalledWith(VALID_ID);
    expect(result).toBe(suggestion);
  });

  it('rejects a non-UUID id before reaching the service', async () => {
    const handler = registeredHandlers.get('live-suggestions:accept')!;
    await expect(handler(makeEvent(), 'not-a-uuid')).rejects.toThrow('Validation failed');
    expect(liveSuggestionService.acceptSuggestion).not.toHaveBeenCalled();
  });
});

describe('live-suggestions:dismiss', () => {
  it('validates the id and delegates to dismissSuggestion', async () => {
    const suggestion = { id: VALID_ID, status: 'dismissed' };
    vi.mocked(liveSuggestionService.dismissSuggestion).mockResolvedValue(suggestion as never);

    const handler = registeredHandlers.get('live-suggestions:dismiss')!;
    const result = await handler(makeEvent(), VALID_ID);

    expect(liveSuggestionService.dismissSuggestion).toHaveBeenCalledWith(VALID_ID);
    expect(result).toBe(suggestion);
  });

  it('rejects a non-UUID id before reaching the service', async () => {
    const handler = registeredHandlers.get('live-suggestions:dismiss')!;
    await expect(handler(makeEvent(), 'nope')).rejects.toThrow('Validation failed');
    expect(liveSuggestionService.dismissSuggestion).not.toHaveBeenCalled();
  });
});

describe('live-suggestions:list', () => {
  it('validates the meetingId and delegates to listSuggestions', async () => {
    const suggestions = [{ id: VALID_ID }];
    vi.mocked(liveSuggestionService.listSuggestions).mockResolvedValue(suggestions as never);

    const handler = registeredHandlers.get('live-suggestions:list')!;
    const result = await handler(makeEvent(), VALID_MEETING_ID);

    expect(liveSuggestionService.listSuggestions).toHaveBeenCalledWith(VALID_MEETING_ID);
    expect(result).toBe(suggestions);
  });

  it('rejects a non-UUID meetingId before reaching the service', async () => {
    const handler = registeredHandlers.get('live-suggestions:list')!;
    await expect(handler(makeEvent(), 'nope')).rejects.toThrow('Validation failed');
    expect(liveSuggestionService.listSuggestions).not.toHaveBeenCalled();
  });
});
