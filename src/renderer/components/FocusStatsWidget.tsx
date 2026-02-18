// === FILE PURPOSE ===
// Unified gamification dashboard widget showing XP progress, level, streak,
// weekly activity chart, category breakdown, and achievement badges.
// Reads all data from gamificationStore (single source of truth).

import { useEffect, useState } from 'react';
import {
  Zap,
  Flame,
  Target,
  Cpu,
  Crown,
  Clock,
  BrainCircuit,
  TrendingUp,
  Calendar,
  CalendarCheck,
  Award,
  Trophy,
  Play,
  SquarePlus,
  Layers,
  CheckSquare,
  ListChecks,
  FolderPlus,
  Bot,
  Mic,
  Video,
  ArrowRightCircle,
  Lightbulb,
  Sparkles,
  Brain,
  BrainCog,
  LayoutGrid,
  Rocket,
  BadgeCheck,
  Timer,
  Medal,
  Shield,
  Hourglass,
  TreePine,
  Flag,
  Infinity,
  History,
  Globe,
  Mountain,
  Gem,
  Star,
  Hash,
  Package,
  Database,
  ThumbsUp,
  Gift,
  Swords,
  CircleCheck,
  ScrollText,
  PenTool,
  GitBranch,
  FolderTree,
  Folders,
  Map as MapIcon,
  Archive,
  Wand2,
  Coffee,
  Headphones,
  Umbrella,
  Ear,
  FileText,
  BookOpen,
  Crosshair,
  Tornado,
  Compass,
  Sun,
  Waves,
  Send,
  Search,
  Eye,
  Wind,
  Hexagon,
  Anchor,
  Share,
  MessageCircle,
  GraduationCap,
  Wrench,
  Coins,
  Wallet,
  Skull,
  Heart,
  Bird,
  Moon,
  Snowflake,
  Users,
} from 'lucide-react';
import { useFocusStore } from '../stores/focusStore';
import { useGamificationStore } from '../stores/gamificationStore';
import { ACHIEVEMENTS, CATEGORY_COLORS, getTier } from '../../shared/types/gamification';
import AchievementsModal from './AchievementsModal';
import LevelBadge from './LevelBadge';

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Zap, Flame, Target, Cpu, Crown, Clock, BrainCircuit, TrendingUp, Calendar, CalendarCheck, Award, Trophy,
  SquarePlus, Layers, CheckSquare, ListChecks, FolderPlus, Bot, Mic, Video, ArrowRightCircle,
  Lightbulb, Sparkles, Brain, BrainCog, LayoutGrid, Rocket, BadgeCheck,
  Timer, Medal, Shield, Hourglass, TreePine, Flag, Infinity, History, Globe, Mountain, Gem, Star,
  Hash, Package, Database, ThumbsUp, Gift, Swords, CircleCheck, ScrollText, PenTool, GitBranch,
  FolderTree, Folders, Map: MapIcon, Archive, Wand2, Coffee,
  Headphones, Umbrella, Ear, FileText, BookOpen, Crosshair, Tornado,
  Compass, Sun, Waves, Send, Search, Eye,
  Wind, Hexagon, Anchor, Share, MessageCircle, GraduationCap,
  Wrench, Coins, Wallet, Skull, Heart, Bird, Moon, Snowflake, Users,
};

// Tailwind color classes for each category
const CATEGORY_CLASS_MAP: Record<string, { bg: string; text: string; dot: string }> = {
  focus:     { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  cards:     { bg: 'bg-blue-500/10',    text: 'text-blue-400',    dot: 'bg-blue-400' },
  projects:  { bg: 'bg-purple-500/10',  text: 'text-purple-400',  dot: 'bg-purple-400' },
  meetings:  { bg: 'bg-amber-500/10',   text: 'text-amber-400',   dot: 'bg-amber-400' },
  ideas:     { bg: 'bg-pink-500/10',    text: 'text-pink-400',    dot: 'bg-pink-400' },
  brainstorm:{ bg: 'bg-cyan-500/10',    text: 'text-cyan-400',    dot: 'bg-cyan-400' },
};

// Map category names from CATEGORY_COLORS to achievement icon bg classes
const ACHIEVEMENT_CATEGORY_CLASS: Record<string, string> = {
  focus:     'bg-emerald-500/15 text-emerald-400',
  cards:     'bg-blue-500/15 text-blue-400',
  projects:  'bg-purple-500/15 text-purple-400',
  meetings:  'bg-amber-500/15 text-amber-400',
  ideas:     'bg-pink-500/15 text-pink-400',
  brainstorm:'bg-cyan-500/15 text-cyan-400',
  cross:     'bg-yellow-500/15 text-yellow-400',
};

const CATEGORIES_ORDER = ['focus', 'cards', 'projects', 'meetings', 'ideas', 'brainstorm'];
const CATEGORY_LABELS: Record<string, string> = {
  focus: 'Focus',
  cards: 'Cards',
  projects: 'Projects',
  meetings: 'Meetings',
  ideas: 'Ideas',
  brainstorm: 'Brainstorm',
};

export default function FocusStatsWidget() {
  const stats = useGamificationStore(s => s.stats);
  const achievements = useGamificationStore(s => s.achievements);
  const dailyXP = useGamificationStore(s => s.dailyXP);
  const mode = useFocusStore(s => s.mode);
  const loadStats = useGamificationStore(s => s.loadStats);
  const loadDailyXP = useGamificationStore(s => s.loadDailyXP);

  const [achievementsModalOpen, setAchievementsModalOpen] = useState(false);

  useEffect(() => {
    loadStats();
    loadDailyXP(7);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStartFocus = () => {
    useFocusStore.getState().setShowStartModal(true);
  };

  // Weekly XP total and max for chart
  const weeklyTotalXP = dailyXP.reduce((sum, d) => sum + d.xp, 0);
  const maxDailyXP = Math.max(...dailyXP.map(d => d.xp), 1);

  // Achievement unlock tracking
  const unlockedSet = new Set(
    achievements.filter(a => a.unlockedAt !== null).map(a => a.id),
  );
  const unlockedCount = unlockedSet.size;

  return (
    <>
      <div className="bg-white dark:bg-surface-900/50 rounded-2xl border border-surface-200 dark:border-surface-800 shadow-sm overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-100 dark:border-surface-800">
          <div className="flex items-center gap-2">
            <Trophy size={16} className="text-emerald-500" />
            <h3 className="font-semibold text-surface-900 dark:text-surface-100">Your Progress</h3>
          </div>
          <div className="flex items-center gap-3">
            {/* Level pill */}
            {stats && <LevelBadge level={stats.level} size="md" />}
            {/* Total XP */}
            {stats && (
              <span className="text-xs font-semibold text-surface-400">{stats.totalXp.toLocaleString()} XP</span>
            )}
            {/* Start Focus button */}
            {mode === 'idle' && (
              <button
                onClick={handleStartFocus}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium transition-colors"
              >
                <Play size={12} />
                Start Focus
              </button>
            )}
          </div>
        </div>

        {/* Stats Grid */}
        <div className="p-5">
          <div className="grid grid-cols-4 gap-4">
            {/* Column 1: Today's XP */}
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wider text-surface-500 font-semibold">Today's XP</p>
              {stats && stats.todayXp > 0 ? (
                <>
                  <p className="text-2xl font-bold text-emerald-500">
                    {stats.todayXp} <span className="text-sm font-medium text-surface-400">XP</span>
                  </p>
                  <p className="text-xs text-surface-500">
                    {stats.focusTodaySessions} focus session{stats.focusTodaySessions !== 1 ? 's' : ''}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-2xl font-bold text-surface-600 dark:text-surface-400">0 <span className="text-sm font-medium text-surface-400">XP</span></p>
                  <p className="text-xs text-surface-500">No activity yet</p>
                </>
              )}
            </div>

            {/* Column 2: Activity Streak */}
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wider text-surface-500 font-semibold">Streak</p>
              {stats && stats.currentStreak > 0 ? (
                <>
                  <p className="text-2xl font-bold text-amber-500 flex items-center gap-1">
                    <Flame size={20} className="text-amber-500" />
                    {stats.currentStreak} <span className="text-sm font-medium text-surface-400">days</span>
                  </p>
                  <p className="text-xs text-surface-500">Best: {stats.longestStreak}</p>
                </>
              ) : (
                <>
                  <p className="text-2xl font-bold text-surface-600 dark:text-surface-400">0 <span className="text-sm font-medium text-surface-400">days</span></p>
                  <p className="text-xs text-surface-500">Start your streak!</p>
                </>
              )}
            </div>

            {/* Column 3: Level Progress */}
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wider text-surface-500 font-semibold">Level</p>
              {stats ? (
                <>
                  <LevelBadge level={stats.level} size="lg" />
                  <div className="w-full h-1.5 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden mt-1">
                    <div
                      className={`h-full ${getTier(stats.level).colors.text.replace('text-', 'bg-')} rounded-full transition-all duration-500`}
                      style={{ width: `${stats.xpProgress * 100}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-surface-500 mt-0.5">
                    {stats.xpNextLevel - stats.totalXp} XP to next
                  </p>
                </>
              ) : (
                <LevelBadge level={1} size="lg" />
              )}
            </div>

            {/* Column 4: This Week (XP bar chart) */}
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wider text-surface-500 font-semibold">This Week</p>
              {dailyXP.length > 0 ? (
                <>
                  <div className="flex items-end gap-1 h-8">
                    {dailyXP.map((day) => {
                      const height = day.xp > 0
                        ? Math.max((day.xp / maxDailyXP) * 100, 10)
                        : 4;
                      return (
                        <div
                          key={day.date}
                          className="flex-1 rounded-sm transition-all duration-300"
                          style={{
                            height: `${height}%`,
                            backgroundColor: day.xp > 0
                              ? 'rgb(16 185 129)' // emerald-500
                              : 'rgb(64 64 64)', // surface-700ish
                          }}
                          title={`${new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' })}: ${day.xp} XP`}
                        />
                      );
                    })}
                  </div>
                  <div className="flex gap-1">
                    {dailyXP.map((day) => (
                      <p key={day.date} className="flex-1 text-[9px] text-surface-500 text-center">
                        {new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' }).charAt(0)}
                      </p>
                    ))}
                  </div>
                  <p className="text-xs text-surface-500">
                    {weeklyTotalXP.toLocaleString()} XP this week
                  </p>
                </>
              ) : (
                <>
                  <div className="flex items-end gap-1 h-8">
                    {Array.from({ length: 7 }).map((_, i) => (
                      <div key={i} className="flex-1 h-[4%] rounded-sm bg-surface-700" />
                    ))}
                  </div>
                  <p className="text-xs text-surface-500">No data yet</p>
                </>
              )}
            </div>
          </div>

          {/* XP Breakdown Row */}
          {stats && (
            <div className="mt-4 pt-4 border-t border-surface-100 dark:border-surface-800">
              <div className="flex flex-wrap gap-2">
                {CATEGORIES_ORDER.map((cat) => {
                  const xp = stats.xpByCategory[cat] || 0;
                  const colors = CATEGORY_CLASS_MAP[cat];
                  const isZero = xp === 0;
                  return (
                    <div
                      key={cat}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                        isZero
                          ? 'bg-surface-100 dark:bg-surface-800 text-surface-400 dark:text-surface-600'
                          : `${colors.bg} ${colors.text}`
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${isZero ? 'bg-surface-400 dark:bg-surface-600' : colors.dot}`}
                      />
                      {CATEGORY_LABELS[cat]}
                      <span className={isZero ? 'text-surface-400 dark:text-surface-600' : ''}>
                        {xp}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Achievements Row */}
          <div
            className="mt-4 pt-4 border-t border-surface-100 dark:border-surface-800 cursor-pointer group"
            onClick={() => setAchievementsModalOpen(true)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setAchievementsModalOpen(true); }}
          >
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs uppercase tracking-wider text-surface-500 font-semibold">Achievements</p>
              <p className="text-xs text-surface-500 group-hover:text-emerald-400 transition-colors">
                {unlockedCount}/{ACHIEVEMENTS.length} unlocked
              </p>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {ACHIEVEMENTS.map((ach) => {
                const Icon = ICON_MAP[ach.icon] || Zap;
                const unlocked = unlockedSet.has(ach.id);
                const categoryClass = ACHIEVEMENT_CATEGORY_CLASS[ach.category] || 'bg-surface-800 text-surface-400';
                return (
                  <div
                    key={ach.id}
                    className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                      unlocked
                        ? categoryClass
                        : 'bg-surface-100 dark:bg-surface-800 text-surface-400 dark:text-surface-600'
                    } group-hover:scale-105`}
                    title={unlocked ? `${ach.name}: ${ach.description}` : `Locked: ${ach.description}`}
                  >
                    <Icon size={14} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <AchievementsModal
        isOpen={achievementsModalOpen}
        onClose={() => setAchievementsModalOpen(false)}
      />
    </>
  );
}
