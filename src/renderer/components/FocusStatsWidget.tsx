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
  focus: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  cards: { bg: 'bg-blue-500/10', text: 'text-blue-400', dot: 'bg-blue-400' },
  projects: { bg: 'bg-purple-500/10', text: 'text-purple-400', dot: 'bg-purple-400' },
  meetings: { bg: 'bg-amber-500/10', text: 'text-amber-400', dot: 'bg-amber-400' },
  ideas: { bg: 'bg-pink-500/10', text: 'text-pink-400', dot: 'bg-pink-400' },
  brainstorm: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', dot: 'bg-cyan-400' },
};

// Map category names from CATEGORY_COLORS to achievement icon bg classes
const ACHIEVEMENT_CATEGORY_CLASS: Record<string, string> = {
  focus: 'bg-emerald-500/15 text-emerald-400',
  cards: 'bg-blue-500/15 text-blue-400',
  projects: 'bg-purple-500/15 text-purple-400',
  meetings: 'bg-amber-500/15 text-amber-400',
  ideas: 'bg-pink-500/15 text-pink-400',
  brainstorm: 'bg-cyan-500/15 text-cyan-400',
  cross: 'bg-yellow-500/15 text-yellow-400',
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
  const loadStats = useGamificationStore(s => s.loadStats);
  const loadDailyXP = useGamificationStore(s => s.loadDailyXP);

  const [achievementsModalOpen, setAchievementsModalOpen] = useState(false);

  useEffect(() => {
    loadStats();
    loadDailyXP(7);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      <div className="hud-panel clip-corner-cut-sm overflow-hidden h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Trophy size={16} className="text-[var(--color-accent)]" />
            <div className="flex items-center gap-3">
              <span className="font-hud text-xs tracking-widest text-[var(--color-accent-dim)]">SYS.PROGRESS</span>
              <div className="h-px w-16 bg-gradient-to-r from-[var(--color-accent)] to-transparent opacity-30" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Level pill */}
            {stats && <LevelBadge level={stats.level} size="md" />}
            {/* Total XP */}
            {stats && (
              <span className="font-data text-xs text-[var(--color-accent-dim)]">{stats.totalXp.toLocaleString()} XP</span>
            )}
          </div>
        </div>
        <div className="ruled-line-accent" />

        {/* Stats Grid */}
        <div className="p-5">
          <div className="grid grid-cols-12 gap-4 lg:gap-6">
            {/* Column 1: Today's XP */}
            <div className="col-span-6 sm:col-span-3 lg:col-span-2 flex flex-col justify-between hud-panel-accent clip-corner-cut-sm p-3">
              <p className="font-hud text-[10px] tracking-wider text-[var(--color-accent-dim)]">Today's XP</p>
              {stats && stats.todayXp > 0 ? (
                <>
                  <p className="font-[var(--font-display)] text-2xl text-[var(--color-accent)] text-glow">
                    {stats.todayXp} <span className="text-sm font-medium text-[var(--color-text-muted)]">XP</span>
                  </p>
                  <p className="font-data text-xs text-[var(--color-text-secondary)]">
                    {stats.focusTodaySessions} focus session{stats.focusTodaySessions !== 1 ? 's' : ''}
                  </p>
                </>
              ) : (
                <>
                  <p className="font-[var(--font-display)] text-2xl text-[var(--color-text-muted)]">0 <span className="text-sm font-medium text-[var(--color-text-muted)]">XP</span></p>
                  <p className="font-data text-xs text-[var(--color-text-secondary)]">No activity yet</p>
                </>
              )}
            </div>

            {/* Column 2: Activity Streak */}
            <div className="col-span-6 sm:col-span-3 lg:col-span-2 flex flex-col justify-between hud-panel-accent clip-corner-cut-sm p-3">
              <p className="font-hud text-[10px] tracking-wider text-[var(--color-warm-dim)]">Streak</p>
              {stats && stats.currentStreak > 0 ? (
                <>
                  <p className="font-[var(--font-display)] text-2xl text-[var(--color-warm)] text-glow-warm flex items-center gap-1">
                    <Flame size={20} className="text-[var(--color-warm)]" />
                    {stats.currentStreak} <span className="text-sm font-medium text-[var(--color-text-muted)]">days</span>
                  </p>
                  <p className="font-data text-xs text-[var(--color-text-secondary)]">Best: {stats.longestStreak}</p>
                </>
              ) : (
                <>
                  <p className="font-[var(--font-display)] text-2xl text-[var(--color-text-muted)]">0 <span className="text-sm font-medium text-[var(--color-text-muted)]">days</span></p>
                  <p className="font-data text-xs text-[var(--color-text-secondary)]">Start your streak!</p>
                </>
              )}
            </div>

            {/* Column 3: Level Progress */}
            <div className="col-span-12 sm:col-span-6 lg:col-span-4 flex flex-col hud-panel clip-corner-cut-sm p-3">
              <p className="font-hud text-[10px] tracking-wider text-[var(--color-accent-dim)] mb-2">Level Progress</p>
              {stats ? (
                <div className="flex flex-col justify-end flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <LevelBadge level={stats.level} size="lg" />
                    <div className="flex-1">
                      <p className="text-[10px] text-surface-500 mb-0.5 font-medium text-right">
                        {stats.xpNextLevel - stats.totalXp} XP to next
                      </p>
                      <div className="w-full h-1.5 bg-[var(--color-border)] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[var(--color-accent)] rounded-full transition-all duration-500 shadow-[0_0_6px_rgba(62,232,228,0.4)]"
                          style={{ width: `${stats.xpProgress * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-end flex-1">
                  <LevelBadge level={1} size="lg" />
                </div>
              )}
            </div>

            {/* Column 4: This Week (XP bar chart) */}
            <div className="col-span-12 lg:col-span-4 flex flex-col justify-between hud-panel clip-corner-cut-sm p-3">
              <p className="font-hud text-[10px] tracking-wider text-[var(--color-accent-dim)]">This Week</p>
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
                              : 'var(--color-surface-300)', // neutral bar for zero-XP days
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
                      <div key={i} className="flex-1 h-[4%] rounded-sm bg-surface-300 dark:bg-surface-700" />
                    ))}
                  </div>
                  <p className="text-xs text-surface-500">No data yet</p>
                </>
              )}
            </div>
          </div>

          {/* XP Breakdown Row */}
          {stats && (
            <div className="mt-4 pt-4">
              <div className="ruled-line-accent mb-4" />
              <div className="flex flex-wrap gap-2">
                {CATEGORIES_ORDER.map((cat) => {
                  const xp = stats.xpByCategory[cat] || 0;
                  const colors = CATEGORY_CLASS_MAP[cat];
                  const isZero = xp === 0;
                  return (
                    <div
                      key={cat}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${isZero
                        ? 'bg-surface-100 dark:bg-surface-800 text-surface-400 dark:text-surface-600'
                        : `${colors.bg} ${colors.text}`
                        }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${isZero ? 'bg-surface-400 dark:bg-surface-600' : colors.dot}`}
                      />
                      {CATEGORY_LABELS[cat]}
                      <span className={isZero ? 'text-surface-400 dark:text-surface-600' : ''}>
                        {xp} XP
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Achievements Row */}
          <div className="ruled-line-accent mt-4" />
          <div
            className="mt-4 pt-0 cursor-pointer group"
            onClick={() => setAchievementsModalOpen(true)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setAchievementsModalOpen(true); }}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <span className="font-hud text-[10px] tracking-wider text-[var(--color-accent-dim)]">Achievements</span>
                <div className="h-px w-12 bg-gradient-to-r from-[var(--color-accent)] to-transparent opacity-30" />
              </div>
              <p className="font-data text-xs text-[var(--color-text-secondary)] group-hover:text-[var(--color-accent)] transition-colors">
                {unlockedCount}/{ACHIEVEMENTS.length} unlocked
              </p>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {ACHIEVEMENTS.map((ach) => {
                const Icon = ICON_MAP[ach.icon] || Zap;
                const unlocked = unlockedSet.has(ach.id);
                const categoryClass = ACHIEVEMENT_CATEGORY_CLASS[ach.category] || 'bg-surface-200 dark:bg-surface-800 text-surface-500 dark:text-surface-400';
                return (
                  <div
                    key={ach.id}
                    className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${unlocked
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
