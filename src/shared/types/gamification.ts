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

// --- Level Tier System (300 levels, 30 tiers of 10) ---

export interface LevelTier {
  tier: number;           // 1-30
  name: string;           // "Bronze", "Iron", etc.
  family: string;         // "metal", "gem", "cosmic", "mythic", "divine", "ultimate"
  startLevel: number;     // 1, 11, 21, ...
  endLevel: number;       // 10, 20, 30, ...
  colors: {
    bg: string;           // Tailwind bg class or CSS value
    text: string;         // Tailwind text class
    border: string;       // Tailwind border class
    glow: string;         // CSS box-shadow value ('' for none)
    gradient?: string;    // Optional CSS gradient for bg
  };
  animate: boolean;       // Whether to apply shimmer animation (Divine/Ultimate only)
}

export const LEVEL_TIERS: LevelTier[] = [
  // --- Metal family (tiers 1-5, Lv 1-50) ---
  { tier: 1, name: 'Bronze', family: 'metal', startLevel: 1, endLevel: 10, animate: false, colors: { bg: 'bg-amber-900/20', text: 'text-amber-600', border: 'border-amber-700/30', glow: '' } },
  { tier: 2, name: 'Iron', family: 'metal', startLevel: 11, endLevel: 20, animate: false, colors: { bg: 'bg-slate-600/20', text: 'text-slate-400', border: 'border-slate-500/30', glow: '' } },
  { tier: 3, name: 'Steel', family: 'metal', startLevel: 21, endLevel: 30, animate: false, colors: { bg: 'bg-zinc-500/20', text: 'text-zinc-300', border: 'border-zinc-400/30', glow: '' } },
  { tier: 4, name: 'Silver', family: 'metal', startLevel: 31, endLevel: 40, animate: false, colors: { bg: 'bg-gray-400/15', text: 'text-gray-300', border: 'border-gray-400/30', glow: '' } },
  { tier: 5, name: 'Gold', family: 'metal', startLevel: 41, endLevel: 50, animate: false, colors: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', border: 'border-yellow-500/30', glow: '0 0 6px rgba(234, 179, 8, 0.15)' } },

  // --- Gem family (tiers 6-10, Lv 51-100) ---
  { tier: 6, name: 'Emerald', family: 'gem', startLevel: 51, endLevel: 60, animate: false, colors: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30', glow: '0 0 8px rgba(52, 211, 153, 0.2)' } },
  { tier: 7, name: 'Sapphire', family: 'gem', startLevel: 61, endLevel: 70, animate: false, colors: { bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-blue-500/30', glow: '0 0 8px rgba(59, 130, 246, 0.2)' } },
  { tier: 8, name: 'Ruby', family: 'gem', startLevel: 71, endLevel: 80, animate: false, colors: { bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/30', glow: '0 0 8px rgba(239, 68, 68, 0.2)' } },
  { tier: 9, name: 'Amethyst', family: 'gem', startLevel: 81, endLevel: 90, animate: false, colors: { bg: 'bg-purple-500/15', text: 'text-purple-400', border: 'border-purple-500/30', glow: '0 0 8px rgba(168, 85, 247, 0.2)' } },
  { tier: 10, name: 'Diamond', family: 'gem', startLevel: 91, endLevel: 100, animate: false, colors: { bg: 'bg-sky-400/15', text: 'text-sky-300', border: 'border-sky-400/30', glow: '0 0 12px rgba(56, 189, 248, 0.25)' } },

  // --- Cosmic family (tiers 11-15, Lv 101-150) ---
  { tier: 11, name: 'Stellar', family: 'cosmic', startLevel: 101, endLevel: 110, animate: false, colors: { bg: '', text: 'text-indigo-300', border: 'border-indigo-500/30', glow: '0 0 12px rgba(129, 140, 248, 0.25)', gradient: 'linear-gradient(135deg, #312e81, #5b21b6)' } },
  { tier: 12, name: 'Nebula', family: 'cosmic', startLevel: 111, endLevel: 120, animate: false, colors: { bg: '', text: 'text-purple-300', border: 'border-purple-500/30', glow: '0 0 12px rgba(192, 132, 252, 0.25)', gradient: 'linear-gradient(135deg, #581c87, #be185d)' } },
  { tier: 13, name: 'Quasar', family: 'cosmic', startLevel: 121, endLevel: 130, animate: false, colors: { bg: '', text: 'text-cyan-300', border: 'border-cyan-500/30', glow: '0 0 12px rgba(103, 232, 249, 0.25)', gradient: 'linear-gradient(135deg, #164e63, #1e40af)' } },
  { tier: 14, name: 'Pulsar', family: 'cosmic', startLevel: 131, endLevel: 140, animate: false, colors: { bg: '', text: 'text-teal-300', border: 'border-teal-500/30', glow: '0 0 12px rgba(94, 234, 212, 0.25)', gradient: 'linear-gradient(135deg, #134e4a, #065f46)' } },
  { tier: 15, name: 'Nova', family: 'cosmic', startLevel: 141, endLevel: 150, animate: false, colors: { bg: '', text: 'text-amber-300', border: 'border-amber-500/30', glow: '0 0 16px rgba(251, 191, 36, 0.3)', gradient: 'linear-gradient(135deg, #78350f, #9a3412)' } },

  // --- Mythic family (tiers 16-20, Lv 151-200) ---
  { tier: 16, name: 'Phoenix', family: 'mythic', startLevel: 151, endLevel: 160, animate: false, colors: { bg: '', text: 'text-orange-300', border: 'border-orange-500/30', glow: '0 0 16px rgba(251, 146, 60, 0.3)', gradient: 'linear-gradient(135deg, #9a3412, #dc2626)' } },
  { tier: 17, name: 'Dragon', family: 'mythic', startLevel: 161, endLevel: 170, animate: false, colors: { bg: '', text: 'text-red-300', border: 'border-red-500/30', glow: '0 0 16px rgba(248, 113, 113, 0.3)', gradient: 'linear-gradient(135deg, #991b1b, #e11d48)' } },
  { tier: 18, name: 'Titan', family: 'mythic', startLevel: 171, endLevel: 180, animate: false, colors: { bg: '', text: 'text-stone-300', border: 'border-stone-500/30', glow: '0 0 16px rgba(214, 211, 209, 0.3)', gradient: 'linear-gradient(135deg, #44403c, #b45309)' } },
  { tier: 19, name: 'Oracle', family: 'mythic', startLevel: 181, endLevel: 190, animate: false, colors: { bg: '', text: 'text-violet-300', border: 'border-violet-500/30', glow: '0 0 16px rgba(196, 181, 253, 0.3)', gradient: 'linear-gradient(135deg, #5b21b6, #a21caf)' } },
  { tier: 20, name: 'Celestial', family: 'mythic', startLevel: 191, endLevel: 200, animate: false, colors: { bg: '', text: 'text-sky-200', border: 'border-sky-400/30', glow: '0 0 16px rgba(125, 211, 252, 0.3)', gradient: 'linear-gradient(135deg, #0369a1, #3730a3)' } },

  // --- Divine family (tiers 21-25, Lv 201-250) ---
  { tier: 21, name: 'Ethereal', family: 'divine', startLevel: 201, endLevel: 210, animate: true, colors: { bg: '', text: 'text-blue-200', border: 'border-blue-400/30', glow: '0 0 20px rgba(147, 197, 253, 0.35)', gradient: 'linear-gradient(135deg, #334155, #1e40af)' } },
  { tier: 22, name: 'Immortal', family: 'divine', startLevel: 211, endLevel: 220, animate: true, colors: { bg: '', text: 'text-emerald-200', border: 'border-emerald-400/30', glow: '0 0 20px rgba(110, 231, 183, 0.35)', gradient: 'linear-gradient(135deg, #065f46, #0f766e)' } },
  { tier: 23, name: 'Transcendent', family: 'divine', startLevel: 221, endLevel: 230, animate: true, colors: { bg: '', text: 'text-purple-200', border: 'border-purple-400/30', glow: '0 0 20px rgba(216, 180, 254, 0.35)', gradient: 'linear-gradient(135deg, #581c87, #6d28d9)' } },
  { tier: 24, name: 'Ascendant', family: 'divine', startLevel: 231, endLevel: 240, animate: true, colors: { bg: '', text: 'text-amber-200', border: 'border-amber-400/30', glow: '0 0 20px rgba(253, 230, 138, 0.35)', gradient: 'linear-gradient(135deg, #78350f, #ca8a04)' } },
  { tier: 25, name: 'Divine', family: 'divine', startLevel: 241, endLevel: 250, animate: true, colors: { bg: '', text: 'text-yellow-100', border: 'border-yellow-300/30', glow: '0 0 20px rgba(254, 249, 195, 0.35)', gradient: 'linear-gradient(135deg, #fefce8, #ca8a04)' } },

  // --- Ultimate family (tiers 26-30, Lv 251-300) ---
  { tier: 26, name: 'Apex', family: 'ultimate', startLevel: 251, endLevel: 260, animate: true, colors: { bg: '', text: 'text-rose-200', border: 'border-rose-400/30', glow: '0 0 24px rgba(251, 113, 133, 0.4)', gradient: 'linear-gradient(135deg, #9f1239, #ec4899)' } },
  { tier: 27, name: 'Supreme', family: 'ultimate', startLevel: 261, endLevel: 270, animate: true, colors: { bg: '', text: 'text-indigo-200', border: 'border-indigo-400/30', glow: '0 0 24px rgba(165, 180, 252, 0.4)', gradient: 'linear-gradient(135deg, #312e81, #7c3aed)' } },
  { tier: 28, name: 'Legendary', family: 'ultimate', startLevel: 271, endLevel: 280, animate: true, colors: { bg: '', text: 'text-amber-100', border: 'border-amber-400/30', glow: '0 0 24px rgba(252, 211, 77, 0.4)', gradient: 'linear-gradient(135deg, #78350f, #dc2626)' } },
  { tier: 29, name: 'Infinite', family: 'ultimate', startLevel: 281, endLevel: 290, animate: true, colors: { bg: '', text: 'text-white', border: 'border-cyan-400/30', glow: '0 0 24px rgba(103, 232, 249, 0.4)', gradient: 'linear-gradient(135deg, #06b6d4, #3b82f6, #8b5cf6)' } },
  { tier: 30, name: 'Omega', family: 'ultimate', startLevel: 291, endLevel: 300, animate: true, colors: { bg: '', text: 'text-white', border: 'border-yellow-300/30', glow: '0 0 30px rgba(250, 204, 21, 0.5)', gradient: 'linear-gradient(135deg, #eab308, #fefce8, #eab308)' } },
];

/** Get the tier definition for a given level (1-300). */
export function getTier(level: number): LevelTier {
  const tierIndex = Math.min(Math.floor((Math.max(level, 1) - 1) / 10), 29);
  return LEVEL_TIERS[tierIndex];
}

/**
 * Total cumulative XP required to reach level n.
 * XP to go from level k to k+1 = 20 + k*8.
 * Closed-form sum: totalXpForLevel(n) = 20*(n-1) + 4*n*(n-1).
 */
export function totalXpForLevel(n: number): number {
  if (n <= 1) return 0;
  return 20 * (n - 1) + 4 * n * (n - 1);
}

const MAX_LEVEL = 300;

export function calculateLevel(totalXp: number): {
  level: number;
  levelName: string;
  xpProgress: number;
  xpNextLevel: number;
} {
  // Solve: totalXpForLevel(n) = 4n^2 + 16n - 20 = totalXp
  // Quadratic: 4n^2 + 16n - (20 + totalXp) = 0
  // n = (-16 + sqrt(256 + 16*(20 + totalXp))) / 8
  // rawLevel is the exact n where totalXpForLevel(n) = totalXp;
  // floor gives the highest level whose threshold is <= totalXp.
  const rawLevel = (-16 + Math.sqrt(256 + 16 * (20 + totalXp))) / 8;
  const level = Math.min(Math.max(Math.floor(rawLevel), 1), MAX_LEVEL);

  const xpAtCurrent = totalXpForLevel(level);
  const xpAtNext = totalXpForLevel(level + 1);

  if (level >= MAX_LEVEL) {
    return {
      level: MAX_LEVEL,
      levelName: getTier(MAX_LEVEL).name,
      xpProgress: 1,
      xpNextLevel: totalXpForLevel(MAX_LEVEL),
    };
  }

  const range = xpAtNext - xpAtCurrent;
  const progress = range > 0 ? (totalXp - xpAtCurrent) / range : 1;

  return {
    level,
    levelName: getTier(level).name,
    xpProgress: Math.min(progress, 1),
    xpNextLevel: xpAtNext,
  };
}

// --- Daily XP Data ---

export interface XpDailyData {
  date: string;
  xp: number;
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
  { id: 'level_50', name: 'Gold Achiever', description: 'Reach Level 50 (Gold tier)', icon: 'Trophy', category: 'focus' },

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
