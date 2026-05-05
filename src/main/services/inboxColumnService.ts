// === FILE PURPOSE ===
// Ensures an "Inbox" column exists on a given board, creating it at position 0
// and shifting all existing columns right if absent.

import { eq, asc } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { columns } from '../db/schema';
import type { Column } from '../../shared/types';

type DB = ReturnType<typeof getDb>;

/**
 * Returns the Inbox column for the given board, creating it at position 0
 * (shifting existing columns by 1) if it does not yet exist.
 * Idempotent — safe to call multiple times.
 */
export async function ensureInboxColumn(db: DB, boardId: string): Promise<Column> {
  // Check whether an Inbox column already exists for this board
  const existing = await db.select().from(columns).where(eq(columns.boardId, boardId)).orderBy(asc(columns.position));

  const inbox = existing.find((c) => c.name === 'Inbox');
  if (inbox) {
    return toColumn(inbox);
  }

  // Insert Inbox at position 0 and shift all existing columns in a transaction
  const [created] = await db.transaction(async (tx) => {
    // Shift every existing column right by one
    if (existing.length > 0) {
      for (const col of existing) {
        await tx
          .update(columns)
          .set({ position: col.position + 1 })
          .where(eq(columns.id, col.id));
      }
    }

    return tx.insert(columns).values({ boardId, name: 'Inbox', position: 0 }).returning();
  });

  return toColumn(created);
}

function toColumn(row: typeof columns.$inferSelect): Column {
  return {
    id: row.id,
    boardId: row.boardId,
    name: row.name,
    position: row.position,
    color: row.color ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
