// === FILE PURPOSE ===
// Builds the participant roster injected into the brief prompt (BRIEF-QUAL.1
// Task 1) — WHO was in the room, merged from three sources so the model uses
// the user's own spelling instead of guessing names from audio.
//
// === HOW IT WORKS ===
// buildRoster(meetingId) merges, in priority order, the meeting's own typed
// `participants` column, calendar attendee NAMES (never emails — mirrors
// meetingIntelligenceService's buildCalendarContext policy), and PERSON entities
// already linked to OTHER meetings of the same project (most recent first). Names
// are deduped across all three sources by entityService's normalizeEntityName, so
// the SAME person typed once and later seen on a calendar invite collapses to one
// roster entry, with the earliest (highest-priority) source winning.
//
// formatRosterBlock(roster, langName) renders the combined prompt fragment Tasks
// 2/3 splice into the system prompt: the roster instruction (when there are any
// participants) and the "write in <language>" instruction (when langName is
// non-null) — kept together so this is the ONE place either piece of wording
// lives. Returns '' when both are empty, so the English/no-roster path stays
// byte-identical to today's prompt.
//
// === DEPENDENCIES ===
// drizzle-orm, ../db/connection (getDb), ../db/schema (meetings/calendarEvents/
// entities/entityLinks), ./entityService (normalizeEntityName — the SAME dedupe
// key entities.normalized_name uses, so spelling variants collapse everywhere).
//
// === LIMITATIONS ===
// - Calendar/known lookups never throw — a lookup failure just narrows the
//   roster to whatever sources succeeded (same honesty rule as
//   meetingIntelligenceService's calendar hint).
// - "known" people are scoped to the meeting's own project; a meeting with no
//   project runs no query for that source (there is no "other meetings" set).

import { and, desc, eq, ne } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { calendarEvents, entities, entityLinks, meetings } from '../db/schema';
import { normalizeEntityName } from './entityService';
import { createLogger } from './logger';

const log = createLogger('ParticipantRoster');

type Db = ReturnType<typeof getDb>;

/** Total roster entries returned, across all sources combined. */
const ROSTER_CAP = 24;
/** "Known" project-person candidates considered, before merging with the rest. */
const KNOWN_PERSON_CAP = 12;

export type RosterSource = 'participants' | 'calendar' | 'known';

export interface RosterEntry {
  name: string;
  source: RosterSource;
}

/** Attendee NAMES only for a calendar-linked meeting — copies buildCalendarContext's
 *  policy (meetingIntelligenceService.ts:207-226): names never emails, never throws. */
async function loadCalendarAttendeeNames(db: Db, calendarEventId: string | null): Promise<string[]> {
  if (!calendarEventId) return [];
  try {
    const [event] = await db
      .select({ attendees: calendarEvents.attendees })
      .from(calendarEvents)
      .where(eq(calendarEvents.id, calendarEventId))
      .limit(1);
    if (!event) return [];
    return (event.attendees ?? [])
      .map((a) => a.name)
      .filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
  } catch (err) {
    log.error('Calendar attendee lookup failed for roster, event', calendarEventId, ':', err);
    return [];
  }
}

/** PERSON entities linked to OTHER meetings of the same project, most recent
 *  first (by the linked meeting's startedAt), deduped, capped at 12. */
async function loadKnownProjectPersonNames(db: Db, projectId: string, excludeMeetingId: string): Promise<string[]> {
  try {
    const rows = await db
      .select({ name: entities.name, startedAt: meetings.startedAt })
      .from(entityLinks)
      .innerJoin(entities, eq(entityLinks.entityId, entities.id))
      .innerJoin(meetings, eq(entityLinks.meetingId, meetings.id))
      .where(and(eq(entities.kind, 'person'), eq(meetings.projectId, projectId), ne(meetings.id, excludeMeetingId)))
      .orderBy(desc(meetings.startedAt));

    const seen = new Set<string>();
    const names: string[] = [];
    for (const row of rows) {
      const key = normalizeEntityName(row.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      names.push(row.name);
      if (names.length >= KNOWN_PERSON_CAP) break;
    }
    return names;
  } catch (err) {
    log.error('Known-person lookup failed for roster, project', projectId, ':', err);
    return [];
  }
}

/**
 * The participant roster for a meeting's brief prompt: typed participants, then
 * calendar attendees, then known project people — deduped by normalizeEntityName
 * (first source wins), capped at 24 total. Names only, emails never appear.
 */
export async function buildRoster(meetingId: string): Promise<RosterEntry[]> {
  const db = getDb();
  const [meetingRow] = await db
    .select({
      participants: meetings.participants,
      calendarEventId: meetings.calendarEventId,
      projectId: meetings.projectId,
    })
    .from(meetings)
    .where(eq(meetings.id, meetingId))
    .limit(1);
  if (!meetingRow) return [];

  const roster: RosterEntry[] = [];
  const seen = new Set<string>();

  const addAll = (names: string[], source: RosterSource): void => {
    for (const rawName of names) {
      if (roster.length >= ROSTER_CAP) return;
      const name = rawName.trim();
      if (!name) continue;
      const key = normalizeEntityName(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      roster.push({ name, source });
    }
  };

  addAll(meetingRow.participants ?? [], 'participants');
  if (roster.length < ROSTER_CAP) {
    addAll(await loadCalendarAttendeeNames(db, meetingRow.calendarEventId), 'calendar');
  }
  if (roster.length < ROSTER_CAP && meetingRow.projectId) {
    addAll(await loadKnownProjectPersonNames(db, meetingRow.projectId, meetingId), 'known');
  }

  return roster;
}

/**
 * The combined prompt fragment for the roster and the brief-language instruction
 * — kept in ONE function so the wording lives in ONE place. Returns '' when the
 * roster is empty and langName is null, keeping the default (English, no known
 * participants) prompt byte-identical to the pre-BRIEF-QUAL.1 prompt.
 */
export function formatRosterBlock(roster: RosterEntry[], langName: string | null): string {
  const parts: string[] = [];
  if (roster.length > 0) {
    const names = roster.map((entry) => entry.name).join(', ');
    parts.push(
      `Participants (use these exact spellings; a commitment has an owner ONLY when the transcript makes it explicit): ${names}.`,
    );
  }
  if (langName) {
    parts.push(`Write the entire brief in ${langName}.`);
  }
  return parts.join('\n\n');
}
