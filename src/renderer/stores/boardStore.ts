// === FILE PURPOSE ===
// Zustand store for board-level state management.
// Manages the active board, its columns, cards, and labels for a given project.
// Card detail sub-entity state (comments, relationships, activities, attachments)
// lives in cardDetailStore.ts.
// All data fetching goes through window.electronAPI (IPC bridge).

// === DEPENDENCIES ===
// zustand, shared types, window.electronAPI (preload bridge)

import { create } from 'zustand';
import type {
  Project,
  Board,
  Column,
  Card,
  Label,
  CardRelationship,
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
  labels: Label[];
  relationships: CardRelationship[];
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
  loadLabels: () => Promise<void>;
  createLabel: (name: string, color: string) => Promise<Label>;
  deleteLabel: (id: string) => Promise<void>;
  attachLabel: (cardId: string, labelId: string) => Promise<void>;
  detachLabel: (cardId: string, labelId: string) => Promise<void>;
}

export const useBoardStore = create<BoardStore>((set, get) => ({
  project: null,
  board: null,
  columns: [],
  cards: [],
  labels: [],
  relationships: [],
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

      // Load columns, cards, labels, and relationships
      const columns = await window.electronAPI.getColumns(board.id);
      const cards = await window.electronAPI.getCardsByBoard(board.id);
      const labels = await window.electronAPI.getLabels(projectId);
      const relationships = await window.electronAPI.getRelationshipsByBoard(board.id);

      set({ project, board, columns, cards, labels, relationships, loading: false });
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
      cards: get().cards.map(c => (c.id === id ? { ...c, ...updated } : c)),
    });
  },

  deleteCard: async (id: string) => {
    await window.electronAPI.deleteCard(id);
    set({
      cards: get().cards.filter(c => c.id !== id),
    });
  },

  moveCard: async (id: string, columnId: string, position: number) => {
    // Optimistically reorder local state so the UI updates immediately
    const currentCards = get().cards;
    const movedCard = currentCards.find(c => c.id === id);
    if (!movedCard) return;

    // Get siblings in the target column (excluding the moved card), sorted by position
    const siblings = currentCards
      .filter(c => c.columnId === columnId && c.id !== id && !c.archived)
      .sort((a, b) => a.position - b.position);

    // Clamp position
    const clampedPos = Math.max(0, Math.min(position, siblings.length));

    // Insert at the requested position
    const reordered = [...siblings];
    reordered.splice(clampedPos, 0, movedCard);

    // Build the updated cards array with correct positions
    const updatedIds = new Map<string, { columnId: string; position: number }>();
    for (let i = 0; i < reordered.length; i++) {
      updatedIds.set(reordered[i].id, { columnId, position: i });
    }

    set({
      cards: currentCards.map(c => {
        const update = updatedIds.get(c.id);
        if (update) {
          return { ...c, columnId: update.columnId, position: update.position };
        }
        return c;
      }),
    });

    // Persist to backend
    const updated = await window.electronAPI.moveCard(id, columnId, position);
    // Reconcile the moved card with the server response
    set({
      cards: get().cards.map(c => (c.id === id ? { ...c, ...updated } : c)),
    });
  },

  loadLabels: async () => {
    const { project } = get();
    if (!project) return;
    const labels = await window.electronAPI.getLabels(project.id);
    set({ labels });
  },

  createLabel: async (name: string, color: string) => {
    const { project, labels } = get();
    if (!project) throw new Error('No project loaded');
    const label = await window.electronAPI.createLabel({
      projectId: project.id, name, color,
    });
    set({ labels: [...labels, label] });
    return label;
  },

  deleteLabel: async (id: string) => {
    await window.electronAPI.deleteLabel(id);
    set({
      labels: get().labels.filter(l => l.id !== id),
      cards: get().cards.map(c => ({
        ...c,
        labels: c.labels?.filter(l => l.id !== id),
      })),
    });
  },

  attachLabel: async (cardId: string, labelId: string) => {
    await window.electronAPI.attachLabel(cardId, labelId);
    const label = get().labels.find(l => l.id === labelId);
    if (!label) return;
    set({
      cards: get().cards.map(c => {
        if (c.id !== cardId) return c;
        const existing = c.labels ?? [];
        if (existing.some(l => l.id === labelId)) return c;
        return { ...c, labels: [...existing, label] };
      }),
    });
  },

  detachLabel: async (cardId: string, labelId: string) => {
    await window.electronAPI.detachLabel(cardId, labelId);
    set({
      cards: get().cards.map(c => {
        if (c.id !== cardId) return c;
        return { ...c, labels: c.labels?.filter(l => l.id !== labelId) };
      }),
    });
  },
}));

/** Filter and sort cards belonging to a specific column by position. */
export function getCardsByColumn(cards: Card[], columnId: string): Card[] {
  return cards
    .filter(c => c.columnId === columnId)
    .sort((a, b) => a.position - b.position);
}
