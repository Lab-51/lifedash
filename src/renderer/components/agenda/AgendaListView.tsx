// === FILE PURPOSE ===
// The original day-grouped upcoming-meetings list, extracted verbatim out of
// SessionsHome's inline UpcomingAgenda (CAL-UX.2 Task 2) so the agenda header can
// switch between list / week / timeline without any of them growing a giant file.
//
// Markup and behavior are unchanged from CAL-UX.1 — day-group headers, one row per
// event with a "when" label and an explicit Record button — with one addition: the
// row's text block is now a button that opens the event details modal.
//
// NEVER auto-records: Record is an explicit click, exactly as before.

import { Mic } from 'lucide-react';
import type { CalendarEvent } from '../../../shared/types/calendar';
import { startOfDayMs } from './agendaTime';

/** Row-level "when" label — the day lives in the group header above the row. */
function formatEventWhen(startsAt: string): string {
  const d = new Date(startsAt);
  const diffMin = (d.getTime() - Date.now()) / 60000;
  if (diffMin < 0) return 'in progress';
  if (diffMin < 60) return `in ${Math.max(1, Math.round(diffMin))} min`;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Day-group header: Today / Tomorrow / weekday name within the next week, else a
 * short date (the window is 7 days, so the date is a fallback for events sitting
 * exactly on the far edge).
 */
function formatEventDayGroup(startsAt: string): string {
  const d = new Date(startsAt);
  const dayDiff = Math.round((startOfDayMs(d) - startOfDayMs(new Date())) / 86_400_000);
  if (dayDiff <= 0) return 'Today';
  if (dayDiff === 1) return 'Tomorrow';
  if (dayDiff < 7) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** One day bucket of the upcoming-meetings list. */
interface UpcomingDayGroup {
  label: string;
  events: CalendarEvent[];
}

/** Events arrive start-ordered, so consecutive rows sharing a label are one group. */
function groupByDay(events: CalendarEvent[]): UpcomingDayGroup[] {
  const groups: UpcomingDayGroup[] = [];
  for (const ev of events) {
    const label = formatEventDayGroup(ev.startsAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.events.push(ev);
    else groups.push({ label, events: [ev] });
  }
  return groups;
}

interface AgendaListViewProps {
  /** Already filtered + capped by the shell (dismissed and ribbon events removed). */
  events: CalendarEvent[];
  onStart: (event: CalendarEvent) => void;
  onOpenEvent: (event: CalendarEvent) => void;
}

export default function AgendaListView({ events, onStart, onOpenEvent }: AgendaListViewProps) {
  const groups = groupByDay(events);

  return (
    <>
      {groups.map((group) => (
        <div key={group.label}>
          <p className="px-4 py-1.5 border-b border-[var(--color-border)] bg-surface-100/60 dark:bg-surface-900/60 font-hud text-[0.625rem] tracking-widest uppercase text-[var(--color-text-muted)]">
            {group.label}
          </p>
          <ul>
            {group.events.map((ev) => (
              <li
                key={ev.id}
                className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--color-border)] last:border-b-0"
              >
                <button
                  type="button"
                  onClick={() => onOpenEvent(ev)}
                  aria-label={`Open details for ${ev.title}`}
                  className="flex-1 min-w-0 overflow-hidden text-left rounded-md focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-border-accent)]"
                >
                  <p className="text-sm text-[var(--color-text-primary)] truncate">{ev.title}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{formatEventWhen(ev.startsAt)}</p>
                </button>
                <button
                  onClick={() => onStart(ev)}
                  aria-label={`Start recording for ${ev.title}`}
                  className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium
                             bg-[var(--color-accent-muted)] hover:bg-[var(--color-accent-dim)] text-[var(--color-accent)]
                             border border-[var(--color-border-accent)] transition-colors"
                >
                  <Mic size={13} />
                  Record
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}
