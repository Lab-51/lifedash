// @vitest-environment jsdom
// CAL-UX.2 Task 2: the Outlook-style timeline — hour-window fitting, pixel
// positioning by start/duration, the deliberate 2-lane overlap split, and the
// block → onOpenEvent contract shared with the other two agenda surfaces.
//
// Positioning is asserted against the component's own scale (48px per hour, window
// clamped to at least 07:00–20:00), so a 10:00 start sits at (10 - 7) * 48 = 144px.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { CalendarEvent } from '../../../../shared/types/calendar';
import AgendaTimeline from '../AgendaTimeline';

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
    startsAt: at(0, 10),
    endsAt: at(0, 11),
    attendees: [],
    ...overrides,
  };
}

describe('AgendaTimeline (CAL-UX.2)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('positions a 10:00–11:00 event three hour-rows into the default window', () => {
    render(<AgendaTimeline events={[makeEvent()]} onOpenEvent={vi.fn()} />);

    const block = screen.getByTestId('agenda-timeline-event');
    expect(block).toHaveStyle({ top: '144px', height: '48px', left: '0%', width: '100%' });
  });

  it('keeps the minimum 07:00–20:00 window and widens it for an earlier event', () => {
    const { rerender } = render(<AgendaTimeline events={[makeEvent()]} onOpenEvent={vi.fn()} />);
    expect(screen.getByText('07:00')).toBeInTheDocument();
    expect(screen.getByText('19:00')).toBeInTheDocument();
    expect(screen.queryByText('06:00')).toBeNull();

    rerender(
      <AgendaTimeline
        events={[makeEvent({ id: 'early', eventId: 'early', startsAt: at(0, 6, 15), endsAt: at(0, 7) })]}
        onOpenEvent={vi.fn()}
      />,
    );
    expect(screen.getByText('06:00')).toBeInTheDocument();
    // The 06:00 event now sits at the very top of the widened window.
    expect(screen.getByTestId('agenda-timeline-event')).toHaveStyle({ top: '12px' });
  });

  it('splits two overlapping events into two side-by-side lanes', () => {
    render(
      <AgendaTimeline
        events={[
          makeEvent({ id: 'a', eventId: 'a', title: 'Standup', startsAt: at(0, 10), endsAt: at(0, 11) }),
          makeEvent({ id: 'b', eventId: 'b', title: 'Overlap', startsAt: at(0, 10, 30), endsAt: at(0, 11, 30) }),
        ]}
        onOpenEvent={vi.fn()}
      />,
    );

    const [first, second] = screen.getAllByTestId('agenda-timeline-event');
    expect(first).toHaveAttribute('data-lane', '0');
    expect(second).toHaveAttribute('data-lane', '1');
    expect(first).toHaveAttribute('data-lanes', '2');
    expect(second).toHaveAttribute('data-lanes', '2');
    expect(first).toHaveStyle({ left: '0%', width: '50%' });
    expect(second).toHaveStyle({ left: '50%', width: '50%' });
  });

  it('caps at two lanes and offsets the third concurrent event instead of shrinking further', () => {
    render(
      <AgendaTimeline
        events={[
          makeEvent({ id: 'a', eventId: 'a', title: 'A', startsAt: at(0, 10), endsAt: at(0, 11) }),
          makeEvent({ id: 'b', eventId: 'b', title: 'B', startsAt: at(0, 10, 10), endsAt: at(0, 11) }),
          makeEvent({ id: 'c', eventId: 'c', title: 'C', startsAt: at(0, 10, 20), endsAt: at(0, 11) }),
        ]}
        onOpenEvent={vi.fn()}
      />,
    );

    const blocks = screen.getAllByTestId('agenda-timeline-event');
    expect(blocks.map((b) => b.getAttribute('data-lane'))).toEqual(['0', '1', '1']);
    expect(blocks.every((b) => b.getAttribute('data-lanes') === '2')).toBe(true);
    expect(blocks[2]).toHaveStyle({ marginLeft: '6px' });
  });

  it('leaves non-overlapping events full width', () => {
    render(
      <AgendaTimeline
        events={[
          makeEvent({ id: 'a', eventId: 'a', title: 'Morning', startsAt: at(0, 10), endsAt: at(0, 11) }),
          makeEvent({ id: 'b', eventId: 'b', title: 'Afternoon', startsAt: at(0, 14), endsAt: at(0, 15) }),
        ]}
        onOpenEvent={vi.fn()}
      />,
    );

    for (const block of screen.getAllByTestId('agenda-timeline-event')) {
      expect(block).toHaveStyle({ left: '0%', width: '100%' });
    }
  });

  it('fires onOpenEvent with the clicked event', () => {
    const onOpenEvent = vi.fn();
    const event = makeEvent({ title: 'Design Review' });
    render(<AgendaTimeline events={[event]} onOpenEvent={onOpenEvent} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open details for Design Review' }));

    expect(onOpenEvent).toHaveBeenCalledTimes(1);
    expect(onOpenEvent).toHaveBeenCalledWith(event);
  });

  it('draws the now marker once, on today’s column, at the current time', () => {
    render(<AgendaTimeline events={[makeEvent()]} onOpenEvent={vi.fn()} />);

    // 09:00 in a 07:00-based window ⇒ 2 hour-rows down.
    expect(screen.getByTestId('agenda-now-line')).toHaveStyle({ top: '96px' });
  });
});
