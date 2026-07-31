// @vitest-environment jsdom
// Phase G Task 4: the Live Mode conflict banner. It surfaces ONLY a DIFFERENT cached
// event starting within 5 min (never the event being recorded), fires exactly one
// desktop notification per event, and is dismissible. It never records.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import type { CalendarEvent } from '../../../shared/types/calendar';

const getUpcomingCalendarEvents = vi.fn().mockResolvedValue([]);
const onCalendarEventsUpdated = vi.fn().mockReturnValue(() => {});
const notificationShow = vi.fn().mockResolvedValue(undefined);

vi.stubGlobal('electronAPI', { getUpcomingCalendarEvents, onCalendarEventsUpdated, notificationShow });

const { default: UpcomingEventBanner } = await import('../UpcomingEventBanner');

const makeEvent = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'google:next',
  provider: 'google',
  eventId: 'next',
  title: 'Next Meeting',
  startsAt: new Date(Date.now() + 3 * 60_000).toISOString(),
  endsAt: new Date(Date.now() + 33 * 60_000).toISOString(),
  attendees: [],
  ...overrides,
});

describe('UpcomingEventBanner — Live Mode conflict banner (Phase G Task 4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUpcomingCalendarEvents.mockResolvedValue([]);
    onCalendarEventsUpdated.mockReturnValue(() => {});
  });

  it('shows a heads-up for a DIFFERENT event starting within 5 min', async () => {
    getUpcomingCalendarEvents.mockResolvedValue([makeEvent()]);
    render(<UpcomingEventBanner currentCalendarEventId="google:current" />);
    await waitFor(() => expect(screen.getByText(/Next Meeting/)).toBeInTheDocument());
  });

  it('does NOT show the event currently being recorded', async () => {
    getUpcomingCalendarEvents.mockResolvedValue([makeEvent({ id: 'google:current' })]);
    render(<UpcomingEventBanner currentCalendarEventId="google:current" />);
    await waitFor(() => expect(getUpcomingCalendarEvents).toHaveBeenCalled());
    expect(screen.queryByText(/Next Meeting/)).toBeNull();
  });

  it('does NOT show an event that is more than 5 min away', async () => {
    getUpcomingCalendarEvents.mockResolvedValue([
      makeEvent({ startsAt: new Date(Date.now() + 20 * 60_000).toISOString() }),
    ]);
    render(<UpcomingEventBanner currentCalendarEventId="google:current" />);
    await waitFor(() => expect(getUpcomingCalendarEvents).toHaveBeenCalled());
    expect(screen.queryByText(/Next Meeting/)).toBeNull();
  });

  it('fires exactly one desktop notification for the conflicting event', async () => {
    getUpcomingCalendarEvents.mockResolvedValue([makeEvent()]);
    render(<UpcomingEventBanner currentCalendarEventId="google:current" />);
    await waitFor(() => expect(notificationShow).toHaveBeenCalledTimes(1));
    expect(notificationShow).toHaveBeenCalledWith(
      'Next meeting starting soon',
      expect.stringContaining('Next Meeting'),
    );
  });

  it('can be dismissed', async () => {
    const user = userEvent.setup();
    getUpcomingCalendarEvents.mockResolvedValue([makeEvent()]);
    render(<UpcomingEventBanner currentCalendarEventId="google:current" />);
    await waitFor(() => expect(screen.getByText(/Next Meeting/)).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Dismiss upcoming meeting notice' }));
    expect(screen.queryByText(/Next Meeting/)).toBeNull();
  });
});
