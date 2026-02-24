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
  barColor: string;
}

const CATEGORY_STYLES: Record<string, CategoryStyle> = {
  focus: {
    labelText: 'dark:text-emerald-400', labelTextLight: 'text-emerald-600',
    iconBgDark: 'dark:bg-emerald-500/20', iconBgLight: 'bg-emerald-100',
    iconTextDark: 'dark:text-emerald-400', iconTextLight: 'text-emerald-600',
    borderLight: 'border-emerald-300/40',
    gradientFrom: 'dark:from-emerald-500/10', gradientFromLight: 'from-emerald-50/80',
    glowDark: 'rgba(52, 211, 153, 0.4)', glowLight: 'rgba(16, 185, 129, 0.25)',
    barColor: 'rgb(52, 211, 153)',
  },
  cards: {
    labelText: 'dark:text-blue-400', labelTextLight: 'text-blue-600',
    iconBgDark: 'dark:bg-blue-500/20', iconBgLight: 'bg-blue-100',
    iconTextDark: 'dark:text-blue-400', iconTextLight: 'text-blue-600',
    borderLight: 'border-blue-300/40',
    gradientFrom: 'dark:from-blue-500/10', gradientFromLight: 'from-blue-50/80',
    glowDark: 'rgba(96, 165, 250, 0.4)', glowLight: 'rgba(59, 130, 246, 0.25)',
    barColor: 'rgb(96, 165, 250)',
  },
  projects: {
    labelText: 'dark:text-purple-400', labelTextLight: 'text-purple-600',
    iconBgDark: 'dark:bg-purple-500/20', iconBgLight: 'bg-purple-100',
    iconTextDark: 'dark:text-purple-400', iconTextLight: 'text-purple-600',
    borderLight: 'border-purple-300/40',
    gradientFrom: 'dark:from-purple-500/10', gradientFromLight: 'from-purple-50/80',
    glowDark: 'rgba(192, 132, 252, 0.4)', glowLight: 'rgba(147, 51, 234, 0.25)',
    barColor: 'rgb(192, 132, 252)',
  },
  meetings: {
    labelText: 'dark:text-amber-400', labelTextLight: 'text-amber-600',
    iconBgDark: 'dark:bg-amber-500/20', iconBgLight: 'bg-amber-100',
    iconTextDark: 'dark:text-amber-400', iconTextLight: 'text-amber-600',
    borderLight: 'border-amber-300/40',
    gradientFrom: 'dark:from-amber-500/10', gradientFromLight: 'from-amber-50/80',
    glowDark: 'rgba(251, 191, 36, 0.4)', glowLight: 'rgba(245, 158, 11, 0.25)',
    barColor: 'rgb(251, 191, 36)',
  },
  ideas: {
    labelText: 'dark:text-pink-400', labelTextLight: 'text-pink-600',
    iconBgDark: 'dark:bg-pink-500/20', iconBgLight: 'bg-pink-100',
    iconTextDark: 'dark:text-pink-400', iconTextLight: 'text-pink-600',
    borderLight: 'border-pink-300/40',
    gradientFrom: 'dark:from-pink-500/10', gradientFromLight: 'from-pink-50/80',
    glowDark: 'rgba(244, 114, 182, 0.4)', glowLight: 'rgba(236, 72, 153, 0.25)',
    barColor: 'rgb(244, 114, 182)',
  },
  brainstorm: {
    labelText: 'dark:text-cyan-400', labelTextLight: 'text-cyan-600',
    iconBgDark: 'dark:bg-cyan-500/20', iconBgLight: 'bg-cyan-100',
    iconTextDark: 'dark:text-cyan-400', iconTextLight: 'text-cyan-600',
    borderLight: 'border-cyan-300/40',
    gradientFrom: 'dark:from-cyan-500/10', gradientFromLight: 'from-cyan-50/80',
    glowDark: 'rgba(34, 211, 238, 0.4)', glowLight: 'rgba(6, 182, 212, 0.25)',
    barColor: 'rgb(34, 211, 238)',
  },
  cross: {
    labelText: 'dark:text-yellow-400', labelTextLight: 'text-yellow-600',
    iconBgDark: 'dark:bg-yellow-500/20', iconBgLight: 'bg-yellow-100',
    iconTextDark: 'dark:text-yellow-400', iconTextLight: 'text-yellow-600',
    borderLight: 'border-yellow-300/40',
    gradientFrom: 'dark:from-yellow-500/10', gradientFromLight: 'from-yellow-50/80',
    glowDark: 'rgba(250, 204, 21, 0.4)', glowLight: 'rgba(234, 179, 8, 0.25)',
    barColor: 'rgb(250, 204, 21)',
  },
};

const CATEGORY_LABEL: Record<string, string> = {
  focus: 'Focus', cards: 'Cards', projects: 'Projects',
  meetings: 'Meetings', ideas: 'Ideas', brainstorm: 'Brainstorm', cross: 'Special',
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

// --- Particle burst positions (radiate outward from icon center) ---
const PARTICLES = [
  { x: '-20px', y: '-24px', delay: '0ms', size: 5 },
  { x: '22px',  y: '-18px', delay: '50ms', size: 4 },
  { x: '-16px', y: '20px',  delay: '100ms', size: 3 },
  { x: '24px',  y: '16px',  delay: '75ms', size: 5 },
  { x: '-8px',  y: '-28px', delay: '25ms', size: 4 },
  { x: '12px',  y: '24px',  delay: '125ms', size: 3 },
];

// --- Auto-dismiss duration ---
const DISPLAY_MS = 6000;
const EXIT_MS = 400;

// --- Component ---

function AchievementBanner() {
  const current = useBannerStore((s) => s.current);
  const next = useBannerStore((s) => s.next);

  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [barDepleted, setBarDepleted] = useState(false);
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
      setBarDepleted(false);
      clearTimers();
      return;
    }

    // Reset states for fresh entrance
    setExiting(false);
    setVisible(false);
    setBarDepleted(false);

    // Trigger entrance on next frame so the DOM renders the invisible state first
    const raf = requestAnimationFrame(() => {
      setVisible(true);
      // Start countdown bar depletion after entrance completes
      requestAnimationFrame(() => {
        setBarDepleted(true);
      });
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
  const categoryLabel = CATEGORY_LABEL[current.category] ?? 'Special';

  const handleDismiss = () => {
    clearTimers();
    setExiting(true);
    exitTimerRef.current = setTimeout(() => {
      next();
    }, EXIT_MS);
  };

  // Animation class — replaces all inline animation styles
  const animClass = exiting
    ? 'achievement-banner-exit'
    : visible
      ? 'achievement-banner-enter'
      : 'achievement-banner-hidden';

  return (
    <div className="fixed top-4 left-0 right-0 z-[60] flex justify-center pointer-events-none">
      <div
        className={`
          achievement-banner pointer-events-auto w-[480px] relative overflow-hidden
          border bg-gradient-to-r clip-corner-cut-sm
          bg-white ${cats.borderLight} ${cats.gradientFromLight} to-white
          ring-1 ring-black/[0.04] shadow-xl shadow-surface-300/50
          dark:bg-surface-900 dark:border-[var(--color-border-accent)] ${cats.gradientFrom} dark:to-surface-900
          dark:ring-0 dark:shadow-2xl dark:shadow-black/30
          ${animClass}
        `}
        style={{
          '--glow-light': cats.glowLight,
          '--glow-dark': cats.glowDark,
        } as React.CSSProperties}
      >
        {/* Shimmer sweep — runs once on entrance */}
        {visible && !exiting && (
          <div
            className="absolute inset-0 pointer-events-none achievement-shimmer"
            style={{
              animation: 'achievement-shimmer 800ms ease-in-out 300ms forwards',
              background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.6) 50%, transparent 100%)',
            }}
          />
        )}

        {/* Content layout */}
        <div className="flex items-center gap-3 px-4 py-3">
          {/* Icon circle */}
          <div
            className={`
              w-12 h-12 rounded-full flex items-center justify-center shrink-0
              relative overflow-visible
              ${cats.iconBgLight} ${cats.iconBgDark}
              ${cats.iconTextLight} ${cats.iconTextDark}
            `}
            style={{
              animation: visible && !exiting
                ? 'achievement-icon-bounce 500ms ease-out 200ms both'
                : undefined,
            }}
          >
            <Icon size={26} />
            {visible && !exiting && PARTICLES.map((p, i) => (
              <span
                key={i}
                className="absolute rounded-full pointer-events-none"
                style={{
                  '--px': p.x,
                  '--py': p.y,
                  width: p.size,
                  height: p.size,
                  backgroundColor: 'currentColor',
                  animation: `achievement-particle 700ms ease-out ${p.delay} forwards`,
                  top: '50%',
                  left: '50%',
                } as React.CSSProperties}
              />
            ))}
          </div>

          {/* Text content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <p
                className={`
                  text-[10px] uppercase tracking-[0.2em] font-bold leading-none
                  ${cats.labelTextLight} ${cats.labelText}
                `}
              >
                Achievement Unlocked
              </p>
              <span
                className={`
                  text-[9px] uppercase tracking-wider font-semibold leading-none
                  px-1.5 py-0.5 rounded-full
                  bg-surface-100 text-surface-500
                  dark:bg-surface-800 dark:text-surface-400
                `}
              >
                {categoryLabel}
              </span>
            </div>
            <p className="text-base font-bold leading-tight truncate text-surface-800 dark:text-surface-100">
              {current.name}
            </p>
            <p className="text-xs leading-snug truncate text-surface-600 dark:text-surface-400">
              {current.description}
            </p>
          </div>

          {/* Dismiss button */}
          <button
            onClick={handleDismiss}
            className="
              p-1 rounded-md shrink-0 transition-colors text-surface-400
              hover:text-surface-700 hover:bg-surface-100
              dark:hover:text-surface-200 dark:hover:bg-surface-800
            "
            aria-label="Dismiss achievement"
          >
            <X size={16} />
          </button>
        </div>

        {/* Countdown progress bar */}
        <div className="h-[3px] w-full">
          <div
            className="h-full rounded-full"
            style={{
              width: barDepleted ? '0%' : '100%',
              transition: barDepleted ? `width ${DISPLAY_MS - EXIT_MS}ms linear` : 'none',
              backgroundColor: cats.barColor,
              opacity: 0.7,
            }}
          />
        </div>
      </div>
    </div>
  );
}

export default AchievementBanner;
