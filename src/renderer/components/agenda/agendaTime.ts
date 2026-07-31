// === FILE PURPOSE ===
// Pure time/bucketing helpers shared by the three agenda surfaces (CAL-UX.2 Task 2):
// AgendaListView, AgendaWeekBoard and AgendaTimeline.
//
// === WHY MODULE SCOPE ===
// Every helper that reads the wall clock (`Date.now()` / `new Date()`) lives here, at
// module scope, so component bodies never perform a clock read during render — the
// react-hooks purity rule flags those. Same seam UpcomingEventBanner.tsx uses.

import type { CalendarEvent } from '../../../shared/types/calendar';

/** The agenda spans today + the next 6 days (the shared 7-day lookahead window). */
export const AGENDA_DAY_COUNT = 7;

/**
 * An event is "imminent" when it starts within this many minutes. Mirrors the
 * ribbon's qualification window (`RIBBON_UPCOMING_MINUTES` in SessionsHome.tsx),
 * which stays private so the dependency runs one way: home → agenda, never back.
 */
export const AGENDA_IMMINENT_MINUTES = 15;

/** Midnight-of-day epoch, so day bucketing ignores clock time. */
export function startOfDayMs(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Whole days between today and the event's day (0 = today, 1 = tomorrow, ...). */
export function dayIndexFromToday(startsAt: string): number {
  return Math.round((startOfDayMs(new Date(startsAt)) - startOfDayMs(new Date())) / 86_400_000);
}

/** Minutes until an event starts (negative once it has begun). */
export function minutesUntil(startsAt: string): number {
  return (new Date(startsAt).getTime() - Date.now()) / 60000;
}

/** True while the event is inside the imminent window (about to start, not yet started). */
export function isImminent(startsAt: string): boolean {
  const diff = minutesUntil(startsAt);
  return diff >= 0 && diff <= AGENDA_IMMINENT_MINUTES;
}

/** "09:30" in the user's locale/clock convention. */
export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** The `AGENDA_DAY_COUNT` column dates, starting with today. */
export function agendaDays(): Date[] {
  const today = new Date();
  return Array.from(
    { length: AGENDA_DAY_COUNT },
    (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + i),
  );
}

/** Column header copy: Today / Tomorrow / short weekday + day-of-month. */
export function dayColumnLabel(dayIndex: number, date: Date): string {
  if (dayIndex === 0) return 'Today';
  if (dayIndex === 1) return 'Tomorrow';
  return date.toLocaleDateString([], { weekday: 'short', day: 'numeric' });
}

/**
 * Buckets events into the `AGENDA_DAY_COUNT` day columns starting today. Events
 * outside the window (already past, or beyond day 6) are dropped — the board only
 * ever renders what its columns can hold.
 */
export function bucketByDay(events: CalendarEvent[]): CalendarEvent[][] {
  const columns: CalendarEvent[][] = Array.from({ length: AGENDA_DAY_COUNT }, () => []);
  for (const ev of events) {
    const index = dayIndexFromToday(ev.startsAt);
    if (index >= 0 && index < AGENDA_DAY_COUNT) columns[index].push(ev);
  }
  return columns;
}

/** Minutes since midnight of the event's own day. */
export function minutesIntoDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}
