// === FILE PURPOSE ===
// EventDetailsModal (CAL-UX.2 Task 3) — the Brain-inspector-style detail overlay for
// ONE calendar event. Opened from every agenda surface via the shared onOpenEvent
// contract; Task 4 owns the mount + open state in SessionsHome.
//
// It shows what LifeDash ALREADY KNOWS about the meeting — never calendar prose:
// CalendarEvent carries no body/description/location by design (structural privacy
// policy in shared/types/calendar.ts), so there is nothing here to leak.
//
// Two data reads, both scoped to open:
//   - calendar:get-event-context  — deterministic DB lookups, instant, ZERO model calls.
//   - calendar:suggest-project    — the existing series/event→project association.
// The AI prep note is OPT-IN ONLY: `calendar:generate-prep-note` fires on an explicit
// button click and never on open (asserted in the test file).
//
// OVERLAY BEHAVIOR follows the established pattern: document.body portal (escapes the
// route's stacking contexts, same target as LiveModeOverlay / the standup picker),
// z-[60] backdrop like the other detail modals, backdrop click dismisses, and the
// BrainInspector Esc/focus contract verbatim — focus moves into the panel on open and
// is restored to the opener on close; Esc is ignored while typing and when a nested
// layer already handled it (event.defaultPrevented).
//
// === DEPENDENCIES ===
// react, react-dom (createPortal), react-router-dom (useNavigate), lucide-react,
// window.electronAPI (getCalendarEventContext, suggestCalendarProject,
// generateCalendarPrepNote), shared calendar types

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Loader2, Mic, X } from 'lucide-react';
import type {
  CalendarEvent,
  CalendarEventAttendee,
  CalendarEventContext,
  CalendarProjectSuggestion,
  CalendarProvider,
} from '../../../shared/types/calendar';
import { formatClock } from './agendaTime';

const PROVIDER_LABEL: Record<CalendarProvider, string> = { google: 'Google', microsoft: 'Microsoft' };

const BADGE_CLASS =
  'shrink-0 text-[0.625rem] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--color-accent-subtle)] text-[var(--color-accent)]';

const SECTION_LABEL_CLASS = 'font-hud text-[0.625rem] tracking-widest uppercase text-[var(--color-accent-dim)]';

const QUIET_TEXT_CLASS = 'text-xs text-[var(--color-text-muted)]';

/** "Friday, Jul 31 · 10:00–11:00" — the clock half reuses the agenda's own
 *  `formatClock` so the modal renders times exactly like the row it opened from. */
function formatEventWhen(startsAt: string, endsAt: string): string {
  const day = new Date(startsAt).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  return `${day} · ${formatClock(startsAt)}–${formatClock(endsAt)}`;
}

/** Short day label for a past session ("Jul 24"). */
function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** Attendee NAMES only. Attendee emails are stored locally but never surfaced —
 *  the email's local-part is a fallback ONLY when there is no name at all, and an
 *  attendee with neither is dropped rather than rendered as an empty chip. */
function attendeeLabel(attendee: CalendarEventAttendee): string | null {
  const name = attendee.name?.trim();
  if (name) return name;
  const localPart = attendee.email?.split('@')[0]?.trim();
  return localPart ? localPart : null;
}

/** Electron wraps handler rejections as `Error invoking remote method 'x': Error: <msg>`.
 *  Strip that transport prefix and show the thrown message VERBATIM — including the
 *  no-model rejection, which is the one the user can act on. Never a fabricated note. */
function toDisplayError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const stripped = raw.replace(/^Error invoking remote method '[^']*':\s*/, '').replace(/^Error:\s*/, '');
  return stripped || 'Could not generate a prep note.';
}

type ContextState = { kind: 'loading' } | { kind: 'ready'; context: CalendarEventContext } | { kind: 'error' };

type PrepState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; note: string }
  | { kind: 'error'; message: string };

export interface EventDetailsModalProps {
  event: CalendarEvent;
  /** Dismiss (close button / Esc / backdrop). The host owns the open state. */
  onClose: () => void;
  /** Explicit record request — the host closes this modal and prefills the recorder. */
  onStartRecording: (event: CalendarEvent) => void;
}

// --- Header -----------------------------------------------------------------
function EventHeader({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  return (
    <div className="shrink-0 flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-[var(--color-border)]">
      <div className="min-w-0">
        <h2 id="event-details-title" className="text-base font-semibold text-[var(--color-text-primary)] break-words">
          {event.title}
        </h2>
        <p className={`${QUIET_TEXT_CLASS} mt-1 break-words`} data-testid="event-details-when">
          {formatEventWhen(event.startsAt, event.endsAt)}
        </p>
        <div className="flex items-center gap-1.5 flex-wrap mt-2">
          <span className={BADGE_CLASS}>{PROVIDER_LABEL[event.provider]}</span>
          {event.seriesId && <span className={BADGE_CLASS}>↻ Recurring</span>}
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="shrink-0 p-1.5 rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] transition-colors"
      >
        <X size={16} />
      </button>
    </div>
  );
}

// --- Attendees --------------------------------------------------------------
function AttendeeChips({ attendees }: { attendees: CalendarEventAttendee[] }) {
  const names = attendees.map(attendeeLabel).filter((n): n is string => n !== null);
  if (names.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className={SECTION_LABEL_CLASS}>Attendees</span>
      <div className="flex flex-wrap gap-1.5">
        {names.map((name, index) => (
          <span
            key={`${name}-${index}`}
            className="max-w-full break-words px-2 py-0.5 rounded-md border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)]"
          >
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}

// --- Context: the previous session in this series ---------------------------
type LastSeriesSession = NonNullable<CalendarEventContext['lastSeriesSession']>;

function LastSessionCard({ last, onOpenSession }: { last: LastSeriesSession; onOpenSession: (id: string) => void }) {
  const hiddenCount = last.totalOpenActionItems - last.openActionItems.length;
  return (
    <div className="flex flex-col gap-2 p-3 rounded-lg border border-[var(--color-border)]">
      <span className={SECTION_LABEL_CLASS}>Last time — {formatDay(last.endedAt)}</span>
      <p className="text-sm font-medium text-[var(--color-text-primary)] break-words">{last.title}</p>
      {/* Task 1 truncates the brief at 240 chars WITHOUT an ellipsis — the "…" is
          the renderer's job, and only when a snippet actually exists. */}
      {last.briefSnippet && (
        <p className="text-sm text-[var(--color-text-secondary)] break-words">{last.briefSnippet}…</p>
      )}
      {last.openActionItems.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className={SECTION_LABEL_CLASS}>Still open</span>
          <ul className="flex flex-col gap-1">
            {last.openActionItems.map((item) => (
              <li key={item.id} className="text-xs text-[var(--color-text-secondary)] break-words">
                • {item.text}
              </li>
            ))}
          </ul>
          {hiddenCount > 0 && <span className={QUIET_TEXT_CLASS}>+{hiddenCount} more</span>}
        </div>
      )}
      <button
        type="button"
        onClick={() => onOpenSession(last.meetingId)}
        className="self-start text-xs font-medium text-[var(--color-accent)] hover:underline"
      >
        View that session
      </button>
    </div>
  );
}

// --- Context: attendees LifeDash already knows -------------------------------
// NON-NAVIGATING BY DESIGN: person/topic entities have no destination outside the
// Brain canvas — resolveBrainOpenTarget maps them to { kind: 'none' } and there is
// no route/deep-link that opens the Brain at an entity. A chip that went nowhere (or
// an invented navigation hack) would be worse than an honest read-only chip.
function AttendeeMatchChips({ matches }: { matches: CalendarEventContext['attendeeMatches'] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={SECTION_LABEL_CLASS}>People you know</span>
      <div className="flex flex-wrap gap-1.5">
        {matches.map((match) => (
          <span
            key={match.entityId}
            className="max-w-full break-words px-2 py-0.5 rounded-md border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)]"
          >
            {match.name} · {match.factCount} fact{match.factCount === 1 ? '' : 's'}
          </span>
        ))}
      </div>
    </div>
  );
}

function ContextSection({ state, onOpenSession }: { state: ContextState; onOpenSession: (id: string) => void }) {
  if (state.kind === 'loading') {
    return (
      <p role="status" className={`${QUIET_TEXT_CLASS} animate-pulse`}>
        Loading meeting context…
      </p>
    );
  }
  if (state.kind === 'error') {
    return <p className={QUIET_TEXT_CLASS}>Couldn&apos;t load meeting context.</p>;
  }
  const { lastSeriesSession, attendeeMatches } = state.context;
  if (!lastSeriesSession && attendeeMatches.length === 0) {
    return <p className={QUIET_TEXT_CLASS}>No previous meetings or known attendees yet.</p>;
  }
  return (
    <>
      {lastSeriesSession && <LastSessionCard last={lastSeriesSession} onOpenSession={onOpenSession} />}
      {attendeeMatches.length > 0 && <AttendeeMatchChips matches={attendeeMatches} />}
    </>
  );
}

// --- Opt-in prep note --------------------------------------------------------
function PrepNoteSection({ state, onGenerate }: { state: PrepState; onGenerate: () => void }) {
  return (
    <div className="flex flex-col gap-2 pt-3 border-t border-[var(--color-border)]">
      <button
        type="button"
        onClick={onGenerate}
        disabled={state.kind === 'loading'}
        className="self-start inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-accent)] hover:underline disabled:opacity-60 disabled:cursor-not-allowed disabled:no-underline"
      >
        {state.kind === 'loading' && <Loader2 size={13} className="animate-spin" />}
        {state.kind === 'ready' ? 'Regenerate' : 'Generate prep note'}
      </button>
      {state.kind === 'loading' && (
        <p role="status" className={QUIET_TEXT_CLASS}>
          Writing your prep note — this can take a moment on a local model.
        </p>
      )}
      {state.kind === 'ready' && (
        <div
          data-testid="prep-note"
          className="p-3 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap break-words overflow-hidden"
        >
          {state.note}
        </div>
      )}
      {state.kind === 'error' && <p className="text-xs text-red-400 break-words">{state.message}</p>}
    </div>
  );
}

// --- Shell -------------------------------------------------------------------
export default function EventDetailsModal({ event, onClose, onStartRecording }: EventDetailsModalProps) {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [contextState, setContextState] = useState<ContextState>({ kind: 'loading' });
  const [suggestion, setSuggestion] = useState<CalendarProjectSuggestion | null>(null);
  const [prepState, setPrepState] = useState<PrepState>({ kind: 'idle' });

  // Focus in on open, restore to the opener (the agenda row/card) on close — the
  // BrainInspector contract, so keyboard users are never dumped to the document top.
  useEffect(() => {
    const prevFocused = document.activeElement as HTMLElement | null;
    containerRef.current?.focus();
    return () => prevFocused?.focus?.();
  }, []);

  // Esc dismisses — skipped while typing, and when a nested layer already handled it
  // (defaultPrevented), so the topmost layer is always the one that closes.
  useEffect(() => {
    const onKey = (keyEvent: KeyboardEvent): void => {
      if (keyEvent.key !== 'Escape' || keyEvent.defaultPrevented) return;
      const target = keyEvent.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Deterministic context on open (instant, zero model calls). A failure is quiet and
  // inline — the modal still records, links and closes.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const context = await window.electronAPI.getCalendarEventContext(event.id);
        if (!cancelled) setContextState({ kind: 'ready', context });
      } catch {
        if (!cancelled) setContextState({ kind: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [event.id]);

  // Project association — the same series/event inputs RecordingControls prefills with.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await window.electronAPI.suggestCalendarProject({
          seriesId: event.seriesId,
          eventId: event.eventId,
        });
        if (!cancelled) setSuggestion(result);
      } catch {
        // Quiet by design: with no suggestion the line is simply absent.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [event.seriesId, event.eventId]);

  const openSession = (meetingId: string): void => {
    onClose();
    void navigate(`/session/${meetingId}`);
  };

  const handleGeneratePrepNote = async (): Promise<void> => {
    setPrepState({ kind: 'loading' });
    try {
      const { note } = await window.electronAPI.generateCalendarPrepNote(event.id);
      setPrepState({ kind: 'ready', note });
    } catch (error) {
      setPrepState({ kind: 'error', message: toDisplayError(error) });
    }
  };

  const recordedSession = contextState.kind === 'ready' ? contextState.context.recordedSession : null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-[2px]"
      onClick={(clickEvent) => {
        if (clickEvent.target === clickEvent.currentTarget) onClose();
      }}
    >
      <div
        ref={containerRef}
        data-testid="event-details-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-details-title"
        tabIndex={-1}
        className="w-full max-w-lg mx-4 max-h-[80vh] flex flex-col rounded-xl bg-[var(--color-chrome)] border border-[var(--color-border)] shadow-2xl outline-none overflow-hidden"
      >
        <EventHeader event={event} onClose={onClose} />

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          <AttendeeChips attendees={event.attendees} />

          {suggestion && (
            <p className={`${QUIET_TEXT_CLASS} break-words`}>Suggested project: {suggestion.projectName}</p>
          )}

          {/* Primary action waits for the (instant) context so it never flips from
              "Start recording" to "View session" under the user's cursor. An errored
              context still offers recording — a lookup failure must never block it. */}
          {contextState.kind !== 'loading' && (
            <div>
              {recordedSession ? (
                <button
                  type="button"
                  onClick={() => openSession(recordedSession.meetingId)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--color-accent-muted)] hover:bg-[var(--color-accent-dim)] text-[var(--color-accent)] border border-[var(--color-border-accent)] transition-colors"
                >
                  View session
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onStartRecording(event)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--color-accent-muted)] hover:bg-[var(--color-accent-dim)] text-[var(--color-accent)] border border-[var(--color-border-accent)] transition-colors"
                >
                  <Mic size={13} />
                  Start recording
                </button>
              )}
            </div>
          )}

          <ContextSection state={contextState} onOpenSession={openSession} />

          <PrepNoteSection state={prepState} onGenerate={() => void handleGeneratePrepNote()} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
