// === FILE PURPOSE ===
// Dramatic achievement unlock banner with slide-down animation and pulsing glow.
// Self-contained Zustand store manages a queue so multiple unlocks display sequentially.

import { useEffect, useRef, useState, useCallback } from 'react';
import { create } from 'zustand';
import { Award, X } from 'lucide-react';
import { ICON_MAP } from './AchievementsModal';
import type { Achievement } from '../../shared/types/gamification';

// --- Category color config ---
// Full Tailwind class strings so static analysis detects them (no interpolation).

interface CategoryStyle {
  labelText: string;
  labelTextLight: string;
  iconBgDark: string;
  iconBgLight: string;
  iconTextDark: string;
  iconTextLight: string;
  borderLight: string;
  gradientFrom: string;
  gradientFromLight: string;
  glowDark: string;
  glowLight: string;
}

const CATEGORY_STYLES: Record<string, CategoryStyle> = {
  focus: {
    labelText: 'text-emerald-400', labelTextLight: 'text-emerald-600',
    iconBgDark: 'bg-emerald-500/20', iconBgLight: 'bg-emerald-500/15',
    iconTextDark: 'text-emerald-400', iconTextLight: 'text-emerald-600',
    borderLight: 'border-emerald-300/40',
    gradientFrom: 'from-emerald-500/10', gradientFromLight: 'from-emerald-500/5',
    glowDark: 'rgba(52, 211, 153, 0.4)', glowLight: 'rgba(16, 185, 129, 0.25)',
  },
  cards: {
    labelText: 'text-blue-400', labelTextLight: 'text-blue-600',
    iconBgDark: 'bg-blue-500/20', iconBgLight: 'bg-blue-500/15',
    iconTextDark: 'text-blue-400', iconTextLight: 'text-blue-600',
    borderLight: 'border-blue-300/40',
    gradientFrom: 'from-blue-500/10', gradientFromLight: 'from-blue-500/5',
    glowDark: 'rgba(96, 165, 250, 0.4)', glowLight: 'rgba(59, 130, 246, 0.25)',
  },
  projects: {
    labelText: 'text-purple-400', labelTextLight: 'text-purple-600',
    iconBgDark: 'bg-purple-500/20', iconBgLight: 'bg-purple-500/15',
    iconTextDark: 'text-purple-400', iconTextLight: 'text-purple-600',
    borderLight: 'border-purple-300/40',
    gradientFrom: 'from-purple-500/10', gradientFromLight: 'from-purple-500/5',
    glowDark: 'rgba(192, 132, 252, 0.4)', glowLight: 'rgba(147, 51, 234, 0.25)',
  },
  meetings: {
    labelText: 'text-amber-400', labelTextLight: 'text-amber-600',
    iconBgDark: 'bg-amber-500/20', iconBgLight: 'bg-amber-500/15',
    iconTextDark: 'text-amber-400', iconTextLight: 'text-amber-600',
    borderLight: 'border-amber-300/40',
    gradientFrom: 'from-amber-500/10', gradientFromLight: 'from-amber-500/5',
    glowDark: 'rgba(251, 191, 36, 0.4)', glowLight: 'rgba(245, 158, 11, 0.25)',
  },
  ideas: {
    labelText: 'text-pink-400', labelTextLight: 'text-pink-600',
    iconBgDark: 'bg-pink-500/20', iconBgLight: 'bg-pink-500/15',
    iconTextDark: 'text-pink-400', iconTextLight: 'text-pink-600',
    borderLight: 'border-pink-300/40',
    gradientFrom: 'from-pink-500/10', gradientFromLight: 'from-pink-500/5',
    glowDark: 'rgba(244, 114, 182, 0.4)', glowLight: 'rgba(236, 72, 153, 0.25)',
  },
  brainstorm: {
    labelText: 'text-cyan-400', labelTextLight: 'text-cyan-600',
    iconBgDark: 'bg-cyan-500/20', iconBgLight: 'bg-cyan-500/15',
    iconTextDark: 'text-cyan-400', iconTextLight: 'text-cyan-600',
    borderLight: 'border-cyan-300/40',
    gradientFrom: 'from-cyan-500/10', gradientFromLight: 'from-cyan-500/5',
    glowDark: 'rgba(34, 211, 238, 0.4)', glowLight: 'rgba(6, 182, 212, 0.25)',
  },
  cross: {
    labelText: 'text-yellow-400', labelTextLight: 'text-yellow-600',
    iconBgDark: 'bg-yellow-500/20', iconBgLight: 'bg-yellow-500/15',
    iconTextDark: 'text-yellow-400', iconTextLight: 'text-yellow-600',
    borderLight: 'border-yellow-300/40',
    gradientFrom: 'from-yellow-500/10', gradientFromLight: 'from-yellow-500/5',
    glowDark: 'rgba(250, 204, 21, 0.4)', glowLight: 'rgba(234, 179, 8, 0.25)',
  },
};

function getCategoryClasses(category: string): CategoryStyle {
  return CATEGORY_STYLES[category] ?? CATEGORY_STYLES.cross;
}

// --- Zustand banner store ---

interface BannerState {
  queue: Achievement[];
  current: Achievement | null;
  push: (achievement: Achievement) => void;
  next: () => void;
  clear: () => void;
}

export const useBannerStore = create<BannerState>((set) => ({
  queue: [],
  current: null,

  push: (achievement) =>
    set((state) => {
      if (state.current === null) {
        // Nothing showing — display immediately
        return { current: achievement };
      }
      // Already showing — add to queue
      return { queue: [...state.queue, achievement] };
    }),

  next: () =>
    set((state) => {
      if (state.queue.length > 0) {
        const [next, ...rest] = state.queue;
        return { current: next, queue: rest };
      }
      return { current: null };
    }),

  clear: () => set({ queue: [], current: null }),
}));

/** Convenience function to show an achievement banner from anywhere. */
export function showAchievementBanner(achievement: Achievement) {
  useBannerStore.getState().push(achievement);
}

// --- Auto-dismiss duration ---
const DISPLAY_MS = 6000;
const EXIT_MS = 400;

// --- Component ---

function AchievementBanner() {
  const current = useBannerStore((s) => s.current);
  const next = useBannerStore((s) => s.next);

  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (exitTimerRef.current) {
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
  }, []);

  // When current changes to non-null, trigger entrance
  useEffect(() => {
    if (!current) {
      setVisible(false);
      setExiting(false);
      clearTimers();
      return;
    }

    // Reset states for fresh entrance
    setExiting(false);
    setVisible(false);

    // Trigger entrance on next frame so the DOM renders the invisible state first
    const raf = requestAnimationFrame(() => {
      setVisible(true);
    });

    // Auto-dismiss: start exit animation after (DISPLAY_MS - EXIT_MS),
    // then call next() after EXIT_MS completes
    timerRef.current = setTimeout(() => {
      setExiting(true);
      exitTimerRef.current = setTimeout(() => {
        next();
      }, EXIT_MS);
    }, DISPLAY_MS - EXIT_MS);

    return () => {
      cancelAnimationFrame(raf);
      clearTimers();
    };
  }, [current, next, clearTimers]);

  // Cleanup on unmount
  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  if (!current) return null;

  const cats = getCategoryClasses(current.category);
  const Icon = ICON_MAP[current.icon] ?? Award;

  // Determine dark/light mode for theme-conditional classes
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  const glowColor = isDark ? cats.glowDark : cats.glowLight;

  const handleDismiss = () => {
    clearTimers();
    setExiting(true);
    exitTimerRef.current = setTimeout(() => {
      next();
    }, EXIT_MS);
  };

  // Animation style
  const animationStyle: React.CSSProperties = exiting
    ? { animation: `achievement-exit ${EXIT_MS}ms ease-in forwards` }
    : visible
      ? { animation: 'achievement-enter 600ms ease-out forwards' }
      : { opacity: 0, transform: 'translateY(-100%) scale(0.95)' };

  return (
    <div className="fixed top-4 left-0 right-0 z-[60] flex justify-center pointer-events-none">
      <div
        className={`
          pointer-events-auto w-[420px] relative overflow-hidden rounded-xl
          border bg-gradient-to-r to-white
          ${isDark
            ? `bg-surface-900 border-surface-700/50 ${cats.gradientFrom} to-surface-900`
            : `bg-white ${cats.borderLight} ${cats.gradientFromLight}`
          }
        `}
        style={{
          ...animationStyle,
          '--achievement-glow-color': glowColor,
          animationName: exiting
            ? 'achievement-exit'
            : visible
              ? 'achievement-enter, achievement-glow'
              : undefined,
          animationDuration: exiting
            ? `${EXIT_MS}ms`
            : visible
              ? '600ms, 2s'
              : undefined,
          animationTimingFunction: exiting
            ? 'ease-in'
            : visible
              ? 'ease-out, ease-in-out'
              : undefined,
          animationFillMode: exiting
            ? 'forwards'
            : visible
              ? 'forwards, none'
              : undefined,
          animationIterationCount: exiting
            ? '1'
            : visible
              ? '1, infinite'
              : undefined,
          animationDelay: exiting
            ? undefined
            : visible
              ? '0ms, 600ms'
              : undefined,
        } as React.CSSProperties}
      >
        {/* Shimmer sweep — runs once on entrance */}
        {visible && !exiting && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              animation: 'achievement-shimmer 800ms ease-in-out 300ms forwards',
              opacity: 0.15,
              background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.6) 50%, transparent 100%)',
            }}
          />
        )}

        {/* Content layout */}
        <div className="flex items-center gap-3 px-4 py-3">
          {/* Icon circle */}
          <div
            className={`
              w-10 h-10 rounded-full flex items-center justify-center shrink-0
              ${isDark ? cats.iconBgDark : cats.iconBgLight}
              ${isDark ? cats.iconTextDark : cats.iconTextLight}
            `}
          >
            <Icon size={22} />
          </div>

          {/* Text content */}
          <div className="flex-1 min-w-0">
            <p
              className={`
                text-[10px] uppercase tracking-widest font-semibold leading-none mb-0.5
                ${isDark ? cats.labelText : cats.labelTextLight}
              `}
            >
              Achievement Unlocked
            </p>
            <p className={`text-lg font-bold leading-tight truncate ${isDark ? 'text-surface-100' : 'text-surface-900'}`}>
              {current.name}
            </p>
            <p className={`text-sm leading-snug truncate ${isDark ? 'text-surface-400' : 'text-surface-500'}`}>
              {current.description}
            </p>
          </div>

          {/* Dismiss button */}
          <button
            onClick={handleDismiss}
            className={`
              p-1 rounded-md shrink-0 transition-colors text-surface-400
              ${isDark
                ? 'hover:text-surface-200 hover:bg-surface-800'
                : 'hover:text-surface-700 hover:bg-surface-100'
              }
            `}
            aria-label="Dismiss achievement"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default AchievementBanner;
