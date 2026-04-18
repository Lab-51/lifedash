// === FILE PURPOSE ===
// Tiny pub/sub bus + shared snapshot used to decouple gamificationStore and
// focusStore. Both stores used to import each other lazily (via dynamic
// import) to:
//   1. let focusStore.saveSession push the resulting stats / achievements
//      back into gamificationStore;
//   2. let gamificationStore.awardXP read the current focus mode so it can
//      suppress the "+XP" toast while the user is in a focus session.
//
// This module owns both interactions so neither store has to import the
// other directly. (CODE-Q.1 Task 1 — Bronze remediation.)
//
// === DEPENDENCIES ===
// shared gamification types — leaf, no other imports

import type { GamificationStats, Achievement } from '../../shared/types/gamification';

// ---------------------------------------------------------------------------
// Focus mode snapshot — written by focusStore, read by gamificationStore
// ---------------------------------------------------------------------------

export type FocusModeSnapshot = 'idle' | 'focus' | 'break' | 'completed';

let focusModeSnapshot: FocusModeSnapshot = 'idle';

/** Called by focusStore whenever its `mode` changes. */
export function setFocusModeSnapshot(mode: FocusModeSnapshot): void {
  focusModeSnapshot = mode;
}

/** Called by gamificationStore.awardXP to decide whether to suppress XP toasts. */
export function getFocusModeSnapshot(): FocusModeSnapshot {
  return focusModeSnapshot;
}

// ---------------------------------------------------------------------------
// Focus-session-saved event — emitted by focusStore, consumed by gamificationStore
// ---------------------------------------------------------------------------

export type FocusSessionSavedListener = (stats: GamificationStats, newAchievements: Achievement[]) => void;

const sessionSavedListeners = new Set<FocusSessionSavedListener>();

/**
 * Subscribe to focus-session-saved events. Returns an unsubscribe function.
 * gamificationStore registers a listener at module load so it can refresh its
 * stats when a focus session is saved.
 */
export function onFocusSessionSaved(listener: FocusSessionSavedListener): () => void {
  sessionSavedListeners.add(listener);
  return () => {
    sessionSavedListeners.delete(listener);
  };
}

/** focusStore.saveSession calls this after persisting the session. */
export function emitFocusSessionSaved(stats: GamificationStats, newAchievements: Achievement[]): void {
  for (const listener of sessionSavedListeners) {
    listener(stats, newAchievements);
  }
}
