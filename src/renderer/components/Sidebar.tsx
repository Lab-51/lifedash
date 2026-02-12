// === FILE PURPOSE ===
// Fixed-width icon sidebar for primary app navigation.
// Uses react-router-dom NavLink for active-state detection.
// Renders vertically: Projects, Meetings, Ideas, Brainstorm, Settings.

// === DEPENDENCIES ===
// react-router-dom (NavLink), lucide-react icons

import { NavLink } from 'react-router-dom';
import {
  FolderKanban,
  Mic,
  Lightbulb,
  Brain,
  Settings,
} from 'lucide-react';

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

function Sidebar() {
  return (
    <nav className="w-16 bg-surface-900 border-r border-surface-800 flex flex-col shrink-0">
      {navItems.map(({ path, label, icon: Icon }) => (
        <NavLink
          key={path}
          to={path}
          end={path === '/'}
          title={label}
          className={({ isActive }) =>
            [
              'w-full h-12 flex items-center justify-center transition-colors',
              isActive
                ? 'bg-primary-600/15 text-primary-400 border-l-2 border-primary-500'
                : 'text-surface-400 hover:bg-surface-800 hover:text-surface-200 border-l-2 border-transparent',
            ].join(' ')
          }
        >
          <Icon size={20} />
        </NavLink>
      ))}
    </nav>
  );
}

export default Sidebar;
