// === FILE PURPOSE ===
// Drag-to-resize + collapse state for the session workspace's right rail, with
// the chosen width remembered across sessions. The rail was a hard-coded 380px
// (332px of content after padding), which squeezed analytics, the brief and
// every other section into unreadable columns — and no amount of internal
// layout work lets one fixed width suit both a laptop and an ultrawide.
//
// === DEPENDENCIES ===
// React + localStorage. No IPC: this is pure view state, so persisting it
// through the settings DB would cost a round trip on every drag for no benefit.
//
// === CONTRACT NOTES ===
// - Width is CLAMPED on read as well as on write. A persisted value from a
//   wider monitor must never render the rail wider than the current window,
//   which would push the transcript canvas off-screen.
// - Collapsing preserves the previous width, so expanding restores it rather
//   than snapping back to the default.
// - Pointer events (not mouse) so a trackpad/touch drag works, with capture so
//   the drag survives the cursor leaving the 4px handle.

import { useCallback, useEffect, useRef, useState } from 'react';

export const RAIL_MIN_WIDTH = 320;
export const RAIL_MAX_WIDTH = 720;
export const RAIL_DEFAULT_WIDTH = 420;
const WIDTH_KEY = 'sessionRail.width';
const COLLAPSED_KEY = 'sessionRail.collapsed';

/** Never wider than the window can afford — the canvas keeps at least 480px. */
export function clampRailWidth(width: number, windowWidth: number = window.innerWidth): number {
  const affordable = Math.max(RAIL_MIN_WIDTH, windowWidth - 480);
  return Math.min(Math.max(width, RAIL_MIN_WIDTH), Math.min(RAIL_MAX_WIDTH, affordable));
}

function readStoredWidth(): number {
  const raw = Number(localStorage.getItem(WIDTH_KEY));
  return Number.isFinite(raw) && raw > 0 ? clampRailWidth(raw) : RAIL_DEFAULT_WIDTH;
}

export interface ResizableRail {
  width: number;
  collapsed: boolean;
  dragging: boolean;
  toggleCollapsed: () => void;
  /** Attach to the drag handle's onPointerDown. */
  onHandlePointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  /** Keyboard resize on the handle — the drag affordance alone is inaccessible. */
  onHandleKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
}

export function useResizableRail(): ResizableRail {
  // Lazy initialisers, not a mount effect: reading storage in an effect meant a
  // first paint at the default width followed by an immediate second render at
  // the stored one — a visible jump, and a cascading-render lint error.
  const [width, setWidth] = useState<number>(() => {
    try {
      return readStoredWidth();
    } catch {
      return RAIL_DEFAULT_WIDTH; // Private mode / storage disabled.
    }
  });
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [dragging, setDragging] = useState(false);
  const frame = useRef<number | null>(null);

  const persistWidth = useCallback((next: number) => {
    setWidth(next);
    try {
      localStorage.setItem(WIDTH_KEY, String(next));
    } catch {
      // Non-fatal: the rail still resizes for this session.
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, String(!prev));
      } catch {
        // Non-fatal.
      }
      return !prev;
    });
  }, []);

  const onHandlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);

      const move = (e: PointerEvent) => {
        // The rail is on the right, so its width grows as the pointer moves left.
        if (frame.current !== null) cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => setWidth(clampRailWidth(window.innerWidth - e.clientX)));
      };
      const up = (e: PointerEvent) => {
        if (frame.current !== null) cancelAnimationFrame(frame.current);
        frame.current = null;
        setDragging(false);
        persistWidth(clampRailWidth(window.innerWidth - e.clientX));
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [persistWidth],
  );

  const onHandleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      const step = event.shiftKey ? 64 : 16;
      if (event.key === 'ArrowLeft') persistWidth(clampRailWidth(width + step));
      else if (event.key === 'ArrowRight') persistWidth(clampRailWidth(width - step));
      else return;
      event.preventDefault();
    },
    [persistWidth, width],
  );

  // A window that shrank below the persisted width would otherwise push the
  // canvas off-screen until the user dragged the handle themselves.
  useEffect(() => {
    const onResize = () => setWidth((w) => clampRailWidth(w));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return { width, collapsed, dragging, toggleCollapsed, onHandlePointerDown, onHandleKeyDown };
}
