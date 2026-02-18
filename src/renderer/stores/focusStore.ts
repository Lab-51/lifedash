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
  workDuration: number; // minutes (default 25)
  breakDuration: number; // minutes (default 5)
  sessionCount: number; // completed focus sessions this app run
  isPaused: boolean;
  intervalId: ReturnType<typeof setInterval> | null;
  showStartModal: boolean; // controls FocusStartModal visibility
  // Actions
  startFocus: (cardId: string | null, cardTitle: string | null) => void;
  startBreak: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  tick: () => void;
  setDurations: (work: number, breakMins: number) => void;
  loadSettings: () => Promise<void>;
  setShowStartModal: (show: boolean) => void;
  clearFocusedCard: () => void;
  saveSession: (input: { cardId?: string; durationMinutes: number; note?: string }) =>
    Promise<{ newAchievements: Achievement[] }>;
}

export const useFocusStore = create<FocusState>((set, get) => ({
  mode: 'idle',
  timeRemaining: 0,
  focusedCardId: null,
  focusedCardTitle: null,
  workDuration: 25,
  breakDuration: 5,
  sessionCount: 0,
  isPaused: false,
  intervalId: null,
  showStartModal: false,
  startFocus: (cardId, cardTitle) => {
    const state = get();
    if (state.intervalId) clearInterval(state.intervalId);

    const intervalId = setInterval(() => get().tick(), 1000);
    set({
      mode: 'focus',
      focusedCardId: cardId,
      focusedCardTitle: cardTitle,
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
    set({
      mode: 'idle',
      timeRemaining: 0,
      isPaused: false,
      intervalId: null,
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
    set({ focusedCardId: null, focusedCardTitle: null });
  },

  saveSession: async (input) => {
    const result = await window.electronAPI.focusSaveSession(input);
    // Delegate stats/achievements to gamificationStore
    const { useGamificationStore } = await import('./gamificationStore');
    useGamificationStore.getState().refreshStats(result.stats, result.newAchievements);
    return { newAchievements: result.newAchievements };
  },
}));
