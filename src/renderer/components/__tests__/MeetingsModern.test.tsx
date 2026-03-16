// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// Mock window.electronAPI — must happen before any store or component import
// ---------------------------------------------------------------------------
vi.stubGlobal('electronAPI', {
  hasWhisperModel: vi.fn().mockResolvedValue(true),
  onTranscriptSegment: vi.fn().mockReturnValue(() => {}),
  onWhisperDownloadProgress: vi.fn().mockReturnValue(() => {}),
  downloadWhisperModel: vi.fn().mockResolvedValue(undefined),
  getMeetings: vi.fn().mockResolvedValue([]),
  getProjects: vi.fn().mockResolvedValue([]),
  getMeeting: vi.fn().mockResolvedValue(null),
  deleteMeeting: vi.fn().mockResolvedValue(undefined),
  getMeetingActionItems: vi.fn().mockResolvedValue([]),
  loadActionItemCounts: vi.fn().mockResolvedValue({}),
});

// ---------------------------------------------------------------------------
// Import stores and component AFTER mocking
// ---------------------------------------------------------------------------
const { useMeetingStore } = await import('../../stores/meetingStore');
const { useRecordingStore } = await import('../../stores/recordingStore');
const { useProjectStore } = await import('../../stores/projectStore');
const { default: MeetingsModern } = await import('../MeetingsModern');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderComponent() {
  return render(
    <MemoryRouter>
      <MeetingsModern />
    </MemoryRouter>,
  );
}

const makeMeeting = (overrides: Record<string, unknown> = {}) => ({
  id: 'meet-1',
  title: 'Weekly Standup',
  template: 'standup',
  startedAt: '2026-03-10T10:00:00Z',
  endedAt: '2026-03-10T10:30:00Z',
  createdAt: '2026-03-10T10:00:00Z',
  updatedAt: '2026-03-10T10:30:00Z',
  projectId: null,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('MeetingsModern', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Override store actions to no-ops so mount effects don't trigger loading state
    useMeetingStore.setState({
      meetings: [],
      loading: false,
      error: null,
      actionItemCounts: {},
      selectedMeeting: null,
      generatingBrief: false,
      generatingActions: false,
      pendingActionCount: 0,
      loadMeetings: vi.fn().mockResolvedValue(undefined),
      loadMeeting: vi.fn().mockResolvedValue(undefined),
      loadActionItemCounts: vi.fn().mockResolvedValue(undefined),
    } as any);

    useRecordingStore.setState({
      isRecording: false,
      isProcessing: false,
      meetingId: null,
      completedMeetingId: null,
      elapsed: 0,
      lastTranscript: '',
      error: null,
      starting: false,
    });

    useProjectStore.setState({
      projects: [],
      loading: false,
      error: null,
      loadProjects: vi.fn().mockResolvedValue(undefined),
    } as any);
  });

  it('renders without crashing with empty meetings', () => {
    renderComponent();
    expect(screen.getByText('Meetings')).toBeInTheDocument();
  });

  it('displays meeting cards when meetings exist in store', () => {
    useMeetingStore.setState({
      meetings: [
        makeMeeting({ id: 'meet-1', title: 'Weekly Standup' }),
        makeMeeting({ id: 'meet-2', title: 'Sprint Retro' }),
      ] as any,
    });

    renderComponent();
    expect(screen.getByText('Weekly Standup')).toBeInTheDocument();
    expect(screen.getByText('Sprint Retro')).toBeInTheDocument();
  });

  it('search input exists and is interactive', async () => {
    const user = userEvent.setup();

    useMeetingStore.setState({
      meetings: [
        makeMeeting({ id: 'meet-1', title: 'Weekly Standup' }),
        makeMeeting({ id: 'meet-2', title: 'Sprint Retro' }),
      ] as any,
    });

    renderComponent();
    const searchInput = screen.getByPlaceholderText('Search transcripts...');
    expect(searchInput).toBeInTheDocument();

    await user.type(searchInput, 'Sprint');
    expect(searchInput).toHaveValue('Sprint');
  });

  it('sort controls render', () => {
    useMeetingStore.setState({
      meetings: [makeMeeting()] as any,
    });
    renderComponent();
    // HudSelect renders the currently selected option label
    expect(screen.getByText('Newest')).toBeInTheDocument();
  });

  it('shows empty state when no meetings', () => {
    renderComponent();
    expect(screen.getByText('Capture every meeting, privately')).toBeInTheDocument();
  });

  it('shows the New Recording button', () => {
    renderComponent();
    expect(screen.getByText('New Recording')).toBeInTheDocument();
  });

  it('displays page subtitle', () => {
    renderComponent();
    expect(screen.getByText('Capture and analyze conversations.')).toBeInTheDocument();
  });
});
