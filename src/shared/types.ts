// === FILE PURPOSE ===
// Shared type definitions used across main, preload, and renderer processes.

/** Database connection status returned by db:status IPC handler */
export interface DatabaseStatus {
  connected: boolean;
  message: string;
}

// === DOMAIN TYPES (match DB schema, serialized for IPC) ===

export type CardPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Board {
  id: string;
  projectId: string;
  name: string;
  position: number;
  createdAt: string;
}

export interface Column {
  id: string;
  boardId: string;
  name: string;
  position: number;
  createdAt: string;
}

export interface Card {
  id: string;
  columnId: string;
  title: string;
  description: string | null;
  position: number;
  priority: CardPriority;
  dueDate: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  labels?: Label[];
}

export interface Label {
  id: string;
  projectId: string;
  name: string;
  color: string;
  createdAt: string;
}

// === INPUT TYPES (for create/update operations) ===

export interface CreateProjectInput {
  name: string;
  description?: string;
  color?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  color?: string | null;
  archived?: boolean;
}

export interface CreateBoardInput {
  projectId: string;
  name: string;
}

export interface UpdateBoardInput {
  name?: string;
  position?: number;
}

export interface CreateColumnInput {
  boardId: string;
  name: string;
}

export interface UpdateColumnInput {
  name?: string;
  position?: number;
}

export interface CreateCardInput {
  columnId: string;
  title: string;
  description?: string;
  priority?: CardPriority;
}

export interface UpdateCardInput {
  title?: string;
  description?: string | null;
  priority?: CardPriority;
  dueDate?: string | null;
  archived?: boolean;
  columnId?: string;
  position?: number;
}

export interface CreateLabelInput {
  projectId: string;
  name: string;
  color: string;
}

export interface UpdateLabelInput {
  name?: string;
  color?: string;
}

/** API exposed to the renderer via contextBridge in preload.ts */
export interface ElectronAPI {
  platform: NodeJS.Platform;

  // Window controls
  windowMinimize: () => void;
  windowMaximize: () => void;
  windowClose: () => void;
  windowIsMaximized: () => Promise<boolean>;
  onWindowMaximizeChange: (
    callback: (isMaximized: boolean) => void,
  ) => () => void;

  // Database
  getDatabaseStatus: () => Promise<DatabaseStatus>;

  // Projects
  getProjects: () => Promise<Project[]>;
  createProject: (data: CreateProjectInput) => Promise<Project>;
  updateProject: (id: string, data: UpdateProjectInput) => Promise<Project>;
  deleteProject: (id: string) => Promise<void>;

  // Boards
  getBoards: (projectId: string) => Promise<Board[]>;
  createBoard: (data: CreateBoardInput) => Promise<Board>;
  updateBoard: (id: string, data: UpdateBoardInput) => Promise<Board>;
  deleteBoard: (id: string) => Promise<void>;

  // Columns
  getColumns: (boardId: string) => Promise<Column[]>;
  createColumn: (data: CreateColumnInput) => Promise<Column>;
  updateColumn: (id: string, data: UpdateColumnInput) => Promise<Column>;
  deleteColumn: (id: string) => Promise<void>;
  reorderColumns: (boardId: string, columnIds: string[]) => Promise<void>;

  // Cards
  getCardsByBoard: (boardId: string) => Promise<Card[]>;
  createCard: (data: CreateCardInput) => Promise<Card>;
  updateCard: (id: string, data: UpdateCardInput) => Promise<Card>;
  deleteCard: (id: string) => Promise<void>;
  moveCard: (id: string, columnId: string, position: number) => Promise<Card>;

  // Labels
  getLabels: (projectId: string) => Promise<Label[]>;
  createLabel: (data: CreateLabelInput) => Promise<Label>;
  updateLabel: (id: string, data: UpdateLabelInput) => Promise<Label>;
  deleteLabel: (id: string) => Promise<void>;
  attachLabel: (cardId: string, labelId: string) => Promise<void>;
  detachLabel: (cardId: string, labelId: string) => Promise<void>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
