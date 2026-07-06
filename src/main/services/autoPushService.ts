// === FILE PURPOSE ===
// Pushes meeting action items as cards into a project's Inbox column automatically
// (no user approval click required). Called after action-item extraction completes
// when the meeting has a known projectId and the autoPush setting is enabled.

import { eq, count, asc } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { actionItems, boards, cards, projects, settings } from '../db/schema';
import { ensureInboxColumn } from './inboxColumnService';
import { createLogger } from './logger';
import type { ActionItem } from '../../shared/types/intelligence';
import type { Card } from '../../shared/types/projects';

type DB = ReturnType<typeof getDb>;

const log = createLogger('AutoPush');

export const SETTINGS_KEY_AUTO_PUSH = 'meetings:autoPushEnabled';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface AutoPushResult {
  pushedCount: number;
  skippedCount: number;
  cards: Card[];
}

/**
 * Automatically push eligible action items from a meeting into the project's
 * Inbox column as cards. Already-converted and dismissed items are skipped.
 *
 * Returns early with zero counts if:
 *  - autoPushEnabled is false (items stay 'pending')
 *  - actionItems array is empty
 *
 * Wraps inserts in a single transaction — partial failures are rolled back.
 */
export async function autoPushActionItems(args: {
  db: DB;
  meetingId: string;
  projectId: string;
  actionItems: ActionItem[];
  userSettings: { autoPushEnabled: boolean };
}): Promise<AutoPushResult> {
  const { db, meetingId, projectId, actionItems: items, userSettings } = args;

  // Gate: feature off → leave everything pending
  if (!userSettings.autoPushEnabled) {
    log.info(`Auto-push disabled — skipping ${items.length} items for meeting ${meetingId}`);
    return { pushedCount: 0, skippedCount: items.length, cards: [] };
  }

  // Gate: nothing to do
  if (items.length === 0) {
    return { pushedCount: 0, skippedCount: 0, cards: [] };
  }

  // Resolve (or create) the project's primary board
  const boardId = await resolvePrimaryBoardId(db, projectId);

  // Ensure Inbox column exists
  const inbox = await ensureInboxColumn(db, boardId);

  // Push each eligible item inside a transaction
  const pushedCards = await db.transaction(async (tx) => {
    const created: Card[] = [];

    for (const item of items) {
      // Idempotency: skip converted or dismissed items
      if (item.status === 'converted' || item.status === 'dismissed') {
        continue;
      }

      // Compute card position (max position + 1)
      const [{ value: cardCount }] = await tx
        .select({ value: count() })
        .from(cards)
        .where(eq(cards.columnId, inbox.id));

      const title = buildCardTitle(item.description);
      const description = buildCardDescription(item.description, meetingId);

      const [card] = await tx
        .insert(cards)
        .values({
          columnId: inbox.id,
          title,
          description,
          priority: 'medium',
          position: Number(cardCount),
          source: 'auto-from-meeting',
          sourceMeetingId: meetingId,
        })
        .returning();

      // Mark action item as converted
      await tx.update(actionItems).set({ status: 'converted', cardId: card.id }).where(eq(actionItems.id, item.id));

      created.push(rowToCard(card));
    }

    return created;
  });

  const skippedCount = items.length - pushedCards.length;
  log.info(`Auto-pushed ${pushedCards.length} cards for meeting ${meetingId} (${skippedCount} skipped)`);

  return { pushedCount: pushedCards.length, skippedCount, cards: pushedCards };
}

/**
 * Read the effective autoPush enabled setting.
 *
 * Resolution order:
 *  1. If `projectId` is provided and the project has a non-null `autoPushEnabled`,
 *     that project-level override wins.
 *  2. Otherwise, fall back to the global `meetings:autoPushEnabled` setting.
 *     Default: true (only the literal string 'false' disables).
 */
export async function readAutoPushSetting(db: DB, projectId?: string): Promise<boolean> {
  // 1. Per-project override
  if (projectId) {
    const projectRows = await db
      .select({ autoPushEnabled: projects.autoPushEnabled })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (projectRows.length > 0 && projectRows[0].autoPushEnabled !== null) {
      return projectRows[0].autoPushEnabled as boolean;
    }
  }

  // 2. Global setting
  const rows = await db.select().from(settings).where(eq(settings.key, SETTINGS_KEY_AUTO_PUSH)).limit(1);
  if (rows.length === 0) return true; // default: enabled
  return rows[0].value !== 'false';
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Find the project's primary board (lowest position).
 * Creates a default board if the project has none.
 *
 * Exported so the Live Assistant (meetingAgentService.createCardInInbox) can reuse
 * the same "resolve or create the project's board" rail instead of duplicating it.
 */
export async function resolvePrimaryBoardId(db: DB, projectId: string): Promise<string> {
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

/**
 * First sentence OR first 80 chars of description, whichever is shorter.
 */
function buildCardTitle(description: string): string {
  const firstSentence = description.split(/[.!?]/)[0].trim();
  return firstSentence.length <= 80 ? firstSentence : description.slice(0, 80).trim();
}

/**
 * Full description + a back-reference line to the source meeting.
 */
function buildCardDescription(description: string, meetingId: string): string {
  return `${description}\n\n_From meeting: ${meetingId}_`;
}

/**
 * Map a Drizzle card row to the shared Card type.
 * Only maps the fields present on the row returned by `.returning()`.
 */
function rowToCard(row: typeof cards.$inferSelect): Card {
  return {
    id: row.id,
    columnId: row.columnId,
    title: row.title,
    description: row.description ?? null,
    position: row.position,
    priority: row.priority,
    dueDate: row.dueDate ? row.dueDate.toISOString() : null,
    completed: row.completed,
    archived: row.archived,
    recurrenceType: row.recurrenceType ?? null,
    recurrenceEndDate: row.recurrenceEndDate ? row.recurrenceEndDate.toISOString() : null,
    sourceRecurringId: row.sourceRecurringId ?? null,
    source: row.source as Card['source'],
    sourceMeetingId: row.sourceMeetingId ?? null,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
