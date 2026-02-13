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
import type { ProjectPlan, TaskBreakdown } from '../../shared/types';

interface TaskStructuringState {
  // Project plan
  plan: ProjectPlan | null;
  planLoading: boolean;
  planError: string | null;
  // Card breakdown
  breakdown: TaskBreakdown | null;
  breakdownLoading: boolean;
  breakdownError: string | null;
  // Actions
  generatePlan: (projectId: string, description?: string) => Promise<void>;
  generateQuickPlan: (name: string, description: string) => Promise<void>;
  generateBreakdown: (cardId: string) => Promise<void>;
  clearPlan: () => void;
  clearBreakdown: () => void;
}

export const useTaskStructuringStore = create<TaskStructuringState>((set) => ({
  plan: null,
  planLoading: false,
  planError: null,
  breakdown: null,
  breakdownLoading: false,
  breakdownError: null,

  generatePlan: async (projectId: string, description?: string) => {
    set({ planLoading: true, planError: null });
    try {
      const plan = await window.electronAPI.taskStructuringGeneratePlan(
        projectId,
        description || '',
      );
      set({ plan, planLoading: false });
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
    } catch (error) {
      set({
        planError: error instanceof Error ? error.message : 'Failed to generate plan',
        planLoading: false,
      });
    }
  },

  generateBreakdown: async (cardId: string) => {
    set({ breakdownLoading: true, breakdownError: null });
    try {
      const breakdown = await window.electronAPI.taskStructuringBreakdown(cardId);
      set({ breakdown, breakdownLoading: false });
    } catch (error) {
      set({
        breakdownError: error instanceof Error ? error.message : 'Failed to generate breakdown',
        breakdownLoading: false,
      });
    }
  },

  clearPlan: () => set({ plan: null, planLoading: false, planError: null }),
  clearBreakdown: () => set({ breakdown: null, breakdownLoading: false, breakdownError: null }),
}));
