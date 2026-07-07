// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import '@testing-library/jest-dom';

/** Reflects the router's current location so navigation assertions can read it. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

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
  transcriptionGetConfig: vi.fn().mockResolvedValue({ type: 'local' }),
  getSetting: vi.fn().mockResolvedValue(null),
  getWhisperModels: vi.fn().mockResolvedValue([]),
  search: vi.fn().mockResolvedValue({ sessions: [], cards: [], projects: [] }),
});

// ---------------------------------------------------------------------------
// Import stores and component AFTER mocking
// ---------------------------------------------------------------------------
const { useMeetingStore } = await import('../../stores/meetingStore');
const { useRecordingStore } = await import('../../stores/recordingStore');
const { useProjectStore } = await import('../../stores/projectStore');
const { default: SessionsHome } = await import('../SessionsHome');
const { default: SessionsHomePage } = await import('../../pages/SessionsHomePage');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderComponent() {
  return render(
    <MemoryRouter>
      <SessionsHome />
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
describe('SessionsHome', () => {
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
    expect(screen.getByText('Sessions')).toBeInTheDocument();
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
    const searchInput = screen.getByPlaceholderText('Search sessions, cards, projects...');
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

  it('row click navigates to the routed session page (/session/:id)', async () => {
    const user = userEvent.setup();
    useMeetingStore.setState({
      meetings: [makeMeeting({ id: 'meet-1', title: 'Weekly Standup' })] as any,
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <SessionsHome />
        <LocationProbe />
      </MemoryRouter>,
    );
    await user.click(screen.getByText('Weekly Standup'));

    // The modal is retired — the detail view is a full page now.
    expect(screen.getByTestId('location')).toHaveTextContent('/session/meet-1');
  });

  describe('pinned live-session card', () => {
    it('does not appear when not recording', () => {
      renderComponent();
      expect(screen.queryByTestId('live-session-pin')).toBeNull();
    });

    it('appears with elapsed time, project, and a Return to Live button when recording', () => {
      useProjectStore.setState({
        projects: [{ id: 'proj-1', name: 'Acme Launch', color: '#6366f1' }] as any,
      });
      useMeetingStore.setState({
        meetings: [makeMeeting({ id: 'meet-live', title: 'Live Standup', projectId: 'proj-1' })] as any,
      });
      useRecordingStore.setState({
        isRecording: true,
        meetingId: 'meet-live',
        elapsed: 125,
      });

      renderComponent();
      const pin = screen.getByTestId('live-session-pin');
      expect(pin).toBeInTheDocument();
      const withinPin = within(pin);
      expect(withinPin.getByText('Live Standup')).toBeInTheDocument();
      expect(withinPin.getByText('Acme Launch')).toBeInTheDocument();
      expect(withinPin.getByLabelText('Elapsed time')).toHaveTextContent('02:05');
      expect(withinPin.getByText('Return to Live')).toBeInTheDocument();
    });

    it('calls restoreLiveMode when "Return to Live" is clicked', async () => {
      const user = userEvent.setup();
      const restoreLiveMode = vi.fn();
      useRecordingStore.setState({
        isRecording: true,
        meetingId: null,
        elapsed: 0,
        restoreLiveMode,
      });

      renderComponent();
      await user.click(screen.getByText('Return to Live'));
      expect(restoreLiveMode).toHaveBeenCalledTimes(1);
    });
  });
});

describe('SessionsHomePage — default route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMeetingStore.setState({
      meetings: [],
      loading: false,
      error: null,
      actionItemCounts: {},
      loadMeetings: vi.fn().mockResolvedValue(undefined),
      loadMeeting: vi.fn().mockResolvedValue(undefined),
      loadActionItemCounts: vi.fn().mockResolvedValue(undefined),
    } as any);
    useRecordingStore.setState({ isRecording: false, meetingId: null, elapsed: 0 });
    useProjectStore.setState({ projects: [], loadProjects: vi.fn().mockResolvedValue(undefined) } as any);
  });

  it('renders SessionsHome — this is the component App.tsx mounts at the index route', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <SessionsHomePage />
      </MemoryRouter>,
    );
    expect(screen.getByText('Sessions')).toBeInTheDocument();
  });
});
