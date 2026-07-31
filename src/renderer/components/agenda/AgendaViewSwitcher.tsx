// === FILE PURPOSE ===
// The three-way agenda view toggle (CAL-UX.2 Task 2) that sits in the upcoming-
// meetings header next to the refresh button: list | week | timeline.
//
// Icon-only by design (the header is a single compact row), so each button carries
// an aria-label AND a title, and the active one is marked with aria-pressed.

import type { LucideIcon } from 'lucide-react';
import { CalendarDays, Clock, List } from 'lucide-react';
import type { AgendaViewMode } from '../../../shared/types/calendar';

const VIEW_OPTIONS: { mode: AgendaViewMode; label: string; Icon: LucideIcon }[] = [
  { mode: 'list', label: 'List view', Icon: List },
  { mode: 'week', label: 'Week view', Icon: CalendarDays },
  { mode: 'timeline', label: 'Timeline view', Icon: Clock },
];

interface AgendaViewSwitcherProps {
  mode: AgendaViewMode;
  onChange: (mode: AgendaViewMode) => void;
}

export default function AgendaViewSwitcher({ mode, onChange }: AgendaViewSwitcherProps) {
  return (
    <div className="flex items-center gap-0.5 shrink-0 rounded-md border border-[var(--color-border)] p-0.5">
      {VIEW_OPTIONS.map((option) => (
        <button
          key={option.mode}
          type="button"
          onClick={() => onChange(option.mode)}
          aria-pressed={mode === option.mode}
          aria-label={option.label}
          title={option.label}
          className={`p-1 rounded transition-colors ${
            mode === option.mode
              ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:bg-surface-100/80 dark:hover:bg-surface-800/80'
          }`}
        >
          <option.Icon size={13} />
        </button>
      ))}
    </div>
  );
}
