// === FILE PURPOSE ===
// Zustand store for card detail sub-entity state.
// Manages comments, relationships, activities, and attachments for the
// currently selected card.  Extracted from boardStore to keep each store
// focused on a single concern.

// === DEPENDENCIES ===
// zustand, shared types, window.electronAPI (preload bridge)

import { create } from 'zustand';
import type {
  CardComment,
  CardRelationship,
  CardActivity,
  CardAttachment,
  CardChecklistItem,
  CreateCardCommentInput,
  CreateCardRelationshipInput,
} from '../../shared/types';

interface CardDetailStore {
  // State
  selectedCardComments: CardComment[];
  selectedCardRelationships: CardRelationship[];
  selectedCardActivities: CardActivity[];
  selectedCardAttachments: CardAttachment[];
  selectedCardChecklistItems: CardChecklistItem[];
  loadingCardDetails: boolean;

  // Actions
  loadCardDetails: (cardId: string) => Promise<void>;
  clearCardDetails: () => void;
  addComment: (input: CreateCardCommentInput) => Promise<void>;
  updateComment: (id: string, content: string) => Promise<void>;
  deleteComment: (id: string) => Promise<void>;
  addRelationship: (input: CreateCardRelationshipInput) => Promise<void>;
  deleteRelationship: (id: string) => Promise<void>;
  addAttachment: (cardId: string) => Promise<void>;
  deleteAttachment: (id: string) => Promise<void>;
  openAttachment: (filePath: string) => Promise<void>;
  loadChecklistItems: (cardId: string) => Promise<void>;
  addChecklistItem: (cardId: string, title: string) => Promise<void>;
  updateChecklistItem: (id: string, updates: { title?: string; completed?: boolean }) => Promise<void>;
  deleteChecklistItem: (id: string) => Promise<void>;
  reorderChecklistItems: (cardId: string, itemIds: string[]) => Promise<void>;
}

export const useCardDetailStore = create<CardDetailStore>((set, get) => ({
  selectedCardComments: [],
  selectedCardRelationships: [],
  selectedCardActivities: [],
  selectedCardAttachments: [],
  selectedCardChecklistItems: [],
  loadingCardDetails: false,

  loadCardDetails: async (cardId: string) => {
    set({ loadingCardDetails: true });
    try {
      const [comments, relationships, activities, attachments, checklistItems] = await Promise.all([
        window.electronAPI.getCardComments(cardId),
        window.electronAPI.getCardRelationships(cardId),
        window.electronAPI.getCardActivities(cardId),
        window.electronAPI.getCardAttachments(cardId),
        window.electronAPI.getChecklistItems(cardId),
      ]);
      set({
        selectedCardComments: comments,
        selectedCardRelationships: relationships,
        selectedCardActivities: activities,
        selectedCardAttachments: attachments,
        selectedCardChecklistItems: checklistItems,
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
    selectedCardAttachments: [],
    selectedCardChecklistItems: [],
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

  addAttachment: async (cardId: string) => {
    const attachment = await window.electronAPI.addCardAttachment(cardId);
    if (attachment) {
      set(state => ({
        selectedCardAttachments: [attachment, ...state.selectedCardAttachments],
      }));
    }
  },

  deleteAttachment: async (id: string) => {
    await window.electronAPI.deleteCardAttachment(id);
    set(state => ({
      selectedCardAttachments: state.selectedCardAttachments.filter(a => a.id !== id),
    }));
  },

  openAttachment: async (filePath: string) => {
    await window.electronAPI.openCardAttachment(filePath);
  },

  loadChecklistItems: async (cardId: string) => {
    const items = await window.electronAPI.getChecklistItems(cardId);
    set({ selectedCardChecklistItems: items });
  },

  addChecklistItem: async (cardId: string, title: string) => {
    const item = await window.electronAPI.addChecklistItem(cardId, title);
    set(state => ({
      selectedCardChecklistItems: [...state.selectedCardChecklistItems, item],
    }));
  },

  updateChecklistItem: async (id: string, updates: { title?: string; completed?: boolean }) => {
    // Optimistic update
    set(state => ({
      selectedCardChecklistItems: state.selectedCardChecklistItems.map(item =>
        item.id === id ? { ...item, ...updates } : item
      ),
    }));
    try {
      await window.electronAPI.updateChecklistItem(id, updates);
    } catch (err) {
      console.error('Failed to update checklist item:', err);
    }
  },

  deleteChecklistItem: async (id: string) => {
    set(state => ({
      selectedCardChecklistItems: state.selectedCardChecklistItems.filter(item => item.id !== id),
    }));
    try {
      await window.electronAPI.deleteChecklistItem(id);
    } catch (err) {
      console.error('Failed to delete checklist item:', err);
    }
  },

  reorderChecklistItems: async (cardId: string, itemIds: string[]) => {
    // Optimistic reorder
    const items = get().selectedCardChecklistItems;
    const reordered = itemIds.map((id, index) => {
      const item = items.find(i => i.id === id)!;
      return { ...item, position: index };
    });
    set({ selectedCardChecklistItems: reordered });
    try {
      await window.electronAPI.reorderChecklistItems(cardId, itemIds);
    } catch (err) {
      console.error('Failed to reorder checklist items:', err);
    }
  },
}));
