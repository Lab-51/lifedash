// === Preload bridge: Card comments, relationships, activities, attachments ===
import { ipcRenderer } from 'electron';
import type { CreateCardCommentInput, CreateCardRelationshipInput } from '../../shared/types';

export const cardDetailsBridge = {
  // Comments
  getCardComments: (cardId: string) => ipcRenderer.invoke('card:getComments', cardId),
  addCardComment: (input: CreateCardCommentInput) =>
    ipcRenderer.invoke('card:addComment', input),
  updateCardComment: (id: string, content: string) =>
    ipcRenderer.invoke('card:updateComment', id, content),
  deleteCardComment: (id: string) => ipcRenderer.invoke('card:deleteComment', id),

  // Relationships
  getCardRelationships: (cardId: string) =>
    ipcRenderer.invoke('card:getRelationships', cardId),
  getRelationshipsByBoard: (boardId: string) =>
    ipcRenderer.invoke('cards:getRelationshipsByBoard', boardId),
  addCardRelationship: (input: CreateCardRelationshipInput) =>
    ipcRenderer.invoke('card:addRelationship', input),
  deleteCardRelationship: (id: string) =>
    ipcRenderer.invoke('card:deleteRelationship', id),

  // Activities
  getCardActivities: (cardId: string) => ipcRenderer.invoke('card:getActivities', cardId),

  // Attachments
  getCardAttachments: (cardId: string) => ipcRenderer.invoke('card:getAttachments', cardId),
  addCardAttachment: (cardId: string) => ipcRenderer.invoke('card:addAttachment', cardId),
  deleteCardAttachment: (id: string) => ipcRenderer.invoke('card:deleteAttachment', id),
  openCardAttachment: (filePath: string) =>
    ipcRenderer.invoke('card:openAttachment', filePath),

  // Checklist Items
  getChecklistItems: (cardId: string) =>
    ipcRenderer.invoke('card:getChecklistItems', cardId),
  addChecklistItem: (cardId: string, title: string) =>
    ipcRenderer.invoke('card:addChecklistItem', { cardId, title }),
  updateChecklistItem: (id: string, updates: { title?: string; completed?: boolean }) =>
    ipcRenderer.invoke('card:updateChecklistItem', { id, ...updates }),
  deleteChecklistItem: (id: string) =>
    ipcRenderer.invoke('card:deleteChecklistItem', id),
  reorderChecklistItems: (cardId: string, itemIds: string[]) =>
    ipcRenderer.invoke('card:reorderChecklistItems', { cardId, itemIds }),
  addChecklistItemsBatch: (cardId: string, titles: string[]) =>
    ipcRenderer.invoke('card:addChecklistItemsBatch', { cardId, titles }),

  // AI description generation
  generateCardDescription: (cardId: string) =>
    ipcRenderer.invoke('card:generate-description', cardId),

  // Card Templates
  getCardTemplates: (projectId?: string) =>
    ipcRenderer.invoke('card-templates:list', projectId),
  createCardTemplate: (input: any) =>
    ipcRenderer.invoke('card-templates:create', input),
  deleteCardTemplate: (id: string) =>
    ipcRenderer.invoke('card-templates:delete', id),
  saveCardAsTemplate: (cardId: string, name?: string) =>
    ipcRenderer.invoke('card-templates:save-from-card', cardId, name),
};
