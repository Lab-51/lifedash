// === FILE PURPOSE ===
// Service layer for focus mode sessions.
// Handles session persistence and daily data queries.
// Achievement/level logic has moved to gamificationService.ts.

import { eq, gte, sql, desc } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { focusSessions, cards } from '../db/schema';
import { FocusSession, FocusDailyData, FocusSessionWithCard, FocusPeriodStats } from '../../shared/types/focus';

export async function saveSession(input: {
  cardId?: string;
  durationMinutes: number;
  note?: string;
}): Promise<FocusSession> {
  const db = getDb();
  const [row] = await db.insert(focusSessions).values({
    cardId: input.cardId || null,
    durationMinutes: input.durationMinutes,
    note: input.note || null,
  }).returning();

  return {
    id: row.id,
    cardId: row.cardId,
    durationMinutes: row.durationMinutes,
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
