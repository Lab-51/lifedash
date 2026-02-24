// === FILE PURPOSE ===
// Modal overlay showing all keyboard shortcuts organized by category.
// Opens via Ctrl+? or from the command palette.

import { useEffect } from 'react';
import { X } from 'lucide-react';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SHORTCUT_GROUPS = [
  {
    label: 'Navigation',
    shortcuts: [
      { keys: 'Ctrl+1', description: 'Home' },
      { keys: 'Ctrl+2', description: 'Projects' },
      { keys: 'Ctrl+3', description: 'Meetings' },
      { keys: 'Ctrl+4', description: 'Ideas' },
      { keys: 'Ctrl+5', description: 'Brainstorm' },
      { keys: 'Ctrl+6', description: 'Focus' },
      { keys: 'Ctrl+7', description: 'Settings' },
    ],
  },
  {
    label: 'Actions',
    shortcuts: [
      { keys: 'Ctrl+K', description: 'Command Palette' },
      { keys: 'Ctrl+Shift+F', description: 'Focus Mode' },
      { keys: 'Ctrl+Shift+Space', description: 'Quick Capture (global)' },
      { keys: 'Ctrl+?', description: 'Keyboard Shortcuts' },
      { keys: 'Esc', description: 'Close modal / overlay' },
    ],
  },
  {
    label: 'Page Shortcuts',
    shortcuts: [
      { keys: '/', description: 'Focus board search (on Board page)' },
      { keys: 'Ctrl+N', description: 'New brainstorm session (on Brainstorm page)' },
      { keys: 'Esc', description: 'Close filters / blur search (on Board page)' },
    ],
  },
];

function KeyboardShortcutsModal({ isOpen, onClose }: KeyboardShortcutsModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md hud-panel-accent clip-corner-cut overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border-accent)]">
          <h2 className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent)]">Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-[var(--color-accent-subtle)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-4 space-y-5">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.label}>
              <h3 className="font-hud text-[10px] tracking-widest uppercase text-[var(--color-accent-dim)] mb-2">
                {group.label}
              </h3>
              <div className="space-y-1.5">
                {group.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.keys}
                    className="flex items-center justify-between py-1"
                  >
                    <span className="text-sm text-[var(--color-text-secondary)]">{shortcut.description}</span>
                    <kbd className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-data text-[var(--color-accent)] bg-[var(--color-accent-subtle)] rounded border border-[var(--color-border)]">
                      {shortcut.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default KeyboardShortcutsModal;
