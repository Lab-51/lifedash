// === FILE PURPOSE ===
// Sidebar Modern — Primary navigation with HUD-styled unified teal glow.

import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
    LayoutDashboard,
    FolderKanban,
    Mic,
    Lightbulb,
    Brain,
    Clock,
    Settings,
    Sun,
    Moon,
    Monitor,
    Timer,
} from 'lucide-react';
import dashIcon from '../assets/icon.svg';
import { useTheme } from '../hooks/useTheme';
import { useFocusStore } from '../stores/focusStore';
import { useBackgroundAgentStore } from '../stores/backgroundAgentStore';

import type { ThemeMode } from '../hooks/useTheme';
import RecordingIndicator from './RecordingIndicator';

interface NavItem {
    path: string;
    label: string;
    icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
    tourId?: string;
}

const navItems: NavItem[] = [
    { path: '/', label: 'Home', icon: LayoutDashboard },
    { path: '/meetings', label: 'Meetings', icon: Mic, tourId: 'nav-meetings' },
    { path: '/projects', label: 'Projects', icon: FolderKanban, tourId: 'nav-projects' },
    { path: '/brainstorm', label: 'Brainstorm', icon: Brain, tourId: 'nav-brainstorm' },
    { path: '/ideas', label: 'Ideas', icon: Lightbulb, tourId: 'nav-ideas' },
    { path: '/focus', label: 'Focus', icon: Clock },
    { path: '/settings', label: 'Settings', icon: Settings },
];

const SHORTCUT_KEYS: Record<string, string> = {
    '/': 'Ctrl+1',
    '/meetings': 'Ctrl+2',
    '/projects': 'Ctrl+3',
    '/brainstorm': 'Ctrl+4',
    '/ideas': 'Ctrl+5',
    '/focus': 'Ctrl+6',
    '/settings': 'Ctrl+7',
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

export default function SidebarModern() {
    const location = useLocation();
    const { themeMode, setTheme } = useTheme();
    const focusMode = useFocusStore(s => s.mode);
    const newInsightsCount = useBackgroundAgentStore(s => s.newInsightsCount);
    const refreshNewCount = useBackgroundAgentStore(s => s.refreshNewCount);

    useEffect(() => {
        refreshNewCount();
    }, [refreshNewCount]);

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
                {navItems.map(({ path, label, icon: Icon, tourId }) => {
                    const isHome = path === '/';
                    const isActive = isHome
                        ? location.pathname === '/'
                        : location.pathname.startsWith(path);

                    return (
                        <NavLink
                            key={path}
                            to={path}
                            title={SHORTCUT_KEYS[path] ? `${label} (${SHORTCUT_KEYS[path]})` : label}
                            {...(tourId ? { 'data-tour-id': tourId } : {})}
                            className={`group relative w-full h-12 flex items-center justify-center rounded-xl transition-all duration-200 ${isActive
                                    ? 'hud-nav-active'
                                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-accent-dim)] hover:bg-[var(--color-accent-subtle)]'
                                }`}
                        >
                            <Icon size={22} strokeWidth={isActive ? 2.5 : 2} className="transition-transform group-hover:scale-110" />

                            {/* New insights badge dot — only on Home */}
                            {isHome && newInsightsCount > 0 && (
                                <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[var(--color-accent)]" />
                            )}

                            {/* Tooltip on hover */}
                            <span className="absolute left-full ml-4 px-2 py-1 bg-white dark:bg-surface-800 text-surface-900 dark:text-white text-xs rounded border border-surface-200 dark:border-transparent opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 pointer-events-none shadow-lg translate-x-1 group-hover:translate-x-0">
                                {label}
                            </span>
                        </NavLink>
                    );
                })}
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
                    title={focusMode === 'idle' ? 'Focus Mode (Ctrl+Shift+F)' : 'Stop Focus Session'}
                    className="w-12 h-12 rounded-xl flex items-center justify-center text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] transition-all hover:scale-105 active:scale-95"
                >
                    <Timer
                        size={20}
                        className={focusMode !== 'idle' ? 'animate-pulse text-emerald-400' : undefined}
                    />
                </button>

                {/* Theme Toggle */}
                <button
                    onClick={cycleTheme}
                    title={THEME_LABELS[themeMode]}
                    className="w-12 h-12 rounded-xl flex items-center justify-center text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] transition-all hover:scale-105 active:scale-95"
                >
                    <ThemeIcon size={20} />
                </button>
            </div>
        </nav>
    );
}
