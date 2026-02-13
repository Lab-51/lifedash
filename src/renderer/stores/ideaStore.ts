// === FILE PURPOSE ===
// Zustand store for idea repository state and CRUD actions.
// Manages the idea list, selected idea detail, and conversion operations.
//
// === DEPENDENCIES ===
// zustand, shared types, window.electronAPI

import { create } from 'zustand';
import type { Idea, IdeaAnalysis, CreateIdeaInput, UpdateIdeaInput } from '../../shared/types';

interface IdeaStore {
  // State
  ideas: Idea[];
  selectedIdea: Idea | null;
  loading: boolean;
  error: string | null;
  analysis: IdeaAnalysis | null;
  analyzing: boolean;
  analysisError: string | null;

  // Actions
  loadIdeas: () => Promise<void>;
  loadIdea: (id: string) => Promise<void>;
  createIdea: (data: CreateIdeaInput) => Promise<Idea>;
  updateIdea: (id: string, data: UpdateIdeaInput) => Promise<void>;
  deleteIdea: (id: string) => Promise<void>;
  clearSelectedIdea: () => void;
  convertToProject: (id: string) => Promise<string>;
  convertToCard: (ideaId: string, columnId: string) => Promise<string>;
  analyzeIdea: (id: string) => Promise<void>;
  clearAnalysis: () => void;
}

export const useIdeaStore = create<IdeaStore>((set, get) => ({
  ideas: [],
  selectedIdea: null,
  loading: false,
  error: null,
  analysis: null,
  analyzing: false,
  analysisError: null,

  loadIdeas: async () => {
    set({ loading: true, error: null });
    try {
      const ideas = await window.electronAPI.getIdeas();
      set({ ideas, loading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load ideas',
        loading: false,
      });
    }
  },

  loadIdea: async (id: string) => {
    try {
      const idea = await window.electronAPI.getIdea(id);
      set({ selectedIdea: idea });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load idea',
      });
    }
  },

  createIdea: async (data: CreateIdeaInput) => {
    const idea = await window.electronAPI.createIdea(data);
    set({ ideas: [idea, ...get().ideas] });
    return idea;
  },

  updateIdea: async (id: string, data: UpdateIdeaInput) => {
    const updated = await window.electronAPI.updateIdea(id, data);
    set({
      ideas: get().ideas.map(i => (i.id === id ? updated : i)),
      selectedIdea: get().selectedIdea?.id === id ? updated : get().selectedIdea,
    });
  },

  deleteIdea: async (id: string) => {
    await window.electronAPI.deleteIdea(id);
    set({
      ideas: get().ideas.filter(i => i.id !== id),
      selectedIdea: get().selectedIdea?.id === id ? null : get().selectedIdea,
    });
  },

  clearSelectedIdea: () => set({ selectedIdea: null, analysis: null, analysisError: null }),

  convertToProject: async (id: string) => {
    const result = await window.electronAPI.convertIdeaToProject(id);
    set({
      ideas: get().ideas.map(i => (i.id === id ? result.idea : i)),
      selectedIdea: get().selectedIdea?.id === id ? result.idea : get().selectedIdea,
    });
    return result.projectId;
  },

  convertToCard: async (ideaId: string, columnId: string) => {
    const result = await window.electronAPI.convertIdeaToCard(ideaId, columnId);
    set({
      ideas: get().ideas.map(i => (i.id === ideaId ? result.idea : i)),
      selectedIdea: get().selectedIdea?.id === ideaId ? result.idea : get().selectedIdea,
    });
    return result.cardId;
  },

  analyzeIdea: async (id: string) => {
    set({ analyzing: true, analysisError: null, analysis: null });
    try {
      const analysis = await window.electronAPI.analyzeIdea(id);
      set({ analysis, analyzing: false });
    } catch (error) {
      set({
        analyzing: false,
        analysisError: error instanceof Error ? error.message : 'Analysis failed',
      });
    }
  },

  clearAnalysis: () => set({ analysis: null, analysisError: null }),
}));
