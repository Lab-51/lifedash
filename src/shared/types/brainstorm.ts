// === Brainstorm session and message types ===

export type BrainstormSessionStatus = 'active' | 'archived';
export type BrainstormMessageRole = 'user' | 'assistant';

export interface BrainstormSession {
  id: string;
  projectId: string | null;
  title: string;
  status: BrainstormSessionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface BrainstormMessage {
  id: string;
  sessionId: string;
  role: BrainstormMessageRole;
  content: string;
  createdAt: string;
}

export interface BrainstormSessionWithMessages extends BrainstormSession {
  messages: BrainstormMessage[];
}

export interface CreateBrainstormSessionInput {
  title: string;
  projectId?: string;
}
