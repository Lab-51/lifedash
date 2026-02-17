// === FILE PURPOSE ===
// Service layer for focus mode gamification.
// Handles session persistence, stats calculation, streak tracking, and achievements.

import { gte, sql, desc } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { focusSessions, focusAchievements } from '../db/schema';
import {
  FocusSession, FocusStats, FocusDailyData, FocusAchievement,
  ACHIEVEMENTS, calculateLevel,
} from '../../shared/types/focus';

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

export async function getStats(): Promise<FocusStats> {
  const db = getDb();

  // Total sessions + minutes
  const [totals] = await db
    .select({
      count: sql<number>`count(*)::int`,
      minutes: sql<number>`coalesce(sum(${focusSessions.durationMinutes}), 0)::int`,
    })
    .from(focusSessions);

  // Today's sessions + minutes
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [today] = await db
    .select({
      count: sql<number>`count(*)::int`,
      minutes: sql<number>`coalesce(sum(${focusSessions.durationMinutes}), 0)::int`,
    })
    .from(focusSessions)
    .where(gte(focusSessions.completedAt, todayStart));

  // Streak calculation: get all distinct dates with sessions
  const dateRows = await db
    .select({
      date: sql<string>`to_char(${focusSessions.completedAt}, 'YYYY-MM-DD')`,
    })
    .from(focusSessions)
    .groupBy(sql`to_char(${focusSessions.completedAt}, 'YYYY-MM-DD')`)
    .orderBy(desc(sql`to_char(${focusSessions.completedAt}, 'YYYY-MM-DD')`));

  const dates = dateRows.map(r => r.date);
  const currentStreak = calculateCurrentStreak(dates);
  const longestStreak = calculateLongestStreak(dates);

  const totalMinutes = totals.minutes;
  const levelInfo = calculateLevel(totalMinutes);

  return {
    totalSessions: totals.count,
    totalMinutes,
    todaySessions: today.count,
    todayMinutes: today.minutes,
    currentStreak,
    longestStreak,
    ...levelInfo,
  };
}

function calculateCurrentStreak(sortedDatesDesc: string[]): number {
  if (sortedDatesDesc.length === 0) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = formatDateStr(today);

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = formatDateStr(yesterday);

  // Streak must include today or yesterday
  if (sortedDatesDesc[0] !== todayStr && sortedDatesDesc[0] !== yesterdayStr) {
    return 0;
  }

  let streak = 1;
  let currentDate = new Date(sortedDatesDesc[0]);

  for (let i = 1; i < sortedDatesDesc.length; i++) {
    const prevDate = new Date(currentDate);
    prevDate.setDate(prevDate.getDate() - 1);
    const prevStr = formatDateStr(prevDate);

    if (sortedDatesDesc[i] === prevStr) {
      streak++;
      currentDate = prevDate;
    } else {
      break;
    }
  }

  return streak;
}

function calculateLongestStreak(sortedDatesDesc: string[]): number {
  if (sortedDatesDesc.length === 0) return 0;

  // Sort ascending for forward walk
  const sorted = [...sortedDatesDesc].sort();
  let longest = 1;
  let current = 1;

  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]);
    const curr = new Date(sorted[i]);
    const diffDays = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);

    if (Math.round(diffDays) === 1) {
      current++;
      longest = Math.max(longest, current);
    } else {
      current = 1;
    }
  }

  return longest;
}

function formatDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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

export async function getAchievements(): Promise<FocusAchievement[]> {
  const db = getDb();
  const unlocked = await db.select().from(focusAchievements);
  const unlockedMap = new Map(unlocked.map(a => [a.id, a.unlockedAt.toISOString()]));

  return ACHIEVEMENTS.map(a => ({
    id: a.id,
    name: a.name,
    description: a.description,
    icon: a.icon,
    unlockedAt: unlockedMap.get(a.id) || null,
  }));
}

export async function checkAndUnlockAchievements(stats: FocusStats): Promise<FocusAchievement[]> {
  const db = getDb();
  const existing = await db.select({ id: focusAchievements.id }).from(focusAchievements);
  const existingIds = new Set(existing.map(a => a.id));

  const newlyUnlocked: FocusAchievement[] = [];

  const checks: Array<{ id: string; condition: boolean }> = [
    { id: 'first_session', condition: stats.totalSessions >= 1 },
    { id: 'five_sessions', condition: stats.totalSessions >= 5 },
    { id: 'ten_sessions', condition: stats.totalSessions >= 10 },
    { id: 'fifty_sessions', condition: stats.totalSessions >= 50 },
    { id: 'hundred_sessions', condition: stats.totalSessions >= 100 },
    { id: 'one_hour_day', condition: stats.todayMinutes >= 60 },
    { id: 'two_hour_day', condition: stats.todayMinutes >= 120 },
    { id: 'streak_3', condition: stats.currentStreak >= 3 },
    { id: 'streak_7', condition: stats.currentStreak >= 7 },
    { id: 'streak_14', condition: stats.currentStreak >= 14 },
    { id: 'streak_30', condition: stats.currentStreak >= 30 },
    { id: 'level_5', condition: stats.level >= 5 },
  ];

  for (const check of checks) {
    if (check.condition && !existingIds.has(check.id)) {
      await db.insert(focusAchievements).values({ id: check.id });
      const achievement = ACHIEVEMENTS.find(a => a.id === check.id)!;
      newlyUnlocked.push({
        id: achievement.id,
        name: achievement.name,
        description: achievement.description,
        icon: achievement.icon,
        unlockedAt: new Date().toISOString(),
      });
    }
  }

  return newlyUnlocked;
}
