// === FILE PURPOSE ===
// Slim, informational "next meeting" banner shown in Live Mode (Phase G Task 4).
// While a recording is in progress, if a DIFFERENT cached calendar event is about to
// start (within 5 min), this surfaces a one-line heads-up + fires ONE desktop
// notification per event. Cloned from GUARD.1's InactivityBanner seam: self-gating
// (renders nothing when nothing qualifies), so LiveModeOverlay mounts it always.
//
// === SAFETY (load-bearing) ===
// Purely informational — dismiss only, no action buttons. It NEVER starts or stops
// recording (hard privacy floor). The event currently being recorded is excluded so
// the session never warns about itself.
//
// === DEPENDENCIES ===
// window.electronAPI.getUpcomingCalendarEvents / onCalendarEventsUpdated /
// notificationShow (all guarded — the banner no-ops if the calendar API is absent).

import { useEffect, useRef, useState } from 'react';
import { CalendarClock, X } from 'lucide-react';
import type { CalendarEvent } from '../../shared/types/calendar';

/** Show the banner when a different event starts within this many minutes. */
const CONFLICT_WINDOW_MINUTES = 5;
/** Re-evaluate the time window on this cadence (the "n min" countdown + window edge). */
const REEVAL_INTERVAL_MS = 30_000;

/** Minutes until an event start (negative = already started). Module scope so the
 *  Date.now() read is not treated as an impure call during render. */
function minutesUntil(startsAt: string): number {
  return (new Date(startsAt).getTime() - Date.now()) / 60000;
}

interface UpcomingEventBannerProps {
  /** Prefixed calendar id of the event being recorded now — excluded from conflicts. */
  currentCalendarEventId?: string | null;
}

export default function UpcomingEventBanner({ currentCalendarEventId }: UpcomingEventBannerProps) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [, setTick] = useState(0);
  // Renderer-side dedupe: an event id here has already fired its one notification.
  const notifiedIdsRef = useRef<Set<string>>(new Set());

  // Load cached events on mount + on each poller push, and re-evaluate the time
  // window on an interval so the "in n min" edge is respected without a push.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      if (!window.electronAPI.getUpcomingCalendarEvents) return;
      window.electronAPI
        .getUpcomingCalendarEvents(24)
        .then((next) => {
          if (!cancelled) setEvents(next);
        })
        .catch(() => {
          // Non-critical — leave the banner hidden on error.
        });
    };
    refresh();
    const unsubscribe = window.electronAPI.onCalendarEventsUpdated?.(refresh);
    const intervalId = setInterval(() => setTick((t) => t + 1), REEVAL_INTERVAL_MS);
    return () => {
      cancelled = true;
      unsubscribe?.();
      clearInterval(intervalId);
    };
  }, []);

  // The nearest DIFFERENT, non-dismissed event starting within the conflict window.
  // Computed each render (the tick interval above forces re-render so the window edge
  // and the "n min" text stay current); `.find` returns a stable events[] reference,
  // so the notification effect below never re-fires spuriously.
  const conflictEvent = events.find((ev) => {
    if (ev.id === currentCalendarEventId) return false;
    if (dismissedIds.has(ev.id)) return false;
    const diffMin = minutesUntil(ev.startsAt);
    return diffMin >= 0 && diffMin <= CONFLICT_WINDOW_MINUTES;
  });

  // Fire exactly ONE desktop notification per conflicting event.
  useEffect(() => {
    if (!conflictEvent) return;
    if (notifiedIdsRef.current.has(conflictEvent.id)) return;
    notifiedIdsRef.current.add(conflictEvent.id);
    void window.electronAPI.notificationShow?.(
      'Next meeting starting soon',
      `${conflictEvent.title} is about to start`,
    );
  }, [conflictEvent]);

  if (!conflictEvent) return null;

  const minutesLeft = Math.max(0, Math.round(minutesUntil(conflictEvent.startsAt)));

  return (
    <div className="shrink-0 flex items-center gap-3 px-4 py-1.5 text-xs bg-[var(--color-accent-subtle)] border-b border-[var(--color-border-accent)]">
      <CalendarClock size={14} className="shrink-0 text-[var(--color-accent)]" />
      <span aria-live="polite" className="min-w-0 truncate text-[var(--color-text-secondary)]">
        Next: <span className="font-medium text-[var(--color-text-primary)]">{conflictEvent.title}</span>{' '}
        {minutesLeft <= 0 ? 'now' : `in ${minutesLeft} min`}
      </span>
      <button
        type="button"
        onClick={() => setDismissedIds((prev) => new Set(prev).add(conflictEvent.id))}
        aria-label="Dismiss upcoming meeting notice"
        className="ml-auto shrink-0 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  );
}
