// === FILE PURPOSE ===
// Live suggestion lifecycle (LIVE.2 Task 2) — accept/dismiss/list for the
// proactive-triage proposals persisted by liveTriageService.
//
// Accepting an 'action_item' creates a card via the EXISTING live-assistant card
// rail (meetingAgentService.createLiveAssistantCard — source='live-assistant',
// sourceMeetingId, Unassigned fallback). Accepting a 'decision'/'question' sets
// status only — those become brief context (see meetingIntelligenceService.ts),
// never cards. Accepting a 'project' (LIVE.3) creates the proposed project and
// links the meeting to it via meetingService.updateMeeting. This split is
// load-bearing: conflating them would either skip card creation for real action
// items or spam the board with decision/question cards nobody asked for.
//
// === DEPENDENCIES ===
// drizzle-orm, meetingAgentService (createLiveAssistantCard — reused, not
// reimplemented), projectService (createProjectRecord — shared creation path),
// meetingService (updateMeeting — reused null→project link + auto-push),
// Task 1's live_suggestions schema + shared types.

import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { liveSuggestions } from '../db/schema';
import { createLiveAssistantCard } from './meetingAgentService';
import { createProjectRecord } from './projectService';
import { getMeeting, updateMeeting } from './meetingService';
import type { LiveSuggestion } from '../../shared/types';

type DB = ReturnType<typeof getDb>;

function toLiveSuggestion(row: typeof liveSuggestions.$inferSelect): LiveSuggestion {
  return {
    id: row.id,
    meetingId: row.meetingId,
    type: row.type,
    title: row.title,
    description: row.description,
    status: row.status,
    acceptedCardId: row.acceptedCardId,
    acceptedProjectId: row.acceptedProjectId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Accept a 'project' suggestion: create the proposed project via the shared
 * creation path, then LINK the meeting to it with meetingService.updateMeeting.
 * updateMeeting is REUSED (not reimplemented) because it already handles the
 * null→project transition INCLUDING auto-pushing the meeting's pending action
 * items into the new project's Inbox. Returns the project's id (stored in
 * acceptedProjectId for provenance). Future accepted action_item chips then route
 * into this project via the existing createLiveAssistantCard rail.
 *
 * BUG 1 GUARD (mirrors meetingAgentService.createProject): re-read the meeting
 * AFTER the atomic claim. If it is ALREADY linked to a project — e.g. a stale
 * 'proposed' chip survived into the post-meeting modal, the user linked the
 * meeting via the dropdown, THEN tapped Create — do NOT create a new project or
 * overwrite the existing link. Return the EXISTING projectId as a benign no-op
 * (provenance points at the project the meeting already has). Only an unlinked
 * meeting creates + links a new project.
 */
async function acceptProjectSuggestion(db: DB, row: typeof liveSuggestions.$inferSelect): Promise<string> {
  const meeting = await getMeeting(row.meetingId);
  if (meeting?.projectId) return meeting.projectId;

  const project = await createProjectRecord(db, {
    name: row.title,
    description: row.description ?? undefined,
  });
  await updateMeeting(row.meetingId, { projectId: project.id });
  return project.id;
}

/**
 * Revert a claimed row back to 'proposed' with no provenance ids. Used when a
 * side effect (card/project creation) fails AFTER the atomic claim, so a failed
 * accept never leaves an orphaned 'accepted' row that produced nothing.
 */
async function revertClaim(db: DB, id: string): Promise<void> {
  await db
    .update(liveSuggestions)
    .set({ status: 'proposed', acceptedCardId: null, acceptedProjectId: null, updatedAt: new Date() })
    .where(eq(liveSuggestions.id, id));
}

/**
 * Accept a 'proposed' suggestion.
 * - action_item: creates a card via the live-assistant rail and stores the
 *   resulting card id in acceptedCardId.
 * - project: creates + links a project and stores its id in acceptedProjectId
 *   (or reuses the existing link — see acceptProjectSuggestion / Bug 1).
 * - decision/question: status-only — no card is created.
 *
 * The claim is ATOMIC (Bug 2 / TOCTOU fix): a single conditional UPDATE flips
 * proposed→accepted, so two concurrent accepts can no longer both pass a JS
 * status check and both run side effects. Returns null when there is no proposed
 * row to claim (already processed or concurrently claimed) so a double-accept
 * creates no duplicate card/project. Throws only when the suggestion never
 * existed, or when a side effect fails (after reverting the claim).
 */
export async function acceptSuggestion(id: string): Promise<LiveSuggestion | null> {
  const db = getDb();

  // 1. ATOMIC CLAIM — flip proposed→accepted in one conditional write. The winner
  //    gets the row back; concurrent losers get nothing.
  const [claimed] = await db
    .update(liveSuggestions)
    .set({ status: 'accepted', updatedAt: new Date() })
    .where(and(eq(liveSuggestions.id, id), eq(liveSuggestions.status, 'proposed')))
    .returning();

  if (!claimed) {
    // Nothing proposed to claim: distinguish a genuinely-missing row (error) from
    // an already-processed / concurrently-claimed row (idempotent no-op → null).
    const [existing] = await db.select().from(liveSuggestions).where(eq(liveSuggestions.id, id));
    if (!existing) throw new Error(`Live suggestion not found: ${id}`);
    return null;
  }

  // 2. SIDE EFFECTS — AFTER claiming. On failure, revert the claim (clearing any
  //    partial ids) and rethrow so a failed card/project creation cannot orphan
  //    an 'accepted' row.
  let acceptedCardId: string | null = null;
  let acceptedProjectId: string | null = null;
  try {
    if (claimed.type === 'action_item') {
      const result = await createLiveAssistantCard(claimed.meetingId, {
        title: claimed.title,
        description: claimed.description ?? undefined,
      });
      if (!result.success || !result.cardId) {
        throw new Error(result.error ?? 'Failed to create card for accepted action item');
      }
      acceptedCardId = result.cardId;
    } else if (claimed.type === 'project') {
      acceptedProjectId = await acceptProjectSuggestion(db, claimed);
    }
  } catch (err) {
    await revertClaim(db, id);
    throw err;
  }

  // 3. Persist provenance ids on the already-claimed row.
  const [updated] = await db
    .update(liveSuggestions)
    .set({ acceptedCardId, acceptedProjectId, updatedAt: new Date() })
    .where(eq(liveSuggestions.id, id))
    .returning();

  return toLiveSuggestion(updated);
}

/** Dismiss a 'proposed' suggestion — no card, no brief context. */
export async function dismissSuggestion(id: string): Promise<LiveSuggestion> {
  const db = getDb();
  const [row] = await db.select().from(liveSuggestions).where(eq(liveSuggestions.id, id));
  if (!row) throw new Error(`Live suggestion not found: ${id}`);
  if (row.status !== 'proposed') throw new Error(`Live suggestion already ${row.status}: ${id}`);

  const [updated] = await db
    .update(liveSuggestions)
    .set({ status: 'dismissed', updatedAt: new Date() })
    .where(eq(liveSuggestions.id, id))
    .returning();

  return toLiveSuggestion(updated);
}

/** All suggestions for a meeting (any status), oldest first. */
export async function listSuggestions(meetingId: string): Promise<LiveSuggestion[]> {
  const db = getDb();
  const rows = await db.select().from(liveSuggestions).where(eq(liveSuggestions.meetingId, meetingId));
  return rows.map(toLiveSuggestion);
}
