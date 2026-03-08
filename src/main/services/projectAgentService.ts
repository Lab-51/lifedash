// === FILE PURPOSE ===
// Project agent service — per-project AI agent with tool calling.
// Builds project context, defines 8 tools, manages conversation messages.
//
// === DEPENDENCIES ===
// ai (tool, z from zod via ai), drizzle-orm, DB schema
//
// === LIMITATIONS ===
// - Tools auto-execute (no mid-stream approval)
// - Agent conversation is per-project (not shared across projects)
// - PGlite cannot join the same table twice — use inArray chaining instead

import { tool } from 'ai';
import { z } from 'zod';
import { eq, asc, desc, and, ilike, inArray, count, isNull, sql } from 'drizzle-orm';
import { getDb } from '../db/connection';
import {
  projects, boards, columns, cards,
  cardActivities, meetings, meetingBriefs, actionItems,
  projectAgentMessages, projectAgentThreads,
} from '../db/schema';
import type { ProjectAgentMessage, ProjectAgentThread, ToolCallRecord, ToolResultRecord, ProjectAgentAction } from '../../shared/types';
import { createLogger } from './logger';

const log = createLogger('ProjectAgent');

// ---------------------------------------------------------------------------
// Row Mapper
// ---------------------------------------------------------------------------

function toMessage(row: typeof projectAgentMessages.$inferSelect): ProjectAgentMessage {
  return {
    id: row.id,
    projectId: row.projectId,
    threadId: row.threadId ?? null,
    role: row.role as ProjectAgentMessage['role'],
    content: row.content,
    toolCalls: row.toolCalls as ToolCallRecord[] | null,
    toolResults: row.toolResults as ToolResultRecord[] | null,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Context Builder
// ---------------------------------------------------------------------------

export async function buildProjectContext(projectId: string): Promise<string> {
  const db = getDb();

  // Fetch the project
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return 'Project not found.';

  // Fetch all boards for this project
  const projectBoards = await db.select().from(boards)
    .where(eq(boards.projectId, projectId))
    .orderBy(asc(boards.position));

  const boardIds = projectBoards.map(b => b.id);

  // Fetch columns and meeting data in parallel
  const [projectColumns, projectMeetings] = await Promise.all([
    boardIds.length > 0
      ? db.select().from(columns)
          .where(inArray(columns.boardId, boardIds))
          .orderBy(asc(columns.position))
      : Promise.resolve([]),
    db.select({ id: meetings.id, title: meetings.title })
      .from(meetings)
      .where(eq(meetings.projectId, projectId))
      .orderBy(desc(meetings.createdAt))
      .limit(10),
  ]);

  const columnIds = projectColumns.map(c => c.id);

  // Fetch cards, meeting briefs, and action items in parallel
  const meetingIds = projectMeetings.map(m => m.id);
  const [projectCards, recentBriefs, pendingActionItems] = await Promise.all([
    columnIds.length > 0
      ? db.select({
          id: cards.id,
          title: cards.title,
          columnId: cards.columnId,
          priority: cards.priority,
          completed: cards.completed,
          dueDate: cards.dueDate,
        }).from(cards)
          .where(and(inArray(cards.columnId, columnIds), eq(cards.archived, false)))
      : Promise.resolve([]),
    meetingIds.length > 0
      ? db.select({
          id: meetingBriefs.id,
          meetingId: meetingBriefs.meetingId,
          summary: meetingBriefs.summary,
          createdAt: meetingBriefs.createdAt,
        }).from(meetingBriefs)
          .where(inArray(meetingBriefs.meetingId, meetingIds))
          .orderBy(desc(meetingBriefs.createdAt))
          .limit(3)
      : Promise.resolve([]),
    meetingIds.length > 0
      ? db.select({ value: count() }).from(actionItems)
          .where(and(
            inArray(actionItems.meetingId, meetingIds),
            eq(actionItems.status, 'pending'),
          ))
      : Promise.resolve([{ value: 0 }]),
  ]);

  // Fetch recent card activities (up to 5)
  const cardIds = projectCards.map(c => c.id);
  const recentActivities = cardIds.length > 0
    ? await db.select({
        id: cardActivities.id,
        cardId: cardActivities.cardId,
        action: cardActivities.action,
        createdAt: cardActivities.createdAt,
      }).from(cardActivities)
        .where(inArray(cardActivities.cardId, cardIds))
        .orderBy(desc(cardActivities.createdAt))
        .limit(5)
    : [];

  // Build lookup maps
  const boardMap = new Map(projectBoards.map(b => [b.id, b]));
  const columnMap = new Map(projectColumns.map(c => [c.id, c]));
  const cardMap = new Map(projectCards.map(c => [c.id, c]));
  const meetingTitleMap = new Map(projectMeetings.map(m => [m.id, m.title]));

  // Summary stats
  const totalCards = projectCards.length;
  const completedCards = projectCards.filter(c => c.completed).length;
  const completionPercent = totalCards > 0
    ? Math.round((completedCards / totalCards) * 100)
    : 0;
  const now = new Date();
  const overdueCount = projectCards.filter(
    c => !c.completed && c.dueDate && new Date(c.dueDate) < now,
  ).length;

  const byPriority: Record<string, number> = { low: 0, medium: 0, high: 0, urgent: 0 };
  for (const card of projectCards) {
    byPriority[card.priority] = (byPriority[card.priority] ?? 0) + 1;
  }

  // Build system prompt
  let ctx = `You are a project management AI assistant for "${project.name}". You can browse boards,
inspect cards, move cards between columns, create new boards, and analyze project health.
Use your tools to gather specific information before answering questions.

## Project
Name: ${project.name}
${project.description ? `Description: ${project.description}\n` : ''}
## Summary Stats
Total cards: ${totalCards} | Completed: ${completedCards} (${completionPercent}%)
Overdue: ${overdueCount} | Pending action items: ${pendingActionItems[0]?.value ?? 0}
Priority breakdown: Low ${byPriority.low} / Medium ${byPriority.medium} / High ${byPriority.high} / Urgent ${byPriority.urgent}

## Boards (${projectBoards.length})`;

  for (const board of projectBoards) {
    const boardColumns = projectColumns.filter(c => c.boardId === board.id);
    ctx += `\n### ${board.name}`;
    for (const col of boardColumns) {
      const colCards = projectCards.filter(c => c.columnId === col.id);
      const recentTitles = colCards.slice(0, 5).map(c => c.title);
      ctx += `\n  - ${col.name} (${colCards.length} cards)`;
      if (recentTitles.length > 0) {
        ctx += `: ${recentTitles.join(', ')}${colCards.length > 5 ? ', ...' : ''}`;
      }
    }
  }

  if (recentBriefs.length > 0) {
    ctx += '\n\n## Recent Meeting Briefs';
    for (const brief of recentBriefs) {
      const title = meetingTitleMap.get(brief.meetingId) ?? 'Untitled meeting';
      const excerpt = brief.summary.length > 200
        ? brief.summary.slice(0, 200) + '...'
        : brief.summary;
      ctx += `\n- **${title}**: ${excerpt}`;
    }
  }

  if (recentActivities.length > 0) {
    ctx += '\n\n## Recent Activity';
    for (const activity of recentActivities) {
      const card = cardMap.get(activity.cardId);
      const cardTitle = card?.title ?? 'Unknown card';
      ctx += `\n- ${activity.action}: "${cardTitle}" (${activity.createdAt.toISOString().slice(0, 10)})`;
    }
  }

  log.debug('Built project context', { projectId, totalCards, boards: projectBoards.length });
  return ctx;
}

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

export function createProjectAgentTools(projectId: string) {
  const db = getDb();

  return {
    listBoards: tool({
      description: 'List all boards in this project with their columns',
      inputSchema: z.object({}),
      execute: async () => {
        const projectBoards = await db.select().from(boards)
          .where(eq(boards.projectId, projectId))
          .orderBy(asc(boards.position));

        if (projectBoards.length === 0) return { boards: [] };

        const boardIds = projectBoards.map(b => b.id);
        const boardColumns = await db.select().from(columns)
          .where(inArray(columns.boardId, boardIds))
          .orderBy(asc(columns.position));

        const result = projectBoards.map(board => ({
          id: board.id,
          name: board.name,
          columns: boardColumns
            .filter(c => c.boardId === board.id)
            .map(c => ({ id: c.id, name: c.name })),
        }));

        return { boards: result };
      },
    }),

    listColumnCards: tool({
      description: 'List cards in a specific column (up to 20)',
      inputSchema: z.object({
        columnId: z.string().uuid().describe('The ID of the column to list cards for'),
      }),
      execute: async ({ columnId }) => {
        const colCards = await db.select({
          id: cards.id,
          title: cards.title,
          priority: cards.priority,
          completed: cards.completed,
          updatedAt: cards.updatedAt,
        }).from(cards)
          .where(and(eq(cards.columnId, columnId), eq(cards.archived, false)))
          .orderBy(asc(cards.position))
          .limit(20);

        return {
          cards: colCards.map(c => ({
            id: c.id,
            title: c.title,
            priority: c.priority,
            completed: c.completed,
            updatedAt: c.updatedAt.toISOString(),
          })),
        };
      },
    }),

    moveCard: tool({
      description: 'Move a card from its current column to a target column',
      inputSchema: z.object({
        cardId: z.string().uuid().describe('The ID of the card to move'),
        targetColumnId: z.string().uuid().describe('The ID of the destination column'),
      }),
      execute: async ({ cardId, targetColumnId }) => {
        // Get current card
        const [card] = await db.select({
          id: cards.id,
          title: cards.title,
          columnId: cards.columnId,
        }).from(cards).where(eq(cards.id, cardId));
        if (!card) return { success: false, error: 'Card not found' };

        // Get source and target column names sequentially (no same-table double join)
        const [sourceColumn] = await db.select({ name: columns.name })
          .from(columns).where(eq(columns.id, card.columnId));
        const [targetColumn] = await db.select({ name: columns.name })
          .from(columns).where(eq(columns.id, targetColumnId));

        if (!targetColumn) return { success: false, error: 'Target column not found' };

        // Move the card
        await db.update(cards)
          .set({ columnId: targetColumnId, updatedAt: new Date() })
          .where(eq(cards.id, cardId));

        // Log the activity
        await db.insert(cardActivities).values({
          cardId,
          action: 'moved',
          details: JSON.stringify({
            fromColumn: sourceColumn?.name ?? 'Unknown',
            toColumn: targetColumn.name,
          }),
        });

        return {
          success: true,
          cardTitle: card.title,
          fromColumn: sourceColumn?.name ?? 'Unknown',
          toColumn: targetColumn.name,
        };
      },
    }),

    createBoard: tool({
      description: 'Create a new board in this project with optional custom columns',
      inputSchema: z.object({
        name: z.string().describe('Name for the new board'),
        columns: z.array(z.string()).optional()
          .describe('Column names to create. Defaults to: To Do, In Progress, Done'),
      }),
      execute: async ({ name, columns: columnNames }) => {
        const colNames = columnNames && columnNames.length > 0
          ? columnNames
          : ['To Do', 'In Progress', 'Done'];

        // Get current board count for position
        const [{ value: boardCount }] = await db.select({ value: count() })
          .from(boards).where(eq(boards.projectId, projectId));

        const [newBoard] = await db.insert(boards).values({
          projectId,
          name,
          position: boardCount,
        }).returning();

        // Insert columns
        const insertedColumns = await db.insert(columns).values(
          colNames.map((colName, i) => ({
            boardId: newBoard.id,
            name: colName,
            position: i,
          })),
        ).returning();

        return {
          success: true,
          board: { id: newBoard.id, name: newBoard.name },
          columns: insertedColumns.map(c => ({ id: c.id, name: c.name })),
        };
      },
    }),

    getProjectStats: tool({
      description: 'Get aggregate statistics for this project: card counts by column/priority, completion rate, and overdue cards',
      inputSchema: z.object({}),
      execute: async () => {
        // Chain: project -> boards -> columns -> cards (no duplicate table joins)
        const projectBoards = await db.select({ id: boards.id, name: boards.name })
          .from(boards).where(eq(boards.projectId, projectId));

        if (projectBoards.length === 0) {
          return {
            totalCards: 0,
            byColumn: [],
            byPriority: { low: 0, medium: 0, high: 0, urgent: 0 },
            completionPercent: 0,
            overdueCount: 0,
          };
        }

        const boardIds = projectBoards.map(b => b.id);
        const projectColumns = await db.select({ id: columns.id, name: columns.name, boardId: columns.boardId })
          .from(columns).where(inArray(columns.boardId, boardIds));

        if (projectColumns.length === 0) {
          return {
            totalCards: 0,
            byColumn: [],
            byPriority: { low: 0, medium: 0, high: 0, urgent: 0 },
            completionPercent: 0,
            overdueCount: 0,
          };
        }

        const columnIds = projectColumns.map(c => c.id);
        const allCards = await db.select({
          id: cards.id,
          columnId: cards.columnId,
          priority: cards.priority,
          completed: cards.completed,
          dueDate: cards.dueDate,
        }).from(cards)
          .where(and(inArray(cards.columnId, columnIds), eq(cards.archived, false)));

        const totalCards = allCards.length;
        const completedCards = allCards.filter(c => c.completed).length;
        const completionPercent = totalCards > 0
          ? Math.round((completedCards / totalCards) * 100)
          : 0;
        const now = new Date();
        const overdueCount = allCards.filter(
          c => !c.completed && c.dueDate && new Date(c.dueDate) < now,
        ).length;

        const byPriority = { low: 0, medium: 0, high: 0, urgent: 0 };
        for (const card of allCards) {
          byPriority[card.priority] = (byPriority[card.priority] ?? 0) + 1;
        }

        const byColumn = projectColumns.map(col => ({
          columnId: col.id,
          columnName: col.name,
          cardCount: allCards.filter(c => c.columnId === col.id).length,
        }));

        return { totalCards, byColumn, byPriority, completionPercent, overdueCount };
      },
    }),

    getActionItems: tool({
      description: 'Get pending action items from meetings linked to this project',
      inputSchema: z.object({}),
      execute: async () => {
        // Get meeting IDs for this project first
        const projectMeetings = await db.select({ id: meetings.id, title: meetings.title })
          .from(meetings).where(eq(meetings.projectId, projectId));

        if (projectMeetings.length === 0) return { actionItems: [] };

        const meetingIds = projectMeetings.map(m => m.id);
        const meetingTitleMap = new Map(projectMeetings.map(m => [m.id, m.title]));

        const pendingItems = await db.select({
          id: actionItems.id,
          meetingId: actionItems.meetingId,
          description: actionItems.description,
          createdAt: actionItems.createdAt,
        }).from(actionItems)
          .where(and(
            inArray(actionItems.meetingId, meetingIds),
            eq(actionItems.status, 'pending'),
          ))
          .orderBy(desc(actionItems.createdAt));

        return {
          actionItems: pendingItems.map(item => ({
            id: item.id,
            description: item.description,
            meetingTitle: meetingTitleMap.get(item.meetingId) ?? 'Unknown meeting',
            createdAt: item.createdAt.toISOString(),
          })),
        };
      },
    }),

    getRecentActivity: tool({
      description: 'Get recent card activity across this project',
      inputSchema: z.object({
        limit: z.number().optional().default(20).describe('Max number of activities to return'),
      }),
      execute: async ({ limit }) => {
        // Chain: project -> boards -> columns -> cards -> cardActivities
        const projectBoards = await db.select({ id: boards.id })
          .from(boards).where(eq(boards.projectId, projectId));

        if (projectBoards.length === 0) return { activities: [] };

        const boardIds = projectBoards.map(b => b.id);
        const projectColumns = await db.select({ id: columns.id })
          .from(columns).where(inArray(columns.boardId, boardIds));

        if (projectColumns.length === 0) return { activities: [] };

        const columnIds = projectColumns.map(c => c.id);
        const projectCards = await db.select({ id: cards.id, title: cards.title })
          .from(cards).where(inArray(cards.columnId, columnIds));

        if (projectCards.length === 0) return { activities: [] };

        const cardIds = projectCards.map(c => c.id);
        const cardTitleMap = new Map(projectCards.map(c => [c.id, c.title]));

        const activities = await db.select({
          id: cardActivities.id,
          cardId: cardActivities.cardId,
          action: cardActivities.action,
          details: cardActivities.details,
          createdAt: cardActivities.createdAt,
        }).from(cardActivities)
          .where(inArray(cardActivities.cardId, cardIds))
          .orderBy(desc(cardActivities.createdAt))
          .limit(limit);

        return {
          activities: activities.map(a => ({
            id: a.id,
            cardTitle: cardTitleMap.get(a.cardId) ?? 'Unknown card',
            action: a.action,
            details: a.details,
            createdAt: a.createdAt.toISOString(),
          })),
        };
      },
    }),

    searchProjectCards: tool({
      description: 'Search for cards in this project by title keyword',
      inputSchema: z.object({
        query: z.string().describe('Search keyword to match against card titles'),
        limit: z.number().optional().default(10).describe('Max results to return'),
      }),
      execute: async ({ query, limit }) => {
        // Get all boards -> columns -> search cards
        const projectBoards = await db.select({ id: boards.id })
          .from(boards).where(eq(boards.projectId, projectId));

        if (projectBoards.length === 0) return { cards: [] };

        const boardIds = projectBoards.map(b => b.id);
        const projectColumns = await db.select({ id: columns.id })
          .from(columns).where(inArray(columns.boardId, boardIds));

        if (projectColumns.length === 0) return { cards: [] };

        const columnIds = projectColumns.map(c => c.id);

        const results = await db.select({
          id: cards.id,
          title: cards.title,
          priority: cards.priority,
          columnId: cards.columnId,
        }).from(cards)
          .where(and(
            inArray(cards.columnId, columnIds),
            eq(cards.archived, false),
            ilike(cards.title, `%${query}%`),
          ))
          .limit(limit);

        return { cards: results };
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// Thread CRUD
// ---------------------------------------------------------------------------

export async function getThreads(projectId: string): Promise<ProjectAgentThread[]> {
  const db = getDb();

  // Step 1: fetch all threads for this project
  const threads = await db.select().from(projectAgentThreads)
    .where(eq(projectAgentThreads.projectId, projectId))
    .orderBy(desc(projectAgentThreads.createdAt));

  if (threads.length === 0) return [];

  // Step 2: count messages per thread (single query, group by threadId)
  const threadIds = threads.map(t => t.id);
  const counts = await db.select({
    threadId: projectAgentMessages.threadId,
    value: count(),
  }).from(projectAgentMessages)
    .where(inArray(projectAgentMessages.threadId, threadIds))
    .groupBy(projectAgentMessages.threadId);

  const countMap = new Map(counts.map(c => [c.threadId, c.value]));

  return threads.map(t => ({
    id: t.id,
    projectId: t.projectId,
    title: t.title,
    createdAt: t.createdAt.toISOString(),
    messageCount: countMap.get(t.id) ?? 0,
  }));
}

export async function createThread(projectId: string, title: string): Promise<ProjectAgentThread> {
  const db = getDb();
  const [row] = await db.insert(projectAgentThreads).values({
    projectId,
    title,
  }).returning();
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    messageCount: 0,
  };
}

export async function deleteThread(threadId: string): Promise<void> {
  const db = getDb();
  await db.delete(projectAgentThreads).where(eq(projectAgentThreads.id, threadId));
}

// ---------------------------------------------------------------------------
// Message Persistence
// ---------------------------------------------------------------------------

export async function getMessages(projectId: string, threadId?: string): Promise<ProjectAgentMessage[]> {
  const db = getDb();
  const condition = threadId
    ? and(eq(projectAgentMessages.projectId, projectId), eq(projectAgentMessages.threadId, threadId))
    : eq(projectAgentMessages.projectId, projectId);
  const rows = await db.select().from(projectAgentMessages)
    .where(condition)
    .orderBy(asc(projectAgentMessages.createdAt));
  return rows.map(toMessage);
}

export async function addMessage(
  projectId: string,
  role: ProjectAgentMessage['role'],
  content: string | null,
  toolCalls?: ToolCallRecord[],
  toolResults?: ToolResultRecord[],
  threadId?: string,
): Promise<ProjectAgentMessage> {
  const db = getDb();
  const [row] = await db.insert(projectAgentMessages).values({
    projectId,
    role,
    content,
    toolCalls: toolCalls ?? null,
    toolResults: toolResults ?? null,
    threadId: threadId ?? null,
  }).returning();
  return toMessage(row);
}

export async function clearMessages(projectId: string): Promise<void> {
  const db = getDb();
  await db.delete(projectAgentMessages).where(eq(projectAgentMessages.projectId, projectId));
}

export async function getMessageCount(projectId: string, threadId?: string): Promise<number> {
  const db = getDb();
  const condition = threadId
    ? and(eq(projectAgentMessages.projectId, projectId), eq(projectAgentMessages.threadId, threadId))
    : eq(projectAgentMessages.projectId, projectId);
  const [{ value }] = await db.select({ value: count() })
    .from(projectAgentMessages)
    .where(condition);
  return value;
}

// ---------------------------------------------------------------------------
// Agent Action Collector
// ---------------------------------------------------------------------------

/** Human-readable descriptions for tool results */
const TOOL_DESCRIPTIONS: Record<string, (input: Record<string, unknown>) => string> = {
  listBoards: () => 'Listed project boards',
  listColumnCards: () => 'Listed column cards',
  moveCard: (input) => `Moved card to ${input.targetColumnId ? 'new column' : 'column'}`,
  createBoard: (input) => `Created board: ${input.name}`,
  getProjectStats: () => 'Retrieved project statistics',
  getActionItems: () => 'Retrieved pending action items',
  getRecentActivity: () => 'Retrieved recent activity',
  searchProjectCards: (input) => `Searched for "${input.query}"`,
};

export function collectAgentActions(
  toolCalls: Array<{ toolName: string; input: Record<string, unknown> }>,
  toolResults: Array<{ success?: boolean }>,
): ProjectAgentAction[] {
  return toolCalls.map((call, i) => {
    const descFn = TOOL_DESCRIPTIONS[call.toolName];
    return {
      toolName: call.toolName,
      description: descFn ? descFn(call.input) : `Used ${call.toolName}`,
      success: toolResults[i]?.success !== false,
    };
  });
}
