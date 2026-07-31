// @vitest-environment jsdom
// CAL-UX.2 Task 3: the event details modal — metadata header, attendee names (never
// emails), the deterministic cross-meeting context, the recorded-vs-record primary
// action, and the OPT-IN prep note (which must never fire on open).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import '@testing-library/jest-dom';
import type { CalendarEvent, CalendarEventContext } from '../../../../shared/types/calendar';

const getCalendarEventContext = vi.fn();
const suggestCalendarProject = vi.fn();
const generateCalendarPrepNote = vi.fn();

vi.stubGlobal('electronAPI', {
  getCalendarEventContext,
  suggestCalendarProject,
  generateCalendarPrepNote,
});

const { default: EventDetailsModal } = await import('../EventDetailsModal');

const emptyContext: CalendarEventContext = {
  recordedSession: null,
  lastSeriesSession: null,
  attendeeMatches: [],
};

const makeEvent = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'google:evt-1',
  provider: 'google',
  eventId: 'evt-1',
  title: 'Weekly Roadmap Sync',
  startsAt: new Date(2026, 6, 31, 10, 0, 0).toISOString(),
  endsAt: new Date(2026, 6, 31, 11, 0, 0).toISOString(),
  attendees: [{ name: 'Ada Lovelace', email: 'ada@example.com' }],
  ...overrides,
});

/** Surfaces the router location so navigation can be asserted without mocking react-router. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="test-location">{location.pathname}</div>;
}

const onClose = vi.fn();
const onStartRecording = vi.fn();

function renderModal(event: CalendarEvent = makeEvent()) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <EventDetailsModal event={event} onClose={onClose} onStartRecording={onStartRecording} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

/** Wait for the on-open context read to settle so the primary action has rendered. */
async function waitForContext() {
  await waitFor(() => expect(getCalendarEventContext).toHaveBeenCalled());
  await screen.findByTestId('event-details-modal');
}

describe('EventDetailsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCalendarEventContext.mockResolvedValue(emptyContext);
    suggestCalendarProject.mockResolvedValue(null);
    generateCalendarPrepNote.mockResolvedValue({ note: 'note' });
  });

  // --- Header / metadata ----------------------------------------------------

  it('renders the title, the day + time range, attendee names and the recurring badge', async () => {
    const event = makeEvent({
      seriesId: 'series-9',
      attendees: [{ name: 'Ada Lovelace', email: 'ada@example.com' }, { email: 'grace.hopper@example.com' }],
    });
    renderModal(event);

    expect(await screen.findByText('Weekly Roadmap Sync')).toBeInTheDocument();

    // Locale-default formatting (same options the agenda list uses) — build the
    // expectation the same way rather than hard-coding a 12h/24h string.
    const start = new Date(event.startsAt);
    const end = new Date(event.endsAt);
    const when = screen.getByTestId('event-details-when').textContent ?? '';
    expect(when).toContain(start.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }));
    expect(when).toContain(start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    expect(when).toContain(end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

    expect(screen.getByText('Google')).toBeInTheDocument();
    expect(screen.getByText('↻ Recurring')).toBeInTheDocument();

    // Names only — the email is a fallback for the nameless attendee, never shown whole.
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('grace.hopper')).toBeInTheDocument();
    expect(screen.queryByText(/ada@example\.com/)).toBeNull();
    expect(screen.queryByText(/grace\.hopper@example\.com/)).toBeNull();
  });

  it('omits the recurring badge for a one-off event', async () => {
    renderModal(makeEvent());
    expect(await screen.findByText('Google')).toBeInTheDocument();
    expect(screen.queryByText('↻ Recurring')).toBeNull();
  });

  // --- Project suggestion ---------------------------------------------------

  it('shows the suggested project when the existing bridge returns one', async () => {
    suggestCalendarProject.mockResolvedValue({ projectId: 'p1', projectName: 'Apollo', basis: 'series-history' });
    renderModal(makeEvent({ seriesId: 'series-9' }));

    expect(await screen.findByText('Suggested project: Apollo')).toBeInTheDocument();
    expect(suggestCalendarProject).toHaveBeenCalledWith({ seriesId: 'series-9', eventId: 'evt-1' });
  });

  it('renders no project line when there is no suggestion', async () => {
    renderModal();
    await waitForContext();
    expect(screen.queryByText(/Suggested project:/)).toBeNull();
  });

  // --- Primary action -------------------------------------------------------

  it('recorded event: offers View session (not Start recording) and navigates to it', async () => {
    const user = userEvent.setup();
    getCalendarEventContext.mockResolvedValue({
      ...emptyContext,
      recordedSession: { meetingId: 'meet-7', title: 'Weekly Roadmap Sync' },
    } satisfies CalendarEventContext);
    renderModal();

    const viewButton = await screen.findByRole('button', { name: 'View session' });
    expect(screen.queryByRole('button', { name: 'Start recording' })).toBeNull();

    await user.click(viewButton);

    expect(screen.getByTestId('test-location')).toHaveTextContent('/session/meet-7');
    expect(onClose).toHaveBeenCalled();
  });

  it('unrecorded event: offers Start recording (not View session) and hands the event back', async () => {
    const user = userEvent.setup();
    const event = makeEvent();
    renderModal(event);

    const startButton = await screen.findByRole('button', { name: 'Start recording' });
    expect(screen.queryByRole('button', { name: 'View session' })).toBeNull();

    await user.click(startButton);

    expect(onStartRecording).toHaveBeenCalledWith(event);
  });

  // --- Context section ------------------------------------------------------

  it('last session: renders the card, the ellipsised snippet, the open items and an honest +N more', async () => {
    const user = userEvent.setup();
    getCalendarEventContext.mockResolvedValue({
      recordedSession: null,
      lastSeriesSession: {
        meetingId: 'meet-3',
        title: 'Roadmap Sync (last week)',
        endedAt: new Date(2026, 6, 24, 11, 0, 0).toISOString(),
        briefSnippet: 'We agreed to cut the mobile scope',
        openActionItems: [
          { id: 'a1', text: 'Send the revised timeline' },
          { id: 'a2', text: 'Book the design review' },
        ],
        totalOpenActionItems: 7,
      },
      attendeeMatches: [],
    } satisfies CalendarEventContext);
    renderModal();

    expect(await screen.findByText('Roadmap Sync (last week)')).toBeInTheDocument();
    expect(screen.getByText(/Last time —/)).toBeInTheDocument();
    expect(screen.getByText('We agreed to cut the mobile scope…')).toBeInTheDocument();
    expect(screen.getByText('• Send the revised timeline')).toBeInTheDocument();
    expect(screen.getByText('• Book the design review')).toBeInTheDocument();
    expect(screen.getByText('+5 more')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'View that session' }));
    expect(screen.getByTestId('test-location')).toHaveTextContent('/session/meet-3');
  });

  it('last session: no "+N more" when the cap was not reached, and no snippet line when there is none', async () => {
    getCalendarEventContext.mockResolvedValue({
      recordedSession: null,
      lastSeriesSession: {
        meetingId: 'meet-3',
        title: 'Roadmap Sync (last week)',
        endedAt: new Date(2026, 6, 24, 11, 0, 0).toISOString(),
        briefSnippet: null,
        openActionItems: [{ id: 'a1', text: 'Send the revised timeline' }],
        totalOpenActionItems: 1,
      },
      attendeeMatches: [],
    } satisfies CalendarEventContext);
    renderModal();

    expect(await screen.findByText('Roadmap Sync (last week)')).toBeInTheDocument();
    expect(screen.queryByText(/more$/)).toBeNull();
    expect(screen.queryByText('…')).toBeNull();
  });

  it('attendee matches: renders fact-count chips (read-only, no navigation target exists)', async () => {
    getCalendarEventContext.mockResolvedValue({
      ...emptyContext,
      attendeeMatches: [
        { entityId: 'e1', name: 'Ada Lovelace', factCount: 4 },
        { entityId: 'e2', name: 'Grace Hopper', factCount: 1 },
      ],
    } satisfies CalendarEventContext);
    renderModal();

    expect(await screen.findByText('Ada Lovelace · 4 facts')).toBeInTheDocument();
    expect(screen.getByText('Grace Hopper · 1 fact')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ada Lovelace/ })).toBeNull();
  });

  it('empty context: renders one quiet line instead of empty sections', async () => {
    renderModal();
    expect(await screen.findByText('No previous meetings or known attendees yet.')).toBeInTheDocument();
  });

  it('context failure: shows a quiet inline message and still offers recording', async () => {
    getCalendarEventContext.mockRejectedValue(new Error('db down'));
    renderModal();

    expect(await screen.findByText("Couldn't load meeting context.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start recording' })).toBeInTheDocument();
  });

  // --- Prep note (opt-in only) ----------------------------------------------

  it('reads the deterministic context on open but NEVER generates a prep note', async () => {
    renderModal();

    await waitFor(() => expect(getCalendarEventContext).toHaveBeenCalledWith('google:evt-1'));
    expect(await screen.findByRole('button', { name: 'Generate prep note' })).toBeInTheDocument();
    expect(generateCalendarPrepNote).not.toHaveBeenCalled();
  });

  it('prep note: click shows an in-flight state, then renders the note with a Regenerate affordance', async () => {
    const user = userEvent.setup();
    let resolvePrep: (value: { note: string }) => void = () => {};
    generateCalendarPrepNote.mockReturnValue(
      new Promise<{ note: string }>((resolve) => {
        resolvePrep = resolve;
      }),
    );
    renderModal();

    await user.click(await screen.findByRole('button', { name: 'Generate prep note' }));

    // In-flight: the button is disabled and a status line is up.
    const button = screen.getByRole('button', { name: /Generate prep note/ });
    expect(button).toBeDisabled();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(generateCalendarPrepNote).toHaveBeenCalledWith('google:evt-1');

    resolvePrep({ note: 'Ask about the mobile scope cut.\nConfirm the timeline.' });

    expect(await screen.findByTestId('prep-note')).toHaveTextContent('Ask about the mobile scope cut.');
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument();
  });

  it('prep note: a rejection surfaces the thrown message verbatim, inline', async () => {
    const user = userEvent.setup();
    generateCalendarPrepNote.mockRejectedValue(
      new Error(
        "Error invoking remote method 'calendar:generate-prep-note': Error: No AI provider configured for prep notes. Go to Settings to add one.",
      ),
    );
    renderModal();

    await user.click(await screen.findByRole('button', { name: 'Generate prep note' }));

    expect(
      await screen.findByText('No AI provider configured for prep notes. Go to Settings to add one.'),
    ).toBeInTheDocument();
  });

  // --- Dismissal / focus ----------------------------------------------------

  it('Esc closes the modal', async () => {
    renderModal();
    await waitForContext();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the close button closes the modal', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(await screen.findByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('focus moves into the dialog on open and returns to the opener on close', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = renderModal();
    const dialog = await screen.findByTestId('event-details-modal');
    expect(document.activeElement).toBe(dialog);

    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
