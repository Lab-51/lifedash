// === FILE PURPOSE ===
// Custom HUD-styled dropdown select component.
// Replaces native <select> with a fully styled popover dropdown.
// Uses React portal so the dropdown is never clipped by ancestor overflow.

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
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
  compact?: boolean;  // Transparent background for inline/toolbar use
  disabled?: boolean;
}

function HudSelect({ value, onChange, options, icon: TriggerIcon, placeholder = 'Select...', compact = false, disabled = false }: HudSelectProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  const selectedOption = options.find(o => o.value === value);

  // Compute dropdown position from trigger bounding rect
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 6, left: rect.left, width: rect.width });
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Reposition on scroll/resize while open
  useEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, updatePosition]);

  const handleToggle = () => {
    if (disabled) return;
    if (!open) updatePosition();
    setOpen(!open);
  };

  const handleSelect = (optValue: string) => {
    onChange(optValue);
    setOpen(false);
  };

  return (
    <div className="relative">
      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
          disabled
            ? 'opacity-50 cursor-not-allowed bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)]'
            : compact
              ? 'bg-transparent hover:bg-[var(--color-accent-subtle)]/30 border-none'
              : 'bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] hover:border-[var(--color-border-accent)]'
        }`}
      >
        {TriggerIcon && <TriggerIcon size={14} className="text-[var(--color-text-muted)] shrink-0" />}
        <span className={`flex-1 truncate ${selectedOption ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)]'}`}>
          {selectedOption?.label || placeholder}
        </span>
        <ChevronDown size={14} className={`text-[var(--color-text-muted)] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown popover — rendered in portal to escape overflow clipping */}
      {open && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] bg-white dark:bg-surface-900 border border-[var(--color-border-accent)] rounded-xl shadow-2xl shadow-black/40 py-1.5 min-w-[180px] max-h-[280px] overflow-y-auto"
          style={{ top: pos.top, left: pos.left, width: Math.max(pos.width, 180) }}
        >
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
        </div>,
        document.body,
      )}
    </div>
  );
}

export default HudSelect;
