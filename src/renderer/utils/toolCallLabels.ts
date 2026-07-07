// === FILE PURPOSE ===
// Shared tool-call label mapping for the meeting-agent ("Live Assistant") tools —
// the ONE source of truth for turning a tool name/args into a human-readable
// verb phrase. Used by the live chat (LiveAssistantChat), the read-only
// post-meeting transcript (meeting-detail/LiveAssistantSection), meetingAgentStore
// (which pushes labeled entries into activityFeedStore as tool-call/tool-result
// events stream in), and SessionWorkspace's post-hoc activity reconstruction
// (V3.1 Task 5).
//
// Extracted out of LiveAssistantChat.tsx into this dependency-free leaf module
// (no store or component imports) so meetingAgentStore can reuse it too WITHOUT
// creating a circular import: meetingAgentStore -> LiveAssistantChat would cycle
// straight back (LiveAssistantChat already imports useMeetingAgentStore). See
// meetingAgentService.ts's own "CIRCULAR IMPORT" note for the same class of
// problem on the main-process side.
//
// === DEPENDENCIES ===
// shared ToolCallRecord type

import type { ToolCallRecord } from '../../shared/types';

/** Human-readable labels for the meeting-agent tools that need one, keyed by tool name. */
const TOOL_LABELS: Record<string, { inProgress: string; done: string }> = {
  getTranscriptWindow: { inProgress: 'Reading transcript window…', done: 'Read transcript window' },
  searchTranscript: { inProgress: 'Searching transcript…', done: 'Searched transcript' },
  getMeetingContext: { inProgress: 'Loading meeting context…', done: 'Loaded meeting context' },
};

/** Generate a human-readable description for a live (in-flight) tool event. */
export function describeToolEvent(toolName: string, args?: unknown): string {
  if (toolName === 'createCardInInbox') {
    const title = (args as Record<string, unknown> | undefined)?.title;
    return title ? `Creating card: "${title}"` : 'Creating card…';
  }
  return TOOL_LABELS[toolName]?.inProgress ?? `Running ${toolName}…`;
}

/** Generate a human-readable description for a persisted tool call (past tense). */
export function describeToolCall(call: ToolCallRecord): string {
  if (call.name === 'createCardInInbox') {
    const title = (call.args as Record<string, unknown> | undefined)?.title;
    return title ? `Created card: "${title}"` : 'Created card';
  }
  return TOOL_LABELS[call.name]?.done ?? `Ran ${call.name}`;
}
