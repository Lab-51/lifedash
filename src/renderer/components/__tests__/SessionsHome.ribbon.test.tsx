// @vitest-environment jsdom
// Phase G Task 4: SessionsHome calendar ribbon render states (none / upcoming /
// in-progress / dismissed) and the one-click path into the prefilled recorder.
// CAL-UX.1: the agenda list below the ribbon is persistent (survives an empty
// window while a calendar is connected), spans the shared 7-day lookahead, and
// groups its rows by day.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import type { CalendarEvent, CalendarAccountStatus } from '../../../shared/types/calendar';
import { CALENDAR_LOOKAHEAD_HOURS } from '../../../shared/types/calendar';

const getUpcomingCalendarEvents = vi.fn().mockResolvedValue([]);
const onCalendarEventsUpdated = vi.fn().mockReturnValue(() => {});
const getCalendarStatus = vi.fn().mockResolvedValue([]);
const pollCalendarNow = vi.fn().mockResolvedValue(undefined);

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
  getCalendarStatus,
  pollCalendarNow,
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

const connectedStatus: CalendarAccountStatus[] = [{ provider: 'google', connected: true, needsReauth: false }];

describe('SessionsHome — calendar ribbon (Phase G Task 4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUpcomingCalendarEvents.mockResolvedValue([]);
    onCalendarEventsUpdated.mockReturnValue(() => {});
    pollCalendarNow.mockResolvedValue(undefined);
    // Default: nothing connected — tests that need the persistent agenda opt in.
    getCalendarStatus.mockResolvedValue([]);
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

  afterEach(() => {
    vi.useRealTimers();
  });

  it('none: renders no ribbon when there are no qualifying events', async () => {
    renderHome();
    await waitFor(() => expect(getUpcomingCalendarEvents).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Start recording' })).toBeNull();
  });

  it('none: an event outside the window (starts in 60 min) shows in the list but not the ribbon', async () => {
    getUpcomingCalendarEvents.mockResolvedValue([
      makeEvent({ startsAt: new Date(Date.now() + 60 * 60_000).toISOString() }),
    ]);
    renderHome();
    await waitFor(() => expect(getUpcomingCalendarEvents).toHaveBeenCalled());
    // No imminent ribbon for a far event...
    expect(screen.queryByRole('button', { name: 'Start recording' })).toBeNull();
    // ...but it IS listed under Upcoming meetings.
    await waitFor(() => expect(screen.getByText('Team Sync')).toBeInTheDocument());
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

  it('list: an event outside the ribbon window (60 min out) appears in the Upcoming meetings list', async () => {
    getUpcomingCalendarEvents.mockResolvedValue([
      makeEvent({
        id: 'google:evt-far',
        eventId: 'evt-far',
        title: 'Planning',
        startsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        endsAt: new Date(Date.now() + 90 * 60_000).toISOString(),
      }),
    ]);
    renderHome();
    await waitFor(() => expect(screen.getByText('Upcoming meetings')).toBeInTheDocument());
    expect(screen.getByText('Planning')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start recording for Planning' })).toBeInTheDocument();
    // The far event is NOT surfaced in the imminent ribbon.
    expect(screen.queryByRole('button', { name: 'Start recording' })).toBeNull();
  });

  it('list: excludes the event already shown in the ribbon (no duplicate)', async () => {
    getUpcomingCalendarEvents.mockResolvedValue([
      makeEvent(), // imminent (10 min) → ribbon (title "Team Sync")
      makeEvent({
        id: 'google:evt-far',
        eventId: 'evt-far',
        title: 'Planning',
        startsAt: new Date(Date.now() + 90 * 60_000).toISOString(),
        endsAt: new Date(Date.now() + 120 * 60_000).toISOString(),
      }),
    ]);
    renderHome();
    await waitFor(() => expect(screen.getByText('Upcoming meetings')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Start recording' })).toBeInTheDocument(); // ribbon
    expect(screen.getByRole('button', { name: 'Start recording for Planning' })).toBeInTheDocument(); // list
    // The imminent event (in the ribbon) is NOT duplicated as a list row.
    expect(screen.queryByRole('button', { name: 'Start recording for Team Sync' })).toBeNull();
  });

  it('list: Record opens the recorder prefilled with the event title', async () => {
    const user = userEvent.setup();
    getUpcomingCalendarEvents.mockResolvedValue([
      makeEvent({
        id: 'google:evt-far',
        eventId: 'evt-far',
        title: 'Planning',
        startsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        endsAt: new Date(Date.now() + 90 * 60_000).toISOString(),
      }),
    ]);
    renderHome();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Start recording for Planning' })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: 'Start recording for Planning' }));
    await waitFor(() => expect(screen.getByPlaceholderText('Meeting title...')).toHaveValue('Planning'));
  });

  // --- CAL-UX.1: 7-day window, persistent section, day grouping -------------------

  it('window: requests the shared lookahead window, not a local literal', async () => {
    renderHome();
    await waitFor(() => expect(getUpcomingCalendarEvents).toHaveBeenCalledWith(CALENDAR_LOOKAHEAD_HOURS));
  });

  it('persistent: a connected calendar with an empty window keeps the section + empty state', async () => {
    getCalendarStatus.mockResolvedValue(connectedStatus);
    renderHome();

    expect(await screen.findByText('Upcoming meetings')).toBeInTheDocument();
    expect(screen.getByText('No meetings in the next 7 days.')).toBeInTheDocument();
  });

  it('persistent: no connected calendar and no events ⇒ no section at all', async () => {
    renderHome();

    await waitFor(() => expect(getCalendarStatus).toHaveBeenCalled());
    await waitFor(() => expect(getUpcomingCalendarEvents).toHaveBeenCalled());
    expect(screen.queryByText('Upcoming meetings')).toBeNull();
    expect(screen.queryByText('No meetings in the next 7 days.')).toBeNull();
  });

  it('refresh: the agenda header button triggers an on-demand calendar sync', async () => {
    getCalendarStatus.mockResolvedValue(connectedStatus);
    renderHome();

    const button = await screen.findByRole('button', { name: 'Refresh calendar' });
    await userEvent.click(button);

    expect(pollCalendarNow).toHaveBeenCalledTimes(1);
  });

  it('refresh: a failed sync surfaces an inline error instead of failing silently', async () => {
    getCalendarStatus.mockResolvedValue(connectedStatus);
    pollCalendarNow.mockRejectedValueOnce(new Error('offline'));
    renderHome();

    await userEvent.click(await screen.findByRole('button', { name: 'Refresh calendar' }));

    expect(await screen.findByText('Refresh failed — check your calendar connection in Settings.')).toBeInTheDocument();
  });

  it('grouping: rows are bucketed under Today / Tomorrow day headers', async () => {
    // Freeze only Date so "now + 1h" and "now + 26h" can never straddle midnight.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 6, 31, 9, 0, 0));
    const now = Date.now();
    getCalendarStatus.mockResolvedValue(connectedStatus);
    getUpcomingCalendarEvents.mockResolvedValue([
      makeEvent({
        id: 'google:evt-today',
        eventId: 'evt-today',
        title: 'Design Review',
        startsAt: new Date(now + 60 * 60_000).toISOString(),
        endsAt: new Date(now + 90 * 60_000).toISOString(),
      }),
      makeEvent({
        id: 'google:evt-tomorrow',
        eventId: 'evt-tomorrow',
        title: 'Roadmap Sync',
        startsAt: new Date(now + 26 * 60 * 60_000).toISOString(),
        endsAt: new Date(now + 27 * 60 * 60_000).toISOString(),
      }),
    ]);

    renderHome();

    expect(await screen.findByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Tomorrow')).toBeInTheDocument();
    expect(screen.getByText('Design Review')).toBeInTheDocument();
    expect(screen.getByText('Roadmap Sync')).toBeInTheDocument();
  });
});
