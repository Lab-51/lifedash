// === FILE PURPOSE ===
// Shared types and constants for unified gamification system.
// Used by main, preload, and renderer. Covers ALL features, not just focus.

// --- XP Event Types ---

export type XpEventType =
  | 'focus_session'
  | 'card_create'
  | 'card_complete'
  | 'checklist_complete'
  | 'project_create'
  | 'project_archive'
  | 'ai_plan'
  | 'meeting_complete'
  | 'meeting_brief'
  | 'action_convert'
  | 'idea_create'
  | 'idea_convert'
  | 'idea_analyze'
  | 'brainstorm_start'
  | 'brainstorm_export'
  | 'ai_standup'
  | 'ai_description'
  | 'ai_breakdown';

export const XP_REWARDS: Record<XpEventType, number> = {
  focus_session: 1, // per minute
  card_create: 5,
  card_complete: 15,
  checklist_complete: 2,
  project_create: 10,
  project_archive: 20,
  ai_plan: 10,
  meeting_complete: 20,
  meeting_brief: 10,
  action_convert: 5,
  idea_create: 5,
  idea_convert: 10,
  idea_analyze: 5,
  brainstorm_start: 5,
  brainstorm_export: 5,
  ai_standup: 5,
  ai_description: 5,
  ai_breakdown: 10,
};

export const XP_CATEGORIES: Record<XpEventType, string> = {
  focus_session: 'focus',
  card_create: 'cards',
  card_complete: 'cards',
  checklist_complete: 'cards',
  project_create: 'projects',
  project_archive: 'projects',
  ai_plan: 'projects',
  meeting_complete: 'meetings',
  meeting_brief: 'meetings',
  action_convert: 'meetings',
  idea_create: 'ideas',
  idea_convert: 'ideas',
  idea_analyze: 'ideas',
  brainstorm_start: 'brainstorm',
  brainstorm_export: 'brainstorm',
  ai_standup: 'projects',
  ai_description: 'cards',
  ai_breakdown: 'cards',
};

// --- Level System ---

export const LEVEL_THRESHOLDS = [
  { level: 1, name: 'Beginner', xpRequired: 0 },
  { level: 2, name: 'Active', xpRequired: 100 },
  { level: 3, name: 'Engaged', xpRequired: 500 },
  { level: 4, name: 'Dedicated', xpRequired: 1500 },
  { level: 5, name: 'Master', xpRequired: 3500 },
  { level: 6, name: 'Grandmaster', xpRequired: 7500 },
  { level: 7, name: 'Legend', xpRequired: 15000 },
  { level: 8, name: 'Transcendent', xpRequired: 30000 },
] as const;

export function calculateLevel(totalXp: number): {
  level: number;
  levelName: string;
  xpProgress: number;
  xpNextLevel: number;
} {
  let currentLevel: (typeof LEVEL_THRESHOLDS)[number] = LEVEL_THRESHOLDS[0];
  for (const threshold of LEVEL_THRESHOLDS) {
    if (totalXp >= threshold.xpRequired) {
      currentLevel = threshold;
    } else {
      break;
    }
  }

  const nextLevelNum = currentLevel.level + 1;
  const nextLevel = LEVEL_THRESHOLDS.find(t => t.level === nextLevelNum);
  const xpNextLevel = nextLevel ? nextLevel.xpRequired : currentLevel.xpRequired;
  const range = xpNextLevel - currentLevel.xpRequired;
  const progress = range > 0 ? (totalXp - currentLevel.xpRequired) / range : 1;

  return {
    level: currentLevel.level,
    levelName: currentLevel.name,
    xpProgress: Math.min(progress, 1),
    xpNextLevel,
  };
}

// --- Stats ---

export interface GamificationStats {
  totalXp: number;
  todayXp: number;
  level: number;
  levelName: string;
  xpProgress: number;
  xpNextLevel: number;
  currentStreak: number;
  longestStreak: number;
  xpByCategory: Record<string, number>;
  focusTodaySessions: number;
  focusTodayMinutes: number;
  focusTotalSessions: number;
  focusTotalMinutes: number;
}

// --- Achievements ---

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  unlockedAt: string | null;
}

export const ACHIEVEMENTS = [
  // Focus (12)
  { id: 'first_session', name: 'First Focus', description: 'Complete your first focus session', icon: 'Zap', category: 'focus' },
  { id: 'five_sessions', name: 'Getting Warmed Up', description: 'Complete 5 focus sessions', icon: 'Flame', category: 'focus' },
  { id: 'ten_sessions', name: 'In The Zone', description: 'Complete 10 focus sessions', icon: 'Target', category: 'focus' },
  { id: 'fifty_sessions', name: 'Focus Machine', description: 'Complete 50 focus sessions', icon: 'Cpu', category: 'focus' },
  { id: 'hundred_sessions', name: 'Centurion', description: 'Complete 100 focus sessions', icon: 'Crown', category: 'focus' },
  { id: 'one_hour_day', name: 'Power Hour', description: '60+ minutes focused in a single day', icon: 'Clock', category: 'focus' },
  { id: 'two_hour_day', name: 'Deep Worker', description: '120+ minutes focused in a single day', icon: 'BrainCircuit', category: 'focus' },
  { id: 'streak_3', name: 'Three-Day Streak', description: '3 consecutive days with sessions', icon: 'TrendingUp', category: 'focus' },
  { id: 'streak_7', name: 'Week Warrior', description: '7 consecutive days with sessions', icon: 'Calendar', category: 'focus' },
  { id: 'streak_14', name: 'Fortnight Focus', description: '14 consecutive days with sessions', icon: 'CalendarCheck', category: 'focus' },
  { id: 'streak_30', name: 'Monthly Master', description: '30 consecutive days with sessions', icon: 'Award', category: 'focus' },
  { id: 'level_5', name: 'Master Achiever', description: 'Reach Level 5 (Master)', icon: 'Trophy', category: 'focus' },

  // Cards (4)
  { id: 'first_card', name: 'Card Starter', description: 'Create your first card', icon: 'SquarePlus', category: 'cards' },
  { id: 'card_creator', name: 'Card Factory', description: 'Create 25 cards', icon: 'Layers', category: 'cards' },
  { id: 'card_completer', name: 'Task Crusher', description: 'Complete 25 cards', icon: 'CheckSquare', category: 'cards' },
  { id: 'checklist_champion', name: 'Checklist Champion', description: 'Complete 50 checklist items', icon: 'ListChecks', category: 'cards' },

  // Projects (2)
  { id: 'first_project', name: 'Project Pioneer', description: 'Create your first project', icon: 'FolderPlus', category: 'projects' },
  { id: 'project_planner', name: 'AI Architect', description: 'Use AI planning on a project', icon: 'Bot', category: 'projects' },

  // Meetings (3)
  { id: 'first_meeting', name: 'First Recording', description: 'Complete your first meeting recording', icon: 'Mic', category: 'meetings' },
  { id: 'meeting_maven', name: 'Meeting Maven', description: 'Complete 10 meeting recordings', icon: 'Video', category: 'meetings' },
  { id: 'action_hero', name: 'Action Hero', description: 'Convert 10 action items to cards', icon: 'ArrowRightCircle', category: 'meetings' },

  // Ideas (2)
  { id: 'first_idea', name: 'Lightbulb Moment', description: 'Create your first idea', icon: 'Lightbulb', category: 'ideas' },
  { id: 'idea_converter', name: 'Idea Alchemist', description: 'Convert 5 ideas to projects or cards', icon: 'Sparkles', category: 'ideas' },

  // Brainstorm (2)
  { id: 'first_brainstorm', name: 'Brainstarter', description: 'Start your first brainstorm session', icon: 'Brain', category: 'brainstorm' },
  { id: 'deep_thinker', name: 'Deep Thinker', description: 'Complete 10 brainstorm sessions', icon: 'BrainCog', category: 'brainstorm' },

  // Cross-feature (3)
  { id: 'multitasker', name: 'Multitasker', description: 'Earn XP in 3+ categories in one day', icon: 'LayoutGrid', category: 'cross' },
  { id: 'power_user', name: 'Power User', description: 'Earn 1000 total XP', icon: 'Rocket', category: 'cross' },
  { id: 'completionist', name: 'Completionist', description: 'Unlock 20 achievements', icon: 'BadgeCheck', category: 'cross' },
] as const;

// --- Category Colors ---

export const CATEGORY_COLORS: Record<string, string> = {
  focus: 'emerald',
  cards: 'blue',
  projects: 'purple',
  meetings: 'amber',
  ideas: 'pink',
  brainstorm: 'cyan',
  cross: 'yellow',
};
