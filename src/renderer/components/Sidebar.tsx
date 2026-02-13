// === FILE PURPOSE ===
// Fixed-width icon sidebar for primary app navigation.
// Includes a theme toggle button at the bottom.

// === DEPENDENCIES ===
// react-router-dom (NavLink), lucide-react icons, useTheme hook

import { NavLink, useLocation } from 'react-router-dom';
import {
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
import type { ThemeMode } from '../hooks/useTheme';
import RecordingIndicator from './RecordingIndicator';

/** Navigation item configuration */
interface NavItem {
  path: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
}

const navItems: NavItem[] = [
  { path: '/', label: 'Projects', icon: FolderKanban },
  { path: '/meetings', label: 'Meetings', icon: Mic },
  { path: '/ideas', label: 'Ideas', icon: Lightbulb },
  { path: '/brainstorm', label: 'Brainstorm', icon: Brain },
  { path: '/settings', label: 'Settings', icon: Settings },
];

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

function Sidebar() {
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
      {navItems.map(({ path, label, icon: Icon }) => {
        // Projects item should also be active on /projects/:id routes
        const isProjectsItem = path === '/';
        const isProjectsActive = isProjectsItem
          ? location.pathname === '/' || location.pathname.startsWith('/projects/')
          : false;

        return (
          <NavLink
            key={path}
            to={path}
            end={isProjectsItem}
            title={label}
            className={({ isActive: navActive }) => {
              const active = isProjectsItem ? isProjectsActive : navActive;
              return [
                'w-full h-12 flex items-center justify-center transition-colors',
                active
                  ? 'bg-primary-600/15 text-primary-400 border-l-2 border-primary-500'
                  : 'text-surface-400 hover:bg-surface-800 hover:text-surface-200 border-l-2 border-transparent',
              ].join(' ');
            }}
          >
            <Icon size={20} />
          </NavLink>
        );
      })}

      {/* Spacer pushes theme toggle to bottom */}
      <div className="flex-1" />

      {/* Recording indicator */}
      <div className="flex justify-center py-1">
        <RecordingIndicator />
      </div>

      {/* Theme toggle button */}
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

export default Sidebar;
