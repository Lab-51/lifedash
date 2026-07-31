// === FILE PURPOSE ===
// Cross-meeting context for ONE calendar event (CAL-UX.2 Task 1) — what LifeDash
// already knows about an upcoming meeting, plus the opt-in prep note.
//
// TWO tiers, deliberately separated:
//   1. getEventContext(eventId) — DETERMINISTIC DB queries only, ZERO model calls.
//      Runs on every modal open, so it must be instant: recorded session for THIS
//      event, the previous COMPLETED session of the same series (brief snippet +
//      open action items), and attendees matched to known person entities.
//   2. generatePrepNote(eventId) — ONLY on an explicit user click. Feeds the SAME
//      context bundle PLUS the event's own description (CAL-UX.2b; no transcript,
//      budget-capped) through the app's per-task model routing + the twin domain's
//      validate-retry-skip pipeline, and caches the result per event for the session
//      so re-opening never re-generates. Attendee EMAILS never enter the prompt.
//
// === HONESTY RULES ===
// - An unknown/uncached eventId yields an EMPTY context — never an exception, and
//   never invented content.
// - Open action items are capped at 5 but `totalOpenActionItems` reports the real
//   number, so the UI's "+N more" is truthful.
// - Attendee↔person matching is CONSERVATIVE: exact match on the same normalized
//   name key the entities table dedupes on (trim + case-fold). No fuzzy matching —
//   a wrong person is worse than no person.
// - No model configured ⇒ the prep note REJECTS with NO_MODEL_ERROR_MESSAGE (the
//   app's convention for user-initiated AI actions), never a fabricated note.
//
// === DEPENDENCIES ===
// drizzle-orm, zod, db/connection (getDb), db/schema (calendarEvents/meetings/
// meetingBriefs/actionItems/entities/entityFacts), ai-provider (resolveTaskModel),
// twinResearchService (generateValidated), entityService (normalizeEntityName —
// reused so the match key can never drift from entities.normalized_name), shared
// calendar types.

import { and, asc, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/connection';
import { actionItems, calendarEvents, entities, entityFacts, meetingBriefs, meetings } from '../db/schema';
import { createLogger } from './logger';
import { resolveTaskModel } from './ai-provider';
import { generateValidated } from './twinResearchService';
import { normalizeEntityName } from './entityService';
import type { CalendarEventAttendee, CalendarEventContext } from '../../shared/types/calendar';

const log = createLogger('CalendarContext');

type Db = ReturnType<typeof getDb>;

/** Plain-text brief excerpt length (hard cut, no ellipsis — the UI adds its own). */
const BRIEF_SNIPPET_CHARS = 240;
/** Action items shown; `totalOpenActionItems` still reports the honest full count. */
const OPEN_ACTION_ITEM_CAP = 5;
/** Attendee↔person matches returned. */
const ATTENDEE_MATCH_CAP = 6;
/** Facts per matched person fed to the prep prompt (context stays compact). */
const FACTS_PER_ATTENDEE = 3;
/** Share of the prep prompt the event's own description may occupy (CAL-UX.2b). */
const PREP_DESCRIPTION_CHARS = 1000;
/** Whole prep-prompt context budget (~1k tokens) — no transcript ever enters it.
 *  Applied LAST, so the description competes inside the same envelope. */
const PREP_CONTEXT_CHAR_BUDGET = 4000;
/** Hard cap on the returned note. */
const PREP_NOTE_MAX_CHARS = 1200;

/** "Open" = not dismissed and not already converted to a card — the same definition
 *  dashboard.ts / meetingPrepService.ts use for outstanding work. */
const OPEN_ACTION_ITEM_STATUSES = ['pending', 'approved'] as const;

/**
 * The user-facing error `calendar:generate-prep-note` rejects with when no model is
 * configured — same convention (and wording shape) as entityFactService's
 * NO_MODEL_ERROR_MESSAGE. An honest failure, never a fake note.
 */
export const NO_MODEL_ERROR_MESSAGE = 'No AI provider configured for prep notes. Go to Settings to add one.';

/** Rejection when the model ran but produced nothing usable (after the pipeline's retry). */
export const PREP_NOTE_FAILED_MESSAGE = 'The model returned no usable prep note. Try again.';

/** Rejection when the event is not in the local cache (agenda is stale). */
export const EVENT_NOT_CACHED_MESSAGE = 'That calendar event is no longer cached. Refresh the agenda and try again.';

function emptyContext(): CalendarEventContext {
  return { recordedSession: null, lastSeriesSession: null, attendeeMatches: [] };
}

// ---------------------------------------------------------------------------
// Deterministic lookups (NO model calls anywhere below)
// ---------------------------------------------------------------------------

interface CachedEvent {
  title: string;
  startsAt: Date;
  endsAt: Date;
  attendees: CalendarEventAttendee[];
  seriesId: string | null;
  /** Plain-texted event description (CAL-UX.2b) — prep-note input only; getEventContext
   *  never returns it (the renderer already holds it on the CalendarEvent). */
  description: string | null;
}

/** The cached calendar row (the only source of seriesId + attendees), or null. */
async function loadCachedEvent(db: Db, eventId: string): Promise<CachedEvent | null> {
  const [row] = await db
    .select({
      title: calendarEvents.title,
      startsAt: calendarEvents.startsAt,
      endsAt: calendarEvents.endsAt,
      attendees: calendarEvents.attendees,
      seriesId: calendarEvents.seriesId,
      description: calendarEvents.description,
    })
    .from(calendarEvents)
    .where(eq(calendarEvents.id, eventId))
    .limit(1);
  return row ?? null;
}

/** The session recorded FOR this exact event (newest wins if several ever linked). */
async function loadRecordedSession(db: Db, eventId: string): Promise<{ meetingId: string; title: string } | null> {
  const [row] = await db
    .select({ id: meetings.id, title: meetings.title })
    .from(meetings)
    .where(eq(meetings.calendarEventId, eventId))
    .orderBy(desc(meetings.startedAt))
    .limit(1);
  return row ? { meetingId: row.id, title: row.title } : null;
}

/**
 * Reduce a brief (markdown) to a plain-text snippet. Minimal stripping only —
 * headings, bold markers, list bullets and code ticks — because the goal is a
 * readable one-liner, not a markdown renderer. Returns null for an empty brief.
 */
export function toBriefSnippet(markdown: string): string | null {
  const text = markdown
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/`+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return text.slice(0, BRIEF_SNIPPET_CHARS);
}

/** Newest brief for a session, plain-texted and truncated; null when it has none. */
async function loadBriefSnippet(db: Db, meetingId: string): Promise<string | null> {
  const [row] = await db
    .select({ summary: meetingBriefs.summary })
    .from(meetingBriefs)
    .where(eq(meetingBriefs.meetingId, meetingId))
    .orderBy(desc(meetingBriefs.createdAt))
    .limit(1);
  return row ? toBriefSnippet(row.summary) : null;
}

/** Open action items (capped) plus the honest total for the UI's "+N more". */
async function loadOpenActionItems(
  db: Db,
  meetingId: string,
): Promise<{ items: { id: string; text: string }[]; total: number }> {
  const rows = await db
    .select({ id: actionItems.id, description: actionItems.description })
    .from(actionItems)
    .where(and(eq(actionItems.meetingId, meetingId), inArray(actionItems.status, [...OPEN_ACTION_ITEM_STATUSES])))
    .orderBy(asc(actionItems.createdAt));
  return {
    items: rows.slice(0, OPEN_ACTION_ITEM_CAP).map((r) => ({ id: r.id, text: r.description })),
    total: rows.length,
  };
}

/**
 * The previous COMPLETED session of the same series, excluding the session already
 * recorded for THIS event (self-exclusion by meeting id — `calendarEventId` may be
 * NULL on sibling rows, where a `!=` comparison would silently drop them).
 * Ordered by end time, falling back to start time so a completed-but-unstamped
 * session still sorts sanely (a plain `DESC` would sort its NULL first).
 */
async function loadLastSeriesSession(
  db: Db,
  seriesId: string,
  excludeMeetingId: string | null,
): Promise<CalendarEventContext['lastSeriesSession']> {
  const [row] = await db
    .select({
      id: meetings.id,
      title: meetings.title,
      startedAt: meetings.startedAt,
      endedAt: meetings.endedAt,
    })
    .from(meetings)
    .where(
      and(
        eq(meetings.calendarSeriesId, seriesId),
        eq(meetings.status, 'completed'),
        excludeMeetingId ? ne(meetings.id, excludeMeetingId) : undefined,
      ),
    )
    .orderBy(sql`coalesce(${meetings.endedAt}, ${meetings.startedAt}) desc`)
    .limit(1);
  if (!row) return null;

  const briefSnippet = await loadBriefSnippet(db, row.id);
  const { items, total } = await loadOpenActionItems(db, row.id);
  return {
    meetingId: row.id,
    title: row.title,
    endedAt: (row.endedAt ?? row.startedAt).toISOString(),
    briefSnippet,
    openActionItems: items,
    totalOpenActionItems: total,
  };
}

/** Distinct normalized attendee names, in the order the provider listed them. */
function attendeeNameKeys(attendees: CalendarEventAttendee[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const attendee of attendees ?? []) {
    const key = normalizeEntityName(attendee.name ?? '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

/**
 * Attendees that are already known PERSON entities, with their fact counts.
 * Exact match on `entities.normalized_name` (the table's own dedupe key) — an
 * attendee named "Ann" never matches the entity "Anna Kowalski".
 */
async function loadAttendeeMatches(
  db: Db,
  attendees: CalendarEventAttendee[],
): Promise<CalendarEventContext['attendeeMatches']> {
  const keys = attendeeNameKeys(attendees);
  if (keys.length === 0) return [];

  const rows = await db
    .select({
      id: entities.id,
      name: entities.name,
      normalizedName: entities.normalizedName,
      factCount: count(entityFacts.id),
    })
    .from(entities)
    .leftJoin(entityFacts, eq(entityFacts.entityId, entities.id))
    .where(and(eq(entities.kind, 'person'), inArray(entities.normalizedName, keys)))
    .groupBy(entities.id, entities.name, entities.normalizedName);

  const byKey = new Map(rows.map((r) => [r.normalizedName, r]));
  return keys
    .map((key) => byKey.get(key))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .slice(0, ATTENDEE_MATCH_CAP)
    .map((row) => ({ entityId: row.id, name: row.name, factCount: Number(row.factCount) }));
}

/**
 * Everything LifeDash knows about one event. Pure DB reads — instant, no model.
 * An unknown eventId returns the empty context instead of throwing: the agenda can
 * legitimately be a poll behind the cache.
 */
export async function getEventContext(eventId: string): Promise<CalendarEventContext> {
  const db = getDb();
  const event = await loadCachedEvent(db, eventId);
  if (!event) return emptyContext();

  const recordedSession = await loadRecordedSession(db, eventId);
  const lastSeriesSession = event.seriesId
    ? await loadLastSeriesSession(db, event.seriesId, recordedSession?.meetingId ?? null)
    : null;
  const attendeeMatches = await loadAttendeeMatches(db, event.attendees);

  return { recordedSession, lastSeriesSession, attendeeMatches };
}

// ---------------------------------------------------------------------------
// Prep note (on-demand only — the ONLY model call in this service)
// ---------------------------------------------------------------------------

const PREP_SYSTEM = `You write a SHORT prep note for a professional about to join a meeting.
Rules:
- Use ONLY the context provided below. Never invent attendees, decisions, commitments or dates.
- Lead with what is unresolved: open action items from last time, then what to follow up on.
- Mention a person only if they appear in the context, and only what the context says about them.
- If the context is thin, say so in one line instead of padding.
- At most 6 short lines, no headings, no markdown formatting, no greeting, no sign-off.
Respond with ONLY the JSON described below — no prose, no markdown code fences.`;

const PREP_OUTPUT_SPEC = 'a JSON object { "note": string } whose note is plain text of at most 6 short lines.';

/** Validates the model's output (retry-then-fail via generateValidated). */
export const prepNoteSchema = z.object({ note: z.string().min(1) });

/** Session-lifetime cache: re-opening an event must not re-run the model. */
const prepNoteCache = new Map<string, string>();

/** Test seam / future invalidation hook — drops every cached note. */
export function clearPrepNoteCache(): void {
  prepNoteCache.clear();
}

/** A few facts per matched attendee — the only extra read the prep note needs. */
async function loadAttendeeFactLines(db: Db, matches: CalendarEventContext['attendeeMatches']): Promise<string[]> {
  const lines: string[] = [];
  for (const match of matches) {
    if (match.factCount === 0) continue;
    const rows = await db
      .select({ content: entityFacts.content })
      .from(entityFacts)
      .where(eq(entityFacts.entityId, match.entityId))
      .orderBy(desc(entityFacts.createdAt))
      .limit(FACTS_PER_ATTENDEE);
    for (const row of rows) lines.push(`- ${match.name}: ${row.content.trim()}`);
  }
  return lines;
}

/** The compact prompt context. Event description + brief snippet + open items +
 *  attendee facts only — NEVER transcript content and NEVER attendee emails, and
 *  hard-capped so a long description or history cannot blow the call. */
function buildPrepContext(event: CachedEvent, context: CalendarEventContext, factLines: string[]): string {
  const blocks: string[] = [
    `Upcoming meeting: "${event.title}" on ${event.startsAt.toISOString()} (ends ${event.endsAt.toISOString()}).`,
  ];

  // The organizer's own agenda text, clearly labeled so the model treats it as given
  // material rather than something it inferred. Sliced before the overall budget.
  const description = event.description?.trim();
  if (description) {
    blocks.push(`Event description (written by the organizer):\n${description.slice(0, PREP_DESCRIPTION_CHARS)}`);
  }

  const last = context.lastSeriesSession;
  if (last) {
    blocks.push(`Last session of this series ("${last.title}", ended ${last.endedAt}).`);
    if (last.briefSnippet) blocks.push(`Brief from last time:\n${last.briefSnippet}`);
    if (last.openActionItems.length > 0) {
      const shown = last.openActionItems.map((i) => `- ${i.text}`).join('\n');
      const hidden = last.totalOpenActionItems - last.openActionItems.length;
      blocks.push(
        `Open action items (${last.totalOpenActionItems} total${hidden > 0 ? `, ${hidden} not shown` : ''}):\n${shown}`,
      );
    }
  } else {
    blocks.push('No previous session of this series has been recorded.');
  }

  if (factLines.length > 0) blocks.push(`What is known about the attendees:\n${factLines.join('\n')}`);
  else if (context.attendeeMatches.length === 0) blocks.push('No attendee is a known contact yet.');

  return blocks.join('\n\n').slice(0, PREP_CONTEXT_CHAR_BUDGET);
}

/**
 * Generate (or replay) the prep note for one event. Cached per eventId for the
 * process lifetime, so the SECOND call for the same event costs no model call at
 * all — the cache is checked before the model is even resolved.
 *
 * Rejects honestly rather than fabricating: {@link NO_MODEL_ERROR_MESSAGE} when no
 * model is configured, {@link EVENT_NOT_CACHED_MESSAGE} for an unknown event, and
 * {@link PREP_NOTE_FAILED_MESSAGE} when the model produced nothing usable.
 */
export async function generatePrepNote(eventId: string): Promise<string> {
  const cached = prepNoteCache.get(eventId);
  if (cached) return cached;

  const provider = await resolveTaskModel('meeting_prep');
  if (!provider) throw new Error(NO_MODEL_ERROR_MESSAGE);

  const db = getDb();
  const event = await loadCachedEvent(db, eventId);
  if (!event) throw new Error(EVENT_NOT_CACHED_MESSAGE);

  const context = await getEventContext(eventId);
  const factLines = await loadAttendeeFactLines(db, context.attendeeMatches);

  const parsed = await generateValidated({
    provider,
    taskType: 'meeting_prep',
    system: `${PREP_SYSTEM}\n\nReturn ${PREP_OUTPUT_SPEC}`,
    context: buildPrepContext(event, context, factLines),
    schema: prepNoteSchema,
    label: `Calendar prep note (${eventId})`,
  });

  const note = (parsed as { note: string } | null)?.note.trim().slice(0, PREP_NOTE_MAX_CHARS) ?? '';
  if (!note) throw new Error(PREP_NOTE_FAILED_MESSAGE);

  prepNoteCache.set(eventId, note);
  log.info(`Prep note generated for ${eventId} (${note.length} chars)`);
  return note;
}
