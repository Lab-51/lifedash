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
  CreateCardCommentInput,
  CreateCardRelationshipInput,
} from '../../shared/types';

interface CardDetailStore {
  // State
  selectedCardComments: CardComment[];
  selectedCardRelationships: CardRelationship[];
  selectedCardActivities: CardActivity[];
  selectedCardAttachments: CardAttachment[];
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
}

export const useCardDetailStore = create<CardDetailStore>((set, get) => ({
  selectedCardComments: [],
  selectedCardRelationships: [],
  selectedCardActivities: [],
  selectedCardAttachments: [],
  loadingCardDetails: false,

  loadCardDetails: async (cardId: string) => {
    set({ loadingCardDetails: true });
    try {
      const [comments, relationships, activities, attachments] = await Promise.all([
        window.electronAPI.getCardComments(cardId),
        window.electronAPI.getCardRelationships(cardId),
        window.electronAPI.getCardActivities(cardId),
        window.electronAPI.getCardAttachments(cardId),
      ]);
      set({
        selectedCardComments: comments,
        selectedCardRelationships: relationships,
        selectedCardActivities: activities,
        selectedCardAttachments: attachments,
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
}));
