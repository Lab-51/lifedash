// === FILE PURPOSE ===
// Unit tests for meetingService's participant-roster surface (BRIEF-QUAL.1
// Task 1): createMeeting persists an optional `participants` list, and the
// dedicated updateMeetingParticipants write is a plain column update, isolated
// from updateMeeting's project-link / completion-transition logic.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports
// ---------------------------------------------------------------------------

vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));

vi.mock('../../db/schema', () => ({
  meetings: {
    id: 'id',
    projectId: 'projectId',
    title: 'title',
    template: 'template',
    startedAt: 'startedAt',
    endedAt: 'endedAt',
    audioPath: 'audioPath',
    status: 'status',
    prepBriefing: 'prepBriefing',
    transcriptionLanguage: 'transcriptionLanguage',
    calendarEventId: 'calendarEventId',
    calendarSeriesId: 'calendarSeriesId',
    participants: 'participants',
    createdAt: 'createdAt',
  },
  transcripts: {},
  meetingBriefs: {},
  actionItems: {},
  twinFacts: {},
}));

vi.mock('../autoPushService', () => ({
  autoPushActionItems: vi.fn().mockResolvedValue({ pushedCount: 0, skippedCount: 0, cards: [] }),
  readAutoPushSetting: vi.fn().mockResolvedValue(true),
}));

vi.mock('../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('../dataChangeNotifier', () => ({ notifyDataChanged: vi.fn() }));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { createMeeting, updateMeetingParticipants } from '../meetingService';
import { getDb } from '../../db/connection';

function makeMeetingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'meeting-1',
    projectId: null,
    title: 'Test Meeting',
    template: 'none',
    startedAt: new Date('2025-01-01T10:00:00Z'),
    endedAt: null,
    audioPath: null,
    status: 'recording',
    prepBriefing: null,
    transcriptionLanguage: null,
    unassignedPending: false,
    calendarEventId: null,
    calendarSeriesId: null,
    participants: null,
    createdAt: new Date('2025-01-01T10:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createMeeting — participants', () => {
  it('persists the typed participants list, in order, on the insert values', async () => {
    const returning = vi.fn().mockResolvedValue([makeMeetingRow({ participants: ['Alice', 'Bob'] })]);
    const values = vi.fn(() => ({ returning }));
    vi.mocked(getDb).mockReturnValue({ insert: vi.fn(() => ({ values })) } as never);

    const result = await createMeeting({ title: 'Standup', participants: ['Alice', 'Bob'] });

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ participants: ['Alice', 'Bob'] }));
    expect(result.participants).toEqual(['Alice', 'Bob']);
  });

  it('defaults participants to null when omitted', async () => {
    const returning = vi.fn().mockResolvedValue([makeMeetingRow({ participants: null })]);
    const values = vi.fn(() => ({ returning }));
    vi.mocked(getDb).mockReturnValue({ insert: vi.fn(() => ({ values })) } as never);

    const result = await createMeeting({ title: 'Standup' });

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ participants: null }));
    expect(result.participants).toBeNull();
  });
});

describe('updateMeetingParticipants', () => {
  it('writes the participants column and returns the mapped meeting', async () => {
    const returning = vi.fn().mockResolvedValue([makeMeetingRow({ participants: ['Carol'] })]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    vi.mocked(getDb).mockReturnValue({ update: vi.fn(() => ({ set })) } as never);

    const result = await updateMeetingParticipants('meeting-1', ['Carol']);

    expect(set).toHaveBeenCalledWith({ participants: ['Carol'] });
    expect(result.id).toBe('meeting-1');
    expect(result.participants).toEqual(['Carol']);
  });
});
