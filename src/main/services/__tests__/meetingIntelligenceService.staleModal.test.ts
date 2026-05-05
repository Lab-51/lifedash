// === FILE PURPOSE ===
// Unit tests for the stale-modal fix in generateActionItems —
// verifies that the returned items array reflects the 'converted' status
// set by auto-push rather than the original 'pending' state.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports
// ---------------------------------------------------------------------------

vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));

vi.mock('../../db/schema', () => ({
  meetingBriefs: {},
  actionItems: {
    id: 'id',
    meetingId: 'meetingId',
    status: 'status',
    cardId: 'cardId',
    description: 'description',
    createdAt: 'createdAt',
  },
  cards: {},
}));

vi.mock('../meetingService', () => ({
  getMeeting: vi.fn(),
}));

vi.mock('../ai-provider', () => ({
  generate: vi.fn(),
  resolveTaskModel: vi.fn(),
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

vi.mock('../../../shared/utils/action-item-parser', () => ({
  parseActionItems: vi.fn().mockReturnValue(['Follow up on the proposal']),
}));

vi.mock('../../../shared/types', () => ({
  MEETING_TEMPLATES: {},
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { generateActionItems } from '../meetingIntelligenceService';
import { getMeeting } from '../meetingService';
import { generate, resolveTaskModel } from '../ai-provider';
import { autoPushActionItems } from '../autoPushService';
import { getDb } from '../../db/connection';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMeetingWithTranscript(projectId: string | null = 'proj-1') {
  return {
    id: 'meeting-1',
    projectId,
    title: 'Test Meeting',
    template: 'none',
    transcriptionLanguage: null,
    segments: [
      {
        id: 'seg-1',
        meetingId: 'meeting-1',
        startTime: 0,
        endTime: 5000,
        content: 'Discuss the proposal',
        speaker: null,
        createdAt: new Date().toISOString(),
      },
    ],
    brief: null,
    actionItems: [],
    status: 'completed',
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    audioPath: null,
    prepBriefing: null,
    createdAt: new Date().toISOString(),
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
 * Build a minimal DB mock for generateActionItems.
 *
 * selectResponses: successive select() calls
 *   - [0]: re-query after auto-push (returns refreshed items)
 *
 * insertReturning: what the insert().values().returning() resolves to (the new action item row)
 */
function buildDb(opts: { selectResponse?: unknown[]; insertReturning?: unknown[] }) {
  const insertReturning = vi.fn().mockResolvedValue(opts.insertReturning ?? [makeActionItemRow()]);
  const insertValues = vi.fn(() => ({ returning: insertReturning }));
  const insertFn = vi.fn(() => ({ values: insertValues }));

  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      then: (resolve: (v: unknown) => void) => resolve(opts.selectResponse ?? []),
    }),
  };
  const selectFn = vi.fn(() => selectChain);

  const db = { select: selectFn, insert: insertFn };
  vi.mocked(getDb).mockReturnValue(db as never);
  return db;
}

// ---------------------------------------------------------------------------
// Stale-modal fix tests
// ---------------------------------------------------------------------------

describe('generateActionItems — stale-modal fix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveTaskModel).mockResolvedValue({
      providerId: 'p1',
      providerName: 'openai',
      apiKeyEncrypted: 'enc',
      baseUrl: null,
      model: 'gpt-4',
      taskType: 'summarization',
      temperature: null,
      maxTokens: null,
    } as never);
    vi.mocked(generate).mockResolvedValue({ text: '- Follow up on the proposal' } as never);
    vi.mocked(autoPushActionItems).mockResolvedValue({ pushedCount: 1, skippedCount: 0, cards: [] });
  });

  it('returns items with converted status when auto-push succeeds', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeetingWithTranscript('proj-1') as never);

    const convertedRow = makeActionItemRow({ status: 'converted', cardId: 'card-1' });

    buildDb({
      insertReturning: [makeActionItemRow()],
      selectResponse: [convertedRow],
    });

    const result = await generateActionItems('meeting-1');

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('converted');
    expect(autoPushActionItems).toHaveBeenCalledOnce();
  });

  it('returns original pending items when meeting has no projectId (auto-push not triggered)', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeetingWithTranscript(null) as never);

    buildDb({
      insertReturning: [makeActionItemRow({ status: 'pending' })],
    });

    const result = await generateActionItems('meeting-1');

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('pending');
    expect(autoPushActionItems).not.toHaveBeenCalled();
  });

  it('returns original pending items when auto-push throws (error is swallowed)', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeetingWithTranscript('proj-1') as never);
    vi.mocked(autoPushActionItems).mockRejectedValueOnce(new Error('Push failed'));

    buildDb({
      insertReturning: [makeActionItemRow({ status: 'pending' })],
    });

    const result = await generateActionItems('meeting-1');

    // Auto-push failed but items are still returned (pending status preserved from pre-push array)
    expect(result).toHaveLength(1);
    expect(autoPushActionItems).toHaveBeenCalledOnce();
  });
});
