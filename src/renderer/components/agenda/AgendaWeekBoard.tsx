// === FILE PURPOSE ===
// The week board agenda surface (CAL-UX.2 Task 2): seven day columns — Today,
// Tomorrow, then short weekday + date — each holding compact, stacked event cards.
// This is the DEFAULT agenda view (the "see the whole week at a glance" ask).
//
// === ONE INTERACTION PER SURFACE (deliberate) ===
// A card is a single button that opens the event details modal. There is NO Record
// button here: recording stays on the ribbon (one-click, imminent events) and inside
// the modal, so the board never becomes a wall of competing actions — and, as
// everywhere else, recording is never started implicitly.

import { Repeat } from 'lucide-react';
import type { CalendarEvent } from '../../../shared/types/calendar';
import { agendaDays, bucketByDay, dayColumnLabel, formatClock, isImminent } from './agendaTime';

/** One compact event card: start time, optional badges, truncated title. */
function WeekEventCard({ event, onOpenEvent }: { event: CalendarEvent; onOpenEvent: (event: CalendarEvent) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpenEvent(event)}
      aria-label={`Open details for ${event.title}`}
      className="w-full min-w-0 text-left rounded-md px-1.5 py-1 border border-[var(--color-border)]
                 bg-surface-100/70 dark:bg-surface-800/50 hover:border-[var(--color-border-accent)]
                 hover:bg-[var(--color-accent-subtle)] transition-colors overflow-hidden"
    >
      <span className="flex items-center gap-1 font-data text-[0.625rem] text-[var(--color-text-muted)]">
        {isImminent(event.startsAt) && (
          <span title="Starts within 15 minutes" className="text-[var(--color-accent)] leading-none">
            ●
          </span>
        )}
        <span className="truncate">{formatClock(event.startsAt)}</span>
        {event.seriesId && (
          <span title="Recurring meeting" className="ml-auto shrink-0 text-[var(--color-text-muted)] leading-none">
            <Repeat size={10} />
          </span>
        )}
      </span>
      <span className="block text-xs text-[var(--color-text-primary)] truncate break-words">{event.title}</span>
    </button>
  );
}

interface AgendaWeekBoardProps {
  /** All non-dismissed cached events for the 7-day window (ribbon event included). */
  events: CalendarEvent[];
  onOpenEvent: (event: CalendarEvent) => void;
}

export default function AgendaWeekBoard({ events, onOpenEvent }: AgendaWeekBoardProps) {
  const days = agendaDays();
  const columns = bucketByDay(events);

  return (
    <div className="grid grid-cols-7">
      {days.map((date, index) => (
        <div
          key={date.getTime()}
          className="min-w-0 border-r border-[var(--color-border)] last:border-r-0"
          data-testid="agenda-week-column"
        >
          <p className="px-2 py-1.5 border-b border-[var(--color-border)] bg-surface-100/60 dark:bg-surface-900/60 font-hud text-[0.5625rem] tracking-widest uppercase text-[var(--color-text-muted)] truncate">
            {dayColumnLabel(index, date)}
          </p>
          {/* Empty columns stay thin and quiet — header only, no filler. */}
          {columns[index].length > 0 && (
            <div className="p-1 space-y-1">
              {columns[index].map((ev) => (
                <WeekEventCard key={ev.id} event={ev} onOpenEvent={onOpenEvent} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
