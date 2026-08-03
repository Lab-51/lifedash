// === FILE PURPOSE ===
// The session workspace's right rail chrome: a drag handle, a collapse toggle,
// and the width that both write to. Previously a hard-coded `w-[380px]` inline
// in SessionWorkspace, which left 332px of content after padding — too narrow
// for the analytics grid, the brief and the proposals, and unchangeable by the
// user on any display size.
//
// === DEPENDENCIES ===
// React, lucide-react (GripVertical / ChevronRight — the icons this codebase
// already uses for drag handles and collapse), useResizableRail.
//
// === CONTRACT NOTES ===
// - A container query context (`@container/rail`) is established here so the
//   sections inside lay out against the RAIL's width, not the window's. That is
//   the actual bug behind the truncated analytics: `md:` breakpoints measure
//   the viewport, so a wide window forced a 4-column grid into a 332px rail.
// - Collapsed still renders the toggle, so the rail can always be brought back.

import type { ReactNode } from 'react';
import { ChevronRight, GripVertical } from 'lucide-react';
import { RAIL_MAX_WIDTH, RAIL_MIN_WIDTH, useResizableRail } from '../hooks/useResizableRail';

export default function SessionRail({ children }: { children: ReactNode }) {
  const { width, collapsed, dragging, toggleCollapsed, onHandlePointerDown, onHandleKeyDown } = useResizableRail();

  if (collapsed) {
    return (
      <div className="shrink-0 border-l border-[var(--color-border)] flex flex-col items-center pt-4">
        <button
          onClick={toggleCollapsed}
          aria-label="Expand the meeting intelligence panel"
          aria-expanded={false}
          className="p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          <ChevronRight size={16} className="rotate-180" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex shrink-0 min-h-0">
      {/* Drag handle — its own element so the 4px hit area never overlaps rail
          content, widened on hover so it is actually grabbable. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the meeting intelligence panel"
        aria-valuenow={width}
        aria-valuemin={RAIL_MIN_WIDTH}
        aria-valuemax={RAIL_MAX_WIDTH}
        tabIndex={0}
        onPointerDown={onHandlePointerDown}
        onKeyDown={onHandleKeyDown}
        className={`group relative w-1 shrink-0 cursor-col-resize border-l border-[var(--color-border)] transition-colors focus:outline-none focus-visible:bg-[var(--color-accent)] ${
          dragging ? 'bg-[var(--color-accent)]' : 'hover:bg-[var(--color-accent-dim)]'
        }`}
      >
        <GripVertical
          size={12}
          aria-hidden="true"
          className="absolute top-1/2 -translate-y-1/2 -left-[5px] text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
        />
      </div>

      <aside
        style={{ width }}
        // `@container/rail` is what lets the sections below respond to the rail
        // instead of the window — see CONTRACT NOTES.
        className="@container/rail overflow-y-auto overflow-x-hidden p-5 space-y-5"
      >
        <div className="flex justify-end -mb-2">
          <button
            onClick={toggleCollapsed}
            aria-label="Collapse the meeting intelligence panel"
            aria-expanded={true}
            className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
        {children}
      </aside>
    </div>
  );
}
