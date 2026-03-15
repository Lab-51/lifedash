// === FILE PURPOSE ===
// Reusable contextual help tooltip. Shows a HelpCircle icon that reveals
// an explanatory popover on hover, click, or keyboard focus.

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';

interface HelpTipProps {
  text: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export default function HelpTip({ text, position = 'top' }: HelpTipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrapperRef = useRef<HTMLSpanElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, close]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        close();
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open, close]);

  // Position classes for the popover
  const positionClasses: Record<string, string> = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  // Arrow/caret classes
  const arrowClasses: Record<string, string> = {
    top: 'top-full left-1/2 -translate-x-1/2 border-t-[var(--color-border-accent)] border-x-transparent border-b-transparent',
    bottom:
      'bottom-full left-1/2 -translate-x-1/2 border-b-[var(--color-border-accent)] border-x-transparent border-t-transparent',
    left: 'left-full top-1/2 -translate-y-1/2 border-l-[var(--color-border-accent)] border-y-transparent border-r-transparent',
    right:
      'right-full top-1/2 -translate-y-1/2 border-r-[var(--color-border-accent)] border-y-transparent border-l-transparent',
  };

  return (
    <span ref={wrapperRef} className="relative inline-flex items-center">
      <span
        role="button"
        tabIndex={0}
        aria-describedby={open ? id : undefined}
        className="inline-flex items-center text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors cursor-help focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent)] rounded-sm"
        onClick={() => setOpen((prev) => !prev)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((prev) => !prev);
          }
        }}
      >
        <HelpCircle size={14} />
      </span>

      {open && (
        <span
          id={id}
          role="tooltip"
          className={`absolute z-[70] max-w-[280px] px-3 py-2 text-xs leading-relaxed text-[var(--color-text-secondary)] bg-[var(--color-chrome)] backdrop-blur-md border border-[var(--color-border-accent)] rounded-lg shadow-lg ${positionClasses[position]}`}
        >
          {text}
          {/* Arrow */}
          <span className={`absolute w-0 h-0 border-[5px] ${arrowClasses[position]}`} />
        </span>
      )}
    </span>
  );
}
