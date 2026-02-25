// === FILE PURPOSE ===
// Custom HUD-styled calendar date picker with time selection.
// Replaces native datetime-local inputs with a fully styled popover calendar.

import { useState, useEffect, useRef, useCallback } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Clock, X } from 'lucide-react';

interface HudDatePickerProps {
  value: string | null;       // ISO date string or null
  onChange: (iso: string | null) => void;
  showTime?: boolean;         // Whether to show time picker (default true)
  placeholder?: string;
  dateOnly?: boolean;         // If true, no time selector (for "end repeat" style pickers)
}

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function startOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function isToday(d: Date): boolean {
  return isSameDay(d, new Date());
}

function formatDisplay(iso: string, showTime: boolean): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  if (!showTime) return date;
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${date} at ${time}`;
}

function HudDatePicker({ value, onChange, showTime = true, placeholder = 'Set date', dateOnly = false }: HudDatePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const now = new Date();
  const selected = value ? new Date(value) : null;

  const [viewYear, setViewYear] = useState(selected?.getFullYear() ?? now.getFullYear());
  const [viewMonth, setViewMonth] = useState(selected?.getMonth() ?? now.getMonth());
  const [hours, setHours] = useState(selected ? selected.getHours() : 9);
  const [minutes, setMinutes] = useState(selected ? selected.getMinutes() : 0);

  // Sync view when value changes externally
  useEffect(() => {
    if (value) {
      const d = new Date(value);
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
      setHours(d.getHours());
      setMinutes(d.getMinutes());
    }
  }, [value]);

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

  const effectiveShowTime = showTime && !dateOnly;

  const buildDate = useCallback((day: number, h?: number, m?: number): string => {
    const d = new Date(viewYear, viewMonth, day, h ?? hours, m ?? minutes);
    return d.toISOString();
  }, [viewYear, viewMonth, hours, minutes]);

  const handleDayClick = (day: number) => {
    onChange(buildDate(day));
    if (!effectiveShowTime) {
      setOpen(false);
    }
  };

  const handleTimeChange = (h: number, m: number) => {
    setHours(h);
    setMinutes(m);
    if (selected) {
      const d = new Date(selected);
      d.setHours(h, m);
      onChange(d.toISOString());
    }
  };

  const handlePreset = (daysFromNow: number) => {
    const d = new Date();
    d.setDate(d.getDate() + daysFromNow);
    d.setHours(hours, minutes, 0, 0);
    onChange(d.toISOString());
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  // Build calendar grid
  const firstDay = startOfMonth(viewYear, viewMonth);
  const totalDays = daysInMonth(viewYear, viewMonth);
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= totalDays; d++) cells.push(d);

  return (
    <div className="relative" ref={ref}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left text-sm transition-colors ${
          value
            ? 'border-[var(--color-border)] hover:border-[var(--color-border-accent)] bg-surface-950 text-[var(--color-text-primary)]'
            : 'border-dashed border-[var(--color-border)] hover:border-[var(--color-border-accent)] bg-surface-950 text-[var(--color-text-muted)]'
        }`}
      >
        <Calendar size={14} className="text-[var(--color-text-muted)] shrink-0" />
        <span className="flex-1 truncate">
          {value ? formatDisplay(value, effectiveShowTime) : placeholder}
        </span>
        {value && (
          <span
            role="button"
            onClick={(e) => { e.stopPropagation(); onChange(null); }}
            className="text-[var(--color-text-muted)] hover:text-red-400 transition-colors p-0.5 shrink-0"
          >
            <X size={12} />
          </span>
        )}
      </button>

      {/* Calendar popover */}
      {open && (
        <div className="absolute top-full left-0 mt-1.5 z-50 bg-surface-900 border border-[var(--color-border-accent)] rounded-xl shadow-2xl shadow-black/40 p-3 min-w-[280px]">
          {/* Quick presets */}
          {!dateOnly && (
            <div className="flex gap-1.5 mb-3">
              {[
                { label: 'Today', days: 0 },
                { label: 'Tomorrow', days: 1 },
                { label: '+1 Week', days: 7 },
              ].map(p => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => handlePreset(p.days)}
                  className="text-[10px] font-hud tracking-wider px-2 py-1 rounded-md border border-[var(--color-border)] hover:border-[var(--color-accent-dim)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          {/* Month/Year header */}
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={prevMonth} className="p-1 rounded-md hover:bg-[var(--color-accent-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors">
              <ChevronLeft size={16} />
            </button>
            <span className="font-hud text-xs tracking-wider text-[var(--color-text-primary)]">
              {MONTHS[viewMonth]} {viewYear}
            </span>
            <button type="button" onClick={nextMonth} className="p-1 rounded-md hover:bg-[var(--color-accent-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors">
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 mb-1">
            {DAYS.map(d => (
              <div key={d} className="text-center text-[10px] font-hud tracking-wider text-[var(--color-text-muted)] py-1">
                {d}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-px">
            {cells.map((day, i) => {
              if (day === null) return <div key={`empty-${i}`} />;
              const cellDate = new Date(viewYear, viewMonth, day);
              const isSelected = selected ? isSameDay(cellDate, selected) : false;
              const isTodayCell = isToday(cellDate);
              const isPast = cellDate < new Date(now.getFullYear(), now.getMonth(), now.getDate());

              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => handleDayClick(day)}
                  className={`w-full aspect-square flex items-center justify-center text-xs rounded-lg transition-all ${
                    isSelected
                      ? 'bg-[var(--color-accent)] text-surface-950 font-bold shadow-[0_0_12px_rgba(62,232,228,0.4)]'
                      : isTodayCell
                        ? 'ring-1 ring-[var(--color-accent-dim)] text-[var(--color-accent)] font-semibold hover:bg-[var(--color-accent-subtle)]'
                        : isPast
                          ? 'text-[var(--color-text-muted)] hover:bg-[var(--color-accent-subtle)]/50 hover:text-[var(--color-text-secondary)]'
                          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-subtle)] hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>

          {/* Time picker */}
          {effectiveShowTime && (
            <>
              <div className="ruled-line-accent my-3" />
              <div className="flex items-center gap-2">
                <Clock size={13} className="text-[var(--color-text-muted)] shrink-0" />
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={String(hours).padStart(2, '0')}
                    onChange={(e) => {
                      const h = Math.max(0, Math.min(23, parseInt(e.target.value) || 0));
                      handleTimeChange(h, minutes);
                    }}
                    className="w-10 text-center text-sm font-data bg-surface-950 border border-[var(--color-border)] rounded-md py-1 text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-dim)] transition-colors"
                  />
                  <span className="text-[var(--color-text-muted)] font-bold">:</span>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    step={5}
                    value={String(minutes).padStart(2, '0')}
                    onChange={(e) => {
                      const m = Math.max(0, Math.min(59, parseInt(e.target.value) || 0));
                      handleTimeChange(hours, m);
                    }}
                    className="w-10 text-center text-sm font-data bg-surface-950 border border-[var(--color-border)] rounded-md py-1 text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-dim)] transition-colors"
                  />
                </div>
                {/* Quick time presets */}
                <div className="flex gap-1 ml-auto">
                  {[
                    { label: '9a', h: 9, m: 0 },
                    { label: '12p', h: 12, m: 0 },
                    { label: '5p', h: 17, m: 0 },
                  ].map(t => (
                    <button
                      key={t.label}
                      type="button"
                      onClick={() => handleTimeChange(t.h, t.m)}
                      className={`text-[10px] font-data px-1.5 py-0.5 rounded border transition-colors ${
                        hours === t.h && minutes === t.m
                          ? 'border-[var(--color-accent-dim)] text-[var(--color-accent)] bg-[var(--color-accent-subtle)]'
                          : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:border-[var(--color-border-accent)]'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default HudDatePicker;
