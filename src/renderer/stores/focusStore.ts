// === FILE PURPOSE ===
// Zustand store for focus mode / Pomodoro timer state.
// Manages work/break sessions, countdown timer, notifications, and persistent stats.
//
// === DEPENDENCIES ===
// zustand, window.electronAPI (preload bridge)

import { create } from 'zustand';
import type { Achievement } from '../../shared/types/gamification';

interface FocusState {
  // State
  mode: 'idle' | 'focus' | 'break' | 'completed';
  timeRemaining: number; // seconds
  focusedCardId: string | null;
  focusedCardTitle: string | null;
  focusedProjectId: string | null;
  workDuration: number; // minutes (default 25)
  breakDuration: number; // minutes (default 5)
  sessionCount: number; // completed focus sessions this app run
  isPaused: boolean;
  intervalId: ReturnType<typeof setInterval> | null;
  showStartModal: boolean; // controls FocusStartModal visibility
  lastSavedAt: number; // timestamp of last successful save (triggers FocusPage re-fetch)
  completedDuration: number; // actual minutes focused (may be < workDuration if stopped early)
  // Actions
  startFocus: (cardId: string | null, cardTitle: string | null, projectId?: string | null) => void;
  startBreak: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  tick: () => void;
  setDurations: (work: number, breakMins: number) => void;
  loadSettings: () => Promise<void>;
  setShowStartModal: (show: boolean) => void;
  clearFocusedCard: () => void;
  saveSession: (input: { cardId?: string; projectId?: string; durationMinutes: number; note?: string; billable?: boolean }) =>
    Promise<{ newAchievements: Achievement[] }>;
  updateSession: (id: string, input: { projectId?: string | null; note?: string | null; billable?: boolean }) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
}

export const useFocusStore = create<FocusState>((set, get) => ({
  mode: 'idle',
  timeRemaining: 0,
  focusedCardId: null,
  focusedCardTitle: null,
  focusedProjectId: null,
  workDuration: 25,
  breakDuration: 5,
  sessionCount: 0,
  isPaused: false,
  intervalId: null,
  showStartModal: false,
  lastSavedAt: 0,
  completedDuration: 0,
  startFocus: (cardId, cardTitle, projectId) => {
    const state = get();
    if (state.intervalId) clearInterval(state.intervalId);

    const intervalId = setInterval(() => get().tick(), 1000);
    set({
      mode: 'focus',
      focusedCardId: cardId,
      focusedCardTitle: cardTitle,
      focusedProjectId: projectId ?? null,
      timeRemaining: state.workDuration * 60,
      isPaused: false,
      intervalId,
    });
  },

  startBreak: () => {
    const state = get();
    if (state.intervalId) clearInterval(state.intervalId);

    const intervalId = setInterval(() => get().tick(), 1000);
    set({
      mode: 'break',
      timeRemaining: state.breakDuration * 60,
      isPaused: false,
      intervalId,
    });
  },

  pause: () => {
    const state = get();
    if (state.intervalId) clearInterval(state.intervalId);
    set({ isPaused: true, intervalId: null });
  },

  resume: () => {
    const intervalId = setInterval(() => get().tick(), 1000);
    set({ isPaused: false, intervalId });
  },

  stop: () => {
    const state = get();
    if (state.intervalId) clearInterval(state.intervalId);

    // When stopping mid-focus with meaningful elapsed time, transition to
    // 'completed' so FocusCompleteModal opens and handles the save (with await).
    // This avoids the unreliable fire-and-forget save pattern.
    if (state.mode === 'focus') {
      const elapsedSeconds = state.workDuration * 60 - state.timeRemaining;
      if (elapsedSeconds >= 5) {
        const elapsedMinutes = Math.max(1, Math.round(elapsedSeconds / 60));
        set({
          mode: 'completed',
          timeRemaining: 0,
          isPaused: false,
          intervalId: null,
          completedDuration: elapsedMinutes,
          sessionCount: state.sessionCount + 1,
        });
        return;
      }
    }

    // For break, completed (force-dismiss), or focus < 5s: reset to idle
    set({
      mode: 'idle',
      timeRemaining: 0,
      isPaused: false,
      intervalId: null,
      focusedCardId: null,
      focusedCardTitle: null,
      focusedProjectId: null,
      completedDuration: 0,
    });
  },

  tick: () => {
    const state = get();
    const next = state.timeRemaining - 1;

    if (next <= 0) {
      if (state.intervalId) clearInterval(state.intervalId);

      if (state.mode === 'focus') {
        window.electronAPI.notificationShow(
          'Focus Complete',
          'Great work! Time for a break.',
        );
        set({
          timeRemaining: 0,
          intervalId: null,
          mode: 'completed',
          sessionCount: state.sessionCount + 1,
          completedDuration: state.workDuration,
        });
      } else if (state.mode === 'break') {
        window.electronAPI.notificationShow(
          'Break Over',
          'Ready to focus again?',
        );
        set({
          timeRemaining: 0,
          intervalId: null,
          mode: 'idle',
          completedDuration: 0,
        });
      }
    } else {
      set({ timeRemaining: next });
    }
  },

  setDurations: (work, breakMins) => {
    set({ workDuration: work, breakDuration: breakMins });
    window.electronAPI.setSetting('pomodoro.workDuration', String(work));
    window.electronAPI.setSetting('pomodoro.breakDuration', String(breakMins));
  },

  loadSettings: async () => {
    try {
      const workStr = await window.electronAPI.getSetting('pomodoro.workDuration');
      const breakStr = await window.electronAPI.getSetting('pomodoro.breakDuration');
      const work = workStr ? parseInt(workStr, 10) : 25;
      const breakMins = breakStr ? parseInt(breakStr, 10) : 5;
      set({
        workDuration: isNaN(work) ? 25 : work,
        breakDuration: isNaN(breakMins) ? 5 : breakMins,
      });
    } catch (error) {
      console.error('Failed to load focus settings:', error);
    }
  },

  setShowStartModal: (show) => {
    set({ showStartModal: show });
  },

  clearFocusedCard: () => {
    set({ focusedCardId: null, focusedCardTitle: null, focusedProjectId: null });
  },

  saveSession: async (input) => {
    const result = await window.electronAPI.focusSaveSession(input);
    // Delegate stats/achievements to gamificationStore
    const { useGamificationStore } = await import('./gamificationStore');
    useGamificationStore.getState().refreshStats(result.stats, result.newAchievements);
    // Bump timestamp so FocusPage re-fetches after save completes
    set({ lastSavedAt: Date.now() });
    return { newAchievements: result.newAchievements };
  },

  updateSession: async (id, input) => {
    await window.electronAPI.focusUpdateSession(id, input);
    set({ lastSavedAt: Date.now() });
  },

  deleteSession: async (id) => {
    await window.electronAPI.focusDeleteSession(id);
    set({ lastSavedAt: Date.now() });
  },
}));
