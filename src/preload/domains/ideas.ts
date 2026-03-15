// === Preload bridge: Idea repository ===
import { ipcRenderer } from 'electron';
import type { CreateIdeaInput, UpdateIdeaInput } from '../../shared/types';

export const ideasBridge = {
  getIdeas: () => ipcRenderer.invoke('ideas:list'),
  getIdea: (id: string) => ipcRenderer.invoke('ideas:get', id),
  createIdea: (data: CreateIdeaInput) => ipcRenderer.invoke('ideas:create', data),
  updateIdea: (id: string, data: UpdateIdeaInput) => ipcRenderer.invoke('ideas:update', id, data),
  deleteIdea: (id: string) => ipcRenderer.invoke('ideas:delete', id),
  convertIdeaToProject: (id: string) => ipcRenderer.invoke('ideas:convert-to-project', id),
  convertIdeaToCard: (ideaId: string, columnId: string) =>
    ipcRenderer.invoke('ideas:convert-to-card', ideaId, columnId),
  analyzeIdea: (id: string) => ipcRenderer.invoke('idea:analyze', id),
};
