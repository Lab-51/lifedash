// === FILE PURPOSE ===
// Service layer for unified gamification system.
// Handles XP awards, stats calculation, streak tracking, and achievements across all features.

import { gte, sql, desc, eq } from 'drizzle-orm';
import { formatDateStr } from '../../shared/utils/date-utils';
import { getDb } from '../db/connection';
import {
  xpEvents, focusSessions, focusAchievements,
  cards, cardChecklistItems, projects, meetings, ideas, brainstormSessions,
} from '../db/schema';
import {
  XpEventType, XP_REWARDS, XP_CATEGORIES,
  GamificationStats, Achievement, ACHIEVEMENTS, calculateLevel,
  XpDailyData,
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
  focusTotalMinutes: number;
  focusCurrentStreak: number;
  cardsCreated: number;
  cardsCompleted: number;
  checklistCompleted: number;
  projectsCreated: number;
  aiPlanUsed: boolean;
  aiPlanCount: number;
  aiDescriptionCount: number;
  aiBreakdownCount: number;
  aiStandupCount: number;
  meetingsCompleted: number;
  meetingBriefCount: number;
  actionsConverted: number;
  ideasCreated: number;
  ideasConverted: number;
  ideasAnalyzed: number;
  projectsArchived: number;
  brainstormSessions: number;
  brainstormExports: number;
  todayCategoryCount: number;
  todayXp: number;
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

  // Consolidated xp_events counts by event_type (replaces individual queries)
  const eventTypeCounts = await db
    .select({
      eventType: xpEvents.eventType,
      count: sql<number>`count(*)::int`,
    })
    .from(xpEvents)
    .groupBy(xpEvents.eventType);
  const eventCountMap = new Map(eventTypeCounts.map(r => [r.eventType, r.count]));

  // Meetings completed
  const [meetingsRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(meetings)
    .where(eq(meetings.status, 'completed'));

  // Ideas created
  const [ideasRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ideas);

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
    focusTotalMinutes: stats.focusTotalMinutes,
    focusCurrentStreak: stats.currentStreak,
    cardsCreated: cardsCreatedRow.count,
    cardsCompleted: cardsCompletedRow.count,
    checklistCompleted: checklistRow.count,
    projectsCreated: projectsRow.count,
    aiPlanUsed: (eventCountMap.get('ai_plan') || 0) > 0,
    aiPlanCount: eventCountMap.get('ai_plan') || 0,
    aiDescriptionCount: eventCountMap.get('ai_description') || 0,
    aiBreakdownCount: eventCountMap.get('ai_breakdown') || 0,
    aiStandupCount: eventCountMap.get('ai_standup') || 0,
    meetingsCompleted: meetingsRow.count,
    meetingBriefCount: eventCountMap.get('meeting_brief') || 0,
    actionsConverted: eventCountMap.get('action_convert') || 0,
    ideasCreated: ideasRow.count,
    ideasConverted: eventCountMap.get('idea_convert') || 0,
    ideasAnalyzed: eventCountMap.get('idea_analyze') || 0,
    projectsArchived: eventCountMap.get('project_archive') || 0,
    brainstormSessions: brainstormRow.count,
    brainstormExports: eventCountMap.get('brainstorm_export') || 0,
    todayCategoryCount: todayCategories.size,
    todayXp: stats.todayXp,
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
    // Focus (24)
    { id: 'first_session', condition: counts.focusTotalSessions >= 1 },
    { id: 'five_sessions', condition: counts.focusTotalSessions >= 5 },
    { id: 'ten_sessions', condition: counts.focusTotalSessions >= 10 },
    { id: 'twenty_five_sessions', condition: counts.focusTotalSessions >= 25 },
    { id: 'fifty_sessions', condition: counts.focusTotalSessions >= 50 },
    { id: 'hundred_sessions', condition: counts.focusTotalSessions >= 100 },
    { id: 'two_hundred_sessions', condition: counts.focusTotalSessions >= 200 },
    { id: 'five_hundred_sessions', condition: counts.focusTotalSessions >= 500 },
    { id: 'one_hour_day', condition: counts.focusTodayMinutes >= 60 },
    { id: 'two_hour_day', condition: counts.focusTodayMinutes >= 120 },
    { id: 'three_hour_day', condition: counts.focusTodayMinutes >= 180 },
    { id: 'four_hour_day', condition: counts.focusTodayMinutes >= 240 },
    { id: 'streak_3', condition: counts.focusCurrentStreak >= 3 },
    { id: 'streak_7', condition: counts.focusCurrentStreak >= 7 },
    { id: 'streak_14', condition: counts.focusCurrentStreak >= 14 },
    { id: 'streak_30', condition: counts.focusCurrentStreak >= 30 },
    { id: 'streak_60', condition: counts.focusCurrentStreak >= 60 },
    { id: 'streak_100', condition: counts.focusCurrentStreak >= 100 },
    { id: 'focus_500_min', condition: counts.focusTotalMinutes >= 500 },
    { id: 'focus_2000_min', condition: counts.focusTotalMinutes >= 2000 },
    { id: 'focus_10000_min', condition: counts.focusTotalMinutes >= 10000 },
    { id: 'level_50', condition: counts.level >= 50 },
    { id: 'level_100', condition: counts.level >= 100 },
    { id: 'level_200', condition: counts.level >= 200 },

    // Cards (14)
    { id: 'first_card', condition: counts.cardsCreated >= 1 },
    { id: 'cards_10', condition: counts.cardsCreated >= 10 },
    { id: 'card_creator', condition: counts.cardsCreated >= 25 },
    { id: 'cards_50', condition: counts.cardsCreated >= 50 },
    { id: 'cards_100', condition: counts.cardsCreated >= 100 },
    { id: 'cards_completed_5', condition: counts.cardsCompleted >= 5 },
    { id: 'card_completer', condition: counts.cardsCompleted >= 25 },
    { id: 'cards_completed_50', condition: counts.cardsCompleted >= 50 },
    { id: 'cards_completed_100', condition: counts.cardsCompleted >= 100 },
    { id: 'checklist_champion', condition: counts.checklistCompleted >= 50 },
    { id: 'checklist_100', condition: counts.checklistCompleted >= 100 },
    { id: 'checklist_500', condition: counts.checklistCompleted >= 500 },
    { id: 'ai_descriptions_5', condition: counts.aiDescriptionCount >= 5 },
    { id: 'ai_breakdowns_3', condition: counts.aiBreakdownCount >= 3 },

    // Projects (8)
    { id: 'first_project', condition: counts.projectsCreated >= 1 },
    { id: 'projects_3', condition: counts.projectsCreated >= 3 },
    { id: 'projects_5', condition: counts.projectsCreated >= 5 },
    { id: 'projects_10', condition: counts.projectsCreated >= 10 },
    { id: 'project_planner', condition: counts.aiPlanUsed },
    { id: 'project_archiver', condition: counts.projectsArchived >= 1 },
    { id: 'ai_plans_5', condition: counts.aiPlanCount >= 5 },
    { id: 'standups_5', condition: counts.aiStandupCount >= 5 },

    // Meetings (10)
    { id: 'first_meeting', condition: counts.meetingsCompleted >= 1 },
    { id: 'meetings_5', condition: counts.meetingsCompleted >= 5 },
    { id: 'meeting_maven', condition: counts.meetingsCompleted >= 10 },
    { id: 'meetings_25', condition: counts.meetingsCompleted >= 25 },
    { id: 'meetings_50', condition: counts.meetingsCompleted >= 50 },
    { id: 'briefs_5', condition: counts.meetingBriefCount >= 5 },
    { id: 'briefs_20', condition: counts.meetingBriefCount >= 20 },
    { id: 'action_hero', condition: counts.actionsConverted >= 10 },
    { id: 'actions_25', condition: counts.actionsConverted >= 25 },
    { id: 'actions_50', condition: counts.actionsConverted >= 50 },

    // Ideas (8)
    { id: 'first_idea', condition: counts.ideasCreated >= 1 },
    { id: 'ideas_10', condition: counts.ideasCreated >= 10 },
    { id: 'ideas_25', condition: counts.ideasCreated >= 25 },
    { id: 'ideas_50', condition: counts.ideasCreated >= 50 },
    { id: 'idea_converter', condition: counts.ideasConverted >= 5 },
    { id: 'ideas_converted_10', condition: counts.ideasConverted >= 10 },
    { id: 'ideas_analyzed_5', condition: counts.ideasAnalyzed >= 5 },
    { id: 'ideas_analyzed_20', condition: counts.ideasAnalyzed >= 20 },

    // Brainstorm (8)
    { id: 'first_brainstorm', condition: counts.brainstormSessions >= 1 },
    { id: 'brainstorms_5', condition: counts.brainstormSessions >= 5 },
    { id: 'deep_thinker', condition: counts.brainstormSessions >= 10 },
    { id: 'brainstorms_25', condition: counts.brainstormSessions >= 25 },
    { id: 'brainstorms_50', condition: counts.brainstormSessions >= 50 },
    { id: 'brainstorm_exports_1', condition: counts.brainstormExports >= 1 },
    { id: 'brainstorm_exports_10', condition: counts.brainstormExports >= 10 },
    { id: 'brainstorm_exports_25', condition: counts.brainstormExports >= 25 },

    // Cross-feature (12)
    { id: 'multitasker', condition: counts.todayCategoryCount >= 3 },
    { id: 'multitasker_5', condition: counts.todayCategoryCount >= 5 },
    { id: 'power_user', condition: counts.totalXp >= 1000 },
    { id: 'power_user_5000', condition: counts.totalXp >= 5000 },
    { id: 'power_user_25000', condition: counts.totalXp >= 25000 },
    { id: 'power_user_100000', condition: counts.totalXp >= 100000 },
    { id: 'completionist', condition: counts.unlockedCount >= 20 },
    { id: 'completionist_50', condition: counts.unlockedCount >= 50 },
    { id: 'completionist_all', condition: counts.unlockedCount >= ACHIEVEMENTS.length - 1 },
    { id: 'xp_100_day', condition: counts.todayXp >= 100 },
    { id: 'xp_500_day', condition: counts.todayXp >= 500 },
    { id: 'all_categories', condition: counts.todayCategoryCount >= 6 },
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

export async function getDailyXP(_days?: number): Promise<XpDailyData[]> {
  const db = getDb();

  // Calculate Monday of the current week (ISO week: Mon=1, Sun=7)
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);

  const rows = await db
    .select({
      date: sql<string>`to_char(${xpEvents.earnedAt}, 'YYYY-MM-DD')`,
      xp: sql<number>`coalesce(sum(${xpEvents.xpAmount}), 0)::int`,
    })
    .from(xpEvents)
    .where(gte(xpEvents.earnedAt, monday))
    .groupBy(sql`to_char(${xpEvents.earnedAt}, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(${xpEvents.earnedAt}, 'YYYY-MM-DD')`);

  // Always return 7 entries: Mon through Sun
  const result: XpDailyData[] = [];
  const dataMap = new Map(rows.map(r => [r.date, r]));

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateStr = formatDateStr(d);
    const data = dataMap.get(dateStr);
    result.push({
      date: dateStr,
      xp: data?.xp || 0,
    });
  }

  return result;
}

