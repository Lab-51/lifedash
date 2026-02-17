// === FILE PURPOSE ===
// Shared types for focus mode gamification. Used by main, preload, and renderer.

export interface FocusSession {
  id: string;
  cardId: string | null;
  durationMinutes: number;
  note: string | null;
  completedAt: string;
}

export interface FocusStats {
  totalSessions: number;
  totalMinutes: number;
  todaySessions: number;
  todayMinutes: number;
  currentStreak: number;
  longestStreak: number;
  level: number;
  levelName: string;
  xpCurrent: number;
  xpNextLevel: number;
  xpProgress: number;
}

export interface FocusAchievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  unlockedAt: string | null;
}

export interface FocusDailyData {
  date: string;
  sessions: number;
  minutes: number;
}

export const LEVEL_THRESHOLDS = [
  { level: 1, name: 'Beginner', minutes: 0 },
  { level: 2, name: 'Focused', minutes: 60 },
  { level: 3, name: 'Disciplined', minutes: 300 },
  { level: 4, name: 'Dedicated', minutes: 900 },
  { level: 5, name: 'Master', minutes: 2100 },
  { level: 6, name: 'Grandmaster', minutes: 4500 },
  { level: 7, name: 'Legend', minutes: 9000 },
  { level: 8, name: 'Transcendent', minutes: 18000 },
] as const;

export const ACHIEVEMENTS = [
  { id: 'first_session', name: 'First Focus', description: 'Complete your first focus session', icon: 'Zap' },
  { id: 'five_sessions', name: 'Getting Warmed Up', description: 'Complete 5 focus sessions', icon: 'Flame' },
  { id: 'ten_sessions', name: 'In The Zone', description: 'Complete 10 focus sessions', icon: 'Target' },
  { id: 'fifty_sessions', name: 'Focus Machine', description: 'Complete 50 focus sessions', icon: 'Cpu' },
  { id: 'hundred_sessions', name: 'Centurion', description: 'Complete 100 focus sessions', icon: 'Crown' },
  { id: 'one_hour_day', name: 'Power Hour', description: '60+ minutes focused in a single day', icon: 'Clock' },
  { id: 'two_hour_day', name: 'Deep Worker', description: '120+ minutes focused in a single day', icon: 'BrainCircuit' },
  { id: 'streak_3', name: 'Three-Day Streak', description: '3 consecutive days with sessions', icon: 'TrendingUp' },
  { id: 'streak_7', name: 'Week Warrior', description: '7 consecutive days with sessions', icon: 'Calendar' },
  { id: 'streak_14', name: 'Fortnight Focus', description: '14 consecutive days with sessions', icon: 'CalendarCheck' },
  { id: 'streak_30', name: 'Monthly Master', description: '30 consecutive days with sessions', icon: 'Award' },
  { id: 'level_5', name: 'Master Achiever', description: 'Reach Level 5 (Master)', icon: 'Trophy' },
] as const;

export function calculateLevel(totalMinutes: number): {
  level: number;
  levelName: string;
  xpCurrent: number;
  xpNextLevel: number;
  xpProgress: number;
} {
  let currentLevel: (typeof LEVEL_THRESHOLDS)[number] = LEVEL_THRESHOLDS[0];
  for (const threshold of LEVEL_THRESHOLDS) {
    if (totalMinutes >= threshold.minutes) {
      currentLevel = threshold;
    } else {
      break;
    }
  }

  const nextLevelNum = currentLevel.level + 1;
  const nextLevel = LEVEL_THRESHOLDS.find(t => t.level === nextLevelNum);
  const xpNextLevel = nextLevel ? nextLevel.minutes : currentLevel.minutes;
  const range = xpNextLevel - currentLevel.minutes;
  const progress = range > 0 ? (totalMinutes - currentLevel.minutes) / range : 1;

  return {
    level: currentLevel.level,
    levelName: currentLevel.name,
    xpCurrent: totalMinutes,
    xpNextLevel,
    xpProgress: Math.min(progress, 1),
  };
}
