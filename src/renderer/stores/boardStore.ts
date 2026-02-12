// === FILE PURPOSE ===
// Zustand store for board-level state management.
// Manages the active board, its columns, and cards for a given project.
// All data fetching goes through window.electronAPI (IPC bridge).

// === DEPENDENCIES ===
// zustand, shared types, window.electronAPI (preload bridge)

import { create } from 'zustand';
import type {
  Project,
  Board,
  Column,
  Card,
  CreateColumnInput,
  UpdateColumnInput,
  CreateCardInput,
  UpdateCardInput,
} from '../../shared/types';

interface BoardStore {
  // State
  project: Project | null;
  board: Board | null;
  columns: Column[];
  cards: Card[];
  loading: boolean;
  error: string | null;

  // Actions
  loadBoard: (projectId: string) => Promise<void>;
  addColumn: (name: string) => Promise<void>;
  updateColumn: (id: string, data: UpdateColumnInput) => Promise<void>;
  deleteColumn: (id: string) => Promise<void>;
  reorderColumns: (columnIds: string[]) => Promise<void>;
  addCard: (columnId: string, title: string, priority?: Card['priority']) => Promise<void>;
  updateCard: (id: string, data: UpdateCardInput) => Promise<void>;
  deleteCard: (id: string) => Promise<void>;
  moveCard: (id: string, columnId: string, position: number) => Promise<void>;
}

export const useBoardStore = create<BoardStore>((set, get) => ({
  project: null,
  board: null,
  columns: [],
  cards: [],
  loading: false,
  error: null,

  loadBoard: async (projectId: string) => {
    set({ loading: true, error: null });
    try {
      // Load project
      const projects = await window.electronAPI.getProjects();
      const project = projects.find(p => p.id === projectId) ?? null;
      if (!project) {
        set({ error: 'Project not found', loading: false });
        return;
      }

      // Load or create board
      let boards = await window.electronAPI.getBoards(projectId);
      let board: Board;
      if (boards.length === 0) {
        board = await window.electronAPI.createBoard({ projectId, name: 'Board' });
      } else {
        board = boards[0];
      }

      // Load columns and cards
      const columns = await window.electronAPI.getColumns(board.id);
      const cards = await window.electronAPI.getCardsByBoard(board.id);

      set({ project, board, columns, cards, loading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load board',
        loading: false,
      });
    }
  },

  addColumn: async (name: string) => {
    const { board, columns } = get();
    if (!board) return;

    const input: CreateColumnInput = { boardId: board.id, name };
    const column = await window.electronAPI.createColumn(input);
    set({ columns: [...columns, column] });
  },

  updateColumn: async (id: string, data: UpdateColumnInput) => {
    const updated = await window.electronAPI.updateColumn(id, data);
    set({
      columns: get().columns.map(c => (c.id === id ? updated : c)),
    });
  },

  deleteColumn: async (id: string) => {
    await window.electronAPI.deleteColumn(id);
    set({
      columns: get().columns.filter(c => c.id !== id),
      cards: get().cards.filter(c => c.columnId !== id),
    });
  },

  reorderColumns: async (columnIds: string[]) => {
    const { board } = get();
    if (!board) return;

    await window.electronAPI.reorderColumns(board.id, columnIds);
    // Reorder local state to match the provided order
    const columnMap = new Map(get().columns.map(c => [c.id, c]));
    const reordered = columnIds
      .map((id, index) => {
        const col = columnMap.get(id);
        if (!col) return null;
        return { ...col, position: index };
      })
      .filter((c): c is Column => c !== null);
    set({ columns: reordered });
  },

  addCard: async (columnId: string, title: string, priority: Card['priority'] = 'medium') => {
    const input: CreateCardInput = { columnId, title, priority };
    const card = await window.electronAPI.createCard(input);
    set({ cards: [...get().cards, card] });
  },

  updateCard: async (id: string, data: UpdateCardInput) => {
    const updated = await window.electronAPI.updateCard(id, data);
    set({
      cards: get().cards.map(c => (c.id === id ? updated : c)),
    });
  },

  deleteCard: async (id: string) => {
    await window.electronAPI.deleteCard(id);
    set({
      cards: get().cards.filter(c => c.id !== id),
    });
  },

  moveCard: async (id: string, columnId: string, position: number) => {
    const updated = await window.electronAPI.moveCard(id, columnId, position);
    set({
      cards: get().cards.map(c => (c.id === id ? updated : c)),
    });
  },
}));

/** Filter and sort cards belonging to a specific column by position. */
export function getCardsByColumn(cards: Card[], columnId: string): Card[] {
  return cards
    .filter(c => c.columnId === columnId)
    .sort((a, b) => a.position - b.position);
}
