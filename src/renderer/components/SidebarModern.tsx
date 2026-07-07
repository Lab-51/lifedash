// === FILE PURPOSE ===
// Sidebar Modern — Primary navigation with HUD-styled unified teal glow.
// V3.1: collapsed to exactly 3 entries (Sessions / Twin[disabled] / Settings).
// Legacy surfaces (Projects, Brainstorm, Ideas, Focus, Intel) keep their routes
// mounted for deep links and search results — only their nav entries are gone.

import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Mic, Brain, Settings, Sun, Moon, Monitor, Timer } from 'lucide-react';
import dashIcon from '../assets/icon.svg';
import { useTheme } from '../hooks/useTheme';
import { useSoundEffect } from '../hooks/useSoundEffect';
import { useFocusStore } from '../stores/focusStore';
import { useBackgroundAgentStore } from '../stores/backgroundAgentStore';
import { useMeetingStore } from '../stores/meetingStore';

import type { ThemeMode } from '../hooks/useTheme';
import RecordingIndicator from './RecordingIndicator';

interface NavItem {
  path: string;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  tourId?: string;
  /** Twin arrives in V3.3 — rendered visible-but-inert so the IA reads complete now. */
  disabled?: boolean;
  disabledHint?: string;
}

const navItems: NavItem[] = [
  { path: '/', label: 'Sessions', icon: Mic, tourId: 'nav-sessions' },
  { path: '/twin', label: 'Twin', icon: Brain, disabled: true, disabledHint: 'Twin — arrives in V3.3' },
  { path: '/settings', label: 'Settings', icon: Settings },
];

const SHORTCUT_KEYS: Record<string, string> = {
  '/': 'Ctrl+1',
  '/settings': 'Ctrl+8',
};

const THEME_CYCLE: ThemeMode[] = ['dark', 'light', 'system'];
const THEME_ICONS: Record<ThemeMode, React.ComponentType<{ size?: number }>> = {
  dark: Moon,
  light: Sun,
  system: Monitor,
};
const THEME_LABELS: Record<ThemeMode, string> = {
  dark: 'Dark mode',
  light: 'Light mode',
  system: 'System theme',
};

/** Twin-style disabled entry — no route yet, so it's an inert focusable button. */
function DisabledNavEntry({ icon: Icon, label, hint }: { icon: NavItem['icon']; label: string; hint?: string }) {
  return (
    <div
      data-testid="nav-item"
      role="button"
      aria-disabled="true"
      aria-label={hint ?? label}
      title={hint ?? label}
      tabIndex={0}
      className="group relative w-full h-12 flex items-center justify-center rounded-xl text-[var(--color-text-muted)] opacity-40 cursor-not-allowed select-none"
    >
      <Icon size={22} strokeWidth={2} />
      <span className="absolute left-full ml-4 px-2 py-1 bg-white dark:bg-surface-800 text-surface-900 dark:text-white text-xs rounded border border-surface-200 dark:border-transparent opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 pointer-events-none shadow-lg translate-x-1 group-hover:translate-x-0">
        {hint ?? label}
      </span>
    </div>
  );
}

interface ActiveNavEntryProps {
  item: NavItem;
  isActive: boolean;
  showInsightsDot: boolean;
  /** Count of unreviewed auto-pushed cards; 0 hides the badge. */
  unreviewedCount: number;
  onHover: () => void;
}

/** Real, routable nav entry (Sessions / Settings) — NavLink with active state + badges. */
function ActiveNavEntry({ item, isActive, showInsightsDot, unreviewedCount, onHover }: ActiveNavEntryProps) {
  const { path, label, icon: Icon, tourId } = item;
  const showUnreviewedBadge = unreviewedCount > 0;
  const unreviewedBadgeText = unreviewedCount > 9 ? '9+' : String(unreviewedCount);

  return (
    <NavLink
      to={path}
      data-testid="nav-item"
      title={SHORTCUT_KEYS[path] ? `${label} (${SHORTCUT_KEYS[path]})` : label}
      {...(tourId ? { 'data-tour-id': tourId } : {})}
      onMouseEnter={onHover}
      className={`group relative w-full h-12 flex items-center justify-center rounded-xl transition-all duration-200 ${
        isActive
          ? 'hud-nav-active'
          : 'text-[var(--color-text-secondary)] hover:text-[var(--color-accent-dim)] hover:bg-[var(--color-accent-subtle)]'
      }`}
    >
      <Icon size={22} strokeWidth={isActive ? 2.5 : 2} className="transition-transform group-hover:scale-110" />

      {/* New insights badge dot — only on Sessions (home) */}
      {showInsightsDot && <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[var(--color-accent)]" />}

      {/* Unreviewed auto-pushed cards badge — Sessions nav only (moved here from
          the retired Projects nav entry; meetings are still where auto-push happens) */}
      {showUnreviewedBadge && (
        <span
          data-testid="sessions-unreviewed-badge"
          title={`${unreviewedCount} meeting card${unreviewedCount === 1 ? '' : 's'} to review — open a session`}
          className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-[var(--color-accent)] text-[var(--color-chrome)] font-data text-[0.6rem] font-bold leading-none border border-[var(--color-chrome)]"
        >
          {unreviewedBadgeText}
        </span>
      )}

      {/* Tooltip on hover */}
      <span className="absolute left-full ml-4 px-2 py-1 bg-white dark:bg-surface-800 text-surface-900 dark:text-white text-xs rounded border border-surface-200 dark:border-transparent opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 pointer-events-none shadow-lg translate-x-1 group-hover:translate-x-0">
        {label}
      </span>
    </NavLink>
  );
}

export default function SidebarModern() {
  const location = useLocation();
  const { themeMode, setTheme } = useTheme();
  const { playHover } = useSoundEffect();
  const focusMode = useFocusStore((s) => s.mode);
  const newInsightsCount = useBackgroundAgentStore((s) => s.newInsightsCount);
  const refreshNewCount = useBackgroundAgentStore((s) => s.refreshNewCount);
  const unreviewedAutoPushedCount = useMeetingStore((s) => s.unreviewedAutoPushedCount);
  const refreshUnreviewedCount = useMeetingStore((s) => s.refreshUnreviewedCount);

  useEffect(() => {
    refreshNewCount();
  }, [refreshNewCount]);

  useEffect(() => {
    refreshUnreviewedCount();
  }, [refreshUnreviewedCount]);

  const cycleTheme = () => {
    const idx = THEME_CYCLE.indexOf(themeMode);
    const next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
    setTheme(next);
  };

  const ThemeIcon = THEME_ICONS[themeMode] || Moon;

  return (
    <nav className="w-20 flex flex-col shrink-0 py-6 transition-colors duration-300 z-50 bg-[var(--color-chrome)] border-r border-[var(--color-border)]">
      {/* App Logo / Top Icon — slow heartbeat glow */}
      <div className="flex justify-center mb-8">
        <img src={dashIcon} alt="LifeDash" className="w-10 h-10 rounded-xl animate-logo-pulse" />
      </div>

      <div className="flex flex-col gap-3 px-3 flex-1">
        {navItems.map((item) =>
          item.disabled ? (
            <DisabledNavEntry key={item.path} icon={item.icon} label={item.label} hint={item.disabledHint} />
          ) : (
            <ActiveNavEntry
              key={item.path}
              item={item}
              isActive={item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path)}
              showInsightsDot={item.path === '/' && newInsightsCount > 0}
              unreviewedCount={item.path === '/' ? unreviewedAutoPushedCount : 0}
              onHover={playHover}
            />
          ),
        )}
      </div>

      <div className="flex flex-col items-center gap-4 px-3 mt-auto">
        <div className="w-full h-px bg-[var(--color-border)]" />

        {/* Recording Visualizer */}
        <RecordingIndicator />

        {/* Focus Mode Toggle */}
        <button
          onClick={() => {
            if (focusMode === 'idle') {
              useFocusStore.getState().setShowStartModal(true);
            } else {
              useFocusStore.getState().stop();
            }
          }}
          onMouseEnter={() => playHover()}
          title={focusMode === 'idle' ? 'Focus Mode (Ctrl+Shift+F)' : 'Stop Focus Session'}
          className="w-12 h-12 rounded-xl flex items-center justify-center text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] transition-all hover:scale-105 active:scale-95"
        >
          <Timer size={20} className={focusMode !== 'idle' ? 'animate-pulse text-emerald-400' : undefined} />
        </button>

        {/* Theme Toggle */}
        <button
          onClick={cycleTheme}
          onMouseEnter={() => playHover()}
          title={THEME_LABELS[themeMode]}
          className="w-12 h-12 rounded-xl flex items-center justify-center text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] transition-all hover:scale-105 active:scale-95"
        >
          <ThemeIcon size={20} />
        </button>
      </div>
    </nav>
  );
}
