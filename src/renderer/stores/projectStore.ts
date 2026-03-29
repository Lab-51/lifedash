// === FILE PURPOSE ===
// Zustand store for project-level state management.
// Manages the project list, selection, and CRUD operations.
// All data fetching goes through window.electronAPI (IPC bridge).

// === DEPENDENCIES ===
// zustand, shared types, window.electronAPI (preload bridge)

import { create } from 'zustand';
import { useGamificationStore } from './gamificationStore';
import type { Project, CreateProjectInput, UpdateProjectInput } from '../../shared/types';

interface ProjectStore {
  // State
  projects: Project[];
  loading: boolean;
  error: string | null;

  // Actions
  loadProjects: () => Promise<void>;
  createProject: (data: CreateProjectInput) => Promise<Project>;
  updateProject: (id: string, data: UpdateProjectInput) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  removeProjectFromUI: (id: string) => void;
  restoreProjectToUI: (project: Project) => void;
  duplicateProject: (id: string) => Promise<Project>;
  reorderProjects: (items: { id: string; sortOrder: number }[]) => Promise<void>;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  loading: false,
  error: null,

  loadProjects: async () => {
    set({ loading: true, error: null });
    try {
      const projects = await window.electronAPI.getProjects();
      set({ projects, loading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load projects',
        loading: false,
      });
    }
  },

  createProject: async (data) => {
    const project = await window.electronAPI.createProject(data);
    set({ projects: [...get().projects, project] });
    useGamificationStore.getState().awardXP('project_create', project.id);
    return project;
  },

  updateProject: async (id, data) => {
    const updated = await window.electronAPI.updateProject(id, data);
    set({
      projects: get().projects.map((p) => (p.id === id ? updated : p)),
    });
    if (data.archived === true) {
      useGamificationStore.getState().awardXP('project_archive', id);
    }
  },

  deleteProject: async (id) => {
    await window.electronAPI.deleteProject(id);
    set({
      projects: get().projects.filter((p) => p.id !== id),
    });
  },

  removeProjectFromUI: (id) => {
    set({ projects: get().projects.filter((p) => p.id !== id) });
  },

  restoreProjectToUI: (project) => {
    set({ projects: [...get().projects, project] });
  },

  duplicateProject: async (id) => {
    const project = await window.electronAPI.duplicateProject(id);
    set({ projects: [...get().projects, project] });
    return project;
  },

  reorderProjects: async (items) => {
    // Optimistic update: apply new sortOrder values locally
    const orderMap = new Map(items.map((item) => [item.id, item.sortOrder]));
    set({
      projects: get().projects.map((p) => (orderMap.has(p.id) ? { ...p, sortOrder: orderMap.get(p.id)! } : p)),
    });
    try {
      await window.electronAPI.reorderProjects(items);
    } catch {
      // Rollback on failure — reload from DB
      await get().loadProjects();
    }
  },
}));
