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
  /** ISO timestamp when "New chat" superseded this thread; null = the current one. */
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A thread plus what the archive picker needs to label it without opening it. */
export interface MeetingAgentThreadSummary extends MeetingAgentThread {
  messageCount: number;
  /** First user line, trimmed to 80 chars — null for an empty thread. */
  preview: string | null;
}
