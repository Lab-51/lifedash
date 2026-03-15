// === FILE PURPOSE ===
// Card agent service — per-card AI agent with tool calling.
// Builds card context, defines 7 tools, manages conversation messages.
//
// === DEPENDENCIES ===
// ai (tool, z from zod via ai), drizzle-orm, DB schema
//
// === LIMITATIONS ===
// - Tools auto-execute (no mid-stream approval)
// - Agent conversation is per-card (not shared across cards)

import { tool } from 'ai';
import { z } from 'zod';
import { eq, asc, desc, and, ilike, inArray, count } from 'drizzle-orm';
import { getDb } from '../db/connection';
import {
  cards,
  columns,
  boards,
  projects,
  cardChecklistItems,
  cardComments,
  cardRelationships,
  cardAgentMessages,
  cardAgentThreads,
} from '../db/schema';
import type {
  CardAgentMessage,
  CardAgentThread,
  ToolCallRecord,
  ToolResultRecord,
  AgentAction,
} from '../../shared/types';
import { createLogger } from './logger';

const log = createLogger('CardAgent');

// ---------------------------------------------------------------------------
// Row Mapper
// ---------------------------------------------------------------------------

function toMessage(row: typeof cardAgentMessages.$inferSelect): CardAgentMessage {
  return {
    id: row.id,
    cardId: row.cardId,
    threadId: row.threadId ?? null,
    role: row.role as CardAgentMessage['role'],
    content: row.content,
    toolCalls: row.toolCalls as ToolCallRecord[] | null,
    toolResults: row.toolResults as ToolResultRecord[] | null,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Context Builder
// ---------------------------------------------------------------------------

export async function buildCardContext(cardId: string): Promise<string> {
  const db = getDb();

  // Fetch the card
  const [card] = await db.select().from(cards).where(eq(cards.id, cardId));
  if (!card) return 'Card not found.';

  // Traverse card -> column -> board -> project
  const [column] = await db.select().from(columns).where(eq(columns.id, card.columnId));
  const [board] = column ? await db.select().from(boards).where(eq(boards.id, column.boardId)) : [undefined];
  const [project] = board ? await db.select().from(projects).where(eq(projects.id, board.projectId)) : [undefined];

  // Parallel: checklist, comments, relationships
  const [checklist, comments, relsAsSource, relsAsTarget] = await Promise.all([
    db
      .select()
      .from(cardChecklistItems)
      .where(eq(cardChecklistItems.cardId, cardId))
      .orderBy(asc(cardChecklistItems.position)),
    db
      .select()
      .from(cardComments)
      .where(eq(cardComments.cardId, cardId))
      .orderBy(desc(cardComments.createdAt))
      .limit(10),
    db.select().from(cardRelationships).where(eq(cardRelationships.sourceCardId, cardId)),
    db.select().from(cardRelationships).where(eq(cardRelationships.targetCardId, cardId)),
  ]);

  // Enrich relationships with card titles
  const allRels = [...relsAsSource, ...relsAsTarget];
  const relCardIds = [...new Set(allRels.flatMap((r) => [r.sourceCardId, r.targetCardId]))].filter(
    (id) => id !== cardId,
  );
  const relCards =
    relCardIds.length > 0
      ? await db.select({ id: cards.id, title: cards.title }).from(cards).where(inArray(cards.id, relCardIds))
      : [];
  const relCardMap = new Map(relCards.map((c) => [c.id, c.title]));

  // Build system prompt
  const doneCount = checklist.filter((i) => i.completed).length;
  let ctx = `## Your Role
You are an AI assistant attached to a project card. You help the user accomplish
the task described in this card by taking concrete actions: creating checklist items,
adding comments, updating the description, creating related cards, and analyzing
related work.

When the user asks you to do something, use your tools to take action. Don't just
describe what you would do — actually do it using the available tools.

## Card Creation Rules
When creating a new card with the createCard tool:
- Keep the description to 1-2 sentences max. The description is a brief summary, not a spec.
- Do NOT put task lists, steps, or checklists inside the description. Use addChecklistItem for those.
- After creating a card, add 3-5 focused checklist items to it using addChecklistItem with the targetCardId set to the new card's ID — not more.
- Checklist items should be high-level milestones, not granular sub-steps.
- If the user's request is vague or broad, ask 1-2 clarifying questions BEFORE creating the card. For example: "What's the main goal?" or "Should this focus on X or Y?"
- Do not over-structure. Start lean — the user can always ask for more detail later.

## Conversation Style
- Keep responses short and actionable (2-4 sentences).
- When asked to break down a task, start with the big picture (3-5 items), not every possible sub-task.
- If you need more context to do a good job, ask ONE clear question before acting.
- Never dump a wall of text. If you need to explain something, use short bullet points.

## Current Card
Title: ${card.title}
Description: ${card.description || '(none)'}
Priority: ${card.priority}`;

  if (column) ctx += `\nColumn: ${column.name}`;
  if (board) ctx += `\nBoard: ${board.name}`;
  if (project) ctx += `\nProject: ${project.name}${project.description ? ` — ${project.description}` : ''}`;

  if (checklist.length > 0) {
    ctx += `\n\n## Checklist (${doneCount}/${checklist.length})`;
    for (const item of checklist) {
      ctx += `\n- [${item.completed ? 'x' : ' '}] ${item.title}`;
    }
  }

  if (comments.length > 0) {
    ctx += `\n\n## Comments (${comments.length})`;
    for (const c of comments) {
      const preview = c.content.length > 150 ? c.content.slice(0, 150) + '...' : c.content;
      ctx += `\n- ${c.createdAt.toISOString().slice(0, 10)}: ${preview}`;
    }
  }

  if (allRels.length > 0) {
    const blocks: string[] = [];
    const dependsOn: string[] = [];
    const relatedTo: string[] = [];

    for (const rel of relsAsSource) {
      const title = relCardMap.get(rel.targetCardId) ?? 'Unknown';
      if (rel.type === 'blocks') blocks.push(title);
      else if (rel.type === 'depends_on') dependsOn.push(title);
      else relatedTo.push(title);
    }
    for (const rel of relsAsTarget) {
      const title = relCardMap.get(rel.sourceCardId) ?? 'Unknown';
      if (rel.type === 'blocks')
        dependsOn.push(title); // reverse: if source blocks us, we depend on it
      else if (rel.type === 'depends_on') blocks.push(title);
      else relatedTo.push(title);
    }

    ctx += '\n\n## Related Cards';
    if (blocks.length > 0) ctx += `\n- Blocks: ${blocks.join(', ')}`;
    if (dependsOn.length > 0) ctx += `\n- Depends on: ${dependsOn.join(', ')}`;
    if (relatedTo.length > 0) ctx += `\n- Related to: ${relatedTo.join(', ')}`;
  }

  return ctx;
}

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

export function createCardAgentTools(cardId: string, projectId: string | null) {
  const db = getDb();

  return {
    getCardDetails: tool({
      description: 'Get full details of a card including its checklist and comments',
      inputSchema: z.object({
        cardId: z.string().uuid().describe('The ID of the card to look up'),
      }),
      execute: async ({ cardId: targetCardId }) => {
        const [targetCard] = await db.select().from(cards).where(eq(cards.id, targetCardId));
        if (!targetCard) return { error: 'Card not found' };

        const checklist = await db
          .select()
          .from(cardChecklistItems)
          .where(eq(cardChecklistItems.cardId, targetCardId))
          .orderBy(asc(cardChecklistItems.position));
        const comments = await db
          .select()
          .from(cardComments)
          .where(eq(cardComments.cardId, targetCardId))
          .orderBy(desc(cardComments.createdAt))
          .limit(10);

        return {
          title: targetCard.title,
          description: targetCard.description,
          priority: targetCard.priority,
          checklist: checklist.map((i) => ({ id: i.id, title: i.title, completed: i.completed })),
          comments: comments.map((c) => ({
            id: c.id,
            content: c.content.slice(0, 200),
            createdAt: c.createdAt.toISOString(),
          })),
        };
      },
    }),

    searchProjectCards: tool({
      description: 'Search for cards in the same project by title keyword',
      inputSchema: z.object({
        query: z.string().describe('Search keyword to match against card titles'),
        limit: z.number().optional().default(10).describe('Max results to return'),
      }),
      execute: async ({ query, limit }) => {
        if (!projectId) return { cards: [], note: 'Card is not in a project' };

        // Get all boards + columns for this project
        const projectBoards = await db.select({ id: boards.id }).from(boards).where(eq(boards.projectId, projectId));
        if (projectBoards.length === 0) return { cards: [] };

        const boardIds = projectBoards.map((b) => b.id);
        const projectColumns = await db
          .select({ id: columns.id })
          .from(columns)
          .where(inArray(columns.boardId, boardIds));
        const columnIds = projectColumns.map((c) => c.id);
        if (columnIds.length === 0) return { cards: [] };

        const results = await db
          .select({
            id: cards.id,
            title: cards.title,
            priority: cards.priority,
            columnId: cards.columnId,
          })
          .from(cards)
          .where(and(inArray(cards.columnId, columnIds), eq(cards.archived, false), ilike(cards.title, `%${query}%`)))
          .limit(limit);

        return { cards: results };
      },
    }),

    addChecklistItem: tool({
      description:
        'Add a new checklist item to a card. Defaults to the current card, but pass targetCardId to add to a different card (e.g. one you just created).',
      inputSchema: z.object({
        title: z.string().describe('The checklist item text'),
        targetCardId: z
          .string()
          .uuid()
          .optional()
          .describe('ID of the card to add the item to. Omit to add to the current card.'),
      }),
      execute: async ({ title, targetCardId }) => {
        const resolvedCardId = targetCardId ?? cardId;
        const [{ value: existingCount }] = await db
          .select({ value: count() })
          .from(cardChecklistItems)
          .where(eq(cardChecklistItems.cardId, resolvedCardId));

        const [item] = await db
          .insert(cardChecklistItems)
          .values({
            cardId: resolvedCardId,
            title,
            position: existingCount,
          })
          .returning();

        return { success: true, item: { id: item.id, title: item.title }, cardId: resolvedCardId };
      },
    }),

    toggleChecklistItem: tool({
      description: 'Toggle a checklist item as completed or not completed',
      inputSchema: z.object({
        itemId: z.string().uuid().describe('The ID of the checklist item'),
        completed: z.boolean().describe('Whether the item should be marked as completed'),
      }),
      execute: async ({ itemId, completed }) => {
        const [item] = await db
          .update(cardChecklistItems)
          .set({ completed })
          .where(eq(cardChecklistItems.id, itemId))
          .returning();
        if (!item) return { success: false, error: 'Checklist item not found' };
        return { success: true };
      },
    }),

    addComment: tool({
      description: 'Add a comment to this card',
      inputSchema: z.object({
        content: z.string().describe('The comment text'),
      }),
      execute: async ({ content }) => {
        const [comment] = await db
          .insert(cardComments)
          .values({
            cardId,
            content,
          })
          .returning();
        return { success: true, commentId: comment.id };
      },
    }),

    updateDescription: tool({
      description: 'Update the description of this card',
      inputSchema: z.object({
        description: z.string().describe('The new card description'),
      }),
      execute: async ({ description }) => {
        await db.update(cards).set({ description, updatedAt: new Date() }).where(eq(cards.id, cardId));
        return { success: true };
      },
    }),

    createCard: tool({
      description:
        'Create a new card in the same column as this card. Keep the description to 1-2 sentences — use addChecklistItem separately for tasks.',
      inputSchema: z.object({
        title: z.string().describe('Short, clear title for the new card'),
        description: z
          .string()
          .optional()
          .describe(
            'Brief 1-2 sentence summary. Do NOT include task lists or steps here — use addChecklistItem instead',
          ),
        priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().describe('Priority level'),
      }),
      execute: async ({ title, description, priority }) => {
        // Get current card's column
        const [currentCard] = await db.select({ columnId: cards.columnId }).from(cards).where(eq(cards.id, cardId));
        if (!currentCard) return { success: false, error: 'Current card not found' };

        // Count existing cards for position
        const existing = await db.select().from(cards).where(eq(cards.columnId, currentCard.columnId));

        const [newCard] = await db
          .insert(cards)
          .values({
            columnId: currentCard.columnId,
            title,
            description: description ?? null,
            priority: priority ?? 'medium',
            position: existing.length,
          })
          .returning();

        // Get column name for result
        const [col] = await db.select({ name: columns.name }).from(columns).where(eq(columns.id, currentCard.columnId));

        return {
          success: true,
          cardId: newCard.id,
          card: { id: newCard.id, title: newCard.title, column: col?.name ?? 'Unknown' },
          hint: 'Use this cardId as targetCardId in addChecklistItem to add checklist items to the new card.',
        };
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// Message Persistence
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Thread CRUD
// ---------------------------------------------------------------------------

export async function getThreads(cardId: string): Promise<CardAgentThread[]> {
  const db = getDb();

  // Step 1: fetch all threads for this card
  const threads = await db
    .select()
    .from(cardAgentThreads)
    .where(eq(cardAgentThreads.cardId, cardId))
    .orderBy(desc(cardAgentThreads.createdAt));

  if (threads.length === 0) return [];

  // Step 2: count messages per thread (single query, group by threadId)
  const threadIds = threads.map((t) => t.id);
  const counts = await db
    .select({
      threadId: cardAgentMessages.threadId,
      value: count(),
    })
    .from(cardAgentMessages)
    .where(inArray(cardAgentMessages.threadId, threadIds))
    .groupBy(cardAgentMessages.threadId);

  const countMap = new Map(counts.map((c) => [c.threadId, c.value]));

  return threads.map((t) => ({
    id: t.id,
    cardId: t.cardId,
    title: t.title,
    createdAt: t.createdAt.toISOString(),
    messageCount: countMap.get(t.id) ?? 0,
  }));
}

export async function createThread(cardId: string, title: string): Promise<CardAgentThread> {
  const db = getDb();
  const [row] = await db
    .insert(cardAgentThreads)
    .values({
      cardId,
      title,
    })
    .returning();
  return {
    id: row.id,
    cardId: row.cardId,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    messageCount: 0,
  };
}

export async function deleteThread(threadId: string): Promise<void> {
  const db = getDb();
  await db.delete(cardAgentThreads).where(eq(cardAgentThreads.id, threadId));
}

// ---------------------------------------------------------------------------
// Message Persistence
// ---------------------------------------------------------------------------

export async function getMessages(cardId: string, threadId?: string): Promise<CardAgentMessage[]> {
  const db = getDb();
  const condition = threadId
    ? and(eq(cardAgentMessages.cardId, cardId), eq(cardAgentMessages.threadId, threadId))
    : eq(cardAgentMessages.cardId, cardId);
  const rows = await db.select().from(cardAgentMessages).where(condition).orderBy(asc(cardAgentMessages.createdAt));
  return rows.map(toMessage);
}

export async function addMessage(
  cardId: string,
  role: CardAgentMessage['role'],
  content: string | null,
  toolCalls?: ToolCallRecord[],
  toolResults?: ToolResultRecord[],
  threadId?: string,
): Promise<CardAgentMessage> {
  const db = getDb();
  const [row] = await db
    .insert(cardAgentMessages)
    .values({
      cardId,
      role,
      content,
      toolCalls: toolCalls ?? null,
      toolResults: toolResults ?? null,
      threadId: threadId ?? null,
    })
    .returning();
  return toMessage(row);
}

export async function clearMessages(cardId: string): Promise<void> {
  const db = getDb();
  await db.delete(cardAgentMessages).where(eq(cardAgentMessages.cardId, cardId));
}

export async function getMessageCount(cardId: string, threadId?: string): Promise<number> {
  const db = getDb();
  const condition = threadId
    ? and(eq(cardAgentMessages.cardId, cardId), eq(cardAgentMessages.threadId, threadId))
    : eq(cardAgentMessages.cardId, cardId);
  const [{ value }] = await db.select({ value: count() }).from(cardAgentMessages).where(condition);
  return value;
}

// ---------------------------------------------------------------------------
// Agent Action Collector
// ---------------------------------------------------------------------------

/** Human-readable descriptions for tool results */
const TOOL_DESCRIPTIONS: Record<string, (input: Record<string, unknown>) => string> = {
  getCardDetails: (input) => `Looked up card ${(input.cardId as string)?.slice(0, 8)}...`,
  searchProjectCards: (input) => `Searched for "${input.query}"`,
  addChecklistItem: (input) => `Added checklist item: ${input.title}`,
  toggleChecklistItem: (input) => `${input.completed ? 'Completed' : 'Uncompleted'} checklist item`,
  addComment: () => 'Added a comment',
  updateDescription: () => 'Updated card description',
  createCard: (input) => `Created card: ${input.title}`,
};

export function collectAgentActions(
  toolCalls: Array<{ toolName: string; input: Record<string, unknown> }>,
  toolResults: Array<{ success?: boolean }>,
): AgentAction[] {
  return toolCalls.map((call, i) => {
    const descFn = TOOL_DESCRIPTIONS[call.toolName];
    return {
      toolName: call.toolName,
      description: descFn ? descFn(call.input) : `Used ${call.toolName}`,
      success: toolResults[i]?.success !== false,
    };
  });
}
