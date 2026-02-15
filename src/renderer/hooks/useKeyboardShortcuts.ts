// === FILE PURPOSE ===
// Global keyboard shortcut handler for navigation.
// Ctrl+1 through Ctrl+5 navigate to the five main pages.
// Supports both Ctrl (Windows/Linux) and Cmd (macOS) modifiers.

// === DEPENDENCIES ===
// react (useEffect), react-router-dom NavigateFunction

import { useEffect } from 'react';
import type { NavigateFunction } from 'react-router-dom';

/** Map of digit keys to route paths */
const SHORTCUT_MAP: Record<string, string> = {
  '1': '/',
  '2': '/meetings',
  '3': '/ideas',
  '4': '/brainstorm',
  '5': '/settings',
};

function useKeyboardShortcuts(
  navigate: NavigateFunction,
  onToggleCommandPalette?: () => void,
  onToggleShortcutsHelp?: () => void,
): void {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Require Ctrl (Windows/Linux) or Cmd (macOS)
      if (!e.ctrlKey && !e.metaKey) return;

      // Ctrl+K / Cmd+K — toggle command palette
      if (e.key === 'k' && onToggleCommandPalette) {
        e.preventDefault();
        onToggleCommandPalette();
        return;
      }

      // Ctrl+? (Ctrl+Shift+/) — toggle shortcuts help
      if (e.key === '?' && onToggleShortcutsHelp) {
        e.preventDefault();
        onToggleShortcutsHelp();
        return;
      }

      const route = SHORTCUT_MAP[e.key];
      if (route) {
        e.preventDefault();
        navigate(route);
      }
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [navigate, onToggleCommandPalette, onToggleShortcutsHelp]);
}

export default useKeyboardShortcuts;
