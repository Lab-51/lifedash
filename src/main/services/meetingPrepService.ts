// === FILE PURPOSE ===
// Meeting prep service — gathers project context (recent card changes, pending
// action items, high-priority cards) and generates an AI briefing for upcoming meetings.

import { eq, gte, desc, and, or, inArray } from 'drizzle-orm';
import { getDb } from '../db/connection';
import {
  projects, boards, columns, cards, cardActivities,
  meetings, actionItems,
} from '../db/schema';
import { resolveTaskModel, generate } from './ai-provider';
import { createLogger } from './logger';
import type { MeetingPrepData } from '../../shared/types';

const log = createLogger('MeetingPrep');

export async function generateMeetingPrep(projectId: string): Promise<MeetingPrepData> {
  const db = getDb();

  // a. Get project name
  const [project] = await db
    .select({ name: projects.name })
    .from(projects)
    .where(eq(projects.id, projectId));

  if (!project) throw new Error(`Project not found: ${projectId}`);

  // b. Find last completed meeting for this project
  const [lastMeeting] = await db
    .select({
      title: meetings.title,
      endedAt: meetings.endedAt,
    })
    .from(meetings)
    .where(
      and(
        eq(meetings.projectId, projectId),
        eq(meetings.status, 'completed'),
      ),
    )
    .orderBy(desc(meetings.endedAt))
    .limit(1);

  const sinceAnchor = lastMeeting?.endedAt
    ? new Date(lastMeeting.endedAt)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // c. Query card activities since last meeting
  const recentActivities = await db
    .select({
      action: cardActivities.action,
      details: cardActivities.details,
      cardTitle: cards.title,
      columnName: columns.name,
      cardCompleted: cards.completed,
    })
    .from(cardActivities)
    .innerJoin(cards, eq(cardActivities.cardId, cards.id))
    .innerJoin(columns, eq(cards.columnId, columns.id))
    .innerJoin(boards, eq(columns.boardId, boards.id))
    .innerJoin(projects, eq(boards.projectId, projects.id))
    .where(
      and(
        eq(projects.id, projectId),
        gte(cardActivities.createdAt, sinceAnchor),
        inArray(cardActivities.action, ['created', 'moved', 'updated']),
      ),
    )
    .orderBy(desc(cardActivities.createdAt));

  // d. Parse card changes
  const created: { title: string; column: string }[] = [];
  const completed: { title: string }[] = [];
  const moved: { title: string; from: string; to: string }[] = [];

  for (const activity of recentActivities) {
    if (activity.action === 'created') {
      created.push({ title: activity.cardTitle, column: activity.columnName });
    } else if (activity.action === 'moved') {
      let from = '';
      let to = activity.columnName;
      if (activity.details) {
        try {
          const parsed = JSON.parse(activity.details);
          if (parsed.fromColumn) from = parsed.fromColumn;
          if (parsed.toColumn) to = parsed.toColumn;
        } catch {
          // ignore malformed details
        }
      }
      moved.push({ title: activity.cardTitle, from, to });
    }
    // Check if a card that was updated is now completed
    if (activity.cardCompleted && activity.action === 'updated') {
      completed.push({ title: activity.cardTitle });
    }
  }

  // e. Query pending action items from project's meetings
  const pendingActions = await db
    .select({
      description: actionItems.description,
      meetingTitle: meetings.title,
    })
    .from(actionItems)
    .innerJoin(meetings, eq(actionItems.meetingId, meetings.id))
    .where(
      and(
        eq(meetings.projectId, projectId),
        or(
          eq(actionItems.status, 'pending'),
          eq(actionItems.status, 'approved'),
        ),
      ),
    );

  // f. Query high-priority cards (not archived, in this project)
  const highPriorityCards = await db
    .select({
      title: cards.title,
      columnName: columns.name,
      dueDate: cards.dueDate,
    })
    .from(cards)
    .innerJoin(columns, eq(cards.columnId, columns.id))
    .innerJoin(boards, eq(columns.boardId, boards.id))
    .where(
      and(
        eq(boards.projectId, projectId),
        eq(cards.archived, false),
        or(
          eq(cards.priority, 'high'),
          eq(cards.priority, 'urgent'),
        ),
      ),
    );

  // g. Generate AI briefing
  const provider = await resolveTaskModel('meeting_prep');
  if (!provider) throw new Error('No AI provider configured. Go to Settings to add one.');

  const createdText = created.length > 0
    ? created.map(c => `- "${c.title}" added to ${c.column}`).join('\n')
    : 'None';

  const completedText = completed.length > 0
    ? completed.map(c => `- "${c.title}"`).join('\n')
    : 'None';

  const movedText = moved.length > 0
    ? moved.map(m => `- "${m.title}" from ${m.from || '?'} to ${m.to}`).join('\n')
    : 'None';

  const pendingActionsText = pendingActions.length > 0
    ? pendingActions.map(a => `- "${a.description}" (from: ${a.meetingTitle})`).join('\n')
    : 'None';

  const highPriorityText = highPriorityCards.length > 0
    ? highPriorityCards.map(c => {
        const due = c.dueDate ? ` (due: ${new Date(c.dueDate).toLocaleDateString()})` : '';
        return `- "${c.title}" in ${c.columnName}${due}`;
      }).join('\n')
    : 'None';

  const lastMeetingInfo = lastMeeting
    ? `Last meeting: "${lastMeeting.title}" on ${new Date(lastMeeting.endedAt!).toLocaleDateString()}`
    : 'No previous meetings for this project.';

  const prompt = `Generate a concise meeting prep briefing for the project "${project.name}".

${lastMeetingInfo}

Cards created since last meeting:
${createdText}

Cards completed:
${completedText}

Cards moved:
${movedText}

Pending action items from previous meetings:
${pendingActionsText}

High-priority cards:
${highPriorityText}

Write a brief (3-5 bullet points) covering:
1. Key progress since the last meeting
2. Outstanding action items that need follow-up
3. High-priority items requiring attention
4. Suggested talking points for the upcoming meeting

Be concise and actionable. Use markdown bullet points.`;

  let aiBriefing: string;
  try {
    const result = await generate({
      providerId: provider.providerId,
      providerName: provider.providerName,
      apiKeyEncrypted: provider.apiKeyEncrypted,
      baseUrl: provider.baseUrl,
      model: provider.model,
      taskType: 'meeting_prep',
      prompt,
      temperature: 0.7,
      maxTokens: 600,
    });

    if (!result.text) {
      throw new Error(`AI provider (${provider.providerName}/${provider.model}) returned empty text.`);
    }
    aiBriefing = result.text;
  } catch (err) {
    log.error('Meeting prep AI generation failed:', err);
    const parts: string[] = ['AI analysis unavailable.'];
    parts.push(`Project has ${created.length} new cards and ${completed.length} completed cards.`);
    if (moved.length > 0) parts.push(`${moved.length} cards moved since last meeting.`);
    if (pendingActions.length > 0) parts.push(`${pendingActions.length} pending action items from previous meetings.`);
    if (highPriorityCards.length > 0) parts.push(`${highPriorityCards.length} high-priority cards need attention.`);
    aiBriefing = parts.join(' ');
  }

  // h. Return full MeetingPrepData
  return {
    projectName: project.name,
    lastMeetingTitle: lastMeeting?.title ?? null,
    lastMeetingDate: lastMeeting?.endedAt
      ? new Date(lastMeeting.endedAt).toISOString()
      : null,
    cardChanges: { created, completed, moved },
    pendingActions: pendingActions.map(a => ({
      description: a.description,
      meetingTitle: a.meetingTitle,
    })),
    highPriorityCards: highPriorityCards.map(c => ({
      title: c.title,
      column: c.columnName,
      dueDate: c.dueDate ? new Date(c.dueDate).toISOString() : null,
    })),
    aiBriefing,
  };
}
