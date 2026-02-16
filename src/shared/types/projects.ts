// === Project, Board, Column, Card, and Label domain types ===

export type CardPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  archived: boolean;
  pinned: boolean;
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

// === Input types for create/update operations ===

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
  pinned?: boolean;
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
