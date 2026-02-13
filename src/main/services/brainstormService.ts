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
// - buildContext queries are sequential (could be parallelized for perf)
//
// === VERIFICATION STATUS ===
// - DB schema: brainstorming.ts created in this task
// - streamText API: verified from node_modules/ai/dist/index.d.ts
// - Shared types: updated in types.ts

import { eq, desc, asc } from 'drizzle-orm';
import { getDb } from '../db/connection';
import {
  brainstormSessions, brainstormMessages,
  projects, boards, meetings, ideas,
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
  return `You are a creative brainstorming assistant. Help the user explore ideas, think through problems, and develop concepts.

Guidelines:
- Be creative and open-minded
- Ask clarifying questions when needed
- Suggest multiple perspectives and approaches
- Help structure thoughts into actionable items
- Reference project context when relevant
- Keep responses focused and practical`;
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
 * Build a system prompt with project context for the given session.
 * If the session is linked to a project, includes project name, description,
 * board names, and recent meeting titles.
 */
export async function buildContext(sessionId: string): Promise<string> {
  const db = getDb();

  const [session] = await db.select().from(brainstormSessions)
    .where(eq(brainstormSessions.id, sessionId));
  if (!session) return getBaseSystemPrompt();

  let context = getBaseSystemPrompt();

  if (session.projectId) {
    const [project] = await db.select().from(projects)
      .where(eq(projects.id, session.projectId));

    if (project) {
      context += `\n\n## Current Project: ${project.name}`;
      if (project.description) {
        context += `\nDescription: ${project.description}`;
      }

      // Load board names
      const projectBoards = await db.select().from(boards)
        .where(eq(boards.projectId, project.id));
      if (projectBoards.length > 0) {
        context += `\nBoards: ${projectBoards.map(b => b.name).join(', ')}`;
      }

      // Load recent meeting titles
      const projectMeetings = await db.select({ title: meetings.title })
        .from(meetings)
        .where(eq(meetings.projectId, project.id))
        .orderBy(desc(meetings.createdAt))
        .limit(5);
      if (projectMeetings.length > 0) {
        context += `\nRecent meetings: ${projectMeetings.map(m => m.title).join(', ')}`;
      }
    }
  }

  return context;
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
