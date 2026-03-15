// === FILE PURPOSE ===
// Zustand store for AI task structuring state — project plan generation and card breakdown.
//
// === DEPENDENCIES ===
// zustand, shared types, window.electronAPI
//
// === LIMITATIONS ===
// - Generated plans/breakdowns are transient (not persisted in DB)
// - Depends on AI provider being configured for 'task_structuring' task type

import { create } from 'zustand';
import { useGamificationStore } from './gamificationStore';
import type { ProjectPlan, TaskBreakdown } from '../../shared/types';

interface TaskStructuringState {
  // Project plan
  plan: ProjectPlan | null;
  planLoading: boolean;
  planError: string | null;
  // Card breakdowns — keyed by cardId so they survive modal close/reopen
  breakdowns: Record<string, TaskBreakdown>;
  breakdownLoadingCardId: string | null;
  breakdownError: string | null;
  // Actions
  generatePlan: (projectId: string, description?: string) => Promise<void>;
  generateQuickPlan: (name: string, description: string) => Promise<void>;
  generateBreakdown: (cardId: string) => Promise<void>;
  clearPlan: () => void;
  clearBreakdown: (cardId: string) => void;
  deleteSubtask: (cardId: string, index: number) => void;
  moveSubtask: (cardId: string, fromIndex: number, toIndex: number) => void;
}

export const useTaskStructuringStore = create<TaskStructuringState>((set, get) => ({
  plan: null,
  planLoading: false,
  planError: null,
  breakdowns: {},
  breakdownLoadingCardId: null,
  breakdownError: null,

  generatePlan: async (projectId: string, description?: string) => {
    set({ planLoading: true, planError: null });
    try {
      const plan = await window.electronAPI.taskStructuringGeneratePlan(projectId, description || '');
      set({ plan, planLoading: false });
      useGamificationStore.getState().awardXP('ai_plan');
    } catch (error) {
      set({
        planError: error instanceof Error ? error.message : 'Failed to generate plan',
        planLoading: false,
      });
    }
  },

  generateQuickPlan: async (name: string, description: string) => {
    set({ planLoading: true, planError: null });
    try {
      const plan = await window.electronAPI.taskStructuringQuickPlan(name, description);
      set({ plan, planLoading: false });
      useGamificationStore.getState().awardXP('ai_plan');
    } catch (error) {
      set({
        planError: error instanceof Error ? error.message : 'Failed to generate plan',
        planLoading: false,
      });
    }
  },

  generateBreakdown: async (cardId: string) => {
    set({ breakdownLoadingCardId: cardId, breakdownError: null });
    try {
      const breakdown = await window.electronAPI.taskStructuringBreakdown(cardId);
      set((state) => ({
        breakdowns: { ...state.breakdowns, [cardId]: breakdown },
        breakdownLoadingCardId: null,
      }));
      useGamificationStore.getState().awardXP('ai_breakdown');
    } catch (error) {
      set({
        breakdownError: error instanceof Error ? error.message : 'Failed to generate breakdown',
        breakdownLoadingCardId: null,
      });
    }
  },

  clearPlan: () => set({ plan: null, planLoading: false, planError: null }),

  clearBreakdown: (cardId: string) =>
    set((state) => {
      const { [cardId]: _, ...rest } = state.breakdowns;
      return { breakdowns: rest, breakdownError: null };
    }),

  deleteSubtask: (cardId: string, index: number) =>
    set((state) => {
      const breakdown = state.breakdowns[cardId];
      if (!breakdown) return state;
      const subtasks = breakdown.subtasks.filter((_, i) => i !== index);
      // If no subtasks left, remove the breakdown entirely
      if (subtasks.length === 0) {
        const { [cardId]: _, ...rest } = state.breakdowns;
        return { breakdowns: rest };
      }
      return {
        breakdowns: {
          ...state.breakdowns,
          [cardId]: { ...breakdown, subtasks },
        },
      };
    }),

  moveSubtask: (cardId: string, fromIndex: number, toIndex: number) =>
    set((state) => {
      const breakdown = state.breakdowns[cardId];
      if (!breakdown) return state;
      const subtasks = [...breakdown.subtasks];
      const [moved] = subtasks.splice(fromIndex, 1);
      subtasks.splice(toIndex, 0, moved);
      return {
        breakdowns: {
          ...state.breakdowns,
          [cardId]: { ...breakdown, subtasks },
        },
      };
    }),
}));
