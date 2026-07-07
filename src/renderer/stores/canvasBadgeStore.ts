// === FILE PURPOSE ===
// Tiny Zustand slice for the canvas tab strip's off-canvas activity badges
// (LiveModeOverlay, Task 4 — consumed by Task 5). Per-tab incrementable counts:
// Task 5 bumps a tab's count when something happens on it while the user is
// looking at a different tab (e.g. a proposal lands on the Board while the user
// is reading Transcript). Viewing a tab clears its own count. NO auto-flip —
// badges are a signal only, the canvas never switches itself.
//
// === DEPENDENCIES ===
// zustand, CanvasTabId (LiveCanvasTabs)

import { create } from 'zustand';
import type { CanvasTabId } from '../components/LiveCanvasTabs';

const EMPTY_COUNTS: Record<CanvasTabId, number> = { transcript: 0, board: 0, brain: 0 };

interface CanvasBadgeStore {
  counts: Record<CanvasTabId, number>;
  /** Bump a tab's off-canvas activity count (Task 5 call site). */
  increment: (tab: CanvasTabId) => void;
  /** Clear a tab's count — called when that tab becomes the active view. */
  clear: (tab: CanvasTabId) => void;
  /** Zero every count — called on a new recording so badges don't leak across sessions. */
  reset: () => void;
}

export const useCanvasBadgeStore = create<CanvasBadgeStore>((set) => ({
  counts: { ...EMPTY_COUNTS },

  increment: (tab) => set((state) => ({ counts: { ...state.counts, [tab]: state.counts[tab] + 1 } })),

  clear: (tab) => set((state) => (state.counts[tab] === 0 ? state : { counts: { ...state.counts, [tab]: 0 } })),

  reset: () => set({ counts: { ...EMPTY_COUNTS } }),
}));
