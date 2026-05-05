// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// Mock window.electronAPI
// ---------------------------------------------------------------------------
vi.stubGlobal('electronAPI', {
  reassignFromUnassigned: vi.fn().mockResolvedValue({ movedCardCount: 0 }),
  countUnreviewedCards: vi.fn().mockResolvedValue(0),
  getProjects: vi.fn().mockResolvedValue([]),
});

// ---------------------------------------------------------------------------
// Imports must come AFTER mocks
// ---------------------------------------------------------------------------
const { default: MeetingCardModern } = await import('../MeetingCardModern');
import type { Meeting } from '../../../shared/types';

function makeMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'meeting-1',
    projectId: null,
    title: 'Test meeting',
    template: 'none',
    startedAt: new Date('2026-05-01T10:00:00Z').toISOString(),
    endedAt: new Date('2026-05-01T10:15:00Z').toISOString(),
    audioPath: null,
    status: 'completed',
    prepBriefing: null,
    transcriptionLanguage: null,
    unassignedPending: false,
    createdAt: new Date('2026-05-01T10:00:00Z').toISOString(),
    ...overrides,
  };
}

describe('MeetingCardModern — unassigned-pending pill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the "Unassigned — set project?" pill when unassignedPending=true', () => {
    render(<MeetingCardModern meeting={makeMeeting({ unassignedPending: true })} onClick={vi.fn()} />);
    expect(screen.getByTestId('meeting-unassigned-pill')).toBeInTheDocument();
    expect(screen.getByTestId('meeting-unassigned-pill')).toHaveTextContent(/unassigned/i);
  });

  it('does NOT render the unassigned pill when unassignedPending=false', () => {
    render(<MeetingCardModern meeting={makeMeeting({ unassignedPending: false })} onClick={vi.fn()} />);
    expect(screen.queryByTestId('meeting-unassigned-pill')).toBeNull();
  });
});
