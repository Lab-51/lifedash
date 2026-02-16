// === FILE PURPOSE ===
// Dashboard IPC handlers — AI standup generation and activity data.

import { ipcMain } from 'electron';
import { eq, gte, desc, and, or, inArray } from 'drizzle-orm';
import { getDb } from '../db/connection';
import {
  cards, cardActivities, columns, boards, projects,
  actionItems, meetings, ideas,
} from '../db/schema';
import { resolveTaskModel, generate } from '../services/ai-provider';
import { createLogger } from '../services/logger';

const log = createLogger('Dashboard');

export function registerDashboardHandlers(): void {
  ipcMain.handle('dashboard:generate-standup', async () => {
    const db = getDb();
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // a. Query card_activities from the last 48 hours
    // Join cardActivities -> cards -> columns -> boards -> projects
    const recentActivities = await db
      .select({
        action: cardActivities.action,
        details: cardActivities.details,
        createdAt: cardActivities.createdAt,
        cardTitle: cards.title,
        columnName: columns.name,
        projectName: projects.name,
      })
      .from(cardActivities)
      .innerJoin(cards, eq(cardActivities.cardId, cards.id))
      .innerJoin(columns, eq(cards.columnId, columns.id))
      .innerJoin(boards, eq(columns.boardId, boards.id))
      .innerJoin(projects, eq(boards.projectId, projects.id))
      .where(
        and(
          gte(cardActivities.createdAt, twoDaysAgo),
          inArray(cardActivities.action, ['moved', 'created', 'updated']),
        ),
      )
      .orderBy(desc(cardActivities.createdAt));

    // b. Query pending action items from recent meetings (last 7 days)
    const pendingActions = await db
      .select({
        description: actionItems.description,
        status: actionItems.status,
        meetingTitle: meetings.title,
      })
      .from(actionItems)
      .innerJoin(meetings, eq(actionItems.meetingId, meetings.id))
      .where(
        and(
          gte(actionItems.createdAt, sevenDaysAgo),
          or(
            eq(actionItems.status, 'pending'),
            eq(actionItems.status, 'approved'),
          ),
        ),
      );

    // c. Query cards currently in flight (updated in last 7 days, not archived)
    const activeCards = await db
      .select({
        cardTitle: cards.title,
        columnName: columns.name,
        projectName: projects.name,
      })
      .from(cards)
      .innerJoin(columns, eq(cards.columnId, columns.id))
      .innerJoin(boards, eq(columns.boardId, boards.id))
      .innerJoin(projects, eq(boards.projectId, projects.id))
      .where(
        and(
          gte(cards.updatedAt, sevenDaysAgo),
          eq(cards.archived, false),
        ),
      );

    // d. Resolve AI provider
    const resolved = await resolveTaskModel('standup');
    if (!resolved) {
      throw new Error('No AI provider configured. Go to Settings to add one.');
    }

    // e. Build prompt
    const activitiesText = recentActivities.length > 0
      ? recentActivities.map(a =>
          `- [${a.action}] "${a.cardTitle}" in ${a.columnName} (${a.projectName})`,
        ).join('\n')
      : 'No recent card activity.';

    const activeCardsText = activeCards.length > 0
      ? activeCards.map(c =>
          `- "${c.cardTitle}" in ${c.columnName} (${c.projectName})`,
        ).join('\n')
      : 'No cards currently in progress.';

    const pendingActionsText = pendingActions.length > 0
      ? pendingActions.map(a =>
          `- "${a.description}" (from: ${a.meetingTitle}) [${a.status}]`,
        ).join('\n')
      : 'No pending action items.';

    const prompt = `Generate a concise daily standup report based on this activity data.
Format with 3 sections using markdown:
## What I did
## What I'm doing today
## Blockers
Use bullet points. Be specific — mention card names and project context.
Keep each section to 2-5 bullets max. If a section has no data, write "None".

Recent activity (last 48 hours):
${activitiesText}

Currently in progress:
${activeCardsText}

Pending action items from meetings:
${pendingActionsText}

Today's date: ${now.toLocaleDateString()}`;

    // f. Generate with AI
    log.info(`Standup provider: ${resolved.providerName} / ${resolved.model}`);
    log.info(`Standup prompt length: ${prompt.length} chars`);

    const result = await generate({
      providerId: resolved.providerId,
      providerName: resolved.providerName,
      apiKeyEncrypted: resolved.apiKeyEncrypted,
      baseUrl: resolved.baseUrl,
      model: resolved.model,
      taskType: 'standup',
      prompt,
      temperature: 0.7,
      maxTokens: 500,
    });

    log.info(`Standup result: ${result.text.length} chars`);
    if (!result.text) {
      throw new Error(`AI provider (${resolved.providerName}/${resolved.model}) returned empty text. Try a different provider or model in Settings.`);
    }
    return { standup: result.text };
  });

  ipcMain.handle('dashboard:activity-data', async () => {
    const db = getDb();
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const cardRows = await db
      .select({ createdAt: cards.createdAt })
      .from(cards)
      .where(gte(cards.createdAt, ninetyDaysAgo));

    const meetingRows = await db
      .select({ createdAt: meetings.createdAt })
      .from(meetings)
      .where(gte(meetings.createdAt, ninetyDaysAgo));

    const ideaRows = await db
      .select({ createdAt: ideas.createdAt })
      .from(ideas)
      .where(gte(ideas.createdAt, ninetyDaysAgo));

    const dayCounts: Record<string, number> = {};
    for (const row of [...cardRows, ...meetingRows, ...ideaRows]) {
      const dateStr = new Date(row.createdAt).toISOString().split('T')[0];
      dayCounts[dateStr] = (dayCounts[dateStr] || 0) + 1;
    }

    return { dayCounts };
  });
}
