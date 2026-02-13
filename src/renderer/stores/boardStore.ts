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
  Label,
  CreateColumnInput,
  UpdateColumnInput,
  CreateCardInput,
  UpdateCardInput,
  CardComment,
  CardRelationship,
  CardActivity,
  CreateCardCommentInput,
  CreateCardRelationshipInput,
} from '../../shared/types';

interface BoardStore {
  // State
  project: Project | null;
  board: Board | null;
  columns: Column[];
  cards: Card[];
  labels: Label[];
  loading: boolean;
  error: string | null;

  // Card detail state (loaded when viewing a specific card)
  selectedCardComments: CardComment[];
  selectedCardRelationships: CardRelationship[];
  selectedCardActivities: CardActivity[];
  loadingCardDetails: boolean;

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

  // Card detail actions
  loadCardDetails: (cardId: string) => Promise<void>;
  clearCardDetails: () => void;
  addComment: (input: CreateCardCommentInput) => Promise<void>;
  updateComment: (id: string, content: string) => Promise<void>;
  deleteComment: (id: string) => Promise<void>;
  addRelationship: (input: CreateCardRelationshipInput) => Promise<void>;
  deleteRelationship: (id: string) => Promise<void>;
}

export const useBoardStore = create<BoardStore>((set, get) => ({
  project: null,
  board: null,
  columns: [],
  cards: [],
  labels: [],
  loading: false,
  error: null,
  selectedCardComments: [],
  selectedCardRelationships: [],
  selectedCardActivities: [],
  loadingCardDetails: false,

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

      // Load columns, cards, and labels
      const columns = await window.electronAPI.getColumns(board.id);
      const cards = await window.electronAPI.getCardsByBoard(board.id);
      const labels = await window.electronAPI.getLabels(projectId);

      set({ project, board, columns, cards, labels, loading: false });
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
    const updated = await window.electronAPI.moveCard(id, columnId, position);
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

  // --- Card Detail Actions ---

  loadCardDetails: async (cardId: string) => {
    set({ loadingCardDetails: true });
    try {
      const [comments, relationships, activities] = await Promise.all([
        window.electronAPI.getCardComments(cardId),
        window.electronAPI.getCardRelationships(cardId),
        window.electronAPI.getCardActivities(cardId),
      ]);
      set({
        selectedCardComments: comments,
        selectedCardRelationships: relationships,
        selectedCardActivities: activities,
        loadingCardDetails: false,
      });
    } catch (error) {
      console.error('Failed to load card details:', error);
      set({ loadingCardDetails: false });
    }
  },

  clearCardDetails: () => set({
    selectedCardComments: [],
    selectedCardRelationships: [],
    selectedCardActivities: [],
  }),

  addComment: async (input: CreateCardCommentInput) => {
    const comment = await window.electronAPI.addCardComment(input);
    set({
      selectedCardComments: [comment, ...get().selectedCardComments],
    });
  },

  updateComment: async (id: string, content: string) => {
    const updated = await window.electronAPI.updateCardComment(id, content);
    set({
      selectedCardComments: get().selectedCardComments.map(
        c => c.id === id ? updated : c,
      ),
    });
  },

  deleteComment: async (id: string) => {
    await window.electronAPI.deleteCardComment(id);
    set({
      selectedCardComments: get().selectedCardComments.filter(c => c.id !== id),
    });
  },

  addRelationship: async (input: CreateCardRelationshipInput) => {
    const rel = await window.electronAPI.addCardRelationship(input);
    set({
      selectedCardRelationships: [...get().selectedCardRelationships, rel],
    });
  },

  deleteRelationship: async (id: string) => {
    await window.electronAPI.deleteCardRelationship(id);
    set({
      selectedCardRelationships: get().selectedCardRelationships.filter(r => r.id !== id),
    });
  },
}));

/** Filter and sort cards belonging to a specific column by position. */
export function getCardsByColumn(cards: Card[], columnId: string): Card[] {
  return cards
    .filter(c => c.columnId === columnId)
    .sort((a, b) => a.position - b.position);
}
