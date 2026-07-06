// === Meeting Agent types — the in-meeting "Live Assistant" conversation (LIVE.1 Phase A) ===
// One thread per meeting (unique index on meetingId) — see src/main/db/schema/meeting-agent.ts.

import type { ToolCallRecord, ToolResultRecord } from './card-agent';

export type MeetingAgentMessageRole = 'user' | 'assistant' | 'tool';

export interface MeetingAgentMessage {
  id: string;
  threadId: string;
  role: MeetingAgentMessageRole;
  content: string | null;
  toolCalls: ToolCallRecord[] | null;
  toolResults: ToolResultRecord[] | null;
  createdAt: string;
}

export interface MeetingAgentThread {
  id: string;
  meetingId: string;
  createdAt: string;
  updatedAt: string;
}
