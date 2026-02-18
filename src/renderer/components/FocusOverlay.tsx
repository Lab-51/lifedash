// === FILE PURPOSE ===
// Full-screen immersive overlay displayed during focus (Pomodoro) and break sessions.
// Replaces the minimal StatusBar timer with a distraction-free, visually rich experience.
// Features: SVG progress ring, large countdown, level/streak info, today's stats,
// motivational quotes, and minimal pause/stop controls.

import { useEffect, useState } from 'react';
import { useFocusStore } from '../stores/focusStore';
import { useGamificationStore } from '../stores/gamificationStore';
import LevelBadge from './LevelBadge';
import { Pause, Play, Square, Timer, Clock, Zap, Flame, Coffee } from 'lucide-react';

// --- Motivational Quotes ---

const FOCUS_QUOTES = [
  '"The secret of getting ahead is getting started." \u2014 Mark Twain',
  '"Focus on being productive instead of busy." \u2014 Tim Ferriss',
  '"It\'s not that I\'m so smart, it\'s just that I stay with problems longer." \u2014 Einstein',
  '"Deep work is the ability to focus without distraction on a cognitively demanding task." \u2014 Cal Newport',
  '"The successful warrior is the average man, with laser-like focus." \u2014 Bruce Lee',
  '"Concentrate all your thoughts upon the work at hand." \u2014 Alexander Graham Bell',
  '"You can\'t depend on your eyes when your imagination is out of focus." \u2014 Mark Twain',
  '"Do every act of your life as though it were the last act of your life." \u2014 Marcus Aurelius',
  '"Where focus goes, energy flows." \u2014 Tony Robbins',
  '"The shorter way to do many things is to only do one thing at a time." \u2014 Mozart',
  '"Starve your distractions, feed your focus." \u2014 Unknown',
  '"It is during our darkest moments that we must focus to see the light." \u2014 Aristotle',
  '"Lack of direction, not lack of time, is the problem." \u2014 Zig Ziglar',
  '"I fear not the man who has practiced 10,000 kicks once, but the man who has practiced one kick 10,000 times." \u2014 Bruce Lee',
  '"The main thing is to keep the main thing the main thing." \u2014 Stephen Covey',
] as const;

// --- Breathing animation keyframes ---

const styleId = 'focus-overlay-keyframes';
if (typeof document !== 'undefined' && !document.getElementById(styleId)) {
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    @keyframes breathe {
      0% { transform: scale(1); opacity: 0.5; }
      100% { transform: scale(1.3); opacity: 1; }
    }
  `;
  document.head.appendChild(style);
}

// --- Helpers ---

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// --- Component ---

export default function FocusOverlay() {
  const {
    mode,
    timeRemaining,
    isPaused,
    focusedCardTitle,
    workDuration,
    breakDuration,
    pause,
    resume,
    stop,
  } = useFocusStore();

  const stats = useGamificationStore((s) => s.stats);

  // Pick a random quote on mount
  const [quote] = useState(
    () => FOCUS_QUOTES[Math.floor(Math.random() * FOCUS_QUOTES.length)],
  );

  // Fade-in on mount
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  // Derive total seconds for progress calculation
  const isFocus = mode === 'focus';
  const totalSeconds = isFocus ? workDuration * 60 : breakDuration * 60;
  const elapsed = totalSeconds - timeRemaining;
  const progress = totalSeconds > 0 ? elapsed / totalSeconds : 0;

  // SVG progress ring constants
  const diameter = 280;
  const center = diameter / 2; // 140
  const radius = 130;
  const circumference = 2 * Math.PI * radius; // ~816.81
  const strokeDashoffset = circumference * (1 - progress);

  // Colors by mode
  const ringColor = isFocus ? 'text-emerald-500' : 'text-amber-500';
  const timerColor = isFocus ? 'text-emerald-400' : 'text-amber-400';
  const gradientBg = isFocus
    ? 'radial-gradient(circle at 50% 40%, rgba(16, 185, 129, 0.07) 0%, transparent 70%)'
    : 'radial-gradient(circle at 50% 40%, rgba(245, 158, 11, 0.07) 0%, transparent 70%)';

  // Stats fallback
  const level = stats?.level ?? 1;
  const totalXp = stats?.totalXp ?? 0;
  const currentStreak = stats?.currentStreak ?? 0;
  const focusTodaySessions = stats?.focusTodaySessions ?? 0;
  const focusTodayMinutes = stats?.focusTodayMinutes ?? 0;
  const todayXp = stats?.todayXp ?? 0;

  return (
    <div className={`fixed inset-0 z-40 flex flex-col items-center bg-surface-950 transition-opacity duration-500 ${visible ? 'opacity-100' : 'opacity-0'}`}>
      {/* Breathing gradient overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: gradientBg,
          animation: 'breathe 4s ease-in-out infinite alternate',
        }}
      />

      {/* TOP BAR */}
      <div className="absolute top-0 left-0 right-0 px-8 py-4 flex justify-between items-center">
        {/* Left: Level badge + XP */}
        <div className="flex items-center gap-2">
          <LevelBadge level={level} size="sm" />
          <span className="text-surface-400 text-sm">
            {totalXp.toLocaleString()} XP
          </span>
        </div>

        {/* Right: Streak */}
        {currentStreak > 0 && (
          <div className="flex items-center gap-1.5 text-surface-400 text-sm">
            <Flame className="w-4 h-4 text-amber-400" />
            <span>{currentStreak} day streak</span>
          </div>
        )}
      </div>

      {/* CENTER — vertically + horizontally centered */}
      <div className="flex flex-col items-center justify-center flex-1 pt-16 pb-4">
        {/* SVG circular progress ring */}
        <div className="relative" style={{ width: diameter, height: diameter }}>
          <svg viewBox={`0 0 ${diameter} ${diameter}`} width={diameter} height={diameter}>
            {/* Background circle */}
            <circle
              cx={center}
              cy={center}
              r={radius}
              stroke="currentColor"
              className="text-surface-800"
              strokeWidth={8}
              fill="none"
            />
            {/* Progress circle */}
            <circle
              cx={center}
              cy={center}
              r={radius}
              stroke="currentColor"
              className={`${ringColor} ${isPaused ? 'animate-pulse' : ''}`}
              strokeWidth={8}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              style={{
                transition: 'stroke-dashoffset 1s ease',
                transform: 'rotate(-90deg)',
                transformOrigin: 'center',
              }}
            />
          </svg>

          {/* Timer text inside the ring */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`font-mono text-8xl font-light tracking-wider ${timerColor}`}>
              {formatTime(timeRemaining)}
            </span>
            <span className="text-sm uppercase tracking-widest text-surface-500 mt-2">
              {isPaused ? (
                'PAUSED'
              ) : isFocus ? (
                'FOCUS'
              ) : (
                <span className="flex items-center gap-1.5">
                  <Coffee className="w-4 h-4" />
                  BREAK TIME
                </span>
              )}
            </span>
          </div>
        </div>

        {/* Card title below the ring */}
        {focusedCardTitle && (
          <p className="mt-6 text-lg text-surface-300 max-w-md truncate text-center">
            {focusedCardTitle}
          </p>
        )}

        {/* Today's stats row */}
        <div className="mt-8 flex items-center gap-6">
          <div className="flex items-center gap-1.5 text-surface-400 text-sm">
            <Timer className="w-4 h-4" />
            <span>{focusTodaySessions} sessions</span>
          </div>
          <div className="flex items-center gap-1.5 text-surface-400 text-sm">
            <Clock className="w-4 h-4" />
            <span>{focusTodayMinutes} min</span>
          </div>
          <div className="flex items-center gap-1.5 text-surface-400 text-sm">
            <Zap className="w-4 h-4" />
            <span>+{todayXp} XP</span>
          </div>
        </div>

        {/* Motivational quote (focus) or relax message (break) */}
        <div className="mt-8 max-w-lg text-center">
          {isFocus ? (
            <p className="text-surface-500 text-sm italic">{quote}</p>
          ) : (
            <p className="text-surface-500 text-sm">Relax, you earned it.</p>
          )}
        </div>
      </div>

      {/* CONTROLS — pinned near bottom */}
      <div className="mt-auto mb-8 flex items-center gap-6">
        {/* Pause / Resume */}
        <div className="flex flex-col items-center">
          <button
            onClick={isPaused ? resume : pause}
            className="w-14 h-14 rounded-full bg-surface-800 hover:bg-surface-700 flex items-center justify-center transition-colors"
          >
            {isPaused ? (
              <Play className="w-6 h-6 text-surface-300" />
            ) : (
              <Pause className="w-6 h-6 text-surface-300" />
            )}
          </button>
          <span className="text-xs text-surface-500 mt-1.5">
            {isPaused ? 'Resume' : 'Pause'}
          </span>
        </div>

        {/* Stop */}
        <div className="flex flex-col items-center">
          <button
            onClick={stop}
            className="w-14 h-14 rounded-full bg-surface-800 hover:bg-red-600 flex items-center justify-center transition-colors"
          >
            <Square className="w-5 h-5 text-surface-300" />
          </button>
          <span className="text-xs text-surface-500 mt-1.5">Stop</span>
        </div>
      </div>

      {/* Keyboard hint */}
      <span className="mb-4 text-xs text-surface-600">Ctrl+Shift+F to exit</span>
    </div>
  );
}
