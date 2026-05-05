// === FILE PURPOSE ===
// Ensures the system "Unassigned" project exists, along with its default board
// and Inbox column. Used when meeting auto-flow cannot assign a card to a real project.

import { eq, asc } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { projects, boards } from '../db/schema';
import { ensureInboxColumn } from './inboxColumnService';
import type { Project } from '../../shared/types';

type DB = ReturnType<typeof getDb>;

// Neutral grey used for the system Unassigned project
const UNASSIGNED_COLOR = '#6b7280';
const UNASSIGNED_NAME = 'Unassigned';

/**
 * Returns the system Unassigned project, creating it (with a default board and
 * Inbox column) if it does not yet exist.
 * Idempotent — safe to call multiple times.
 */
export async function ensureUnassignedProject(db: DB): Promise<Project> {
  // Look up existing system project
  const [existing] = await db.select().from(projects).where(eq(projects.system, true)).limit(1);

  if (existing) {
    await ensureDefaultBoardAndInbox(db, existing.id);
    return toProject(existing);
  }

  // Create the system project
  const [created] = await db
    .insert(projects)
    .values({
      name: UNASSIGNED_NAME,
      color: UNASSIGNED_COLOR,
      archived: false,
      pinned: false,
      system: true,
      sortOrder: 0,
    })
    .returning();

  await ensureDefaultBoardAndInbox(db, created.id);
  return toProject(created);
}

/** Ensures at least one board exists for the project, then ensures its Inbox column. */
async function ensureDefaultBoardAndInbox(db: DB, projectId: string): Promise<void> {
  const existingBoards = await db
    .select()
    .from(boards)
    .where(eq(boards.projectId, projectId))
    .orderBy(asc(boards.position))
    .limit(1);

  let boardId: string;

  if (existingBoards.length > 0) {
    boardId = existingBoards[0].id;
  } else {
    const [board] = await db.insert(boards).values({ projectId, name: 'Board', position: 0 }).returning();
    boardId = board.id;
  }

  await ensureInboxColumn(db, boardId);
}

function toProject(row: typeof projects.$inferSelect): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    color: row.color ?? null,
    archived: row.archived,
    pinned: row.pinned,
    system: row.system,
    autoPushEnabled: row.autoPushEnabled ?? null,
    hourlyRate: row.hourlyRate ?? null,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
