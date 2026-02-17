// === FILE PURPOSE ===
// Service layer for unified gamification system.
// Handles XP awards, stats calculation, streak tracking, and achievements across all features.

import { gte, sql, desc, eq } from 'drizzle-orm';
import { getDb } from '../db/connection';
import {
  xpEvents, focusSessions, focusAchievements,
  cards, cardChecklistItems, projects, meetings, ideas, brainstormSessions,
} from '../db/schema';
import {
  XpEventType, XP_REWARDS, XP_CATEGORIES,
  GamificationStats, Achievement, ACHIEVEMENTS, calculateLevel,
} from '../../shared/types/gamification';

export async function awardXP(
  eventType: XpEventType,
  entityId?: string,
  xpOverride?: number,
): Promise<number> {
  const db = getDb();
  const xpAmount = xpOverride ?? XP_REWARDS[eventType];

  await db.insert(xpEvents).values({
    eventType,
    xpAmount,
    entityId: entityId || null,
  });

  return xpAmount;
}

export async function getStats(): Promise<GamificationStats> {
  const db = getDb();

  // Total XP
  const [totalRow] = await db
    .select({
      total: sql<number>`coalesce(sum(${xpEvents.xpAmount}), 0)::int`,
    })
    .from(xpEvents);

  // Today XP
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [todayRow] = await db
    .select({
      total: sql<number>`coalesce(sum(${xpEvents.xpAmount}), 0)::int`,
    })
    .from(xpEvents)
    .where(gte(xpEvents.earnedAt, todayStart));

  // XP by event_type
  const xpByTypeRows = await db
    .select({
      eventType: xpEvents.eventType,
      total: sql<number>`coalesce(sum(${xpEvents.xpAmount}), 0)::int`,
    })
    .from(xpEvents)
    .groupBy(xpEvents.eventType);

  // Map event types to categories
  const xpByCategory: Record<string, number> = {};
  for (const row of xpByTypeRows) {
    const category = XP_CATEGORIES[row.eventType as XpEventType] || 'other';
    xpByCategory[category] = (xpByCategory[category] || 0) + row.total;
  }

  // Level
  const totalXp = totalRow.total;
  const levelInfo = calculateLevel(totalXp);

  // Focus-specific stats
  const [focusTotals] = await db
    .select({
      count: sql<number>`count(*)::int`,
      minutes: sql<number>`coalesce(sum(${focusSessions.durationMinutes}), 0)::int`,
    })
    .from(focusSessions);

  const [focusToday] = await db
    .select({
      count: sql<number>`count(*)::int`,
      minutes: sql<number>`coalesce(sum(${focusSessions.durationMinutes}), 0)::int`,
    })
    .from(focusSessions)
    .where(gte(focusSessions.completedAt, todayStart));

  // Streak: distinct dates with ANY xp_events activity
  const dateRows = await db
    .select({
      date: sql<string>`to_char(${xpEvents.earnedAt}, 'YYYY-MM-DD')`,
    })
    .from(xpEvents)
    .groupBy(sql`to_char(${xpEvents.earnedAt}, 'YYYY-MM-DD')`)
    .orderBy(desc(sql`to_char(${xpEvents.earnedAt}, 'YYYY-MM-DD')`));

  const dates = dateRows.map(r => r.date);
  const currentStreak = calculateCurrentStreak(dates);
  const longestStreak = calculateLongestStreak(dates);

  return {
    totalXp,
    todayXp: todayRow.total,
    level: levelInfo.level,
    levelName: levelInfo.levelName,
    xpProgress: levelInfo.xpProgress,
    xpNextLevel: levelInfo.xpNextLevel,
    currentStreak,
    longestStreak,
    xpByCategory,
    focusTodaySessions: focusToday.count,
    focusTodayMinutes: focusToday.minutes,
    focusTotalSessions: focusTotals.count,
    focusTotalMinutes: focusTotals.minutes,
  };
}

export async function getAchievements(): Promise<Achievement[]> {
  const db = getDb();
  const unlocked = await db.select().from(focusAchievements);
  const unlockedMap = new Map(unlocked.map(a => [a.id, a.unlockedAt]));

  return ACHIEVEMENTS.map(a => ({
    id: a.id,
    name: a.name,
    description: a.description,
    icon: a.icon,
    category: a.category,
    unlockedAt: unlockedMap.get(a.id)?.toISOString() || null,
  }));
}

export interface AchievementCounts {
  focusTotalSessions: number;
  focusTodayMinutes: number;
  focusCurrentStreak: number;
  cardsCreated: number;
  cardsCompleted: number;
  checklistCompleted: number;
  projectsCreated: number;
  aiPlanUsed: boolean;
  meetingsCompleted: number;
  actionsConverted: number;
  ideasCreated: number;
  ideasConverted: number;
  brainstormSessions: number;
  todayCategoryCount: number;
  totalXp: number;
  level: number;
  unlockedCount: number;
}

export async function getAchievementCounts(stats: GamificationStats): Promise<AchievementCounts> {
  const db = getDb();

  // Cards created
  const [cardsCreatedRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(cards);

  // Cards completed
  const [cardsCompletedRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(cards)
    .where(eq(cards.completed, true));

  // Checklist items completed
  const [checklistRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(cardChecklistItems)
    .where(eq(cardChecklistItems.completed, true));

  // Projects created
  const [projectsRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects);

  // AI plan used: check xp_events for 'ai_plan'
  const [aiPlanRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(xpEvents)
    .where(eq(xpEvents.eventType, 'ai_plan'));

  // Meetings completed
  const [meetingsRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(meetings)
    .where(eq(meetings.status, 'completed'));

  // Actions converted: check xp_events for 'action_convert'
  const [actionsRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(xpEvents)
    .where(eq(xpEvents.eventType, 'action_convert'));

  // Ideas created
  const [ideasRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ideas);

  // Ideas converted: check xp_events for 'idea_convert'
  const [ideasConvertedRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(xpEvents)
    .where(eq(xpEvents.eventType, 'idea_convert'));

  // Brainstorm sessions
  const [brainstormRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(brainstormSessions);

  // Today's distinct categories
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayCategoryRows = await db
    .select({
      eventType: xpEvents.eventType,
    })
    .from(xpEvents)
    .where(gte(xpEvents.earnedAt, todayStart))
    .groupBy(xpEvents.eventType);

  const todayCategories = new Set(
    todayCategoryRows.map(r => XP_CATEGORIES[r.eventType as XpEventType] || 'other'),
  );

  // Already unlocked achievements count
  const [unlockedRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(focusAchievements);

  return {
    focusTotalSessions: stats.focusTotalSessions,
    focusTodayMinutes: stats.focusTodayMinutes,
    focusCurrentStreak: stats.currentStreak,
    cardsCreated: cardsCreatedRow.count,
    cardsCompleted: cardsCompletedRow.count,
    checklistCompleted: checklistRow.count,
    projectsCreated: projectsRow.count,
    aiPlanUsed: aiPlanRow.count > 0,
    meetingsCompleted: meetingsRow.count,
    actionsConverted: actionsRow.count,
    ideasCreated: ideasRow.count,
    ideasConverted: ideasConvertedRow.count,
    brainstormSessions: brainstormRow.count,
    todayCategoryCount: todayCategories.size,
    totalXp: stats.totalXp,
    level: stats.level,
    unlockedCount: unlockedRow.count,
  };
}

export async function checkAndUnlockAchievements(
  stats: GamificationStats,
  counts: AchievementCounts,
): Promise<Achievement[]> {
  const db = getDb();
  const existing = await db.select({ id: focusAchievements.id }).from(focusAchievements);
  const existingIds = new Set(existing.map(a => a.id));

  const newlyUnlocked: Achievement[] = [];

  const checks: Array<{ id: string; condition: boolean }> = [
    // Focus
    { id: 'first_session', condition: counts.focusTotalSessions >= 1 },
    { id: 'five_sessions', condition: counts.focusTotalSessions >= 5 },
    { id: 'ten_sessions', condition: counts.focusTotalSessions >= 10 },
    { id: 'fifty_sessions', condition: counts.focusTotalSessions >= 50 },
    { id: 'hundred_sessions', condition: counts.focusTotalSessions >= 100 },
    { id: 'one_hour_day', condition: counts.focusTodayMinutes >= 60 },
    { id: 'two_hour_day', condition: counts.focusTodayMinutes >= 120 },
    { id: 'streak_3', condition: counts.focusCurrentStreak >= 3 },
    { id: 'streak_7', condition: counts.focusCurrentStreak >= 7 },
    { id: 'streak_14', condition: counts.focusCurrentStreak >= 14 },
    { id: 'streak_30', condition: counts.focusCurrentStreak >= 30 },
    { id: 'level_5', condition: counts.level >= 5 },

    // Cards
    { id: 'first_card', condition: counts.cardsCreated >= 1 },
    { id: 'card_creator', condition: counts.cardsCreated >= 25 },
    { id: 'card_completer', condition: counts.cardsCompleted >= 25 },
    { id: 'checklist_champion', condition: counts.checklistCompleted >= 50 },

    // Projects
    { id: 'first_project', condition: counts.projectsCreated >= 1 },
    { id: 'project_planner', condition: counts.aiPlanUsed },

    // Meetings
    { id: 'first_meeting', condition: counts.meetingsCompleted >= 1 },
    { id: 'meeting_maven', condition: counts.meetingsCompleted >= 10 },
    { id: 'action_hero', condition: counts.actionsConverted >= 10 },

    // Ideas
    { id: 'first_idea', condition: counts.ideasCreated >= 1 },
    { id: 'idea_converter', condition: counts.ideasConverted >= 5 },

    // Brainstorm
    { id: 'first_brainstorm', condition: counts.brainstormSessions >= 1 },
    { id: 'deep_thinker', condition: counts.brainstormSessions >= 10 },

    // Cross-feature
    { id: 'multitasker', condition: counts.todayCategoryCount >= 3 },
    { id: 'power_user', condition: counts.totalXp >= 1000 },
    { id: 'completionist', condition: counts.unlockedCount >= 20 },
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
        category: achievement.category,
        unlockedAt: new Date().toISOString(),
      });
    }
  }

  return newlyUnlocked;
}

// --- Streak helpers (same algorithms as focusService, operating on date strings) ---

function calculateCurrentStreak(sortedDatesDesc: string[]): number {
  if (sortedDatesDesc.length === 0) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = formatDateStr(today);

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = formatDateStr(yesterday);

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
