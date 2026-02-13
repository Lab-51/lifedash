// === FILE PURPOSE ===
// IPC handlers for cards, labels, comments, relationships, and activity log CRUD operations.
// Includes card movement between columns, label attachment, and fire-and-forget activity logging.

// === DEPENDENCIES ===
// drizzle-orm (eq, and, asc, desc operators), electron (ipcMain)

// === LIMITATIONS ===
// - cards:list-by-board uses 4 batch queries (columns, cards, cardLabels, labels).
// - No pagination on list queries yet.
// - card:getRelationships fetches titles per relationship (N+1, acceptable for small counts)
// - card:getActivities limited to most recent 50 entries

import { ipcMain } from 'electron';
import { eq, and, asc, desc, inArray } from 'drizzle-orm';
import { getDb } from '../db/connection';
import {
  cards,
  cardLabels,
  labels,
  columns,
  cardComments,
  cardRelationships,
  cardRelationshipTypeEnum,
  cardActivities,
  cardActivityActionEnum,
  cardAttachments,
} from '../db/schema';
import * as attachmentService from '../services/attachmentService';
import type {
  CreateCardInput,
  UpdateCardInput,
  CreateLabelInput,
  UpdateLabelInput,
  Card,
  Label,
} from '../../shared/types';
import { buildCardLabelMap } from '../../shared/utils/card-utils';

/**
 * Fire-and-forget activity log insertion.
 * Does not throw — activity logging should never break primary operations.
 */
function logCardActivity(
  cardId: string,
  action: string,
  details?: Record<string, unknown>,
): void {
  const db = getDb();
  db.insert(cardActivities)
    .values({
      cardId,
      action: action as (typeof cardActivityActionEnum.enumValues)[number],
      details: details ? JSON.stringify(details) : null,
    })
    .catch((err: unknown) => console.error('Activity log error:', err));
}

export function registerCardHandlers(): void {
  // --- Cards ---

  ipcMain.handle('cards:list-by-board', async (_event, boardId: string) => {
    const db = getDb();

    // Query 1: Get all columns for this board
    const boardColumns = await db
      .select()
      .from(columns)
      .where(eq(columns.boardId, boardId));
    const columnIds = boardColumns.map((c) => c.id);
    if (columnIds.length === 0) return [];

    // Query 2: Batch-fetch all non-archived cards in these columns
    const allCardRows = await db
      .select()
      .from(cards)
      .where(and(inArray(cards.columnId, columnIds), eq(cards.archived, false)))
      .orderBy(asc(cards.position));
    if (allCardRows.length === 0) return [];

    const cardIds = allCardRows.map((c) => c.id);

    // Query 3: Batch-fetch all card-label junction rows for these cards
    const allCardLabelRows = await db
      .select()
      .from(cardLabels)
      .where(inArray(cardLabels.cardId, cardIds));

    // Query 4: Batch-fetch all labels referenced by these cards
    const labelIds = [...new Set(allCardLabelRows.map((cl) => cl.labelId))];
    const allLabels = labelIds.length > 0
      ? await db.select().from(labels).where(inArray(labels.id, labelIds))
      : [];

    // Build card -> labels lookup via shared utility
    const cardLabelMap = buildCardLabelMap(
      allCardLabelRows,
      allLabels as unknown as Label[],
    );

    // Assemble result
    return allCardRows.map((card) => ({
      ...(card as unknown as Card),
      labels: cardLabelMap.get(card.id) ?? [],
    }));
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
      logCardActivity(card.id, 'created', { title: data.title });
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
      // Log 'archived' or 'restored' if archived field changed, otherwise 'updated'
      if (data.archived === true) {
        logCardActivity(id, 'archived');
      } else if (data.archived === false) {
        logCardActivity(id, 'restored');
      } else {
        logCardActivity(id, 'updated', {
          fields: Object.keys(data).filter(k => k !== 'updatedAt'),
        });
      }
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

      // Get all non-archived cards in the target column, sorted by position
      const siblingsInTarget = await db
        .select()
        .from(cards)
        .where(
          and(
            eq(cards.columnId, columnId),
            eq(cards.archived, false),
          ),
        )
        .orderBy(asc(cards.position));

      // Remove the moved card from the list (it may already be in this column for same-column reorder)
      const filtered = siblingsInTarget.filter(c => c.id !== id);

      // Clamp position to valid range
      const clampedPosition = Math.max(0, Math.min(position, filtered.length));

      // Insert the moved card at the requested position
      const reordered = [...filtered];
      // Use a minimal placeholder — we only need the id for the update loop
      reordered.splice(clampedPosition, 0, { id } as typeof cards.$inferSelect);

      // Update all positions in one pass
      for (let i = 0; i < reordered.length; i++) {
        if (reordered[i].id === id) {
          // Update the moved card: set column, position, and timestamp
          await db
            .update(cards)
            .set({ columnId, position: i, updatedAt: new Date() })
            .where(eq(cards.id, id));
        } else if (reordered[i].position !== i) {
          // Only update siblings whose position actually changed
          await db
            .update(cards)
            .set({ position: i })
            .where(eq(cards.id, reordered[i].id));
        }
      }

      // Return the updated card
      const [updated] = await db.select().from(cards).where(eq(cards.id, id));

      logCardActivity(id, 'moved', { columnId, position: clampedPosition });
      return updated;
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

  // --- Card Comments ---

  ipcMain.handle('card:getComments', async (_event, cardId: string) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(cardComments)
      .where(eq(cardComments.cardId, cardId))
      .orderBy(desc(cardComments.createdAt));
    return rows;
  });

  ipcMain.handle(
    'card:addComment',
    async (_event, input: { cardId: string; content: string }) => {
      const db = getDb();
      const [comment] = await db
        .insert(cardComments)
        .values({ cardId: input.cardId, content: input.content })
        .returning();
      logCardActivity(input.cardId, 'commented', { commentId: comment.id });
      return comment;
    },
  );

  ipcMain.handle(
    'card:updateComment',
    async (_event, id: string, content: string) => {
      const db = getDb();
      const [comment] = await db
        .update(cardComments)
        .set({ content, updatedAt: new Date() })
        .where(eq(cardComments.id, id))
        .returning();
      return comment;
    },
  );

  ipcMain.handle('card:deleteComment', async (_event, id: string) => {
    const db = getDb();
    await db.delete(cardComments).where(eq(cardComments.id, id));
  });

  // --- Card Relationships ---

  ipcMain.handle(
    'card:getRelationships',
    async (_event, cardId: string) => {
      const db = getDb();
      // Get relationships where this card is source or target
      const asSource = await db
        .select()
        .from(cardRelationships)
        .where(eq(cardRelationships.sourceCardId, cardId));
      const asTarget = await db
        .select()
        .from(cardRelationships)
        .where(eq(cardRelationships.targetCardId, cardId));

      // Enrich with card titles
      const all = [...asSource, ...asTarget];
      const enriched = [];
      for (const rel of all) {
        const [sourceCard] = await db
          .select({ title: cards.title })
          .from(cards)
          .where(eq(cards.id, rel.sourceCardId));
        const [targetCard] = await db
          .select({ title: cards.title })
          .from(cards)
          .where(eq(cards.id, rel.targetCardId));
        enriched.push({
          ...rel,
          sourceCardTitle: sourceCard?.title ?? 'Unknown',
          targetCardTitle: targetCard?.title ?? 'Unknown',
        });
      }
      return enriched;
    },
  );

  ipcMain.handle(
    'card:addRelationship',
    async (
      _event,
      input: { sourceCardId: string; targetCardId: string; type: string },
    ) => {
      const db = getDb();
      const [rel] = await db
        .insert(cardRelationships)
        .values({
          sourceCardId: input.sourceCardId,
          targetCardId: input.targetCardId,
          type: input.type as (typeof cardRelationshipTypeEnum.enumValues)[number],
        })
        .returning();
      logCardActivity(input.sourceCardId, 'relationship_added', {
        targetCardId: input.targetCardId,
        type: input.type,
      });
      return rel;
    },
  );

  ipcMain.handle('card:deleteRelationship', async (_event, id: string) => {
    const db = getDb();
    // Get the relationship first for activity logging
    const [rel] = await db
      .select()
      .from(cardRelationships)
      .where(eq(cardRelationships.id, id));
    await db.delete(cardRelationships).where(eq(cardRelationships.id, id));
    if (rel) {
      logCardActivity(rel.sourceCardId, 'relationship_removed', {
        targetCardId: rel.targetCardId,
        type: rel.type,
      });
    }
  });

  // --- Card Activities ---

  ipcMain.handle('card:getActivities', async (_event, cardId: string) => {
    const db = getDb();
    return db
      .select()
      .from(cardActivities)
      .where(eq(cardActivities.cardId, cardId))
      .orderBy(desc(cardActivities.createdAt))
      .limit(50);
  });

  // --- Card Attachments ---

  ipcMain.handle('card:getAttachments', async (_event, cardId: string) => {
    return attachmentService.getAttachments(cardId);
  });

  ipcMain.handle('card:addAttachment', async (_event, cardId: string) => {
    const attachment = await attachmentService.addAttachment(cardId);
    if (attachment) {
      logCardActivity(cardId, 'updated', {
        action: 'attachment_added',
        fileName: attachment.fileName,
      });
    }
    return attachment;
  });

  ipcMain.handle('card:deleteAttachment', async (_event, id: string) => {
    const db = getDb();
    const [att] = await db.select().from(cardAttachments).where(eq(cardAttachments.id, id));
    await attachmentService.deleteAttachment(id);
    if (att) {
      logCardActivity(att.cardId, 'updated', {
        action: 'attachment_removed',
        fileName: att.fileName,
      });
    }
  });

  ipcMain.handle('card:openAttachment', async (_event, filePath: string) => {
    return attachmentService.openAttachment(filePath);
  });
}
