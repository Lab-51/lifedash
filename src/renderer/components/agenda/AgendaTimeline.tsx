// === FILE PURPOSE ===
// The Outlook-style timeline agenda surface (CAL-UX.2 Task 2): seven day columns
// sharing one vertical hour axis, with events absolutely positioned by start time
// and duration. Read-only by spec — no drag, no resize, no editing.
//
// === HOUR WINDOW ===
// The visible hour range auto-fits the week's events (floor of the earliest start
// hour .. ceil of the latest end hour) but is always at least 07:00–20:00, so a
// week holding only a 09:00 stand-up still looks like a working day rather than a
// single squashed row.
//
// === NO TIMER (deliberate) ===
// The "now" marker is computed at render time. SessionsHome already re-renders the
// agenda on every `calendar:events-updated` push and on every view switch, which is
// accurate enough for a home-screen glance and costs no interval.

import type { CalendarEvent } from '../../../shared/types/calendar';
import { agendaDays, bucketByDay, dayColumnLabel, formatClock, minutesIntoDay } from './agendaTime';

/** Vertical scale: one hour of wall clock = this many pixels. */
const HOUR_ROW_HEIGHT_PX = 48;
/** Floor for very short meetings so a 5-minute slot stays clickable. */
const MIN_BLOCK_HEIGHT_PX = 16;
/** Minimum visible window — widened (never narrowed) to fit the week's events. */
const DEFAULT_WINDOW_START_HOUR = 7;
const DEFAULT_WINDOW_END_HOUR = 20;
/** Fallback duration for an event whose end is missing/malformed. */
const FALLBACK_DURATION_MIN = 30;
/**
 * LIMIT (deliberate): at most two side-by-side lanes. Two overlapping events split
 * the day column in half. A THIRD concurrent event does NOT shrink the column
 * further — it reuses lane 1 and is nudged right by this many pixels per extra
 * event, so it stays visible as a small stack. A correct N-way layout needs an
 * interval-graph pass, which this compact home-screen surface does not warrant.
 */
const MAX_LANES = 2;
const OVERFLOW_LANE_OFFSET_PX = 6;

/** One event resolved to its box inside a day column. */
interface PositionedEvent {
  event: CalendarEvent;
  topPx: number;
  heightPx: number;
  lane: number;
  laneCount: number;
  /** 0 for the first two concurrent events; 1, 2, ... for the stacked overflow. */
  overflowIndex: number;
}

/**
 * End of the event in minutes from ITS START DAY's midnight. Events running past
 * midnight are clamped to 24:00 (the next day gets its own column anyway).
 */
function endMinutesIntoDay(event: CalendarEvent): number {
  const start = minutesIntoDay(event.startsAt);
  const durationMin = (new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime()) / 60000;
  const usable = Number.isFinite(durationMin) && durationMin > 0 ? durationMin : FALLBACK_DURATION_MIN;
  return Math.min(24 * 60, start + usable);
}

/** Widen the default window until it holds every event in the week. */
function hourWindow(columns: CalendarEvent[][]): { startHour: number; endHour: number } {
  let startHour = DEFAULT_WINDOW_START_HOUR;
  let endHour = DEFAULT_WINDOW_END_HOUR;
  for (const column of columns) {
    for (const event of column) {
      startHour = Math.min(startHour, Math.floor(minutesIntoDay(event.startsAt) / 60));
      endHour = Math.max(endHour, Math.ceil(endMinutesIntoDay(event) / 60));
    }
  }
  return { startHour: Math.max(0, startHour), endHour: Math.min(24, endHour) };
}

/** Greedy lane assignment + pixel positioning for one day column. See MAX_LANES. */
function layoutColumn(events: CalendarEvent[], startHour: number): PositionedEvent[] {
  const windowStartMin = startHour * 60;
  const sorted = [...events].sort((a, b) => minutesIntoDay(a.startsAt) - minutesIntoDay(b.startsAt));
  const spans: { start: number; end: number; lane: number; overflowIndex: number }[] = [];

  for (const event of sorted) {
    const start = minutesIntoDay(event.startsAt);
    const end = endMinutesIntoDay(event);
    const concurrent = spans.filter((s) => s.start < end && start < s.end);
    const used = new Set(concurrent.map((s) => s.lane));
    let lane = 0;
    while (lane < MAX_LANES && used.has(lane)) lane += 1;
    const overflowIndex = lane < MAX_LANES ? 0 : concurrent.length - MAX_LANES + 1;
    spans.push({ start, end, lane: Math.min(lane, MAX_LANES - 1), overflowIndex });
  }

  return sorted.map((event, i) => {
    const span = spans[i];
    const shared = spans.some((other, j) => j !== i && other.start < span.end && span.start < other.end);
    return {
      event,
      topPx: ((span.start - windowStartMin) / 60) * HOUR_ROW_HEIGHT_PX,
      heightPx: Math.max(MIN_BLOCK_HEIGHT_PX, ((span.end - span.start) / 60) * HOUR_ROW_HEIGHT_PX),
      lane: span.lane,
      laneCount: shared ? MAX_LANES : 1,
      overflowIndex: span.overflowIndex,
    };
  });
}

/** Offset of the current time inside the hour window; null when outside it. */
function nowOffsetPx(startHour: number, endHour: number): number | null {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes < startHour * 60 || minutes > endHour * 60) return null;
  return ((minutes - startHour * 60) / 60) * HOUR_ROW_HEIGHT_PX;
}

/** One absolutely-positioned event block. */
function TimelineBlock({
  positioned,
  onOpenEvent,
}: {
  positioned: PositionedEvent;
  onOpenEvent: (event: CalendarEvent) => void;
}) {
  const { event, topPx, heightPx, lane, laneCount, overflowIndex } = positioned;
  return (
    <button
      type="button"
      data-testid="agenda-timeline-event"
      data-lane={lane}
      data-lanes={laneCount}
      onClick={() => onOpenEvent(event)}
      aria-label={`Open details for ${event.title}`}
      style={{
        top: `${topPx}px`,
        height: `${heightPx}px`,
        left: `${(lane * 100) / laneCount}%`,
        width: `${100 / laneCount}%`,
        marginLeft: `${overflowIndex * OVERFLOW_LANE_OFFSET_PX}px`,
      }}
      className="absolute overflow-hidden rounded-[3px] px-1 py-0.5 text-left border
                 border-[var(--color-border-accent)] bg-[var(--color-accent-subtle)]
                 hover:bg-[var(--color-accent-muted)] transition-colors"
    >
      <span className="block font-data text-[0.5625rem] text-[var(--color-text-muted)] truncate">
        {formatClock(event.startsAt)}
      </span>
      <span className="block text-[0.6875rem] text-[var(--color-text-primary)] truncate break-words">
        {event.title}
      </span>
    </button>
  );
}

interface AgendaTimelineProps {
  /** All non-dismissed cached events for the 7-day window (ribbon event included). */
  events: CalendarEvent[];
  onOpenEvent: (event: CalendarEvent) => void;
}

export default function AgendaTimeline({ events, onOpenEvent }: AgendaTimelineProps) {
  const days = agendaDays();
  const columns = bucketByDay(events);
  const { startHour, endHour } = hourWindow(columns);
  const hours = Array.from({ length: Math.max(1, endHour - startHour) }, (_, i) => startHour + i);
  const gridHeightPx = hours.length * HOUR_ROW_HEIGHT_PX;
  const nowTopPx = nowOffsetPx(startHour, endHour);

  return (
    <div className="flex overflow-x-auto" data-testid="agenda-timeline">
      {/* Shared hour axis */}
      <div className="shrink-0 w-10 border-r border-[var(--color-border)]">
        <div className="h-6 border-b border-[var(--color-border)] bg-surface-100/60 dark:bg-surface-900/60" />
        {hours.map((hour) => (
          <div
            key={hour}
            style={{ height: `${HOUR_ROW_HEIGHT_PX}px` }}
            className="pr-1 pt-0.5 text-right font-data text-[0.5625rem] leading-none text-[var(--color-text-muted)]"
          >
            {`${String(hour).padStart(2, '0')}:00`}
          </div>
        ))}
      </div>

      {/* Seven day columns */}
      <div className="grid grid-cols-7 flex-1 min-w-0">
        {days.map((date, index) => (
          <div key={date.getTime()} className="min-w-0 border-r border-[var(--color-border)] last:border-r-0">
            <p className="h-6 px-1 flex items-center border-b border-[var(--color-border)] bg-surface-100/60 dark:bg-surface-900/60 font-hud text-[0.5625rem] tracking-widest uppercase text-[var(--color-text-muted)] truncate">
              {dayColumnLabel(index, date)}
            </p>
            <div className="relative" style={{ height: `${gridHeightPx}px` }}>
              {hours.map((hour) => (
                <div
                  key={hour}
                  style={{ height: `${HOUR_ROW_HEIGHT_PX}px` }}
                  className="border-b border-[var(--color-border)] opacity-40"
                />
              ))}
              {index === 0 && nowTopPx !== null && (
                <div
                  data-testid="agenda-now-line"
                  style={{ top: `${nowTopPx}px` }}
                  className="absolute left-0 right-0 h-px bg-[var(--color-accent)] opacity-70"
                />
              )}
              {layoutColumn(columns[index], startHour).map((positioned) => (
                <TimelineBlock key={positioned.event.id} positioned={positioned} onOpenEvent={onOpenEvent} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
