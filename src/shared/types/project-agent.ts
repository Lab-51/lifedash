// === Project Agent types — per-project AI agent conversation and tool tracking ===

import type { ToolCallRecord, ToolResultRecord } from './card-agent';

export type ProjectAgentMessageRole = 'user' | 'assistant' | 'tool';

export interface ProjectAgentMessage {
  id: string;
  projectId: string;
  threadId: string | null;
  role: ProjectAgentMessageRole;
  content: string | null;
  toolCalls: ToolCallRecord[] | null;
  toolResults: ToolResultRecord[] | null;
  createdAt: string;
}

export interface ProjectAgentThread {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  messageCount?: number;
}

/** What the project agent did — rendered in the UI as action badges */
export interface ProjectAgentAction {
  toolName: string;
  description: string;  // human-readable: "Moved card to Done"
  success: boolean;
}
