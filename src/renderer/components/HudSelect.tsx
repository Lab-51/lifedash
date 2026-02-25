// === FILE PURPOSE ===
// Custom HUD-styled dropdown select component.
// Replaces native <select> with a fully styled popover dropdown.

import { useState, useEffect, useRef } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface HudSelectOption {
  value: string;
  label: string;
  icon?: LucideIcon;
  description?: string;
}

interface HudSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: HudSelectOption[];
  icon?: LucideIcon;
  placeholder?: string;
}

function HudSelect({ value, onChange, options, icon: TriggerIcon, placeholder = 'Select...' }: HudSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(o => o.value === value);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSelect = (optValue: string) => {
    onChange(optValue);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border border-[var(--color-border)] hover:border-[var(--color-border-accent)] bg-surface-950 text-left text-sm transition-colors"
      >
        {TriggerIcon && <TriggerIcon size={14} className="text-[var(--color-text-muted)] shrink-0" />}
        <span className={`flex-1 truncate ${selectedOption ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)]'}`}>
          {selectedOption?.label || placeholder}
        </span>
        <ChevronDown size={14} className={`text-[var(--color-text-muted)] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown popover */}
      {open && (
        <div className="absolute top-full left-0 mt-1.5 z-50 w-full bg-surface-900 border border-[var(--color-border-accent)] rounded-xl shadow-2xl shadow-black/40 py-1.5 min-w-[180px]">
          {options.map(opt => {
            const isActive = opt.value === value;
            const OptIcon = opt.icon;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleSelect(opt.value)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                  isActive
                    ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent)]'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-subtle)]/50 hover:text-[var(--color-text-primary)]'
                }`}
              >
                {OptIcon && <OptIcon size={14} className="shrink-0" />}
                <div className="flex flex-col flex-1 min-w-0">
                  <span className={`truncate ${isActive ? 'font-semibold' : ''}`}>{opt.label}</span>
                  {opt.description && (
                    <span className="text-[10px] text-[var(--color-text-muted)] truncate">{opt.description}</span>
                  )}
                </div>
                {isActive && <Check size={14} className="text-[var(--color-accent)] shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default HudSelect;
