// @vitest-environment jsdom
// CAL-UX.2 Task 2: the week board — seven day columns starting today, events
// bucketed into the right column, recurring/imminent badges, and the whole card as
// the single "open details" affordance (no Record button on this surface).
//
// Date is frozen (Date only, like the SessionsHome grouping test) so "today + n"
// arithmetic can never straddle midnight mid-run.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { CalendarEvent } from '../../../../shared/types/calendar';
import AgendaWeekBoard from '../AgendaWeekBoard';

/** Friday 2026-07-31, 09:00 local. */
const NOW = new Date(2026, 6, 31, 9, 0, 0);

function at(dayOffset: number, hour: number, minute = 0): string {
  return new Date(2026, 6, 31 + dayOffset, hour, minute, 0).toISOString();
}

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'google:evt-1',
    provider: 'google',
    eventId: 'evt-1',
    title: 'Team Sync',
    startsAt: at(0, 14),
    endsAt: at(0, 15),
    attendees: [],
    ...overrides,
  };
}

function columns() {
  return screen.getAllByTestId('agenda-week-column');
}

describe('AgendaWeekBoard (CAL-UX.2)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders seven day columns headed Today / Tomorrow / short weekday + date', () => {
    render(<AgendaWeekBoard events={[]} onOpenEvent={vi.fn()} />);

    expect(columns()).toHaveLength(7);
    expect(within(columns()[0]).getByText('Today')).toBeInTheDocument();
    expect(within(columns()[1]).getByText('Tomorrow')).toBeInTheDocument();
    // Day 2 is Sunday 2026-08-02 — a short weekday + day-of-month label.
    expect(within(columns()[2]).getByText(/Sun/)).toBeInTheDocument();
  });

  it('buckets each event into the day column it starts in', () => {
    render(
      <AgendaWeekBoard
        events={[
          makeEvent({ id: 'a', eventId: 'a', title: 'Today Standup', startsAt: at(0, 14), endsAt: at(0, 15) }),
          makeEvent({ id: 'b', eventId: 'b', title: 'Tomorrow Review', startsAt: at(1, 10), endsAt: at(1, 11) }),
          makeEvent({ id: 'c', eventId: 'c', title: 'Late Retro', startsAt: at(4, 11), endsAt: at(4, 12) }),
        ]}
        onOpenEvent={vi.fn()}
      />,
    );

    expect(within(columns()[0]).getByText('Today Standup')).toBeInTheDocument();
    expect(within(columns()[1]).getByText('Tomorrow Review')).toBeInTheDocument();
    expect(within(columns()[4]).getByText('Late Retro')).toBeInTheDocument();
    // No leakage into the wrong column.
    expect(within(columns()[1]).queryByText('Today Standup')).toBeNull();
  });

  it('drops events outside the seven-day window instead of mis-bucketing them', () => {
    render(
      <AgendaWeekBoard
        events={[
          makeEvent({ id: 'far', eventId: 'far', title: 'Next Month', startsAt: at(30, 9), endsAt: at(30, 10) }),
        ]}
        onOpenEvent={vi.fn()}
      />,
    );

    expect(screen.queryByText('Next Month')).toBeNull();
  });

  it('shows the recurring badge for a series event and the imminent dot inside 15 minutes', () => {
    render(
      <AgendaWeekBoard
        events={[
          makeEvent({
            id: 'soon',
            eventId: 'soon',
            title: 'Starting Soon',
            startsAt: at(0, 9, 10),
            endsAt: at(0, 9, 40),
            seriesId: 'series-1',
          }),
          makeEvent({ id: 'later', eventId: 'later', title: 'Much Later', startsAt: at(0, 16), endsAt: at(0, 17) }),
        ]}
        onOpenEvent={vi.fn()}
      />,
    );

    expect(screen.getByTitle('Recurring meeting')).toBeInTheDocument();
    expect(screen.getByTitle('Starts within 15 minutes')).toBeInTheDocument();
    // Exactly one of each — the 16:00 event is neither recurring nor imminent.
    expect(screen.getAllByTitle('Recurring meeting')).toHaveLength(1);
    expect(screen.getAllByTitle('Starts within 15 minutes')).toHaveLength(1);
  });

  it('fires onOpenEvent with the clicked event and offers no Record button', () => {
    const onOpenEvent = vi.fn();
    const event = makeEvent({ id: 'x', eventId: 'x', title: 'Design Review' });
    render(<AgendaWeekBoard events={[event]} onOpenEvent={onOpenEvent} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open details for Design Review' }));

    expect(onOpenEvent).toHaveBeenCalledTimes(1);
    expect(onOpenEvent).toHaveBeenCalledWith(event);
    expect(screen.queryByRole('button', { name: /Start recording/ })).toBeNull();
  });

  it('renders empty columns as header-only (no cards)', () => {
    render(
      <AgendaWeekBoard events={[makeEvent({ id: 'a', eventId: 'a', title: 'Today Standup' })]} onOpenEvent={vi.fn()} />,
    );

    expect(within(columns()[0]).getAllByRole('button')).toHaveLength(1);
    expect(within(columns()[3]).queryAllByRole('button')).toHaveLength(0);
  });
});
