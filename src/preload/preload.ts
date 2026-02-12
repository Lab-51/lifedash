// === FILE PURPOSE ===
// Preload script — runs before renderer process loads.
// Exposes a safe API to the renderer via contextBridge.
// All IPC communication goes through this bridge, keeping
// contextIsolation intact and nodeIntegration disabled.

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  // Window controls
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onWindowMaximizeChange: (callback: (isMaximized: boolean) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      isMaximized: boolean,
    ) => {
      callback(isMaximized);
    };
    ipcRenderer.on('window:maximize-change', handler);
    // Return cleanup function for React useEffect
    return () => {
      ipcRenderer.removeListener('window:maximize-change', handler);
    };
  },

  // Database
  getDatabaseStatus: () => ipcRenderer.invoke('db:status'),

  // Projects
  getProjects: () => ipcRenderer.invoke('projects:list'),
  createProject: (data: any) => ipcRenderer.invoke('projects:create', data),
  updateProject: (id: string, data: any) =>
    ipcRenderer.invoke('projects:update', id, data),
  deleteProject: (id: string) => ipcRenderer.invoke('projects:delete', id),

  // Boards
  getBoards: (projectId: string) =>
    ipcRenderer.invoke('boards:list', projectId),
  createBoard: (data: any) => ipcRenderer.invoke('boards:create', data),
  updateBoard: (id: string, data: any) =>
    ipcRenderer.invoke('boards:update', id, data),
  deleteBoard: (id: string) => ipcRenderer.invoke('boards:delete', id),

  // Columns
  getColumns: (boardId: string) =>
    ipcRenderer.invoke('columns:list', boardId),
  createColumn: (data: any) => ipcRenderer.invoke('columns:create', data),
  updateColumn: (id: string, data: any) =>
    ipcRenderer.invoke('columns:update', id, data),
  deleteColumn: (id: string) => ipcRenderer.invoke('columns:delete', id),
  reorderColumns: (boardId: string, columnIds: string[]) =>
    ipcRenderer.invoke('columns:reorder', boardId, columnIds),

  // Cards
  getCardsByBoard: (boardId: string) =>
    ipcRenderer.invoke('cards:list-by-board', boardId),
  createCard: (data: any) => ipcRenderer.invoke('cards:create', data),
  updateCard: (id: string, data: any) =>
    ipcRenderer.invoke('cards:update', id, data),
  deleteCard: (id: string) => ipcRenderer.invoke('cards:delete', id),
  moveCard: (id: string, columnId: string, position: number) =>
    ipcRenderer.invoke('cards:move', id, columnId, position),

  // Labels
  getLabels: (projectId: string) =>
    ipcRenderer.invoke('labels:list', projectId),
  createLabel: (data: any) => ipcRenderer.invoke('labels:create', data),
  updateLabel: (id: string, data: any) =>
    ipcRenderer.invoke('labels:update', id, data),
  deleteLabel: (id: string) => ipcRenderer.invoke('labels:delete', id),
  attachLabel: (cardId: string, labelId: string) =>
    ipcRenderer.invoke('labels:attach', cardId, labelId),
  detachLabel: (cardId: string, labelId: string) =>
    ipcRenderer.invoke('labels:detach', cardId, labelId),
});
