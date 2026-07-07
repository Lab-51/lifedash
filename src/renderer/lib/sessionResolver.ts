// === FILE PURPOSE ===
// Pure project/card -> session resolvers (STORY-PROJECTS-IN-SESSION). Projects and
// boards no longer have standalone destinations; every link that used to open
// /projects/:id must instead land inside a SESSION (its Board tab). These helpers
// map a projectId or cardId to the meeting (session) that should host it, using
// data ALREADY loaded in the renderer (meetingStore.meetings + boardStore.allCards),
// so no new IPC is needed. Kept pure (stores passed in, never imported) so they're
// trivially unit-testable and reusable from every link site + the route redirect.

import type { Meeting } from '../../shared/types';

// NOTE: a source-meeting-ACCURATE card→session resolver (open a card in the exact
// session that created it, rather than its project's latest session) would require
// adding `sourceMeetingId` to the lean boardStore.allCards row. Until that field
// exists there is no caller for it, so card links resolve via the project's latest
// session — see projectSessionLink, which CommandPalette/SessionSearch use directly.

/**
 * The meetingId of the most-recent session linked to a project (max startedAt),
 * or null if the project has no sessions. Callers land on `/` (home) when null —
 * never a retired /projects destination.
 */
export function latestSessionForProject(projectId: string, meetings: Meeting[]): string | null {
  let latest: Meeting | null = null;
  for (const m of meetings) {
    if (m.projectId !== projectId) continue;
    if (latest === null || new Date(m.startedAt).getTime() > new Date(latest.startedAt).getTime()) {
      latest = m;
    }
  }
  return latest?.id ?? null;
}

/**
 * Build the in-session Board-tab deep link for a project (optionally opening a card).
 * `viewProject` forces the session's Board tab active and — when the project is NOT
 * the session's own linked project — shows the "Viewing <name>" back-banner. Returns
 * `/` (home) when the project has no session, so no link ever dead-ends on /projects.
 */
export function projectSessionLink(projectId: string, meetings: Meeting[], cardId?: string): string {
  const sessionId = latestSessionForProject(projectId, meetings);
  if (!sessionId) return '/';
  const params = new URLSearchParams({ viewProject: projectId });
  if (cardId) params.set('openCard', cardId);
  return `/session/${sessionId}?${params.toString()}`;
}
