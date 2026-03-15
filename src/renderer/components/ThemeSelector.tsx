// === FILE PURPOSE ===
// Theme selector component for the Appearance section of the Settings page.
// Shows three options: Dark, Light, System with visual indicators.

import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import type { ThemeMode } from '../hooks/useTheme';

const THEME_OPTIONS: {
  mode: ThemeMode;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}[] = [
  { mode: 'dark', label: 'Dark', description: 'Dark background with light text', icon: Moon },
  { mode: 'light', label: 'Light', description: 'Light background with dark text', icon: Sun },
  { mode: 'system', label: 'System', description: 'Follow your OS setting', icon: Monitor },
];

export default function ThemeSelector() {
  const { themeMode, setTheme } = useTheme();

  return (
    <div className="flex gap-3">
      {THEME_OPTIONS.map(({ mode, label, description, icon: Icon }) => (
        <button
          key={mode}
          onClick={() => setTheme(mode)}
          className={`flex-1 p-3 rounded-lg border text-left transition-all ${
            themeMode === mode
              ? 'border-[var(--color-accent-dim)] bg-[var(--color-accent-subtle)] text-[var(--color-accent)] shadow-[0_0_12px_var(--color-chrome-glow)]'
              : 'border-[var(--color-border)] bg-[var(--color-chrome)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-accent)]'
          }`}
        >
          <Icon size={20} className="mb-1.5" />
          <div className="text-sm font-medium">{label}</div>
          <div className="text-xs text-[var(--color-text-muted)] mt-0.5">{description}</div>
        </button>
      ))}
    </div>
  );
}
