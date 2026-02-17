// === FILE PURPOSE ===
// Dashboard widget showing focus mode stats: today's progress, streak, level,
// weekly activity chart, and achievement badges.

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
} from 'lucide-react';
import { useFocusStore } from '../stores/focusStore';
import { useGamificationStore } from '../stores/gamificationStore';
import { ACHIEVEMENTS } from '../../shared/types/gamification';
import type { FocusDailyData } from '../../shared/types/focus';

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Zap, Flame, Target, Cpu, Crown, Clock, BrainCircuit, TrendingUp, Calendar, CalendarCheck, Award, Trophy,
  SquarePlus, Layers, CheckSquare, ListChecks, FolderPlus, Bot, Mic, Video, ArrowRightCircle,
  Lightbulb, Sparkles, Brain, BrainCog, LayoutGrid, Rocket, BadgeCheck,
};

export default function FocusStatsWidget() {
  const stats = useGamificationStore(s => s.stats);
  const achievements = useGamificationStore(s => s.achievements);
  const mode = useFocusStore(s => s.mode);
  const loadStats = useGamificationStore(s => s.loadStats);

  const [dailyData, setDailyData] = useState<FocusDailyData[]>([]);

  useEffect(() => {
    loadStats();
    window.electronAPI.focusGetDaily(7).then(setDailyData).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStartFocus = () => {
    useFocusStore.getState().setShowStartModal(true);
  };

  // Compute weekly total
  const weeklyTotalMinutes = dailyData.reduce((sum, d) => sum + d.minutes, 0);
  const maxDailyMinutes = Math.max(...dailyData.map(d => d.minutes), 1);

  // Build achievement map for unlocked status
  const unlockedSet = new Set(
    achievements.filter(a => a.unlockedAt !== null).map(a => a.id),
  );
  const unlockedCount = unlockedSet.size;

  return (
    <div className="bg-white dark:bg-surface-900/50 rounded-2xl border border-surface-200 dark:border-surface-800 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-100 dark:border-surface-800">
        <div className="flex items-center gap-2">
          <Zap size={16} className="text-emerald-500" />
          <h3 className="font-semibold text-surface-900 dark:text-surface-100">Focus Mode</h3>
        </div>
        {mode === 'idle' && (
          <button
            onClick={handleStartFocus}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium transition-colors"
          >
            <Play size={12} />
            Start Focus Session
          </button>
        )}
      </div>

      {/* Stats Grid */}
      <div className="p-5">
        <div className="grid grid-cols-4 gap-4">
          {/* Today */}
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wider text-surface-500 font-semibold">Today</p>
            {stats && stats.focusTodaySessions > 0 ? (
              <>
                <p className="text-2xl font-bold text-emerald-500">
                  {stats.focusTodayMinutes} <span className="text-sm font-medium text-surface-400">min</span>
                </p>
                <p className="text-xs text-surface-500">
                  {stats.focusTodaySessions} session{stats.focusTodaySessions !== 1 ? 's' : ''}
                </p>
              </>
            ) : (
              <>
                <p className="text-2xl font-bold text-surface-600 dark:text-surface-400">0 <span className="text-sm font-medium text-surface-400">min</span></p>
                <p className="text-xs text-surface-500">No sessions yet</p>
              </>
            )}
          </div>

          {/* Streak */}
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

          {/* Level */}
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wider text-surface-500 font-semibold">Level</p>
            {stats ? (
              <>
                <p className="text-2xl font-bold text-emerald-500">
                  Lv.{stats.level}
                </p>
                <p className="text-xs text-surface-400 mb-1">{stats.levelName}</p>
                <div className="w-full h-1.5 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                    style={{ width: `${stats.xpProgress * 100}%` }}
                  />
                </div>
                <p className="text-[10px] text-surface-500 mt-0.5">
                  {stats.xpNextLevel - stats.totalXp} XP to next
                </p>
              </>
            ) : (
              <>
                <p className="text-2xl font-bold text-surface-600 dark:text-surface-400">Lv.1</p>
                <p className="text-xs text-surface-500">Beginner</p>
              </>
            )}
          </div>

          {/* Weekly Chart */}
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wider text-surface-500 font-semibold">This Week</p>
            {dailyData.length > 0 ? (
              <>
                <div className="flex items-end gap-1 h-8">
                  {dailyData.map((day) => {
                    const height = day.minutes > 0
                      ? Math.max((day.minutes / maxDailyMinutes) * 100, 10)
                      : 4;
                    return (
                      <div
                        key={day.date}
                        className="flex-1 rounded-sm transition-all duration-300"
                        style={{
                          height: `${height}%`,
                          backgroundColor: day.minutes > 0
                            ? 'rgb(16 185 129)' // emerald-500
                            : 'rgb(64 64 64)', // surface-700ish
                        }}
                        title={`${new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' })}: ${day.minutes} min`}
                      />
                    );
                  })}
                </div>
                <div className="flex gap-1">
                  {dailyData.map((day) => (
                    <p key={day.date} className="flex-1 text-[9px] text-surface-500 text-center">
                      {new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' }).charAt(0)}
                    </p>
                  ))}
                </div>
                <p className="text-xs text-surface-500">
                  {weeklyTotalMinutes >= 60
                    ? `${Math.floor(weeklyTotalMinutes / 60)}h ${weeklyTotalMinutes % 60}m total`
                    : `${weeklyTotalMinutes}m total`}
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

        {/* Achievements Row */}
        <div className="mt-5 pt-4 border-t border-surface-100 dark:border-surface-800">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs uppercase tracking-wider text-surface-500 font-semibold">Achievements</p>
            <p className="text-xs text-surface-500">{unlockedCount}/{ACHIEVEMENTS.length} unlocked</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {ACHIEVEMENTS.map((ach) => {
              const Icon = ICON_MAP[ach.icon] || Zap;
              const unlocked = unlockedSet.has(ach.id);
              return (
                <div
                  key={ach.id}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                    unlocked
                      ? 'bg-emerald-500/15 text-emerald-500'
                      : 'bg-surface-100 dark:bg-surface-800 text-surface-400 dark:text-surface-600'
                  }`}
                  title={unlocked ? `${ach.name}: ${ach.description}` : `Locked: ${ach.description}`}
                >
                  <Icon size={16} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
