// === FILE PURPOSE ===
// Sidebar Modern — Primary navigation with modern styling.

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

import type { ThemeMode } from '../hooks/useTheme';
import RecordingIndicator from './RecordingIndicator';

interface NavItem {
    path: string;
    label: string;
    icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
    activeClass: string;
}

const navItems: NavItem[] = [
    { path: '/', label: 'Home', icon: LayoutDashboard, activeClass: 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 ring-1 ring-primary-100 dark:ring-primary-800' },
    { path: '/projects', label: 'Projects', icon: FolderKanban, activeClass: 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 ring-1 ring-primary-100 dark:ring-primary-800' },
    { path: '/meetings', label: 'Meetings', icon: Mic, activeClass: 'bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 ring-1 ring-rose-100 dark:ring-rose-800' },
    { path: '/ideas', label: 'Ideas', icon: Lightbulb, activeClass: 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 ring-1 ring-amber-100 dark:ring-amber-800' },
    { path: '/brainstorm', label: 'Brainstorm', icon: Brain, activeClass: 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 ring-1 ring-indigo-100 dark:ring-indigo-800' },
    { path: '/focus', label: 'Focus', icon: Clock, activeClass: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-100 dark:ring-emerald-800' },
    { path: '/settings', label: 'Settings', icon: Settings, activeClass: 'bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-200 ring-1 ring-surface-200 dark:ring-surface-700' },
];

const SHORTCUT_KEYS: Record<string, string> = {
    '/': 'Ctrl+1',
    '/projects': 'Ctrl+2',
    '/meetings': 'Ctrl+3',
    '/ideas': 'Ctrl+4',
    '/brainstorm': 'Ctrl+5',
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

    const cycleTheme = () => {
        const idx = THEME_CYCLE.indexOf(themeMode);
        const next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
        setTheme(next);
    };

    const ThemeIcon = THEME_ICONS[themeMode] || Moon;

    return (
        <nav className="w-20 bg-white dark:bg-surface-900 border-r border-surface-200 dark:border-surface-800 flex flex-col shrink-0 py-6 transition-colors duration-300 z-50">
            {/* App Logo / Top Icon — slow heartbeat glow */}
            <div className="flex justify-center mb-8">
                <img src={dashIcon} alt="LifeDash" className="w-10 h-10 rounded-xl animate-logo-pulse" />
            </div>

            <div className="flex flex-col gap-3 px-3 flex-1">
                {navItems.map(({ path, label, icon: Icon, activeClass }) => {
                    const isHome = path === '/';
                    const isActive = isHome
                        ? location.pathname === '/'
                        : location.pathname.startsWith(path);

                    return (
                        <NavLink
                            key={path}
                            to={path}
                            title={SHORTCUT_KEYS[path] ? `${label} (${SHORTCUT_KEYS[path]})` : label}
                            className={`group relative w-full h-12 flex items-center justify-center rounded-xl transition-all duration-200 ${isActive
                                    ? `shadow-sm ${activeClass}`
                                    : 'text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800'
                                }`}
                        >
                            <Icon size={22} strokeWidth={isActive ? 2.5 : 2} className="transition-transform group-hover:scale-110" />

                            {/* Tooltip on hover */}
                            <span className="absolute left-full ml-4 px-2 py-1 bg-surface-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 pointer-events-none shadow-lg translate-x-1 group-hover:translate-x-0">
                                {label}
                            </span>
                        </NavLink>
                    );
                })}
            </div>

            <div className="flex flex-col items-center gap-4 px-3 mt-auto">
                <div className="w-full h-px bg-surface-200 dark:bg-surface-800" />

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
                    className="w-12 h-12 rounded-xl flex items-center justify-center text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800 transition-all hover:scale-105 active:scale-95"
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
                    className="w-12 h-12 rounded-xl flex items-center justify-center text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800 transition-all hover:scale-105 active:scale-95"
                >
                    <ThemeIcon size={20} />
                </button>
            </div>
        </nav>
    );
}
