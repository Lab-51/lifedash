// === FILE PURPOSE ===
// Sidebar Classic — Fixed-width icon sidebar for primary app navigation.
// Includes a theme toggle button at the bottom.

import { NavLink, useLocation } from 'react-router-dom';
import {
    LayoutDashboard,
    FolderKanban,
    Mic,
    Lightbulb,
    Brain,
    Settings,
    Sun,
    Moon,
    Monitor,
} from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { useDesign } from '../hooks/useDesign';
import type { ThemeMode } from '../hooks/useTheme';
import RecordingIndicator from './RecordingIndicator';

interface NavItem {
    path: string;
    label: string;
    icon: React.ComponentType<{ size?: number }>;
}

const navItems: NavItem[] = [
    { path: '/', label: 'Home', icon: LayoutDashboard },
    { path: '/projects', label: 'Projects', icon: FolderKanban },
    { path: '/meetings', label: 'Meetings', icon: Mic },
    { path: '/ideas', label: 'Ideas', icon: Lightbulb },
    { path: '/brainstorm', label: 'Brainstorm', icon: Brain },
    { path: '/settings', label: 'Settings', icon: Settings },
];

const SHORTCUT_KEYS: Record<string, string> = {
    '/': 'Ctrl+1',
    '/projects': 'Ctrl+2',
    '/meetings': 'Ctrl+3',
    '/ideas': 'Ctrl+4',
    '/brainstorm': 'Ctrl+5',
    '/settings': 'Ctrl+6',
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

export default function SidebarClassic() {
    const location = useLocation();
    const { themeMode, setTheme } = useTheme();

    const cycleTheme = () => {
        const idx = THEME_CYCLE.indexOf(themeMode);
        const next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
        setTheme(next);
    };

    const ThemeIcon = THEME_ICONS[themeMode] || Moon;

    return (
        <nav className="w-16 bg-surface-900 border-r border-surface-800 flex flex-col shrink-0">
            <div className="flex flex-col gap-1 py-3">
                {navItems.map(({ path, label, icon: Icon }) => {
                    const isHome = path === '/';
                    const isActive = isHome
                        ? location.pathname === '/'
                        : location.pathname.startsWith(path);

                    return (
                        <NavLink
                            key={path}
                            to={path}
                            title={SHORTCUT_KEYS[path] ? `${label} (${SHORTCUT_KEYS[path]})` : label}
                            className={`w-full h-10 flex items-center justify-center transition-colors relative ${isActive
                                    ? 'text-primary-400'
                                    : 'text-surface-400 hover:bg-surface-800 hover:text-surface-200'
                                }`}
                        >
                            {isActive && (
                                <div className="absolute left-0 top-1 bottom-1 w-1 bg-primary-500 rounded-r-full" />
                            )}
                            <Icon size={20} />
                        </NavLink>
                    );
                })}
            </div>

            <div className="flex-1" />

            <div className="flex justify-center py-2">
                <RecordingIndicator />
            </div>

            <button
                onClick={cycleTheme}
                title={THEME_LABELS[themeMode]}
                className="w-full h-12 flex items-center justify-center text-surface-400 hover:bg-surface-800 hover:text-surface-200 transition-colors"
            >
                <ThemeIcon size={20} />
            </button>
        </nav>
    );
}
