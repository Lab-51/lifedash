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
};
