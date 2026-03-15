// === FILE PURPOSE ===
// Dropdown action menu for Intel Feed article cards.
// Provides quick actions: Save as Idea, Start Project, Discuss with AI.

import { useState, useRef, useEffect } from 'react';
import { MoreHorizontal, Lightbulb, FolderKanban, Brain } from 'lucide-react';
import type { IntelItem } from '../../shared/types';

interface IntelActionMenuProps {
  item: IntelItem;
  onSaveAsIdea: (item: IntelItem) => void;
  onStartProject: (item: IntelItem) => void;
  onDiscuss: (item: IntelItem) => void;
}

const MENU_ITEMS = [
  { key: 'idea', label: 'Save as Idea', icon: Lightbulb, action: 'onSaveAsIdea' },
  { key: 'project', label: 'Start Project', icon: FolderKanban, action: 'onStartProject' },
  { key: 'discuss', label: 'Discuss with AI', icon: Brain, action: 'onDiscuss' },
] as const;

export default function IntelActionMenu({ item, onSaveAsIdea, onStartProject, onDiscuss }: IntelActionMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;

    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handlers: Record<string, (item: IntelItem) => void> = {
    onSaveAsIdea,
    onStartProject,
    onDiscuss,
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(prev => !prev);
        }}
        title="Actions"
        className="cursor-pointer shrink-0 p-1 rounded transition-all text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--color-accent)]"
      >
        <MoreHorizontal size={14} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-elevated)] shadow-lg py-1"
        >
          {MENU_ITEMS.map(({ key, label, icon: Icon, action }) => (
            <button
              key={key}
              onClick={(e) => {
                e.stopPropagation();
                handlers[action](item);
                setOpen(false);
              }}
              className="cursor-pointer w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-subtle)] hover:text-[var(--color-accent)] transition-colors"
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
