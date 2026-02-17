// === Advanced card types: comments, relationships, activity, attachments, templates ===

import type { CardPriority } from './projects';

export type CardRelationshipType = 'blocks' | 'depends_on' | 'related_to';

export interface CardComment {
  id: string;
  cardId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface CardRelationship {
  id: string;
  sourceCardId: string;
  targetCardId: string;
  type: CardRelationshipType;
  createdAt: string;
  // Joined titles for display
  sourceCardTitle?: string;
  targetCardTitle?: string;
}

export type CardActivityAction =
  | 'created' | 'updated' | 'moved' | 'commented'
  | 'archived' | 'restored' | 'relationship_added' | 'relationship_removed';

export interface CardActivity {
  id: string;
  cardId: string;
  action: CardActivityAction;
  details: string | null;
  createdAt: string;
}

export interface CardAttachment {
  id: string;
  cardId: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string | null;
  createdAt: string;
}

export interface CardChecklistItem {
  id: string;
  cardId: string;
  title: string;
  completed: boolean;
  position: number;
  createdAt: string;
}

// === Input types ===

export interface CreateCardCommentInput {
  cardId: string;
  content: string;
}

export interface CreateCardRelationshipInput {
  sourceCardId: string;
  targetCardId: string;
  type: CardRelationshipType;
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

export interface CardTemplate {
  id: string;
  projectId: string | null;
  name: string;
  description: string | null;
  priority: CardPriority;
  labelNames: string[] | null;
  createdAt: string;
  updatedAt: string;
}
