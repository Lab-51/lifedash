// === Preload bridge: Projects, Boards, Columns, Cards, Labels ===
import { ipcRenderer } from 'electron';
import type {
  CreateProjectInput, UpdateProjectInput,
  CreateBoardInput, UpdateBoardInput,
  CreateColumnInput, UpdateColumnInput,
  CreateCardInput, UpdateCardInput,
} from '../../shared/types';
import type { CreateLabelInput, UpdateLabelInput } from '../../shared/types';

export const projectsBridge = {
  // Projects
  getProjects: () => ipcRenderer.invoke('projects:list'),
  createProject: (data: CreateProjectInput) => ipcRenderer.invoke('projects:create', data),
  updateProject: (id: string, data: UpdateProjectInput) =>
    ipcRenderer.invoke('projects:update', id, data),
  deleteProject: (id: string) => ipcRenderer.invoke('projects:delete', id),
  duplicateProject: (id: string) => ipcRenderer.invoke('projects:duplicate', id),

  // Boards
  getBoards: (projectId: string) => ipcRenderer.invoke('boards:list', projectId),
  createBoard: (data: CreateBoardInput) => ipcRenderer.invoke('boards:create', data),
  updateBoard: (id: string, data: UpdateBoardInput) =>
    ipcRenderer.invoke('boards:update', id, data),
  deleteBoard: (id: string) => ipcRenderer.invoke('boards:delete', id),

  // Columns
  getColumns: (boardId: string) => ipcRenderer.invoke('columns:list', boardId),
  createColumn: (data: CreateColumnInput) => ipcRenderer.invoke('columns:create', data),
  updateColumn: (id: string, data: UpdateColumnInput) =>
    ipcRenderer.invoke('columns:update', id, data),
  deleteColumn: (id: string) => ipcRenderer.invoke('columns:delete', id),
  reorderColumns: (boardId: string, columnIds: string[]) =>
    ipcRenderer.invoke('columns:reorder', boardId, columnIds),

  // Cards
  getAllCards: () => ipcRenderer.invoke('cards:list-all'),
  getCardsByBoard: (boardId: string) => ipcRenderer.invoke('cards:list-by-board', boardId),
  createCard: (data: CreateCardInput) => ipcRenderer.invoke('cards:create', data),
  updateCard: (id: string, data: UpdateCardInput) =>
    ipcRenderer.invoke('cards:update', id, data),
  deleteCard: (id: string) => ipcRenderer.invoke('cards:delete', id),
  moveCard: (id: string, columnId: string, position: number) =>
    ipcRenderer.invoke('cards:move', id, columnId, position),

  // Labels
  getLabels: (projectId: string) => ipcRenderer.invoke('labels:list', projectId),
  createLabel: (data: CreateLabelInput) => ipcRenderer.invoke('labels:create', data),
  updateLabel: (id: string, data: UpdateLabelInput) =>
    ipcRenderer.invoke('labels:update', id, data),
  deleteLabel: (id: string) => ipcRenderer.invoke('labels:delete', id),
  attachLabel: (cardId: string, labelId: string) =>
    ipcRenderer.invoke('labels:attach', cardId, labelId),
  detachLabel: (cardId: string, labelId: string) =>
    ipcRenderer.invoke('labels:detach', cardId, labelId),
};
