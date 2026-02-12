// === FILE PURPOSE ===
// IPC handlers for cards and labels CRUD operations.
// Includes card movement between columns and label attachment.

// === DEPENDENCIES ===
// drizzle-orm (eq, and, asc operators), electron (ipcMain)

// === LIMITATIONS ===
// - cards:list-by-board fetches labels per card in a loop (N+1 queries).
//   Consider a join-based approach for better performance in the future.
// - No pagination on list queries yet.

import { ipcMain } from 'electron';
import { eq, and, asc } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { cards, cardLabels, labels, columns } from '../db/schema';
import type {
  CreateCardInput,
  UpdateCardInput,
  CreateLabelInput,
  UpdateLabelInput,
  Card,
  Label,
} from '../../shared/types';

export function registerCardHandlers(): void {
  // --- Cards ---

  ipcMain.handle('cards:list-by-board', async (_event, boardId: string) => {
    const db = getDb();
    // Get all columns for this board, then all cards in those columns
    const boardColumns = await db
      .select()
      .from(columns)
      .where(eq(columns.boardId, boardId));
    const columnIds = boardColumns.map((c) => c.id);

    if (columnIds.length === 0) return [];

    // Get cards for all columns in the board
    const allCards: (Card & { labels: Label[] })[] = [];
    for (const colId of columnIds) {
      const colCards = await db
        .select()
        .from(cards)
        .where(and(eq(cards.columnId, colId), eq(cards.archived, false)))
        .orderBy(asc(cards.position));

      for (const card of colCards) {
        // Get labels for each card
        const cardLabelRows = await db
          .select()
          .from(cardLabels)
          .where(eq(cardLabels.cardId, card.id));
        const cardLabelList: Label[] = [];
        for (const cl of cardLabelRows) {
          const [label] = await db
            .select()
            .from(labels)
            .where(eq(labels.id, cl.labelId));
          if (label) cardLabelList.push(label as unknown as Label);
        }
        allCards.push({ ...(card as unknown as Card), labels: cardLabelList });
      }
    }
    return allCards;
  });

  ipcMain.handle(
    'cards:create',
    async (_event, data: CreateCardInput) => {
      const db = getDb();
      // Get next position in the column
      const existing = await db
        .select()
        .from(cards)
        .where(eq(cards.columnId, data.columnId));
      const [card] = await db
        .insert(cards)
        .values({
          columnId: data.columnId,
          title: data.title,
          description: data.description ?? null,
          priority: data.priority ?? 'medium',
          position: existing.length,
        })
        .returning();
      return card;
    },
  );

  ipcMain.handle(
    'cards:update',
    async (_event, id: string, data: UpdateCardInput) => {
      const db = getDb();
      // Convert dueDate string to Date object for the DB layer
      const setData: Record<string, unknown> = {
        ...data,
        updatedAt: new Date(),
      };
      if (data.dueDate !== undefined) {
        setData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
      }
      const [card] = await db
        .update(cards)
        .set(setData)
        .where(eq(cards.id, id))
        .returning();
      return card;
    },
  );

  ipcMain.handle('cards:delete', async (_event, id: string) => {
    const db = getDb();
    await db.delete(cards).where(eq(cards.id, id));
  });

  ipcMain.handle(
    'cards:move',
    async (_event, id: string, columnId: string, position: number) => {
      const db = getDb();
      const [card] = await db
        .update(cards)
        .set({ columnId, position, updatedAt: new Date() })
        .where(eq(cards.id, id))
        .returning();
      return card;
    },
  );

  // --- Labels ---

  ipcMain.handle('labels:list', async (_event, projectId: string) => {
    const db = getDb();
    return db
      .select()
      .from(labels)
      .where(eq(labels.projectId, projectId))
      .orderBy(asc(labels.name));
  });

  ipcMain.handle(
    'labels:create',
    async (_event, data: CreateLabelInput) => {
      const db = getDb();
      const [label] = await db
        .insert(labels)
        .values({
          projectId: data.projectId,
          name: data.name,
          color: data.color,
        })
        .returning();
      return label;
    },
  );

  ipcMain.handle(
    'labels:update',
    async (_event, id: string, data: UpdateLabelInput) => {
      const db = getDb();
      const [label] = await db
        .update(labels)
        .set(data)
        .where(eq(labels.id, id))
        .returning();
      return label;
    },
  );

  ipcMain.handle('labels:delete', async (_event, id: string) => {
    const db = getDb();
    await db.delete(labels).where(eq(labels.id, id));
  });

  ipcMain.handle(
    'labels:attach',
    async (_event, cardId: string, labelId: string) => {
      const db = getDb();
      await db
        .insert(cardLabels)
        .values({ cardId, labelId })
        .onConflictDoNothing();
    },
  );

  ipcMain.handle(
    'labels:detach',
    async (_event, cardId: string, labelId: string) => {
      const db = getDb();
      await db
        .delete(cardLabels)
        .where(
          and(
            eq(cardLabels.cardId, cardId),
            eq(cardLabels.labelId, labelId),
          ),
        );
    },
  );
}
