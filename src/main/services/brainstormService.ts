// === FILE PURPOSE ===
// Brainstorming service — session CRUD, message management, context building,
// and export-to-idea functionality.
//
// === DEPENDENCIES ===
// drizzle-orm, DB schema (brainstorming, projects, boards, meetings, ideas), connection
//
// === LIMITATIONS ===
// - Context injection is read-only (project data -> system prompt, no tool calls)
// - No message editing or deletion (append-only conversation)
// - Card/idea/meeting context limited to most recent items to manage token usage
//
// === VERIFICATION STATUS ===
// - DB schema: brainstorming.ts created in this task
// - streamText API: verified from node_modules/ai/dist/index.d.ts
// - Shared types: updated in types.ts

import { eq, desc, asc, and, inArray, not } from 'drizzle-orm';
import { getDb } from '../db/connection';
import {
  brainstormSessions, brainstormMessages,
  projects, boards, columns, cards, meetings, meetingBriefs, ideas,
} from '../db/schema';
import type {
  BrainstormSession, BrainstormMessage, BrainstormSessionWithMessages,
  CreateBrainstormSessionInput, BrainstormSessionStatus, Idea,
} from '../../shared/types';

// ---------------------------------------------------------------------------
// Row Mappers
// ---------------------------------------------------------------------------

function toSession(row: typeof brainstormSessions.$inferSelect): BrainstormSession {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    status: row.status as BrainstormSessionStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toMessage(row: typeof brainstormMessages.$inferSelect): BrainstormMessage {
  return {
    id: row.id,
    sessionId: row.sessionId,
    role: row.role as 'user' | 'assistant',
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// System Prompt
// ---------------------------------------------------------------------------

function getBaseSystemPrompt(): string {
  return `You are a brainstorming partner. You have a STRICT conversational style — short messages, one question at a time, back-and-forth dialogue.

## HARD RULES (never violate these)

1. YOUR FIRST RESPONSE TO ANY NEW TOPIC MUST BE 2-4 SENTENCES. No exceptions. Ask ONE question to understand the user's situation better.
2. NEVER list more than 2 examples or ideas in a single message. After giving 1-2 examples, say "Want me to expand on these or explore more options?"
3. NEVER combine questions with brainstorming. Either ask a question OR share ideas — not both in the same message.
4. NEVER produce more than ~120 words per message until the user has answered at least 2 of your questions.
5. ONE question per message. Do not stack multiple questions.
6. Keep responses SHORT and scannable. Prefer 2-3 concise sentences over long paragraphs. No walls of text.

## How to start

When the user describes what they want to brainstorm:
- Acknowledge their topic in one sentence
- Ask ONE focused question to understand their situation better
- End with a choices tag (see below)

Example first response for "improve pricing model":
"Interesting — pricing is one of the highest-leverage things to get right. What's your biggest concern with the current model?
<!-- choices: single|Not enough conversions|Too much churn|Underpriced|Too complex|Starting from scratch -->"

That's it. Short. One question. Choices for easy reply.

## Selectable options (chips)

End your message with ONE of these tags on its own line:
- Pick one: <!-- choices: single|Option A|Option B|Option C -->
- Pick many: <!-- choices: multi|Option A|Option B|Option C -->

Rules:
- Place the tag AFTER all visible text, on its own line
- 3-5 options, each 2-6 words
- Use on MOST messages (questions and idea proposals)
- Do NOT mention the tag in your visible text — the user sees clickable buttons

## Conversation flow

Round 1: Understand the topic (ask what, who, or why)
Round 2: Narrow the focus (ask about constraints, goals, or priorities)
Round 3+: Start sharing ideas — but only 2-3 at a time, then ask which to explore deeper

The user can say "just give me ideas" to skip questions — then give 1-2 ideas max and ask which to develop or if they want more.

## Context awareness

When project context is provided below, use it. Don't re-ask what the context already tells you.`;
}

// ---------------------------------------------------------------------------
// Exported Functions
// ---------------------------------------------------------------------------

/**
 * List all brainstorm sessions ordered by most recently updated.
 */
export async function getSessions(): Promise<BrainstormSession[]> {
  const db = getDb();
  const rows = await db.select().from(brainstormSessions)
    .orderBy(desc(brainstormSessions.updatedAt));
  return rows.map(toSession);
}

/**
 * Get a single session with all its messages.
 */
export async function getSession(id: string): Promise<BrainstormSessionWithMessages | null> {
  const db = getDb();
  const [sessionRow] = await db.select().from(brainstormSessions)
    .where(eq(brainstormSessions.id, id));
  if (!sessionRow) return null;

  const messageRows = await db.select().from(brainstormMessages)
    .where(eq(brainstormMessages.sessionId, id))
    .orderBy(asc(brainstormMessages.createdAt));

  return {
    ...toSession(sessionRow),
    messages: messageRows.map(toMessage),
  };
}

/**
 * Create a new brainstorm session.
 */
export async function createSession(data: CreateBrainstormSessionInput): Promise<BrainstormSession> {
  const db = getDb();
  const [row] = await db.insert(brainstormSessions).values({
    title: data.title,
    projectId: data.projectId ?? null,
  }).returning();
  return toSession(row);
}

/**
 * Update a session's title or status.
 */
export async function updateSession(
  id: string,
  data: { title?: string; status?: BrainstormSessionStatus },
): Promise<BrainstormSession> {
  const db = getDb();
  const updateObj: Record<string, unknown> = { updatedAt: new Date() };
  if (data.title !== undefined) updateObj.title = data.title;
  if (data.status !== undefined) updateObj.status = data.status;

  const [row] = await db.update(brainstormSessions)
    .set(updateObj)
    .where(eq(brainstormSessions.id, id))
    .returning();
  if (!row) throw new Error(`Session not found: ${id}`);
  return toSession(row);
}

/**
 * Delete a session (cascade deletes messages).
 */
export async function deleteSession(id: string): Promise<void> {
  const db = getDb();
  await db.delete(brainstormSessions).where(eq(brainstormSessions.id, id));
}

/**
 * Append a message to a session and touch the session's updatedAt.
 */
export async function addMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
): Promise<BrainstormMessage> {
  const db = getDb();
  const [row] = await db.insert(brainstormMessages).values({
    sessionId,
    role,
    content,
  }).returning();

  // Touch session updatedAt
  await db.update(brainstormSessions)
    .set({ updatedAt: new Date() })
    .where(eq(brainstormSessions.id, sessionId));

  return toMessage(row);
}

/**
 * Get ordered message history for a session.
 */
export async function getMessages(sessionId: string): Promise<BrainstormMessage[]> {
  const db = getDb();
  const rows = await db.select().from(brainstormMessages)
    .where(eq(brainstormMessages.sessionId, sessionId))
    .orderBy(asc(brainstormMessages.createdAt));
  return rows.map(toMessage);
}

/**
 * Build system prompt with project context.
 * Injects: project info, board names, card titles, idea data, meeting briefs.
 * Queries are parallelized where possible via Promise.all.
 */
export async function buildContext(sessionId: string): Promise<string> {
  const db = getDb();

  const [session] = await db.select().from(brainstormSessions)
    .where(eq(brainstormSessions.id, sessionId));
  if (!session) return getBaseSystemPrompt();

  let context = getBaseSystemPrompt();

  if (!session.projectId) return context;

  const [project] = await db.select().from(projects)
    .where(eq(projects.id, session.projectId));
  if (!project) return context;

  context += `\n\n## Current Project: ${project.name}`;
  if (project.description) {
    context += `\nDescription: ${project.description}`;
  }

  // Parallel queries: boards, meetings, ideas
  const [projectBoards, projectMeetings, projectIdeas] = await Promise.all([
    db.select().from(boards)
      .where(eq(boards.projectId, project.id)),
    db.select({ id: meetings.id, title: meetings.title })
      .from(meetings)
      .where(eq(meetings.projectId, project.id))
      .orderBy(desc(meetings.createdAt))
      .limit(3),
    db.select({ title: ideas.title, status: ideas.status })
      .from(ideas)
      .where(and(
        eq(ideas.projectId, project.id),
        not(eq(ideas.status, 'archived')),
      ))
      .orderBy(desc(ideas.updatedAt))
      .limit(5),
  ]);

  // Board names + card titles per board
  if (projectBoards.length > 0) {
    context += `\n\n## Boards`;
    for (const board of projectBoards) {
      const boardColumns = await db.select({ id: columns.id })
        .from(columns).where(eq(columns.boardId, board.id));
      const columnIds = boardColumns.map(c => c.id);

      if (columnIds.length > 0) {
        const boardCards = await db.select({ title: cards.title })
          .from(cards)
          .where(and(
            inArray(cards.columnId, columnIds),
            eq(cards.archived, false),
          ))
          .orderBy(desc(cards.updatedAt))
          .limit(5);

        if (boardCards.length > 0) {
          context += `\n- ${board.name}: ${boardCards.map(c => c.title).join(', ')}`;
        } else {
          context += `\n- ${board.name} (no cards)`;
        }
      } else {
        context += `\n- ${board.name} (no columns)`;
      }
    }
  }

  // Recent ideas
  if (projectIdeas.length > 0) {
    context += `\n\n## Recent Ideas`;
    for (const idea of projectIdeas) {
      context += `\n- ${idea.title} (${idea.status})`;
    }
  }

  // Recent meetings with brief summaries
  if (projectMeetings.length > 0) {
    context += `\n\n## Recent Meetings`;
    for (const mtg of projectMeetings) {
      context += `\n- ${mtg.title}`;
      const [brief] = await db.select({ summary: meetingBriefs.summary })
        .from(meetingBriefs)
        .where(eq(meetingBriefs.meetingId, mtg.id))
        .orderBy(desc(meetingBriefs.createdAt))
        .limit(1);
      if (brief) {
        const truncated = brief.summary.length > 200
          ? brief.summary.slice(0, 200) + '...'
          : brief.summary;
        context += ` — ${truncated}`;
      }
    }
  }

  return context;
}

/**
 * Export an assistant message as a new board card on the linked project's first column.
 */
export async function exportToCard(
  sessionId: string,
  messageId: string,
): Promise<{
  id: string; columnId: string; title: string; description: string | null;
  position: number; priority: string; dueDate: null; archived: boolean;
  createdAt: string; updatedAt: string;
}> {
  const db = getDb();

  const [msg] = await db.select().from(brainstormMessages)
    .where(eq(brainstormMessages.id, messageId));
  if (!msg) throw new Error(`Message not found: ${messageId}`);

  const [session] = await db.select().from(brainstormSessions)
    .where(eq(brainstormSessions.id, sessionId));
  if (!session?.projectId) throw new Error('Session must be linked to a project to save as card');

  // Find the project's board
  const [board] = await db.select().from(boards)
    .where(eq(boards.projectId, session.projectId));
  if (!board) throw new Error('Project has no board');

  // Find the first column (by position)
  const [firstColumn] = await db.select().from(columns)
    .where(eq(columns.boardId, board.id))
    .orderBy(asc(columns.position))
    .limit(1);
  if (!firstColumn) throw new Error('Board has no columns');

  // Count existing cards to get position
  const existingCards = await db.select().from(cards)
    .where(eq(cards.columnId, firstColumn.id));

  // Create the title: first line stripped of markdown #, truncated to 100 chars
  const title = msg.content.split('\n')[0].replace(/^#+\s*/, '').trim().slice(0, 100) || 'Brainstorm card';

  // Create the card
  const [card] = await db.insert(cards).values({
    columnId: firstColumn.id,
    title,
    description: msg.content,
    priority: 'medium',
    position: existingCards.length,
  }).returning();

  return {
    id: card.id,
    columnId: card.columnId,
    title: card.title,
    description: card.description,
    position: card.position,
    priority: card.priority,
    dueDate: null,
    archived: card.archived,
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
  };
}

/**
 * Export an assistant message as a new idea.
 * Uses the message content as the idea description and a truncated version as the title.
 */
export async function exportToIdea(
  sessionId: string,
  messageId: string,
): Promise<Idea> {
  const db = getDb();

  const [msg] = await db.select().from(brainstormMessages)
    .where(eq(brainstormMessages.id, messageId));
  if (!msg) throw new Error(`Message not found: ${messageId}`);

  const [session] = await db.select().from(brainstormSessions)
    .where(eq(brainstormSessions.id, sessionId));

  const [ideaRow] = await db.insert(ideas).values({
    title: msg.content.slice(0, 100).replace(/\n/g, ' ').trim(),
    description: msg.content,
    projectId: session?.projectId ?? null,
    status: 'new',
  }).returning();

  return {
    id: ideaRow.id,
    projectId: ideaRow.projectId,
    title: ideaRow.title,
    description: ideaRow.description,
    status: ideaRow.status as 'new',
    effort: ideaRow.effort as null,
    impact: ideaRow.impact as null,
    tags: [],
    createdAt: ideaRow.createdAt.toISOString(),
    updatedAt: ideaRow.updatedAt.toISOString(),
  };
}
