// === FILE PURPOSE ===
// Series→project association learning (Phase G Task 5). Suggests which project
// a calendar series is "about" by looking at meetings that were previously
// recorded for that same series and already have a projectId. Purely derived
// from `meetings` columns — never touches `calendar_events` — so it keeps
// working even if the provider disconnects and the event cache is purged.
//
// === WHY SERIES-ONLY (not attendee overlap) ===
// Deterministic + explainable. Attendee-set matching is fuzzy and there is no
// persistent email/identity store to match against reliably. Attendee NAMES
// are instead surfaced to the LLM classifier as a hint (see
// projectDetectionService.buildUserPrompt / meetingIntelligenceService) —
// emails never leave the calendar_events cache.
//
// === DEPENDENCIES ===
// drizzle-orm, DB schema (meetings, projects), shared calendar types.

import { eq, and, isNotNull } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { meetings, projects } from '../db/schema';
import type { CalendarProjectSuggestion } from '../../shared/types/calendar';

/** Minimum number of prior linked meetings in a series before suggesting its project. */
export const SERIES_ASSOCIATION_MIN = 2;

export interface SuggestProjectArgs {
  seriesId?: string;
  /** Accepted for interface completeness — series-history is the only basis for now. */
  eventId?: string;
}

/**
 * Suggest a project for a calendar series based on association history.
 *
 * Queries `meetings` rows sharing the given `calendarSeriesId` that already
 * have a `projectId`, groups by project, and returns the top project when it
 * has `>= SERIES_ASSOCIATION_MIN` linked meetings.
 *
 * Deterministic tiebreak on equal counts:
 *   1. Higher count wins.
 *   2. On an exact count tie, the project whose most recent linked meeting is
 *      newest wins (the more recently reinforced association).
 *   3. If still tied (identical counts and identical most-recent timestamp),
 *      the lower projectId (string compare) wins, for a fully stable order.
 *
 * `eventId` is accepted but unused today — see the WHY note above.
 * Returns `null` when there's no seriesId, no history, or the top project is
 * below the threshold.
 */
export async function suggestProject(args: SuggestProjectArgs): Promise<CalendarProjectSuggestion | null> {
  const { seriesId } = args;
  if (!seriesId) return null;

  const db = getDb();
  const rows = await db
    .select({ projectId: meetings.projectId, createdAt: meetings.createdAt })
    .from(meetings)
    .where(and(eq(meetings.calendarSeriesId, seriesId), isNotNull(meetings.projectId)));

  if (rows.length === 0) return null;

  const counts = new Map<string, { count: number; mostRecent: Date }>();
  for (const row of rows) {
    const projectId = row.projectId;
    if (!projectId) continue; // isNotNull already filters this; defensive for TS narrowing
    const existing = counts.get(projectId);
    if (existing) {
      existing.count += 1;
      if (row.createdAt > existing.mostRecent) existing.mostRecent = row.createdAt;
    } else {
      counts.set(projectId, { count: 1, mostRecent: row.createdAt });
    }
  }

  const ranked = Array.from(counts.entries()).sort(([idA, a], [idB, b]) => {
    if (b.count !== a.count) return b.count - a.count;
    const recencyDiff = b.mostRecent.getTime() - a.mostRecent.getTime();
    if (recencyDiff !== 0) return recencyDiff;
    return idA.localeCompare(idB);
  });

  const [topProjectId, top] = ranked[0];
  if (top.count < SERIES_ASSOCIATION_MIN) return null;

  const [project] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, topProjectId));
  if (!project) return null; // project deleted since the meetings were linked

  return { projectId: topProjectId, projectName: project.name, basis: 'series-history' };
}
