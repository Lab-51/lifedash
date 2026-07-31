// @vitest-environment jsdom
// Phase G Task 4: SessionsHome calendar ribbon render states (none / upcoming /
// in-progress / dismissed) and the one-click path into the prefilled recorder.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import type { CalendarEvent } from '../../../shared/types/calendar';

const getUpcomingCalendarEvents = vi.fn().mockResolvedValue([]);
const onCalendarEventsUpdated = vi.fn().mockReturnValue(() => {});

vi.stubGlobal('electronAPI', {
  hasWhisperModel: vi.fn().mockResolvedValue(true),
  onTranscriptSegment: vi.fn().mockReturnValue(() => {}),
  onWhisperDownloadProgress: vi.fn().mockReturnValue(() => {}),
  getMeetings: vi.fn().mockResolvedValue([]),
  getProjects: vi.fn().mockResolvedValue([]),
  getSetting: vi.fn().mockResolvedValue(null),
  getWhisperModels: vi.fn().mockResolvedValue([]),
  transcriptionGetConfig: vi.fn().mockResolvedValue({ type: 'local' }),
  getProjectsWithRecency: vi.fn().mockResolvedValue([]),
  whisperGetActiveModel: vi.fn().mockResolvedValue(null),
  suggestCalendarProject: vi.fn().mockResolvedValue(null),
  search: vi.fn().mockResolvedValue({ sessions: [], cards: [], projects: [] }),
  getUpcomingCalendarEvents,
  onCalendarEventsUpdated,
});

const { useMeetingStore } = await import('../../stores/meetingStore');
const { useRecordingStore } = await import('../../stores/recordingStore');
const { useProjectStore } = await import('../../stores/projectStore');
const { default: SessionsHome } = await import('../SessionsHome');

function renderHome() {
  return render(
    <MemoryRouter>
      <SessionsHome />
    </MemoryRouter>,
  );
}

const makeEvent = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'google:evt-1',
  provider: 'google',
  eventId: 'evt-1',
  title: 'Team Sync',
  startsAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  endsAt: new Date(Date.now() + 40 * 60_000).toISOString(),
  attendees: [],
  ...overrides,
});

describe('SessionsHome — calendar ribbon (Phase G Task 4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUpcomingCalendarEvents.mockResolvedValue([]);
    onCalendarEventsUpdated.mockReturnValue(() => {});
    useMeetingStore.setState({
      meetings: [],
      loading: false,
      error: null,
      actionItemCounts: {},
      loadMeetings: vi.fn().mockResolvedValue(undefined),
      loadActionItemCounts: vi.fn().mockResolvedValue(undefined),
    } as never);
    useRecordingStore.setState({ isRecording: false, meetingId: null, elapsed: 0, starting: false } as never);
    useProjectStore.setState({ projects: [], loadProjects: vi.fn().mockResolvedValue(undefined) } as never);
  });

  it('none: renders no ribbon when there are no qualifying events', async () => {
    renderHome();
    await waitFor(() => expect(getUpcomingCalendarEvents).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Start recording' })).toBeNull();
  });

  it('none: an event outside the window (starts in 60 min) does not show a ribbon', async () => {
    getUpcomingCalendarEvents.mockResolvedValue([
      makeEvent({ startsAt: new Date(Date.now() + 60 * 60_000).toISOString() }),
    ]);
    renderHome();
    await waitFor(() => expect(getUpcomingCalendarEvents).toHaveBeenCalled());
    expect(screen.queryByText(/Team Sync/)).toBeNull();
  });

  it('upcoming: shows the event title + a Start recording button', async () => {
    getUpcomingCalendarEvents.mockResolvedValue([makeEvent()]);
    renderHome();
    await waitFor(() => expect(screen.getByText(/Team Sync/)).toBeInTheDocument());
    expect(screen.getByText(/starts in/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start recording' })).toBeInTheDocument();
  });

  it('in-progress: an event that started <10 min ago shows an in-progress ribbon', async () => {
    getUpcomingCalendarEvents.mockResolvedValue([
      makeEvent({ startsAt: new Date(Date.now() - 5 * 60_000).toISOString() }),
    ]);
    renderHome();
    await waitFor(() => expect(screen.getByText(/Team Sync/)).toBeInTheDocument());
    expect(screen.getByText(/in progress/)).toBeInTheDocument();
  });

  it('dismissed: clicking dismiss removes the ribbon for that event', async () => {
    const user = userEvent.setup();
    getUpcomingCalendarEvents.mockResolvedValue([makeEvent()]);
    renderHome();
    await waitFor(() => expect(screen.getByText(/Team Sync/)).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Dismiss upcoming event' }));
    expect(screen.queryByText(/Team Sync/)).toBeNull();
  });

  it('one-click: Start recording opens the recorder prefilled with the event title', async () => {
    const user = userEvent.setup();
    getUpcomingCalendarEvents.mockResolvedValue([makeEvent()]);
    renderHome();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start recording' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Start recording' }));

    // Recorder expands with the event title seeded into its title input.
    await waitFor(() => expect(screen.getByPlaceholderText('Meeting title...')).toHaveValue('Team Sync'));
  });
});
