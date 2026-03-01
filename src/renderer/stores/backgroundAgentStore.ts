// === FILE PURPOSE ===
// Zustand store for the background agent system.
// Manages insights, preferences, daily usage, and the new-insights badge count.
// Event listeners (onBackgroundAgentNewInsights) should be set up in consuming components.

import { create } from 'zustand';
import type { AgentInsight, BackgroundAgentPreferences } from '../../shared/types/background-agent';
import { toast } from '../hooks/useToast';

interface BackgroundAgentStore {
  insights: AgentInsight[];
  newInsightsCount: number;
  preferences: BackgroundAgentPreferences | null;
  dailyUsage: { date: string; tokensUsed: number } | null;
  loading: boolean;

  loadInsights: (projectId: string) => Promise<void>;
  loadPreferences: () => Promise<void>;
  loadDailyUsage: () => Promise<void>;
  updatePreferences: (partial: Partial<BackgroundAgentPreferences>) => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  dismissInsight: (id: string) => Promise<void>;
  markActedOn: (id: string) => Promise<void>;
  runNow: () => Promise<{ ran: boolean; reason: string }>;
  refreshNewCount: () => Promise<void>;
}

const initialState = {
  insights: [] as AgentInsight[],
  newInsightsCount: 0,
  preferences: null as BackgroundAgentPreferences | null,
  dailyUsage: null as { date: string; tokensUsed: number } | null,
  loading: false,
};

export const useBackgroundAgentStore = create<BackgroundAgentStore>((set, get) => ({
  ...initialState,

  loadInsights: async (projectId: string) => {
    set({ loading: true });
    try {
      const insights = await window.electronAPI.backgroundAgentGetInsights(projectId);
      set({ insights, loading: false });
    } catch (error) {
      console.error('Failed to load insights:', error);
      set({ loading: false });
    }
  },

  loadPreferences: async () => {
    try {
      const preferences = await window.electronAPI.backgroundAgentGetPreferences();
      set({ preferences });
    } catch (error) {
      console.error('Failed to load background agent preferences:', error);
    }
  },

  loadDailyUsage: async () => {
    try {
      const dailyUsage = await window.electronAPI.backgroundAgentGetDailyUsage();
      set({ dailyUsage });
    } catch (error) {
      console.error('Failed to load daily usage:', error);
    }
  },

  updatePreferences: async (partial: Partial<BackgroundAgentPreferences>) => {
    // Optimistic update
    const current = get().preferences;
    if (current) {
      set({ preferences: { ...current, ...partial } });
    }
    try {
      await window.electronAPI.backgroundAgentUpdatePreferences(partial);
      // Reload to get authoritative server state
      const preferences = await window.electronAPI.backgroundAgentGetPreferences();
      set({ preferences });
    } catch (error) {
      console.error('Failed to update preferences:', error);
      // Revert on failure
      if (current) {
        set({ preferences: current });
      }
      toast('Failed to save preferences', 'error');
    }
  },

  markAsRead: async (id: string) => {
    // Optimistic update — change status to 'read' in local state
    set({
      insights: get().insights.map(insight =>
        insight.id === id ? { ...insight, status: 'read' as const, readAt: new Date() } : insight,
      ),
    });
    try {
      await window.electronAPI.backgroundAgentMarkRead(id);
    } catch (error) {
      console.error('Failed to mark insight as read:', error);
    }
  },

  dismissInsight: async (id: string) => {
    // Optimistic update — remove from local state
    set({ insights: get().insights.filter(insight => insight.id !== id) });
    try {
      await window.electronAPI.backgroundAgentDismiss(id);
    } catch (error) {
      console.error('Failed to dismiss insight:', error);
    }
  },

  markActedOn: async (id: string) => {
    // Optimistic update — change status to 'acted_on'
    set({
      insights: get().insights.map(insight =>
        insight.id === id ? { ...insight, status: 'acted_on' as const } : insight,
      ),
    });
    try {
      await window.electronAPI.backgroundAgentMarkActedOn(id);
    } catch (error) {
      console.error('Failed to mark insight as acted on:', error);
    }
  },

  runNow: async () => {
    try {
      const result = await window.electronAPI.backgroundAgentRunNow();
      return result;
    } catch (error) {
      console.error('Failed to run background agent:', error);
      toast('Failed to run background agent', 'error');
      return { ran: false, reason: 'error' };
    }
  },

  refreshNewCount: async () => {
    try {
      const count = await window.electronAPI.backgroundAgentGetNewCount();
      set({ newInsightsCount: count });
    } catch (error) {
      console.error('Failed to get new insights count:', error);
    }
  },
}));
