// === FILE PURPOSE ===
// Re-routes auto-pushed meeting cards from the system "Unassigned" project's Inbox
// to a chosen real project's Inbox when the user resolves a low-confidence
// auto-detect by picking the project explicitly.

import { eq, and, asc } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { cards, boards, meetings } from '../db/schema';
import { ensureInboxColumn } from './inboxColumnService';
import { createLogger } from './logger';

const log = createLogger('MeetingReassign');

type DB = ReturnType<typeof getDb>;

export interface ReassignResult {
  movedCardCount: number;
  meetingId: string;
  newProjectId: string;
}

/**
 * Move all auto-pushed cards for a meeting from their current Inbox column
 * to the target project's Inbox column, then update the meeting itself.
 *
 * Idempotent — calling on a meeting whose cards are already in the target
 * Inbox simply moves zero cards. Safe to retry.
 */
export async function reassignMeetingFromUnassigned(meetingId: string, newProjectId: string): Promise<ReassignResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;

    // 1. Resolve target project's primary board + Inbox column
    const targetBoardId = await resolvePrimaryBoardId(txDb, newProjectId);
    const targetInbox = await ensureInboxColumn(txDb, targetBoardId);

    // 2. Find all auto-pushed cards for this meeting (regardless of current location)
    const meetingCards = await tx
      .select()
      .from(cards)
      .where(and(eq(cards.sourceMeetingId, meetingId), eq(cards.source, 'auto-from-meeting')));

    // 3. For each card not already in the target Inbox, append to the bottom
    //    so we preserve existing target Inbox order and the meeting cards' relative order.
    const targetSiblings = await tx
      .select()
      .from(cards)
      .where(and(eq(cards.columnId, targetInbox.id), eq(cards.archived, false)))
      .orderBy(asc(cards.position));

    let nextPos = targetSiblings.length;
    let moved = 0;
    for (const card of meetingCards) {
      if (card.columnId === targetInbox.id) continue;
      await tx
        .update(cards)
        .set({ columnId: targetInbox.id, position: nextPos, updatedAt: new Date() })
        .where(eq(cards.id, card.id));
      nextPos += 1;
      moved += 1;
    }

    // 4. Update the meeting: clear unassignedPending, set projectId
    await tx
      .update(meetings)
      .set({ projectId: newProjectId, unassignedPending: false })
      .where(eq(meetings.id, meetingId));

    log.info(`Reassigned ${moved} card(s) from meeting ${meetingId} to project ${newProjectId}`);

    return {
      movedCardCount: moved,
      meetingId,
      newProjectId,
    };
  });
}

/**
 * Find the project's primary board (lowest position).
 * Creates a default board if the project has none.
 */
async function resolvePrimaryBoardId(db: DB, projectId: string): Promise<string> {
  const existing = await db
    .select()
    .from(boards)
    .where(eq(boards.projectId, projectId))
    .orderBy(asc(boards.position))
    .limit(1);

  if (existing.length > 0) {
    return existing[0].id;
  }

  // No boards — create the default one
  const [board] = await db.insert(boards).values({ projectId, name: 'Board', position: 0 }).returning();
  log.info(`Created default board for project ${projectId}`);
  return board.id;
}
