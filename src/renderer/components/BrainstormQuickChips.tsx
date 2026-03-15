// === FILE PURPOSE ===
// Quick-reply chips for brainstorm AI responses.
// Parses single/multi-select choices embedded in assistant messages
// and renders them as clickable pill-shaped buttons below the AI message.

import { useState } from 'react';
import { Send, MousePointerClick, ListChecks } from 'lucide-react';

interface BrainstormQuickChipsProps {
  choices: string[];
  mode: 'single' | 'multi';
  onSend: (selected: string[]) => void;
}

/** Regex to extract choices markup from message content. */
export const CHOICES_REGEX = /<!--\s*choices:\s*(single|multi)\|(.+?)\s*-->/;

/** Parse a message string for embedded choices markup. Returns null if not found. */
export function parseChoices(content: string): { mode: 'single' | 'multi'; choices: string[] } | null {
  const match = content.match(CHOICES_REGEX);
  if (!match) return null;
  const mode = match[1] as 'single' | 'multi';
  const choices = match[2]
    .split('|')
    .map((c) => c.trim())
    .filter(Boolean);
  if (choices.length === 0) return null;
  return { mode, choices };
}

/** Strip choices markup from a message string so it doesn't render visually. */
export function stripChoicesMarkup(content: string): string {
  return content.replace(/<!--\s*choices:\s*(?:single|multi)\|.+?\s*-->/g, '').trim();
}

export default function BrainstormQuickChips({ choices, mode, onSend }: BrainstormQuickChipsProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const handleChipClick = (chip: string) => {
    if (mode === 'single') {
      onSend([chip]);
      return;
    }

    // Multi-select: toggle
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(chip)) {
        next.delete(chip);
      } else {
        next.add(chip);
      }
      return next;
    });
  };

  const handleSendMulti = () => {
    if (selected.size > 0) {
      onSend(Array.from(selected));
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-2">
      {/* Hint label */}
      <div className="flex items-center gap-1.5 text-[0.6875rem] font-medium text-[var(--color-accent)] opacity-80">
        {mode === 'single' ? (
          <>
            <MousePointerClick size={12} />
            <span>Pick one</span>
          </>
        ) : (
          <>
            <ListChecks size={12} />
            <span>Select all that apply</span>
          </>
        )}
      </div>

      {/* Chips */}
      <div className="flex flex-wrap items-center gap-2">
        {choices.map((chip) => {
          const isSelected = selected.has(chip);
          return (
            <button
              key={chip}
              onClick={() => handleChipClick(chip)}
              className={`px-3 py-1.5 text-sm font-medium rounded-full border transition-all ${
                isSelected
                  ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)] border-[var(--color-border-accent)] shadow-sm'
                  : 'bg-transparent text-[var(--color-text-secondary)] border-[var(--color-border)] hover:border-[var(--color-accent-dim)] hover:text-[var(--color-accent)]'
              }`}
            >
              {chip}
            </button>
          );
        })}

        {mode === 'multi' && selected.size > 0 && (
          <button
            onClick={handleSendMulti}
            className="px-3 py-1.5 text-sm font-medium rounded-full bg-[var(--color-accent)] text-white border border-[var(--color-accent)] hover:opacity-90 transition-all flex items-center gap-1.5 shadow-sm"
          >
            <Send size={12} />
            Send
          </button>
        )}
      </div>
    </div>
  );
}
