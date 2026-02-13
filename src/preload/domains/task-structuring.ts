// === Preload bridge: Task structuring (AI-driven) ===
import { ipcRenderer } from 'electron';

export const taskStructuringBridge = {
  taskStructuringGeneratePlan: (projectId: string, description: string) =>
    ipcRenderer.invoke('task-structuring:generate-plan', projectId, description),
  taskStructuringBreakdown: (cardId: string) =>
    ipcRenderer.invoke('task-structuring:breakdown', cardId),
  taskStructuringQuickPlan: (name: string, description: string) =>
    ipcRenderer.invoke('task-structuring:quick-plan', name, description),
};
