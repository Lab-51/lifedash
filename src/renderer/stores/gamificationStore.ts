// === FILE PURPOSE ===
// Zustand store for unified gamification state (XP, level, achievements).
// Centralises stats that were previously in focusStore and adds XP award
// actions consumed by every feature store.
//
// === DEPENDENCIES ===
// zustand, shared gamification types, window.electronAPI, useToast, useFocusStore

import { create } from 'zustand';
import { toast } from '../hooks/useToast';
import type { GamificationStats, Achievement, XpEventType } from '../../shared/types/gamification';

interface GamificationState {
  stats: GamificationStats | null;
  achievements: Achievement[];

  // Actions
  loadStats: () => Promise<void>;
  awardXP: (eventType: XpEventType, entityId?: string) => Promise<void>;
  refreshStats: (stats: GamificationStats, newAchievements: Achievement[]) => void;
}

export const useGamificationStore = create<GamificationState>((set, get) => ({
  stats: null,
  achievements: [],

  loadStats: async () => {
    try {
      const [stats, achievements] = await Promise.all([
        window.electronAPI.gamificationGetStats(),
        window.electronAPI.gamificationGetAchievements(),
      ]);
      set({ stats, achievements });
    } catch (error) {
      console.error('Failed to load gamification stats:', error);
    }
  },

  awardXP: async (eventType, entityId) => {
    try {
      const result = await window.electronAPI.gamificationAwardXp(eventType, entityId);
      set({ stats: result.stats });

      // Import focusStore lazily to avoid circular deps
      const { useFocusStore } = await import('./focusStore');
      const isFocusing = useFocusStore.getState().mode !== 'idle';

      // Show +XP toast unless focus mode is active
      if (!isFocusing && result.xpAwarded > 0) {
        toast(`+${result.xpAwarded} XP`, 'success', undefined, 2000);
      }

      // Always show achievement toasts (even during focus)
      if (result.newAchievements && result.newAchievements.length > 0) {
        // Refresh achievements list
        const achievements = await window.electronAPI.gamificationGetAchievements();
        set({ achievements });

        result.newAchievements.forEach((a: Achievement, i: number) => {
          setTimeout(() => {
            toast(`Achievement Unlocked: ${a.name} — ${a.description}`, 'success', undefined, 5000);
          }, i * 500);
        });
      }
    } catch (error) {
      console.error('Failed to award XP:', error);
    }
  },

  refreshStats: (stats, newAchievements) => {
    set({ stats });

    if (newAchievements.length > 0) {
      // Also refresh the full achievements list from backend
      window.electronAPI.gamificationGetAchievements().then(achievements => {
        set({ achievements });
      }).catch(() => {});

      newAchievements.forEach((a, i) => {
        setTimeout(() => {
          toast(`Achievement Unlocked: ${a.name} — ${a.description}`, 'success', undefined, 5000);
        }, i * 500);
      });
    }
  },
}));
