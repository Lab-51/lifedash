// === FILE PURPOSE ===
// Global keyboard shortcut handler for navigation.
// Ctrl+1 through Ctrl+8 navigate to the eight main pages.
// Supports both Ctrl (Windows/Linux) and Cmd (macOS) modifiers.

// === DEPENDENCIES ===
// react (useEffect), react-router-dom NavigateFunction

import { useEffect } from 'react';
import type { NavigateFunction } from 'react-router-dom';

/** Map of digit keys to route paths.
 *  Ctrl+4 ("Projects") removed in the session-centric IA collapse: `/projects` now
 *  redirects to `/`, so the shortcut just went to Sessions home. Projects live only
 *  inside sessions — there is no standalone Projects page to jump to. */
const SHORTCUT_MAP: Record<string, string> = {
  '1': '/',
  '2': '/meetings',
  '3': '/intel',
  '5': '/brainstorm',
  '6': '/ideas',
  '7': '/focus',
  '8': '/settings',
};

function useKeyboardShortcuts(
  navigate: NavigateFunction,
  onToggleCommandPalette?: () => void,
  onToggleShortcutsHelp?: () => void,
  onToggleFocusMode?: () => void,
  onQuickRecord?: () => void,
): void {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Require Ctrl (Windows/Linux) or Cmd (macOS)
      if (!e.ctrlKey && !e.metaKey) return;

      // Ctrl+Shift+R — quick record / stop recording
      if (e.shiftKey && e.key === 'R' && onQuickRecord) {
        e.preventDefault();
        onQuickRecord();
        return;
      }

      // Ctrl+Shift+F — toggle focus mode
      if (e.shiftKey && e.key === 'F' && onToggleFocusMode) {
        e.preventDefault();
        onToggleFocusMode();
        return;
      }

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
  }, [navigate, onToggleCommandPalette, onToggleShortcutsHelp, onToggleFocusMode, onQuickRecord]);
}

export default useKeyboardShortcuts;
