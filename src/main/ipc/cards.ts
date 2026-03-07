// === FILE PURPOSE ===
// IPC handlers for cards, labels, comments, relationships, and activity log CRUD operations.
// Includes card movement between columns, label attachment, and fire-and-forget activity logging.

// === DEPENDENCIES ===
// drizzle-orm (eq, and, asc, desc operators), electron (ipcMain)

// === LIMITATIONS ===
// - cards:list-by-board uses 5 batch queries (columns, cards, cardLabels, labels, checklists).
// - No pagination on list queries yet.
// - card:getRelationships batch-fetches all referenced card titles in one query
// - card:getActivities limited to most recent 50 entries

import { ipcMain } from 'electron';
import { eq, and, or, asc, desc, inArray, isNull, count, sql } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { createLogger } from '../services/logger';
import {
  cards,
  cardLabels,
  labels,
  columns,
  boards,
  projects,
  cardComments,
  cardRelationships,
  cardRelationshipTypeEnum,
  cardActivities,
  cardActivityActionEnum,
  cardAttachments,
  cardChecklistItems,
  cardTemplates,
} from '../db/schema';
import { resolveTaskModel, generate } from '../services/ai-provider';
import * as attachmentService from '../services/attachmentService';
import type { Card, Label } from '../../shared/types';
import { buildCardLabelMap } from '../../shared/utils/card-utils';
import { computeCardMove } from '../../shared/utils/card-move';
import { getNextRecurrenceDate } from '../../shared/utils/date-utils';
import { validateInput } from '../../shared/validation/ipc-validator';
import {
  idParamSchema,
  createCardInputSchema,
  updateCardInputSchema,
  cardMoveSchema,
  createLabelInputSchema,
  updateLabelInputSchema,
  createCardCommentInputSchema,
  commentContentSchema,
  createCardRelationshipInputSchema,
  filePathSchema,
  addChecklistItemSchema,
  updateChecklistItemSchema,
  reorderChecklistItemsSchema,
  addChecklistItemsBatchSchema,
  createCardTemplateSchema,
} from '../../shared/validation/schemas';

const log = createLogger('Cards');

type CardRow = InferSelectModel<typeof cards>;

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
    .catch((err: unknown) => log.error('Activity log error:', err));
}

/**
 * Spawn a new recurring card when a recurring card is completed.
 * Calculates the next due date based on recurrence type and creates a clone.
 * Returns null if no recurrence, past end date, or no recurrence type.
 */
async function spawnRecurringCard(completedCard: CardRow, db: ReturnType<typeof getDb>): Promise<CardRow | null> {
  if (!completedCard.recurrenceType) return null;

  // Guard: don't spawn if an active (non-archived) child already exists for this card
  const [existingChild] = await db
    .select({ id: cards.id })
    .from(cards)
    .where(and(eq(cards.sourceRecurringId, completedCard.id), eq(cards.archived, false)))
    .limit(1);
  if (existingChild) return null;

  // Calculate next due date
  let nextDueDate: Date | null = null;
  if (completedCard.dueDate) {
    nextDueDate = getNextRecurrenceDate(completedCard.dueDate.toISOString(), completedCard.recurrenceType);
  }

  // Check end date
  if (completedCard.recurrenceEndDate && nextDueDate) {
    if (nextDueDate > new Date(completedCard.recurrenceEndDate)) return null;
  }

  // Create new card at top of same column
  const [newCard] = await db.insert(cards).values({
    columnId: completedCard.columnId,
    title: completedCard.title,
    description: completedCard.description,
    priority: completedCard.priority,
    position: 0,
    dueDate: nextDueDate,
    recurrenceType: completedCard.recurrenceType,
    recurrenceEndDate: completedCard.recurrenceEndDate,
    sourceRecurringId: completedCard.id,
    completed: false,
    archived: false,
  }).returning();

  return newCard;
}

export function registerCardHandlers(): void {
  // --- Cards ---

  ipcMain.handle('cards:list-by-board', async (_event, boardId: unknown) => {
    const validBoardId = validateInput(idParamSchema, boardId);
    const db = getDb();

    // Query 1: Get all columns for this board
    const boardColumns = await db
      .select()
      .from(columns)
      .where(eq(columns.boardId, validBoardId));
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

    // Query 5: Batch-fetch checklist progress per card
    const checklistCounts = await db
      .select({
        cardId: cardChecklistItems.cardId,
        total: count(),
        done: count(sql`CASE WHEN ${cardChecklistItems.completed} THEN 1 END`),
      })
      .from(cardChecklistItems)
      .where(inArray(cardChecklistItems.cardId, cardIds))
      .groupBy(cardChecklistItems.cardId);

    const checklistMap = new Map(
      checklistCounts.map(c => [c.cardId, { total: Number(c.total), done: Number(c.done) }])
    );

    // Assemble result
    return allCardRows.map((card) => ({
      ...(card as unknown as Card),
      labels: cardLabelMap.get(card.id) ?? [],
      checklistTotal: checklistMap.get(card.id)?.total ?? 0,
      checklistDone: checklistMap.get(card.id)?.done ?? 0,
    }));
  });

  ipcMain.handle('cards:list-all', async () => {
    const db = getDb();
    const rows = await db
      .select({
        id: cards.id,
        columnId: cards.columnId,
        title: cards.title,
        description: cards.description,
        priority: cards.priority,
        archived: cards.archived,
        completed: cards.completed,
        updatedAt: cards.updatedAt,
        projectId: boards.projectId,
      })
      .from(cards)
      .innerJoin(columns, eq(cards.columnId, columns.id))
      .innerJoin(boards, eq(columns.boardId, boards.id))
      .where(eq(cards.archived, false))
      .orderBy(desc(cards.updatedAt));
    return rows;
  });

  ipcMain.handle(
    'cards:create',
    async (_event, data: unknown) => {
      const input = validateInput(createCardInputSchema, data);
      const db = getDb();
      // Get next position using count() — avoids fetching full rows and reduces race window
      const [{ value: existingCount }] = await db
        .select({ value: count() })
        .from(cards)
        .where(and(eq(cards.columnId, input.columnId), eq(cards.archived, false)));
      const [card] = await db
        .insert(cards)
        .values({
          columnId: input.columnId,
          title: input.title,
          description: input.description ?? null,
          priority: input.priority ?? 'medium',
          position: Number(existingCount),
        })
        .returning();
      logCardActivity(card.id, 'created', { title: input.title });
      return card;
    },
  );

  ipcMain.handle(
    'cards:update',
    async (_event, id: unknown, data: unknown) => {
      const validId = validateInput(idParamSchema, id);
      const input = validateInput(updateCardInputSchema, data);
      const db = getDb();

      // Query current card state BEFORE the update (for recurrence detection)
      const [currentCard] = await db.select().from(cards).where(eq(cards.id, validId));

      // Convert dueDate string to Date object for the DB layer
      const setData: Record<string, unknown> = {
        ...input,
        updatedAt: new Date(),
      };
      if (input.dueDate !== undefined) {
        setData.dueDate = input.dueDate ? new Date(input.dueDate) : null;
      }
      if (input.recurrenceEndDate !== undefined) {
        setData.recurrenceEndDate = input.recurrenceEndDate
          ? new Date(input.recurrenceEndDate)
          : null;
      }
      const [card] = await db
        .update(cards)
        .set(setData)
        .where(eq(cards.id, validId))
        .returning();

      // Check if completed changed from false -> true AND card has recurrenceType
      let spawnedCard = null;
      if (
        currentCard &&
        !currentCard.completed &&
        card.completed &&
        card.recurrenceType
      ) {
        spawnedCard = await spawnRecurringCard(card, db);
      }

      // Log 'archived' or 'restored' if archived field changed, otherwise 'updated'
      if (input.archived === true) {
        logCardActivity(validId, 'archived');
      } else if (input.archived === false) {
        logCardActivity(validId, 'restored');
      } else {
        logCardActivity(validId, 'updated', {
          fields: Object.keys(input).filter(k => k !== 'updatedAt'),
        });
      }
      return { card, spawnedCard };
    },
  );

  ipcMain.handle('cards:delete', async (_event, id: unknown) => {
    const validId = validateInput(idParamSchema, id);
    const db = getDb();
    await db.delete(cards).where(eq(cards.id, validId));
  });

  ipcMain.handle(
    'cards:move',
    async (_event, id: unknown, columnId: unknown, position: unknown) => {
      const validId = validateInput(idParamSchema, id);
      const moveData = validateInput(cardMoveSchema, { columnId, position });
      const db = getDb();

      // Get all non-archived cards in the target column, sorted by position
      const siblingsInTarget = await db
        .select()
        .from(cards)
        .where(
          and(
            eq(cards.columnId, moveData.columnId),
            eq(cards.archived, false),
          ),
        )
        .orderBy(asc(cards.position));

      // Compute new positions using pure function
      const siblings = siblingsInTarget.map(c => ({ id: c.id, position: c.position }));
      const { clampedPosition, updates } = computeCardMove(validId, moveData.position, siblings);

      // Apply all position updates in a single transaction for atomicity
      await db.transaction(async (tx) => {
        for (const upd of updates) {
          if (upd.id === validId) {
            await tx
              .update(cards)
              .set({ columnId: moveData.columnId, position: upd.position, updatedAt: new Date() })
              .where(eq(cards.id, validId));
          } else {
            await tx
              .update(cards)
              .set({ position: upd.position })
              .where(eq(cards.id, upd.id));
          }
        }
      });

      // Return the updated card
      const [updated] = await db.select().from(cards).where(eq(cards.id, validId));

      logCardActivity(validId, 'moved', { columnId: moveData.columnId, position: clampedPosition });
      return updated;
    },
  );

  // --- Labels ---

  ipcMain.handle('labels:list', async (_event, projectId: unknown) => {
    const validProjectId = validateInput(idParamSchema, projectId);
    const db = getDb();
    return db
      .select()
      .from(labels)
      .where(eq(labels.projectId, validProjectId))
      .orderBy(asc(labels.name));
  });

  ipcMain.handle(
    'labels:create',
    async (_event, data: unknown) => {
      const input = validateInput(createLabelInputSchema, data);
      const db = getDb();
      const [label] = await db
        .insert(labels)
        .values({
          projectId: input.projectId,
          name: input.name,
          color: input.color,
        })
        .returning();
      return label;
    },
  );

  ipcMain.handle(
    'labels:update',
    async (_event, id: unknown, data: unknown) => {
      const validId = validateInput(idParamSchema, id);
      const input = validateInput(updateLabelInputSchema, data);
      const db = getDb();
      const [label] = await db
        .update(labels)
        .set(input)
        .where(eq(labels.id, validId))
        .returning();
      return label;
    },
  );

  ipcMain.handle('labels:delete', async (_event, id: unknown) => {
    const validId = validateInput(idParamSchema, id);
    const db = getDb();
    await db.delete(labels).where(eq(labels.id, validId));
  });

  ipcMain.handle(
    'labels:attach',
    async (_event, cardId: unknown, labelId: unknown) => {
      const validCardId = validateInput(idParamSchema, cardId);
      const validLabelId = validateInput(idParamSchema, labelId);
      const db = getDb();
      await db
        .insert(cardLabels)
        .values({ cardId: validCardId, labelId: validLabelId })
        .onConflictDoNothing();
    },
  );

  ipcMain.handle(
    'labels:detach',
    async (_event, cardId: unknown, labelId: unknown) => {
      const validCardId = validateInput(idParamSchema, cardId);
      const validLabelId = validateInput(idParamSchema, labelId);
      const db = getDb();
      await db
        .delete(cardLabels)
        .where(
          and(
            eq(cardLabels.cardId, validCardId),
            eq(cardLabels.labelId, validLabelId),
          ),
        );
    },
  );

  // --- Card Comments ---

  ipcMain.handle('card:getComments', async (_event, cardId: unknown) => {
    const validCardId = validateInput(idParamSchema, cardId);
    const db = getDb();
    const rows = await db
      .select()
      .from(cardComments)
      .where(eq(cardComments.cardId, validCardId))
      .orderBy(desc(cardComments.createdAt));
    return rows;
  });

  ipcMain.handle(
    'card:addComment',
    async (_event, input: unknown) => {
      const validInput = validateInput(createCardCommentInputSchema, input);
      const db = getDb();
      const [comment] = await db
        .insert(cardComments)
        .values({ cardId: validInput.cardId, content: validInput.content })
        .returning();
      logCardActivity(validInput.cardId, 'commented', { commentId: comment.id });
      return comment;
    },
  );

  ipcMain.handle(
    'card:updateComment',
    async (_event, id: unknown, content: unknown) => {
      const validId = validateInput(idParamSchema, id);
      const validContent = validateInput(commentContentSchema, content);
      const db = getDb();
      const [comment] = await db
        .update(cardComments)
        .set({ content: validContent, updatedAt: new Date() })
        .where(eq(cardComments.id, validId))
        .returning();
      return comment;
    },
  );

  ipcMain.handle('card:deleteComment', async (_event, id: unknown) => {
    const validId = validateInput(idParamSchema, id);
    const db = getDb();
    await db.delete(cardComments).where(eq(cardComments.id, validId));
  });

  // --- Card Relationships ---

  ipcMain.handle(
    'card:getRelationships',
    async (_event, cardId: unknown) => {
      const validCardId = validateInput(idParamSchema, cardId);
      const db = getDb();
      // Get relationships where this card is source or target
      const asSource = await db
        .select()
        .from(cardRelationships)
        .where(eq(cardRelationships.sourceCardId, validCardId));
      const asTarget = await db
        .select()
        .from(cardRelationships)
        .where(eq(cardRelationships.targetCardId, validCardId));

      // Enrich with card titles — batch-fetch all referenced cards in one query
      const all = [...asSource, ...asTarget];
      const allCardIds = [...new Set(all.flatMap(r => [r.sourceCardId, r.targetCardId]))];
      const cardTitleRows = allCardIds.length > 0
        ? await db.select({ id: cards.id, title: cards.title })
            .from(cards).where(inArray(cards.id, allCardIds))
        : [];
      const titleMap = new Map(cardTitleRows.map(c => [c.id, c.title]));

      const enriched = all.map(rel => ({
        ...rel,
        sourceCardTitle: titleMap.get(rel.sourceCardId) ?? 'Unknown',
        targetCardTitle: titleMap.get(rel.targetCardId) ?? 'Unknown',
      }));
      return enriched;
    },
  );

  ipcMain.handle(
    'card:addRelationship',
    async (_event, input: unknown) => {
      const validInput = validateInput(createCardRelationshipInputSchema, input);
      const db = getDb();
      const [rel] = await db
        .insert(cardRelationships)
        .values({
          sourceCardId: validInput.sourceCardId,
          targetCardId: validInput.targetCardId,
          type: validInput.type as (typeof cardRelationshipTypeEnum.enumValues)[number],
        })
        .returning();

      // Enrich with card titles so the UI can display them immediately
      const titleRows = await db.select({ id: cards.id, title: cards.title })
        .from(cards)
        .where(inArray(cards.id, [rel.sourceCardId, rel.targetCardId]));
      const titleMap = new Map(titleRows.map(c => [c.id, c.title]));

      logCardActivity(validInput.sourceCardId, 'relationship_added', {
        targetCardId: validInput.targetCardId,
        type: validInput.type,
      });
      return {
        ...rel,
        sourceCardTitle: titleMap.get(rel.sourceCardId) ?? 'Unknown',
        targetCardTitle: titleMap.get(rel.targetCardId) ?? 'Unknown',
      };
    },
  );

  ipcMain.handle('card:deleteRelationship', async (_event, id: unknown) => {
    const validId = validateInput(idParamSchema, id);
    const db = getDb();
    // Get the relationship first for activity logging
    const [rel] = await db
      .select()
      .from(cardRelationships)
      .where(eq(cardRelationships.id, validId));
    await db.delete(cardRelationships).where(eq(cardRelationships.id, validId));
    if (rel) {
      logCardActivity(rel.sourceCardId, 'relationship_removed', {
        targetCardId: rel.targetCardId,
        type: rel.type,
      });
    }
  });

  // --- Board-level Relationships (for Kanban badge display) ---

  ipcMain.handle('cards:getRelationshipsByBoard', async (_event, boardId: unknown) => {
    const validBoardId = validateInput(idParamSchema, boardId);
    const db = getDb();

    // Get all column IDs for this board
    const boardColumns = await db
      .select({ id: columns.id })
      .from(columns)
      .where(eq(columns.boardId, validBoardId));
    const columnIds = boardColumns.map(c => c.id);
    if (columnIds.length === 0) return [];

    // Get all non-archived card IDs in these columns
    const boardCards = await db
      .select({ id: cards.id })
      .from(cards)
      .where(and(inArray(cards.columnId, columnIds), eq(cards.archived, false)));
    const cardIds = boardCards.map(c => c.id);
    if (cardIds.length === 0) return [];

    // Get all relationships where EITHER source or target is in this board's cards
    const asSource = await db
      .select()
      .from(cardRelationships)
      .where(inArray(cardRelationships.sourceCardId, cardIds));
    const asTarget = await db
      .select()
      .from(cardRelationships)
      .where(inArray(cardRelationships.targetCardId, cardIds));

    // Deduplicate (a relationship might have both source and target in this board)
    const relMap = new Map<string, typeof asSource[0]>();
    for (const r of [...asSource, ...asTarget]) {
      relMap.set(r.id, r);
    }
    return Array.from(relMap.values());
  });

  // --- Card Activities ---

  ipcMain.handle('card:getActivities', async (_event, cardId: unknown) => {
    const validCardId = validateInput(idParamSchema, cardId);
    const db = getDb();
    return db
      .select()
      .from(cardActivities)
      .where(eq(cardActivities.cardId, validCardId))
      .orderBy(desc(cardActivities.createdAt))
      .limit(50);
  });

  // --- Card Attachments ---

  ipcMain.handle('card:getAttachments', async (_event, cardId: unknown) => {
    const validCardId = validateInput(idParamSchema, cardId);
    return attachmentService.getAttachments(validCardId);
  });

  ipcMain.handle('card:addAttachment', async (_event, cardId: unknown) => {
    const validCardId = validateInput(idParamSchema, cardId);
    const attachment = await attachmentService.addAttachment(validCardId);
    if (attachment) {
      logCardActivity(validCardId, 'updated', {
        action: 'attachment_added',
        fileName: attachment.fileName,
      });
    }
    return attachment;
  });

  ipcMain.handle('card:deleteAttachment', async (_event, id: unknown) => {
    const validId = validateInput(idParamSchema, id);
    const db = getDb();
    const [att] = await db.select().from(cardAttachments).where(eq(cardAttachments.id, validId));
    await attachmentService.deleteAttachment(validId);
    if (att) {
      logCardActivity(att.cardId, 'updated', {
        action: 'attachment_removed',
        fileName: att.fileName,
      });
    }
  });

  ipcMain.handle('card:openAttachment', async (_event, filePath: unknown) => {
    const validFilePath = validateInput(filePathSchema, filePath);
    return attachmentService.openAttachment(validFilePath);
  });

  // --- Card Checklist Items ---

  ipcMain.handle('card:getChecklistItems', async (_event, cardId: unknown) => {
    const validCardId = validateInput(idParamSchema, cardId);
    const db = getDb();
    return db
      .select()
      .from(cardChecklistItems)
      .where(eq(cardChecklistItems.cardId, validCardId))
      .orderBy(asc(cardChecklistItems.position));
  });

  ipcMain.handle('card:addChecklistItem', async (_event, input: unknown) => {
    const validInput = validateInput(addChecklistItemSchema, input);
    const db = getDb();
    // Get count of existing items for position
    const [{ value: existingCount }] = await db
      .select({ value: count() })
      .from(cardChecklistItems)
      .where(eq(cardChecklistItems.cardId, validInput.cardId));
    const [item] = await db
      .insert(cardChecklistItems)
      .values({
        cardId: validInput.cardId,
        title: validInput.title,
        position: existingCount,
      })
      .returning();
    return item;
  });

  ipcMain.handle('card:updateChecklistItem', async (_event, input: unknown) => {
    const validInput = validateInput(updateChecklistItemSchema, input);
    const db = getDb();
    const setData: Record<string, unknown> = {};
    if (validInput.title !== undefined) setData.title = validInput.title;
    if (validInput.completed !== undefined) setData.completed = validInput.completed;
    const [item] = await db
      .update(cardChecklistItems)
      .set(setData)
      .where(eq(cardChecklistItems.id, validInput.id))
      .returning();
    return item;
  });

  ipcMain.handle('card:deleteChecklistItem', async (_event, id: unknown) => {
    const validId = validateInput(idParamSchema, id);
    const db = getDb();
    await db.delete(cardChecklistItems).where(eq(cardChecklistItems.id, validId));
  });

  ipcMain.handle('card:reorderChecklistItems', async (_event, input: unknown) => {
    const validInput = validateInput(reorderChecklistItemsSchema, input);
    const db = getDb();
    await db.transaction(async (tx) => {
      for (let i = 0; i < validInput.itemIds.length; i++) {
        await tx
          .update(cardChecklistItems)
          .set({ position: i })
          .where(eq(cardChecklistItems.id, validInput.itemIds[i]));
      }
    });
  });

  ipcMain.handle('card:addChecklistItemsBatch', async (_event, input: unknown) => {
    const validInput = validateInput(addChecklistItemsBatchSchema, input);
    const db = getDb();
    // Get current max position
    const existing = await db
      .select({ value: count() })
      .from(cardChecklistItems)
      .where(eq(cardChecklistItems.cardId, validInput.cardId));
    const startPosition = existing[0].value;
    const values = validInput.titles.map((title, i) => ({
      cardId: validInput.cardId,
      title,
      position: startPosition + i,
    }));
    const items = await db
      .insert(cardChecklistItems)
      .values(values)
      .returning();
    return items;
  });

  // --- AI: Generate Card Description ---

  ipcMain.handle('card:generate-description', async (_event, cardId: unknown) => {
    const validCardId = validateInput(idParamSchema, cardId);
    const db = getDb();

    // Fetch the card
    const [card] = await db.select().from(cards).where(eq(cards.id, validCardId));
    if (!card) throw new Error('Card not found');

    // Traverse card -> column -> board -> project for context
    const [column] = await db.select().from(columns).where(eq(columns.id, card.columnId));
    let project: { name: string } | undefined;
    if (column) {
      const [board] = await db.select().from(boards).where(eq(boards.id, column.boardId));
      if (board) {
        const [proj] = await db
          .select({ name: projects.name })
          .from(projects)
          .where(eq(projects.id, board.projectId));
        project = proj;
      }
    }

    // Get card labels for additional context
    const cardLabelRows = await db
      .select()
      .from(cardLabels)
      .where(eq(cardLabels.cardId, validCardId));
    const labelIds = cardLabelRows.map(cl => cl.labelId);
    const labelRows = labelIds.length > 0
      ? await db.select().from(labels).where(inArray(labels.id, labelIds))
      : [];
    const labelNames = labelRows.map(l => l.name);

    // Resolve AI provider
    const resolved = await resolveTaskModel('card-description');
    if (!resolved) throw new Error('No AI provider configured. Please add one in Settings.');

    const prompt = `Write a concise task description (2-3 sentences) for this card on a project board.

Card title: ${card.title}
Priority: ${card.priority}
${project ? `Project: ${project.name}` : ''}
${labelNames.length > 0 ? `Labels: ${labelNames.join(', ')}` : ''}

Write a clear, actionable description. Be specific and practical, not generic.
Format as a single HTML paragraph (<p> tag).`;

    const result = await generate({
      providerId: resolved.providerId,
      providerName: resolved.providerName,
      apiKeyEncrypted: resolved.apiKeyEncrypted,
      baseUrl: resolved.baseUrl,
      model: resolved.model,
      taskType: 'card-description',
      prompt,
      temperature: resolved.temperature ?? 0.7,
      maxTokens: resolved.maxTokens ?? 200,
    });

    return { description: result.text };
  });

  // --- Card Templates ---

  ipcMain.handle('card-templates:list', async (_event, projectId?: unknown) => {
    const db = getDb();
    const where = projectId
      ? or(
          eq(cardTemplates.projectId, validateInput(idParamSchema, projectId)),
          isNull(cardTemplates.projectId),
        )
      : isNull(cardTemplates.projectId);
    return db
      .select()
      .from(cardTemplates)
      .where(where)
      .orderBy(asc(cardTemplates.name))
      .then(rows =>
        rows.map(r => ({
          ...r,
          labelNames: r.labelNames ? JSON.parse(r.labelNames) : null,
        })),
      );
  });

  ipcMain.handle('card-templates:create', async (_event, data: unknown) => {
    const input = validateInput(createCardTemplateSchema, data);
    const db = getDb();
    const [template] = await db
      .insert(cardTemplates)
      .values({
        projectId: input.projectId ?? null,
        name: input.name,
        description: input.description ?? null,
        priority: input.priority ?? 'medium',
        labelNames: input.labelNames ? JSON.stringify(input.labelNames) : null,
      })
      .returning();
    return {
      ...template,
      labelNames: template.labelNames ? JSON.parse(template.labelNames) : null,
    };
  });

  ipcMain.handle('card-templates:delete', async (_event, id: unknown) => {
    const validId = validateInput(idParamSchema, id);
    const db = getDb();
    await db.delete(cardTemplates).where(eq(cardTemplates.id, validId));
  });

  ipcMain.handle(
    'card-templates:save-from-card',
    async (_event, cardId: unknown, name?: unknown) => {
      const validCardId = validateInput(idParamSchema, cardId);
      const db = getDb();

      // Fetch the card
      const [card] = await db.select().from(cards).where(eq(cards.id, validCardId));
      if (!card) throw new Error('Card not found');

      // Fetch card labels
      const cardLabelRows = await db
        .select()
        .from(cardLabels)
        .where(eq(cardLabels.cardId, validCardId));
      const labelIds = cardLabelRows.map(cl => cl.labelId);
      const labelRows = labelIds.length > 0
        ? await db.select().from(labels).where(inArray(labels.id, labelIds))
        : [];
      const labelNameList = labelRows.map(l => l.name);

      // Traverse card -> column -> board -> project for projectId
      let projectId: string | null = null;
      const [column] = await db.select().from(columns).where(eq(columns.id, card.columnId));
      if (column) {
        const [board] = await db.select().from(boards).where(eq(boards.id, column.boardId));
        if (board) {
          projectId = board.projectId;
        }
      }

      const templateName = (typeof name === 'string' && name.trim()) ? name.trim() : card.title;

      const [template] = await db
        .insert(cardTemplates)
        .values({
          projectId,
          name: templateName,
          description: card.description,
          priority: card.priority,
          labelNames: labelNameList.length > 0 ? JSON.stringify(labelNameList) : null,
        })
        .returning();

      return {
        ...template,
        labelNames: template.labelNames ? JSON.parse(template.labelNames) : null,
      };
    },
  );
}
