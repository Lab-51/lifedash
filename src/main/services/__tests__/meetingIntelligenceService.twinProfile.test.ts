// === FILE PURPOSE ===
// Unit tests for the V3.3 Task 2 digital-twin profile injection wired into
// meetingIntelligenceService: both generateBrief's summarization system prompt
// and generateActionItems' action-extraction system prompt call
// buildProfileContext('summarization') and prepend the returned block. Proves,
// per consumer: profile present -> block prepended (structurally, ahead of the
// exact same base prompt that would have been sent with no profile); profile
// absent OR buildProfileContext throwing -> system prompt is byte-identical to
// the no-profile baseline (regression guard) and generation is never blocked.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports
// ---------------------------------------------------------------------------

vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));

vi.mock('../../db/schema', () => ({
  meetingBriefs: { meetingId: 'meetingId', summary: 'summary', createdAt: 'createdAt' },
  actionItems: {
    id: 'id',
    meetingId: 'meetingId',
    status: 'status',
    cardId: 'cardId',
    description: 'description',
    createdAt: 'createdAt',
  },
  cards: {},
  meetings: { id: 'id', projectId: 'projectId' },
  projects: { id: 'id', archived: 'archived', system: 'system', name: 'name', description: 'description' },
  liveSuggestions: {
    id: 'id',
    meetingId: 'meetingId',
    type: 'type',
    title: 'title',
    description: 'description',
    status: 'status',
  },
}));

vi.mock('../meetingService', () => ({
  getMeeting: vi.fn(),
  updateMeeting: vi.fn().mockResolvedValue({}),
}));

vi.mock('../ai-provider', () => ({
  generate: vi.fn(),
  resolveTaskModel: vi.fn(),
}));

vi.mock('../autoPushService', () => ({
  autoPushActionItems: vi.fn().mockResolvedValue({ pushedCount: 0, skippedCount: 0, cards: [] }),
  readAutoPushSetting: vi.fn().mockResolvedValue(true),
}));

vi.mock('../unassignedProjectService', () => ({
  ensureUnassignedProject: vi.fn().mockResolvedValue({ id: 'unassigned-id', name: 'Unassigned', system: true }),
}));

vi.mock('../projectDetectionService', () => ({
  detectProjectFromTranscript: vi.fn(),
}));

vi.mock('../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../../shared/utils/action-item-parser', () => ({
  parseActionItems: vi.fn().mockReturnValue([]),
}));

vi.mock('../../../shared/types', () => ({
  MEETING_TEMPLATES: [],
}));

vi.mock('../twinProfileService', () => ({ buildProfileContext: vi.fn() }));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { generateBrief, generateActionItems, injectTwinProfileContext } from '../meetingIntelligenceService';
import { getMeeting } from '../meetingService';
import { generate, resolveTaskModel } from '../ai-provider';
import { getDb } from '../../db/connection';
import { buildProfileContext } from '../twinProfileService';
import { parseActionItems } from '../../../shared/utils/action-item-parser';

const MEETING_ID = 'meeting-1';
const PROFILE_BLOCK = 'User profile (the professional you assist):\n\nIdentity: Dana, Staff Engineer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMeeting(overrides: Record<string, unknown> = {}) {
  return {
    id: MEETING_ID,
    projectId: null,
    title: 'Test Meeting',
    template: 'none',
    transcriptionLanguage: null,
    segments: [
      {
        id: 's1',
        meetingId: MEETING_ID,
        startTime: 0,
        endTime: 5000,
        content: 'discuss the roadmap',
        speaker: null,
        createdAt: '2025-01-01T00:00:00Z',
      },
    ],
    brief: null,
    actionItems: [],
    status: 'completed',
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    audioPath: null,
    prepBriefing: null,
    unassignedPending: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Every select()/insert() this file's flows touch resolves to an empty/no-op response. */
function buildDb(insertReturning: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.innerJoin = vi.fn().mockReturnValue(chain);
  chain.orderBy = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockResolvedValue([]);
  chain.where = vi.fn().mockReturnValue({ ...chain, then: (resolve: (v: unknown) => void) => resolve([]) });

  const db = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn().mockResolvedValue(insertReturning) })) })),
  };
  vi.mocked(getDb).mockReturnValue(db as never);
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveTaskModel).mockResolvedValue({
    providerId: 'p1',
    providerName: 'openai',
    apiKeyEncrypted: 'enc',
    baseUrl: null,
    model: 'gpt-4o-mini',
    temperature: 0,
    maxTokens: 500,
  } as never);
  vi.mocked(parseActionItems).mockReturnValue(['Follow up']);
});

// ---------------------------------------------------------------------------
// injectTwinProfileContext — pure(-ish) unit contract
// ---------------------------------------------------------------------------

describe('injectTwinProfileContext', () => {
  it('returns the system prompt byte-identical when no profile exists (regression guard)', async () => {
    vi.mocked(buildProfileContext).mockResolvedValue('');

    const result = await injectTwinProfileContext('BASE SYSTEM PROMPT');

    expect(result).toBe('BASE SYSTEM PROMPT');
    expect(buildProfileContext).toHaveBeenCalledWith('summarization');
  });

  it('prepends the profile block, separated by a blank line, when a profile exists', async () => {
    vi.mocked(buildProfileContext).mockResolvedValue(PROFILE_BLOCK);

    const result = await injectTwinProfileContext('BASE SYSTEM PROMPT');

    expect(result).toBe(`${PROFILE_BLOCK}\n\nBASE SYSTEM PROMPT`);
  });

  it('falls back to the system prompt byte-identical when buildProfileContext throws (never blocks generation)', async () => {
    vi.mocked(buildProfileContext).mockRejectedValue(new Error('db exploded'));

    const result = await injectTwinProfileContext('BASE SYSTEM PROMPT');

    expect(result).toBe('BASE SYSTEM PROMPT');
  });
});

// ---------------------------------------------------------------------------
// generateBrief — twin profile injection into the summarization system prompt
// ---------------------------------------------------------------------------

describe('generateBrief — twin profile injection (V3.3 Task 2)', () => {
  it('system prompt is byte-identical to the no-profile baseline when no profile exists', async () => {
    vi.mocked(buildProfileContext).mockResolvedValue('');
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    vi.mocked(generate).mockResolvedValue({ text: 'Generated brief content' } as never);
    buildDb([{ id: 'brief-1', meetingId: MEETING_ID, summary: 'ok', createdAt: new Date() }]);

    await generateBrief(MEETING_ID);

    const callArg = vi.mocked(generate).mock.calls[0][0];
    expect(callArg.system).not.toContain('User profile');
    expect(buildProfileContext).toHaveBeenCalledWith('summarization');
  });

  it('prepends the profile block ahead of the exact same base system prompt when a profile exists', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    vi.mocked(generate).mockResolvedValue({ text: 'Generated brief content' } as never);

    // Baseline call (no profile).
    vi.mocked(buildProfileContext).mockResolvedValue('');
    buildDb([{ id: 'brief-1', meetingId: MEETING_ID, summary: 'ok', createdAt: new Date() }]);
    await generateBrief(MEETING_ID);
    const baselineSystem = vi.mocked(generate).mock.calls[0][0].system;

    // Profile-present call — same meeting/template/language inputs.
    vi.mocked(buildProfileContext).mockResolvedValue(PROFILE_BLOCK);
    buildDb([{ id: 'brief-2', meetingId: MEETING_ID, summary: 'ok', createdAt: new Date() }]);
    await generateBrief(MEETING_ID);
    const withProfileSystem = vi.mocked(generate).mock.calls[1][0].system;

    expect(withProfileSystem).toBe(`${PROFILE_BLOCK}\n\n${baselineSystem}`);
  });

  it('does not block brief generation when buildProfileContext throws', async () => {
    vi.mocked(buildProfileContext).mockRejectedValue(new Error('db exploded'));
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    vi.mocked(generate).mockResolvedValue({ text: 'Generated brief content' } as never);
    buildDb([{ id: 'brief-1', meetingId: MEETING_ID, summary: 'ok', createdAt: new Date() }]);

    const result = await generateBrief(MEETING_ID);

    expect(result.id).toBe('brief-1');
    const callArg = vi.mocked(generate).mock.calls[0][0];
    expect(callArg.system).not.toContain('User profile');
  });
});

// ---------------------------------------------------------------------------
// generateActionItems — twin profile injection into the action-extraction prompt
// ---------------------------------------------------------------------------

describe('generateActionItems — twin profile injection (V3.3 Task 2)', () => {
  it('system prompt is byte-identical to the no-profile baseline when no profile exists', async () => {
    vi.mocked(buildProfileContext).mockResolvedValue('');
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    vi.mocked(generate).mockResolvedValue({ text: '- Follow up' } as never);
    buildDb([
      {
        id: 'action-1',
        meetingId: MEETING_ID,
        cardId: null,
        description: 'Follow up',
        status: 'pending',
        createdAt: new Date(),
      },
    ]);

    await generateActionItems(MEETING_ID);

    const callArg = vi.mocked(generate).mock.calls[0][0];
    expect(callArg.system).not.toContain('User profile');
    expect(buildProfileContext).toHaveBeenCalledWith('summarization');
  });

  it('prepends the profile block ahead of the exact same base system prompt when a profile exists', async () => {
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    vi.mocked(generate).mockResolvedValue({ text: '- Follow up' } as never);

    vi.mocked(buildProfileContext).mockResolvedValue('');
    buildDb([
      {
        id: 'action-1',
        meetingId: MEETING_ID,
        cardId: null,
        description: 'Follow up',
        status: 'pending',
        createdAt: new Date(),
      },
    ]);
    await generateActionItems(MEETING_ID);
    const baselineSystem = vi.mocked(generate).mock.calls[0][0].system;

    vi.mocked(buildProfileContext).mockResolvedValue(PROFILE_BLOCK);
    buildDb([
      {
        id: 'action-2',
        meetingId: MEETING_ID,
        cardId: null,
        description: 'Follow up',
        status: 'pending',
        createdAt: new Date(),
      },
    ]);
    await generateActionItems(MEETING_ID);
    const withProfileSystem = vi.mocked(generate).mock.calls[1][0].system;

    expect(withProfileSystem).toBe(`${PROFILE_BLOCK}\n\n${baselineSystem}`);
  });

  it('does not block action item extraction when buildProfileContext throws', async () => {
    vi.mocked(buildProfileContext).mockRejectedValue(new Error('db exploded'));
    vi.mocked(getMeeting).mockResolvedValue(makeMeeting() as never);
    vi.mocked(generate).mockResolvedValue({ text: '- Follow up' } as never);
    buildDb([
      {
        id: 'action-1',
        meetingId: MEETING_ID,
        cardId: null,
        description: 'Follow up',
        status: 'pending',
        createdAt: new Date(),
      },
    ]);

    const result = await generateActionItems(MEETING_ID);

    expect(result).toHaveLength(1);
    const callArg = vi.mocked(generate).mock.calls[0][0];
    expect(callArg.system).not.toContain('User profile');
  });
});
