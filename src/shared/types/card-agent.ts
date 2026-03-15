// === Card Agent types — per-card AI agent conversation and tool tracking ===

export type CardAgentMessageRole = 'user' | 'assistant' | 'tool';

export interface CardAgentMessage {
  id: string;
  cardId: string;
  threadId: string | null;
  role: CardAgentMessageRole;
  content: string | null;
  toolCalls: ToolCallRecord[] | null;
  toolResults: ToolResultRecord[] | null;
  createdAt: string;
}

export interface CardAgentThread {
  id: string;
  cardId: string;
  title: string;
  createdAt: string;
  messageCount?: number;
}

export interface ToolCallRecord {
  id: string; // tool call ID (from AI SDK)
  name: string; // tool name (e.g. 'addChecklistItem')
  args: Record<string, unknown>;
}

export interface ToolResultRecord {
  toolCallId: string;
  toolName: string;
  result: unknown;
}

/** What the agent did — rendered in the UI as action badges */
export interface AgentAction {
  toolName: string;
  description: string; // human-readable: "Added checklist item: Set up JWT"
  success: boolean;
}
