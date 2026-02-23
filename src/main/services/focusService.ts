// === FILE PURPOSE ===
// Service layer for focus mode sessions.
// Handles session persistence and daily data queries.
// Achievement/level logic has moved to gamificationService.ts.

import { eq, gte, lte, and, sql, desc } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { focusSessions, cards, columns, boards, projects } from '../db/schema';
import { FocusSession, FocusDailyData, FocusSessionWithCard, FocusPeriodStats, FocusTimeReportOptions, FocusSessionFull, FocusProjectTime, FocusTimeReport } from '../../shared/types/focus';
import { billableHours } from '../../shared/utils/billing';

export async function saveSession(input: {
  cardId?: string;
  projectId?: string;
  durationMinutes: number;
  note?: string;
  billable?: boolean;
}): Promise<FocusSession> {
  const db = getDb();
  const [row] = await db.insert(focusSessions).values({
    cardId: input.cardId || null,
    projectId: input.projectId || null,
    durationMinutes: input.durationMinutes,
    note: input.note || null,
    billable: input.billable ?? true,
  }).returning();

  return {
    id: row.id,
    cardId: row.cardId,
    durationMinutes: row.durationMinutes,
    billable: row.billable,
    note: row.note,
    completedAt: row.completedAt.toISOString(),
  };
}

export async function getDailyData(days: number = 30): Promise<FocusDailyData[]> {
  const db = getDb();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  const rows = await db
    .select({
      date: sql<string>`to_char(${focusSessions.completedAt}, 'YYYY-MM-DD')`,
      sessions: sql<number>`count(*)::int`,
      minutes: sql<number>`coalesce(sum(${focusSessions.durationMinutes}), 0)::int`,
    })
    .from(focusSessions)
    .where(gte(focusSessions.completedAt, startDate))
    .groupBy(sql`to_char(${focusSessions.completedAt}, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(${focusSessions.completedAt}, 'YYYY-MM-DD')`);

  // Fill gaps with zero-value entries
  const result: FocusDailyData[] = [];
  const dataMap = new Map(rows.map(r => [r.date, r]));

  for (let i = 0; i < days; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const dateStr = formatDateStr(d);
    const data = dataMap.get(dateStr);
    result.push({
      date: dateStr,
      sessions: data?.sessions || 0,
      minutes: data?.minutes || 0,
    });
  }

  return result;
}

function formatDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export async function getSessionHistory(options: { offset?: number; limit?: number } = {}): Promise<{ sessions: FocusSessionWithCard[]; total: number }> {
  const db = getDb();
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  // Get total count
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(focusSessions);

  // Get paginated sessions with card title via LEFT JOIN
  const rows = await db
    .select({
      id: focusSessions.id,
      cardId: focusSessions.cardId,
      durationMinutes: focusSessions.durationMinutes,
      billable: focusSessions.billable,
      note: focusSessions.note,
      completedAt: focusSessions.completedAt,
      cardTitle: cards.title,
    })
    .from(focusSessions)
    .leftJoin(cards, eq(focusSessions.cardId, cards.id))
    .orderBy(desc(focusSessions.completedAt))
    .limit(limit)
    .offset(offset);

  return {
    sessions: rows.map(r => ({
      id: r.id,
      cardId: r.cardId,
      durationMinutes: r.durationMinutes,
      billable: r.billable,
      note: r.note,
      completedAt: r.completedAt.toISOString(),
      cardTitle: r.cardTitle ?? null,
    })),
    total: count,
  };
}

export async function getPeriodStats(): Promise<FocusPeriodStats> {
  const db = getDb();
  const now = new Date();

  // Today start
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  // This week start (Monday, ISO week)
  const weekStart = new Date(now);
  const dayOfWeek = weekStart.getDay();
  const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  weekStart.setDate(weekStart.getDate() + daysToMonday);
  weekStart.setHours(0, 0, 0, 0);

  // This month start
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Run a single query with conditional aggregation
  const [agg] = await db
    .select({
      todaySessions: sql<number>`count(*) filter (where ${focusSessions.completedAt} >= ${todayStart})::int`,
      todayMinutes: sql<number>`coalesce(sum(${focusSessions.durationMinutes}) filter (where ${focusSessions.completedAt} >= ${todayStart}), 0)::int`,
      weekSessions: sql<number>`count(*) filter (where ${focusSessions.completedAt} >= ${weekStart})::int`,
      weekMinutes: sql<number>`coalesce(sum(${focusSessions.durationMinutes}) filter (where ${focusSessions.completedAt} >= ${weekStart}), 0)::int`,
      monthSessions: sql<number>`count(*) filter (where ${focusSessions.completedAt} >= ${monthStart})::int`,
      monthMinutes: sql<number>`coalesce(sum(${focusSessions.durationMinutes}) filter (where ${focusSessions.completedAt} >= ${monthStart}), 0)::int`,
      allSessions: sql<number>`count(*)::int`,
      allMinutes: sql<number>`coalesce(sum(${focusSessions.durationMinutes}), 0)::int`,
    })
    .from(focusSessions);

  const dailyData = await getDailyData(30);

  return {
    today: { sessions: agg.todaySessions, minutes: agg.todayMinutes },
    thisWeek: { sessions: agg.weekSessions, minutes: agg.weekMinutes },
    thisMonth: { sessions: agg.monthSessions, minutes: agg.monthMinutes },
    allTime: { sessions: agg.allSessions, minutes: agg.allMinutes },
    dailyData,
  };
}

export async function getTimeReport(options: FocusTimeReportOptions): Promise<FocusTimeReport> {
  const db = getDb();
  const startDate = new Date(options.startDate + 'T00:00:00');
  const endDate = new Date(options.endDate + 'T23:59:59.999');

  // Single projects join using COALESCE in ON: prefers direct projectId, falls back to card-chain
  const projectJoin = sql`${projects.id} = COALESCE(${focusSessions.projectId}, ${boards.projectId})`;

  // Build billable filter condition
  const billableCondition = options.billableOnly === true
    ? eq(focusSessions.billable, true)
    : options.billableOnly === false
      ? eq(focusSessions.billable, false)
      : undefined;

  // Build base WHERE conditions
  const baseConditions = [
    gte(focusSessions.completedAt, startDate),
    lte(focusSessions.completedAt, endDate),
  ];
  if (options.projectId) baseConditions.push(eq(projects.id, options.projectId));
  if (billableCondition) baseConditions.push(billableCondition);
  const baseWhere = and(...baseConditions);

  // 1. Session list with project info via JOIN chain
  const sessionRows = await db
    .select({
      id: focusSessions.id,
      cardId: focusSessions.cardId,
      durationMinutes: focusSessions.durationMinutes,
      billable: focusSessions.billable,
      note: focusSessions.note,
      completedAt: focusSessions.completedAt,
      cardTitle: cards.title,
      projectId: projects.id,
      projectName: projects.name,
      projectColor: projects.color,
      hourlyRate: projects.hourlyRate,
    })
    .from(focusSessions)
    .leftJoin(cards, eq(focusSessions.cardId, cards.id))
    .leftJoin(columns, eq(cards.columnId, columns.id))
    .leftJoin(boards, eq(columns.boardId, boards.id))
    .leftJoin(projects, projectJoin)
    .where(baseWhere)
    .orderBy(desc(focusSessions.completedAt));

  const sessions: FocusSessionFull[] = sessionRows.map(r => ({
    id: r.id,
    cardId: r.cardId,
    durationMinutes: r.durationMinutes,
    billable: r.billable,
    note: r.note,
    completedAt: r.completedAt.toISOString(),
    cardTitle: r.cardTitle ?? null,
    projectId: r.projectId ?? null,
    projectName: r.projectName ?? null,
    projectColor: r.projectColor ?? null,
    hourlyRate: r.hourlyRate ?? null,
  }));

  // 2. Per-project aggregation (always uses date range, not billable filter, for full breakdown)
  const projectWhereConditions = [
    gte(focusSessions.completedAt, startDate),
    lte(focusSessions.completedAt, endDate),
  ];
  if (billableCondition) projectWhereConditions.push(billableCondition);

  const projectRows = await db
    .select({
      projectId: projects.id,
      projectName: projects.name,
      projectColor: projects.color,
      hourlyRate: projects.hourlyRate,
      sessions: sql<number>`count(*)::int`,
      minutes: sql<number>`coalesce(sum(${focusSessions.durationMinutes}), 0)::int`,
      billableMinutes: sql<number>`coalesce(sum(case when ${focusSessions.billable} then ${focusSessions.durationMinutes} else 0 end), 0)::int`,
      billableHoursSum: sql<number>`coalesce(sum(case when ${focusSessions.billable} then (case when ${focusSessions.durationMinutes} > 30 then ceil(${focusSessions.durationMinutes}::numeric / 60) else ${focusSessions.durationMinutes}::numeric / 60 end) else 0 end), 0)::numeric`,
    })
    .from(focusSessions)
    .leftJoin(cards, eq(focusSessions.cardId, cards.id))
    .leftJoin(columns, eq(cards.columnId, columns.id))
    .leftJoin(boards, eq(columns.boardId, boards.id))
    .leftJoin(projects, projectJoin)
    .where(and(...projectWhereConditions))
    .groupBy(projects.id, projects.name, projects.color, projects.hourlyRate)
    .orderBy(sql`coalesce(sum(${focusSessions.durationMinutes}), 0) desc`);

  const projectBreakdown: FocusProjectTime[] = projectRows.map(r => ({
    projectId: r.projectId ?? null,
    projectName: r.projectName ?? null,
    projectColor: r.projectColor ?? null,
    sessions: r.sessions,
    minutes: r.minutes,
    cost: r.hourlyRate != null ? Number(r.billableHoursSum) * r.hourlyRate : null,
  }));

  // 3. Summary stats
  const summaryConditions = [
    gte(focusSessions.completedAt, startDate),
    lte(focusSessions.completedAt, endDate),
  ];
  if (options.projectId) summaryConditions.push(eq(projects.id, options.projectId));
  if (billableCondition) summaryConditions.push(billableCondition);
  const summaryWhere = and(...summaryConditions);

  // For summary with project filter or billable filter, we need the JOIN chain
  const needsJoins = !!options.projectId || billableCondition !== undefined;

  const summarySelectFields = {
    totalSessions: sql<number>`count(*)::int`,
    totalMinutes: sql<number>`coalesce(sum(${focusSessions.durationMinutes}), 0)::int`,
    avgSessionMinutes: sql<number>`coalesce(round(avg(${focusSessions.durationMinutes})::numeric), 0)::int`,
    longestSessionMinutes: sql<number>`coalesce(max(${focusSessions.durationMinutes}), 0)::int`,
    activeDays: sql<number>`count(distinct to_char(${focusSessions.completedAt}, 'YYYY-MM-DD'))::int`,
    billableMinutes: sql<number>`coalesce(sum(case when ${focusSessions.billable} then ${focusSessions.durationMinutes} else 0 end), 0)::int`,
  };

  const summaryQuery = needsJoins
    ? db
        .select(summarySelectFields)
        .from(focusSessions)
        .leftJoin(cards, eq(focusSessions.cardId, cards.id))
        .leftJoin(columns, eq(cards.columnId, columns.id))
        .leftJoin(boards, eq(columns.boardId, boards.id))
        .leftJoin(projects, projectJoin)
        .where(summaryWhere)
    : db
        .select(summarySelectFields)
        .from(focusSessions)
        .where(summaryWhere);

  const [summaryRow] = await summaryQuery;

  // Compute billable cost from project breakdown totals
  const billableCost = projectBreakdown.reduce((sum, p) => sum + (p.cost ?? 0), 0);

  // 4. Daily data for the date range
  const dayCount = Math.round((new Date(options.endDate).getTime() - new Date(options.startDate).getTime()) / 86_400_000) + 1;
  const dailyData = await getDailyDataForRange(startDate, endDate, dayCount, options.projectId);

  return {
    sessions,
    projectBreakdown,
    summary: {
      totalSessions: summaryRow.totalSessions,
      totalMinutes: summaryRow.totalMinutes,
      avgSessionMinutes: summaryRow.avgSessionMinutes,
      longestSessionMinutes: summaryRow.longestSessionMinutes,
      activeDays: summaryRow.activeDays,
      billableMinutes: summaryRow.billableMinutes,
      billableCost,
    },
    dailyData,
  };
}

async function getDailyDataForRange(
  startDate: Date,
  endDate: Date,
  dayCount: number,
  projectId?: string,
): Promise<FocusDailyData[]> {
  const db = getDb();
  const projectJoin = sql`${projects.id} = COALESCE(${focusSessions.projectId}, ${boards.projectId})`;

  const baseQuery = projectId
    ? db
        .select({
          date: sql<string>`to_char(${focusSessions.completedAt}, 'YYYY-MM-DD')`,
          sessions: sql<number>`count(*)::int`,
          minutes: sql<number>`coalesce(sum(${focusSessions.durationMinutes}), 0)::int`,
        })
        .from(focusSessions)
        .leftJoin(cards, eq(focusSessions.cardId, cards.id))
        .leftJoin(columns, eq(cards.columnId, columns.id))
        .leftJoin(boards, eq(columns.boardId, boards.id))
        .leftJoin(projects, projectJoin)
        .where(and(
          gte(focusSessions.completedAt, startDate),
          lte(focusSessions.completedAt, endDate),
          eq(projects.id, projectId),
        ))
        .groupBy(sql`to_char(${focusSessions.completedAt}, 'YYYY-MM-DD')`)
        .orderBy(sql`to_char(${focusSessions.completedAt}, 'YYYY-MM-DD')`)
    : db
        .select({
          date: sql<string>`to_char(${focusSessions.completedAt}, 'YYYY-MM-DD')`,
          sessions: sql<number>`count(*)::int`,
          minutes: sql<number>`coalesce(sum(${focusSessions.durationMinutes}), 0)::int`,
        })
        .from(focusSessions)
        .where(and(
          gte(focusSessions.completedAt, startDate),
          lte(focusSessions.completedAt, endDate),
        ))
        .groupBy(sql`to_char(${focusSessions.completedAt}, 'YYYY-MM-DD')`)
        .orderBy(sql`to_char(${focusSessions.completedAt}, 'YYYY-MM-DD')`);

  const rows = await baseQuery;
  const dataMap = new Map(rows.map(r => [r.date, r]));
  const result: FocusDailyData[] = [];

  for (let i = 0; i < dayCount; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const dateStr = formatDateStr(d);
    const data = dataMap.get(dateStr);
    result.push({
      date: dateStr,
      sessions: data?.sessions || 0,
      minutes: data?.minutes || 0,
    });
  }

  return result;
}

export async function updateSession(
  id: string,
  input: { projectId?: string | null; note?: string | null; billable?: boolean },
): Promise<void> {
  const db = getDb();
  const updates: Record<string, unknown> = {};
  if ('projectId' in input) updates.projectId = input.projectId || null;
  if ('note' in input) updates.note = input.note || null;
  if ('billable' in input) updates.billable = input.billable;
  await db.update(focusSessions).set(updates).where(eq(focusSessions.id, id));
}

export async function deleteSession(id: string): Promise<void> {
  const db = getDb();
  await db.delete(focusSessions).where(eq(focusSessions.id, id));
}
