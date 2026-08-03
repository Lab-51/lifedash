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

/** The searched phrase, when the args carry one. Without this every search
 *  rendered as the same opaque "Searched transcript" line — a model that fired
 *  twenty of them produced twenty identical rows that said nothing about what
 *  it actually looked for, or whether it was repeating itself. */
function searchQuery(args: unknown): string | null {
  const query = (args as Record<string, unknown> | undefined)?.query;
  return typeof query === 'string' && query.trim() ? query.trim() : null;
}

/** Generate a human-readable description for a live (in-flight) tool event. */
export function describeToolEvent(toolName: string, args?: unknown): string {
  if (toolName === 'createCardInInbox') {
    const title = (args as Record<string, unknown> | undefined)?.title;
    return title ? `Creating card: "${title}"` : 'Creating card…';
  }
  if (toolName === 'searchTranscript') {
    const query = searchQuery(args);
    return query ? `Searching transcript for “${query}”…` : TOOL_LABELS.searchTranscript.inProgress;
  }
  return TOOL_LABELS[toolName]?.inProgress ?? `Running ${toolName}…`;
}

/** Generate a human-readable description for a persisted tool call (past tense). */
export function describeToolCall(call: ToolCallRecord): string {
  if (call.name === 'createCardInInbox') {
    const title = (call.args as Record<string, unknown> | undefined)?.title;
    return title ? `Created card: "${title}"` : 'Created card';
  }
  if (call.name === 'searchTranscript') {
    const query = searchQuery(call.args);
    return query ? `Searched transcript for “${query}”` : TOOL_LABELS.searchTranscript.done;
  }
  return TOOL_LABELS[call.name]?.done ?? `Ran ${call.name}`;
}

export interface GroupedToolCall {
  /** Identity of the first call in the run — reused as the React key. */
  id: string;
  label: string;
  /** How many adjacent calls collapsed into this row (1 = not collapsed). */
  count: number;
  failed: boolean;
}

/**
 * Collapse RUNS of identical tool-call labels into one row with a count.
 *
 * A model given a search tool can emit many tool calls in a single step —
 * `stepCountIs(5)` bounds steps, not calls — and small local models do this
 * freely. Rendering one row per call turned a single answer into twenty-odd
 * identical lines that pushed the actual reply off screen. Only ADJACENT
 * duplicates merge, so a genuine "search, read, search again" sequence still
 * reads in order rather than being silently reordered into buckets.
 */
export function groupToolCalls(
  calls: ToolCallRecord[],
  isFailed: (call: ToolCallRecord) => boolean = () => false,
): GroupedToolCall[] {
  const grouped: GroupedToolCall[] = [];
  calls.forEach((call, index) => {
    const label = describeToolCall(call);
    const failed = isFailed(call);
    const previous = grouped[grouped.length - 1];
    // Never merge a failure into a success (or vice versa): the icon would then
    // claim an outcome that did not apply to every call in the run.
    if (previous && previous.label === label && previous.failed === failed) {
      previous.count += 1;
      return;
    }
    grouped.push({ id: call.id || String(index), label, count: 1, failed });
  });
  return grouped;
}
