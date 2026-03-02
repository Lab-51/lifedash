// === FILE PURPOSE ===
// Background agent service — manages preferences, daily token budget tracking,
// CRUD operations for AI-generated project insights, and AI analysis logic
// (e.g. stale card detection).

import { getDb } from '../db/connection';
import { settings, agentInsights, boards, columns, cards, projects } from '../db/schema';
import { eq, and, desc, count, lt, lte, inArray, ne } from 'drizzle-orm';
import { createLogger } from './logger';
import { generate, resolveTaskModel } from './ai-provider';
import type { BackgroundAgentPreferences, AgentInsight, InsightType, InsightSeverity, InsightStatus } from '../../shared/types/background-agent';

const log = createLogger('BackgroundAgent');

// ============================================================================
// Preferences
// ============================================================================

const SETTINGS_KEY = 'background_agent_preferences';

const DEFAULT_PREFERENCES: BackgroundAgentPreferences = {
  enabled: false,
  frequency: 'daily',
  dailyTokenBudget: 50000,
  enabledInsightTypes: ['stale_cards'],
  staleCardThresholdDays: 7,
  analyzedProjectIds: [],
};

/**
 * Load background agent preferences from the settings table.
 * Returns defaults merged with stored values for forward-compatibility.
 */
export async function getPreferences(): Promise<BackgroundAgentPreferences> {
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(settings)
      .where(eq(settings.key, SETTINGS_KEY))
      .limit(1);

    if (rows.length === 0) {
      return { ...DEFAULT_PREFERENCES };
    }

    const stored = JSON.parse(rows[0].value) as Partial<BackgroundAgentPreferences>;
    return { ...DEFAULT_PREFERENCES, ...stored };
  } catch (err) {
    log.error('Failed to load background agent preferences:', err);
    return { ...DEFAULT_PREFERENCES };
  }
}

/**
 * Update background agent preferences (partial update supported).
 * Merges new values into current preferences and upserts to DB.
 */
export async function updatePreferences(
  prefs: Partial<BackgroundAgentPreferences>,
): Promise<void> {
  const current = await getPreferences();
  const merged = { ...current, ...prefs };
  const value = JSON.stringify(merged);

  const db = getDb();
  await db
    .insert(settings)
    .values({ key: SETTINGS_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: new Date() },
    });
}

// ============================================================================
// Daily token budget tracking
// ============================================================================

const DAILY_USAGE_KEY = 'background_agent_daily_usage';

interface DailyUsage {
  date: string; // 'YYYY-MM-DD'
  tokensUsed: number;
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Get today's token usage. Resets automatically on a new day.
 */
export async function getDailyUsage(): Promise<DailyUsage> {
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(settings)
      .where(eq(settings.key, DAILY_USAGE_KEY))
      .limit(1);

    if (rows.length === 0) {
      return { date: todayString(), tokensUsed: 0 };
    }

    const stored = JSON.parse(rows[0].value) as DailyUsage;
    // Reset if it's a new day
    if (stored.date !== todayString()) {
      return { date: todayString(), tokensUsed: 0 };
    }

    return stored;
  } catch (err) {
    log.error('Failed to get daily usage:', err);
    return { date: todayString(), tokensUsed: 0 };
  }
}

/**
 * Add tokens to today's usage counter.
 */
export async function addTokenUsage(tokens: number): Promise<void> {
  const current = await getDailyUsage();
  const updated: DailyUsage = {
    date: todayString(),
    tokensUsed: current.tokensUsed + tokens,
  };
  const value = JSON.stringify(updated);

  const db = getDb();
  await db
    .insert(settings)
    .values({ key: DAILY_USAGE_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: new Date() },
    });
}

/**
 * Check whether today's token budget has been exhausted.
 */
export async function isBudgetExhausted(): Promise<boolean> {
  const [usage, prefs] = await Promise.all([getDailyUsage(), getPreferences()]);
  return usage.tokensUsed >= prefs.dailyTokenBudget;
}

// ============================================================================
// Insight CRUD
// ============================================================================

export interface GetInsightsOptions {
  status?: InsightStatus;
  type?: InsightType;
  limit?: number;
}

/**
 * Get insights for a project, optionally filtered by status and type.
 * Ordered by createdAt descending (newest first).
 */
export async function getInsights(
  projectId: string,
  options: GetInsightsOptions = {},
): Promise<AgentInsight[]> {
  const db = getDb();

  const conditions = [eq(agentInsights.projectId, projectId)];

  if (options.status) {
    conditions.push(eq(agentInsights.status, options.status));
  }
  if (options.type) {
    conditions.push(eq(agentInsights.type, options.type));
  }

  const query = db
    .select()
    .from(agentInsights)
    .where(and(...conditions))
    .orderBy(desc(agentInsights.createdAt));

  if (options.limit) {
    query.limit(options.limit);
  }

  const rows = await query;
  return rows.map(rowToInsight);
}

/**
 * Get a single insight by ID.
 */
export async function getInsightById(id: string): Promise<AgentInsight | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(agentInsights)
    .where(eq(agentInsights.id, id))
    .limit(1);

  if (rows.length === 0) return null;
  return rowToInsight(rows[0]);
}

/**
 * Count all insights with status='new' across all projects.
 * Used for notification badge counts.
 */
export async function getAllNewInsightsCount(): Promise<number> {
  const db = getDb();
  const result = await db
    .select({ count: count() })
    .from(agentInsights)
    .where(eq(agentInsights.status, 'new'));

  return result[0]?.count ?? 0;
}

/**
 * Mark an insight as read (sets status='read' and readAt=now).
 */
export async function markAsRead(id: string): Promise<void> {
  const db = getDb();
  await db
    .update(agentInsights)
    .set({ status: 'read', readAt: new Date() })
    .where(eq(agentInsights.id, id));
}

/**
 * Dismiss an insight (sets status='dismissed' and dismissedAt=now).
 */
export async function dismissInsight(id: string): Promise<void> {
  const db = getDb();
  await db
    .update(agentInsights)
    .set({ status: 'dismissed', dismissedAt: new Date() })
    .where(eq(agentInsights.id, id));
}

/**
 * Mark an insight as acted on (sets status='acted_on').
 */
export async function markActedOn(id: string): Promise<void> {
  const db = getDb();
  await db
    .update(agentInsights)
    .set({ status: 'acted_on' })
    .where(eq(agentInsights.id, id));
}

export interface CreateInsightData {
  projectId: string;
  type: InsightType;
  severity: string;
  title: string;
  summary: string;
  details?: Record<string, unknown> | null;
  relatedCardIds?: string[];
  tokenCost?: number;
}

/**
 * Insert a new insight record into the database.
 */
export async function createInsight(data: CreateInsightData): Promise<AgentInsight> {
  const db = getDb();
  const rows = await db
    .insert(agentInsights)
    .values({
      projectId: data.projectId,
      type: data.type,
      severity: data.severity,
      title: data.title,
      summary: data.summary,
      details: data.details ?? null,
      relatedCardIds: data.relatedCardIds ?? [],
      tokenCost: data.tokenCost ?? 0,
    })
    .returning();

  return rowToInsight(rows[0]);
}

/**
 * Check if an active (non-dismissed, non-acted_on) insight of the given type
 * already exists. When projectId is provided, scopes to that project;
 * when omitted, checks globally across all projects. Used for deduplication.
 */
export async function hasActiveInsight(
  type: InsightType,
  projectId?: string,
): Promise<boolean> {
  const db = getDb();
  const conditions = [
    eq(agentInsights.type, type),
    ne(agentInsights.status, 'dismissed'),
    ne(agentInsights.status, 'acted_on'),
  ];
  if (projectId) {
    conditions.push(eq(agentInsights.projectId, projectId));
  }
  const result = await db
    .select({ count: count() })
    .from(agentInsights)
    .where(and(...conditions));
  return (result[0]?.count ?? 0) > 0;
}

/**
 * Get insights across multiple projects (or all projects if no IDs specified).
 * Excludes dismissed and acted_on insights. Ordered by createdAt descending.
 */
export async function getAllProjectInsights(
  projectIds?: string[],
  limit = 50,
): Promise<AgentInsight[]> {
  const db = getDb();

  const conditions = [
    ne(agentInsights.status, 'dismissed'),
    ne(agentInsights.status, 'acted_on'),
  ];
  if (projectIds && projectIds.length > 0) {
    conditions.push(inArray(agentInsights.projectId, projectIds));
  }

  const rows = await db
    .select()
    .from(agentInsights)
    .where(and(...conditions))
    .orderBy(desc(agentInsights.createdAt))
    .limit(limit);

  return rows.map(rowToInsight);
}

/**
 * Clean up old insights:
 * 1. Delete dismissed insights older than 30 days
 * 2. Deduplicate: when multiple active insights of the same type exist
 *    (e.g. leftover per-project insights from before consolidation),
 *    dismiss all but the newest one.
 */
export async function cleanupOldInsights(): Promise<void> {
  const db = getDb();

  // 1. Delete old dismissed insights
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  await db
    .delete(agentInsights)
    .where(
      and(
        eq(agentInsights.status, 'dismissed'),
        lt(agentInsights.createdAt, cutoff),
      ),
    );

  // 2. Deduplicate visible insights of the same type — keep only the newest
  //    Includes acted_on so old insights don't linger in the panel
  const activeRows = await db
    .select()
    .from(agentInsights)
    .where(ne(agentInsights.status, 'dismissed'))
    .orderBy(desc(agentInsights.createdAt));

  const seenTypes = new Set<string>();
  const toDismiss: string[] = [];

  for (const row of activeRows) {
    if (seenTypes.has(row.type)) {
      toDismiss.push(row.id);
    } else {
      seenTypes.add(row.type);
    }
  }

  if (toDismiss.length > 0) {
    await db
      .update(agentInsights)
      .set({ status: 'dismissed', dismissedAt: new Date() })
      .where(inArray(agentInsights.id, toDismiss));

    log.info(`Deduplicated ${toDismiss.length} older insight(s)`);
  }
}

// ============================================================================
// Stale Card Analysis (consolidated across projects)
// ============================================================================

/** Names that indicate a "done" column — cards here are not stale. */
const DONE_COLUMN_NAMES = ['done', 'completed', 'archive'];

interface ProjectRef {
  id: string;
  name: string;
}

/**
 * Analyze stale cards across ALL specified projects and create a single
 * consolidated insight. Each stale card detail carries its projectId +
 * projectName so the renderer can navigate per-card.
 *
 * Returns the created insight, or null if no stale cards exist.
 */
export async function analyzeStaleCardsConsolidated(
  projectList: ProjectRef[],
): Promise<AgentInsight | null> {
  try {
    if (projectList.length === 0) return null;

    const db = getDb();

    // Check for ALL non-dismissed stale_cards insights (including acted_on)
    const existingVisible = await db
      .select()
      .from(agentInsights)
      .where(
        and(
          eq(agentInsights.type, 'stale_cards'),
          ne(agentInsights.status, 'dismissed'),
        ),
      )
      .orderBy(desc(agentInsights.createdAt));

    if (existingVisible.length > 0) {
      // Check if the newest is already a consolidated insight (has details.projects)
      const newest = existingVisible[0];
      const newestDetails = newest.details as Record<string, unknown> | null;
      const isConsolidated = newestDetails?.projects != null;

      if (isConsolidated && existingVisible.length === 1) {
        // Already have a single consolidated insight — skip
        log.info('Skipping stale card analysis — consolidated insight already exists');
        return null;
      }

      // Old per-project insights or acted_on duplicates — dismiss them all
      // so we can create a fresh consolidated one
      const idsToDismiss = existingVisible.map((r) => r.id);
      await db
        .update(agentInsights)
        .set({ status: 'dismissed', dismissedAt: new Date() })
        .where(inArray(agentInsights.id, idsToDismiss));

      log.info(`Dismissed ${idsToDismiss.length} old stale_cards insight(s) for consolidation`);
    }

    const prefs = await getPreferences();
    const thresholdDays = prefs.staleCardThresholdDays;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - thresholdDays);

    // Collect stale cards across all projects
    const allStaleCards: {
      id: string;
      title: string;
      column: string;
      daysSinceUpdate: number;
      priority: string;
      projectId: string;
      projectName: string;
    }[] = [];

    // Track per-project counts to determine anchor project
    const projectCardCounts = new Map<string, number>();

    for (const project of projectList) {
      // Step 1: Get all boards for this project
      const projectBoards = await db
        .select({ id: boards.id })
        .from(boards)
        .where(eq(boards.projectId, project.id));

      if (projectBoards.length === 0) continue;

      const boardIds = projectBoards.map((b) => b.id);

      // Step 2: Get all columns for those boards
      const projectColumns = await db
        .select({ id: columns.id, name: columns.name })
        .from(columns)
        .where(inArray(columns.boardId, boardIds));

      if (projectColumns.length === 0) continue;

      // Build column lookup and filter out "done" columns
      const columnMap = new Map<string, string>();
      const activeColumnIds: string[] = [];
      for (const col of projectColumns) {
        columnMap.set(col.id, col.name);
        if (!DONE_COLUMN_NAMES.includes(col.name.toLowerCase().trim())) {
          activeColumnIds.push(col.id);
        }
      }

      if (activeColumnIds.length === 0) continue;

      // Step 3: Get stale cards in active columns
      const staleCards = await db
        .select({
          id: cards.id,
          title: cards.title,
          columnId: cards.columnId,
          priority: cards.priority,
          updatedAt: cards.updatedAt,
        })
        .from(cards)
        .where(
          and(
            inArray(cards.columnId, activeColumnIds),
            eq(cards.archived, false),
            eq(cards.completed, false),
            lte(cards.updatedAt, cutoffDate),
          ),
        );

      if (staleCards.length === 0) continue;

      projectCardCounts.set(project.id, staleCards.length);

      for (const card of staleCards) {
        const daysSinceUpdate = Math.floor(
          (Date.now() - new Date(card.updatedAt).getTime()) / (1000 * 60 * 60 * 24),
        );
        allStaleCards.push({
          id: card.id,
          title: card.title,
          column: columnMap.get(card.columnId) ?? 'Unknown',
          daysSinceUpdate,
          priority: card.priority,
          projectId: project.id,
          projectName: project.name,
        });
      }
    }

    if (allStaleCards.length === 0) return null;

    // Determine anchor project (the one with the most stale cards)
    let anchorProjectId = projectList[0].id;
    let maxCount = 0;
    for (const [pid, cnt] of projectCardCounts) {
      if (cnt > maxCount) {
        maxCount = cnt;
        anchorProjectId = pid;
      }
    }

    // Build projects lookup map for the insight details
    const projectsMap: Record<string, string> = {};
    for (const card of allStaleCards) {
      projectsMap[card.projectId] = card.projectName;
    }

    // Build AI context covering all projects
    const contextLines = [
      `Stale cards across ${Object.keys(projectsMap).length} project(s) (not updated in ${thresholdDays}+ days):`,
      '',
    ];
    // Group by project for context
    for (const [pid, pName] of Object.entries(projectsMap)) {
      const pCards = allStaleCards.filter((c) => c.projectId === pid);
      contextLines.push(`## ${pName} (${pCards.length} card${pCards.length !== 1 ? 's' : ''}):`);
      for (const c of pCards) {
        contextLines.push(
          `- "${c.title}" (column: ${c.column}, ${c.daysSinceUpdate} days stale, priority: ${c.priority})`,
        );
      }
      contextLines.push('');
    }

    const contextString = contextLines.join('\n');

    // AI analysis
    const staleCount = allStaleCards.length;
    let summary: string;
    let tokenCost = 0;

    try {
      const resolved = await resolveTaskModel('background_agent');
      if (!resolved) {
        throw new Error('No AI provider configured');
      }

      const result = await generate({
        ...resolved,
        taskType: 'background_agent',
        system:
          'You are a project management assistant analyzing stale cards across multiple projects. Provide a brief analysis of why these cards might be stuck, and suggest 1-2 actionable next steps. Be concise (2-3 sentences max).',
        prompt: contextString,
        maxTokens: 300,
      });

      summary = result.text || 'Analysis could not be generated.';
      tokenCost = result.usage?.totalTokens ?? 0;

      if (tokenCost > 0) {
        await addTokenUsage(tokenCost);
      }
    } catch (aiErr) {
      log.error('AI analysis failed for stale cards, using fallback:', aiErr);
      summary = "These cards may need attention as they haven't been updated recently.";
    }

    // Determine severity based on total count
    let severity: InsightSeverity;
    if (staleCount >= 6) {
      severity = 'critical';
    } else if (staleCount >= 3) {
      severity = 'warning';
    } else {
      severity = 'info';
    }

    // Create single consolidated insight
    const insight = await createInsight({
      projectId: anchorProjectId,
      type: 'stale_cards',
      severity,
      title: `${staleCount} card${staleCount !== 1 ? 's' : ''} haven't been updated in ${thresholdDays}+ days`,
      summary,
      details: {
        staleCards: allStaleCards.map((c) => ({
          id: c.id,
          title: c.title,
          column: c.column,
          daysSinceUpdate: c.daysSinceUpdate,
          priority: c.priority,
          projectId: c.projectId,
          projectName: c.projectName,
        })),
        projects: projectsMap,
      },
      relatedCardIds: allStaleCards.map((c) => c.id),
      tokenCost,
    });

    const projectNames = Object.values(projectsMap).join(', ');
    log.info(
      `Consolidated stale card insight created: ${staleCount} card(s) across [${projectNames}], severity=${severity}`,
    );
    return insight;
  } catch (err) {
    log.error('analyzeStaleCardsConsolidated failed:', err);
    return null;
  }
}

// ============================================================================
// Internal helpers
// ============================================================================

type InsightRow = typeof agentInsights.$inferSelect;

function rowToInsight(row: InsightRow): AgentInsight {
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type as InsightType,
    severity: row.severity as AgentInsight['severity'],
    status: row.status as AgentInsight['status'],
    title: row.title,
    summary: row.summary ?? '',
    details: (row.details as Record<string, unknown> | null) ?? null,
    relatedCardIds: (row.relatedCardIds as string[]) ?? [],
    tokenCost: row.tokenCost ?? 0,
    createdAt: row.createdAt,
    readAt: row.readAt ?? null,
    dismissedAt: row.dismissedAt ?? null,
  };
}
