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
    participants: null,
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

// === TRANS-COV.1 Task 5 — the coverage marker beside the duration ===========

describe('MeetingCardModern — coverage marker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows no marker at all when the meeting has no coverage record (unknown)', () => {
    render(<MeetingCardModern meeting={makeMeeting()} onClick={vi.fn()} />);
    expect(screen.queryByText('Partial')).toBeNull();
    expect(screen.queryByText('Recovered')).toBeNull();
  });

  it('shows "Partial" for a meeting with a failed or unresolved window', () => {
    const meeting = makeMeeting({
      transcriptionCoverage: {
        version: 1,
        endedBy: 'stop',
        audioMs: 60000,
        provider: 'local',
        model: 'ggml-base.bin',
        windowStampMs: 10000,
        windowAdvanceMs: 9000,
        retranscribed: [],
        channels: {
          mic: { windows: 1, saved: 0, silentRms: 0, silentVad: 0, droppedHallucination: 0, failed: 1 },
          system: { windows: 0, saved: 0, silentRms: 0, silentVad: 0, droppedHallucination: 0, failed: 0 },
          mixed: { windows: 0, saved: 0, silentRms: 0, silentVad: 0, droppedHallucination: 0, failed: 0 },
        },
        gaps: [{ startMs: 0, endMs: 10000, channel: 'mic', reason: 'failed' }],
      },
    });
    render(<MeetingCardModern meeting={meeting} onClick={vi.fn()} />);
    expect(screen.getByText('Partial')).toBeInTheDocument();
    expect(screen.queryByText('Complete')).toBeNull();
  });

  it('shows "Recovered" for a session closed by crash recovery, never the word "complete"', () => {
    const meeting = makeMeeting({
      transcriptionCoverage: {
        version: 1,
        endedBy: 'recovered',
        audioMs: 30000,
        provider: 'local',
        model: null,
        windowStampMs: 10000,
        windowAdvanceMs: 9000,
        retranscribed: [],
        channels: {
          mic: { windows: 0, saved: 0, silentRms: 0, silentVad: 0, droppedHallucination: 0, failed: 0 },
          system: { windows: 0, saved: 0, silentRms: 0, silentVad: 0, droppedHallucination: 0, failed: 0 },
          mixed: { windows: 0, saved: 0, silentRms: 0, silentVad: 0, droppedHallucination: 0, failed: 0 },
        },
        gaps: [{ startMs: 20000, endMs: 30000, channel: 'mixed', reason: 'unknown' }],
      },
    });
    render(<MeetingCardModern meeting={meeting} onClick={vi.fn()} />);
    expect(screen.getByText('Recovered')).toBeInTheDocument();
    expect(screen.queryByText(/complete/i)).toBeNull();
  });
});
