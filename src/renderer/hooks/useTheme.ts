// === FILE PURPOSE ===
// Hook that manages the app theme (dark/light/system).
// Reads theme preference from settingsStore, applies the correct CSS class
// to document.documentElement, and listens for system theme changes.

import { useEffect } from 'react';
import { useSettingsStore } from '../stores/settingsStore';

export type ThemeMode = 'dark' | 'light' | 'system';

/** Resolves 'system' to the actual theme based on OS preference */
function resolveTheme(mode: ThemeMode): 'dark' | 'light' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return mode;
}

/** Apply the resolved theme class to the document root */
function applyTheme(mode: ThemeMode) {
  const resolved = resolveTheme(mode);
  const el = document.documentElement.classList;
  el.toggle('light', resolved === 'light');
  el.toggle('dark', resolved === 'dark');
}

/**
 * Manages app theme. Call once at the app root level.
 * Reads from settings store key 'app.theme' (default: 'system').
 * Applies CSS class to <html> and listens for system theme changes.
 */
export function useTheme() {
  const settings = useSettingsStore((s) => s.settings);
  const setSetting = useSettingsStore((s) => s.setSetting);

  const themeMode = (settings['app.theme'] as ThemeMode) || 'system';

  // Apply theme whenever the setting changes
  useEffect(() => {
    applyTheme(themeMode);
  }, [themeMode]);

  // Listen for OS theme changes when mode is 'system'
  useEffect(() => {
    if (themeMode !== 'system') return;

    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const handler = () => applyTheme('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [themeMode]);

  const setTheme = (mode: ThemeMode) => {
    setSetting('app.theme', mode);
  };

  return { themeMode, setTheme };
}
