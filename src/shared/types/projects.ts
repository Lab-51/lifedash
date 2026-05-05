// === Project, Board, Column, Card, and Label domain types ===

export type CardPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  archived: boolean;
  pinned: boolean;
  system: boolean; // true = internal sentinel (e.g. Unassigned) — hidden from user-facing lists
  /** Per-project auto-push override. null = use global setting; true/false = explicit override. */
  autoPushEnabled: boolean | null;
  hourlyRate: number | null;
  sortOrder: number;
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
  color: string | null;
  createdAt: string;
}

export type CardSource = 'manual' | 'auto-from-meeting';

export interface Card {
  id: string;
  columnId: string;
  title: string;
  description: string | null;
  position: number;
  priority: CardPriority;
  dueDate: string | null;
  completed: boolean;
  archived: boolean;
  recurrenceType?: string | null;
  recurrenceEndDate?: string | null;
  sourceRecurringId?: string | null;
  // Meeting auto-flow fields
  source: CardSource;
  sourceMeetingId: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  labels?: Label[];
  checklistTotal?: number;
  checklistDone?: number;
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
  hourlyRate?: number | null;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  color?: string | null;
  archived?: boolean;
  pinned?: boolean;
  /** null = use global auto-push setting; true/false = per-project override */
  autoPushEnabled?: boolean | null;
  hourlyRate?: number | null;
  sortOrder?: number;
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
  color?: string | null;
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
  completed?: boolean;
  archived?: boolean;
  columnId?: string;
  position?: number;
  recurrenceType?: string | null;
  recurrenceEndDate?: string | null;
}
