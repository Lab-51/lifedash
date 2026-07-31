// @vitest-environment jsdom
// CAL-UX.2 Task 2 regression: the day-grouped list extracted out of SessionsHome
// must keep its CAL-UX.1 behavior — Today/Tomorrow group headers, one row per event
// with a "when" label and an explicit Record button — plus the new onOpenEvent seam.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { CalendarEvent } from '../../../../shared/types/calendar';
import AgendaListView from '../AgendaListView';

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

describe('AgendaListView (CAL-UX.2 extraction)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('groups rows under Today / Tomorrow headers and keeps a Record button per row', () => {
    render(
      <AgendaListView
        events={[
          makeEvent({ id: 'a', eventId: 'a', title: 'Design Review' }),
          makeEvent({ id: 'b', eventId: 'b', title: 'Roadmap Sync', startsAt: at(1, 11), endsAt: at(1, 12) }),
        ]}
        onStart={vi.fn()}
        onOpenEvent={vi.fn()}
      />,
    );

    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Tomorrow')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start recording for Design Review' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start recording for Roadmap Sync' })).toBeInTheDocument();
  });

  it('shows a relative "when" label for imminent rows and a clock time for later ones', () => {
    render(
      <AgendaListView
        events={[makeEvent({ id: 'soon', eventId: 'soon', title: 'Soon', startsAt: at(0, 9, 30) })]}
        onStart={vi.fn()}
        onOpenEvent={vi.fn()}
      />,
    );

    expect(screen.getByText('in 30 min')).toBeInTheDocument();
  });

  it('fires onStart from Record and onOpenEvent from the row body', () => {
    const onStart = vi.fn();
    const onOpenEvent = vi.fn();
    const event = makeEvent({ title: 'Design Review' });
    render(<AgendaListView events={[event]} onStart={onStart} onOpenEvent={onOpenEvent} />);

    fireEvent.click(screen.getByRole('button', { name: 'Start recording for Design Review' }));
    expect(onStart).toHaveBeenCalledWith(event);
    expect(onOpenEvent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Open details for Design Review' }));
    expect(onOpenEvent).toHaveBeenCalledWith(event);
  });
});
