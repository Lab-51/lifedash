// === FILE PURPOSE ===
// Session-scoped, in-memory Zustand store for the Live Mode "activity feed"
// (V3.1 Task 5) — a reverse-chron log of everything the assistant/triage did
// during the CURRENT recording:
//  - meeting-agent tool-call/tool-result stream events, pushed directly by
//    meetingAgentStore.send() (see that file) so the log stays accurate even
//    if LiveAssistantChat unmounts mid-answer (Live Mode minimized).
//  - liveSuggestionsStore chip accept/dismiss, pushed directly by that store's
//    accept()/dismiss() actions (covers the 'project' chip's create+link too).
// Verb-phrase labels for tool calls are always computed by the CALLER, reusing
// the ONE shared meeting-agent label map in utils/toolCallLabels — this store
// never imports it, keeping it a dependency-light leaf (no circular import
// back through LiveAssistantChat -> meetingAgentStore -> this store).
//
// Off-canvas entries (targetTab !== the tab currently in view, tracked here via
// setViewedTab) bump canvasBadgeStore (Task 4). The canvas itself NEVER
// auto-switches — only an explicit click (ActivityFeed's onSelectTab) does.
//
// Clears on recording stop/cancel via its own initListener(), reacting to
// recordingStore.meetingId transitions (mirrors liveSuggestionsStore's own
// listener pattern) — registered once at app root (App.tsx).
//
// The exported tab-mapping + label helpers are also reused, read-only, by
// SessionWorkspace's post-hoc reconstruction (built from persisted agent
// messages + suggestions) so the live and post-hoc feeds agree on where each
// action goes.
//
// === DEPENDENCIES ===
// zustand, recordingStore (read-only meetingId transitions), canvasBadgeStore,
// CanvasTabId (LiveCanvasTabs, type-only), shared LiveSuggestion types

import { create } from 'zustand';
import { useRecordingStore } from './recordingStore';
import { useCanvasBadgeStore } from './canvasBadgeStore';
import type { CanvasTabId } from '../components/LiveCanvasTabs';
import type { LiveSuggestion, LiveSuggestionType } from '../../shared/types';

export type ActivityFeedIcon = 'tool-ok' | 'tool-error' | 'accepted' | 'dismissed' | 'project';

export interface ActivityFeedEntry {
  id: string;
  icon: ActivityFeedIcon;
  /** Verb phrase, e.g. "Created card 'Send report' in Inbox". */
  label: string;
  /** ISO timestamp. */
  timestamp: string;
  /** Which canvas tab this action affects — drives the off-canvas badge + click-to-switch. */
  targetTab: CanvasTabId;
}

const MAX_ENTRIES = 50;

/** Which canvas tab a meeting-agent tool's activity belongs to. */
const TOOL_TARGET_TAB: Record<string, CanvasTabId> = {
  getTranscriptWindow: 'transcript',
  searchTranscript: 'transcript',
  getMeetingContext: 'transcript',
  createCardInInbox: 'board',
  listBoards: 'board',
  listColumnCards: 'board',
  moveCard: 'board',
  getProjectStats: 'board',
  searchProjectCards: 'board',
  createProject: 'board',
  captureNote: 'brain',
};

/** Exported for post-hoc reuse (SessionWorkspace's reconstruction). Defaults to 'transcript' for any future/unknown tool. */
export function toolTargetTab(toolName: string): CanvasTabId {
  return TOOL_TARGET_TAB[toolName] ?? 'transcript';
}

const SUGGESTION_TARGET_TAB: Record<LiveSuggestionType, CanvasTabId> = {
  action_item: 'board',
  project: 'board',
  decision: 'brain',
  question: 'brain',
};

/** Exported for post-hoc reuse. */
export function suggestionTargetTab(type: LiveSuggestionType): CanvasTabId {
  return SUGGESTION_TARGET_TAB[type];
}

const SUGGESTION_TYPE_LABEL: Record<LiveSuggestionType, string> = {
  action_item: 'action item',
  decision: 'decision',
  question: 'question',
  project: 'project',
};

/** Verb phrase for a chip accept/dismiss. Exported for post-hoc reuse. */
export function describeSuggestionEvent(suggestion: LiveSuggestion, action: 'accepted' | 'dismissed'): string {
  if (suggestion.type === 'project' && action === 'accepted') {
    return `Created project "${suggestion.title}" — meeting linked`;
  }
  const verb = action === 'accepted' ? 'Accepted' : 'Dismissed';
  return `${verb} ${SUGGESTION_TYPE_LABEL[suggestion.type]}: "${suggestion.title}"`;
}

let idCounter = 0;
function makeId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now()}-${idCounter}`;
}

interface PendingToolCall {
  entryId: string;
  toolName: string;
}

interface ActivityFeedStore {
  /** Reverse-chron (newest first), capped at MAX_ENTRIES. */
  entries: ActivityFeedEntry[];
  /** The canvas tab currently in view — off-canvas entries (targetTab !== this) bump the badge. */
  viewedTab: CanvasTabId;
  /** Tool calls awaiting their result, so a failed result can flip the optimistic entry's icon. */
  pendingToolCalls: PendingToolCall[];

  /** A meeting-agent tool call started — label is pre-computed by the caller (reused chat label map). */
  addToolCall: (toolName: string, label: string) => void;
  /** The matching tool call's result arrived — flips that entry to 'tool-error' on failure only. */
  resolveToolResult: (toolName: string, result: unknown) => void;
  /** A live-suggestion chip was accepted or dismissed. */
  addSuggestionEvent: (suggestion: LiveSuggestion, action: 'accepted' | 'dismissed') => void;
  /** Tell the store which tab is currently in view (called on tab switch — see LiveModeOverlay). */
  setViewedTab: (tab: CanvasTabId) => void;
  /** Reset everything — called on recording stop/cancel (and by initListener on any new recording). */
  clear: () => void;
  /** Registers the recordingStore.meetingId reaction. Returns a cleanup function. */
  initListener: () => () => void;
}

export const useActivityFeedStore = create<ActivityFeedStore>((set, get) => ({
  entries: [],
  viewedTab: 'transcript',
  pendingToolCalls: [],

  addToolCall: (toolName, label) => {
    const entry: ActivityFeedEntry = {
      id: makeId('tool'),
      icon: 'tool-ok',
      label,
      timestamp: new Date().toISOString(),
      targetTab: toolTargetTab(toolName),
    };
    set((state) => ({
      entries: [entry, ...state.entries].slice(0, MAX_ENTRIES),
      pendingToolCalls: [...state.pendingToolCalls, { entryId: entry.id, toolName }],
    }));
    if (entry.targetTab !== get().viewedTab) useCanvasBadgeStore.getState().increment(entry.targetTab);
  },

  resolveToolResult: (toolName, result) => {
    set((state) => {
      const idx = state.pendingToolCalls.findIndex((p) => p.toolName === toolName);
      if (idx === -1) return state;
      const { entryId } = state.pendingToolCalls[idx];
      const pendingToolCalls = [...state.pendingToolCalls.slice(0, idx), ...state.pendingToolCalls.slice(idx + 1)];
      const failed = (result as Record<string, unknown> | undefined)?.success === false;
      if (!failed) return { pendingToolCalls };
      return {
        pendingToolCalls,
        entries: state.entries.map((e) => (e.id === entryId ? { ...e, icon: 'tool-error' as const } : e)),
      };
    });
  },

  addSuggestionEvent: (suggestion, action) => {
    const targetTab = suggestionTargetTab(suggestion.type);
    const entry: ActivityFeedEntry = {
      id: makeId('suggestion'),
      icon: action === 'dismissed' ? 'dismissed' : suggestion.type === 'project' ? 'project' : 'accepted',
      label: describeSuggestionEvent(suggestion, action),
      timestamp: new Date().toISOString(),
      targetTab,
    };
    set((state) => ({ entries: [entry, ...state.entries].slice(0, MAX_ENTRIES) }));
    if (targetTab !== get().viewedTab) useCanvasBadgeStore.getState().increment(targetTab);
  },

  setViewedTab: (tab) => set({ viewedTab: tab }),

  clear: () => set({ entries: [], pendingToolCalls: [], viewedTab: 'transcript' }),

  initListener: () => {
    return useRecordingStore.subscribe((state, prevState) => {
      if (state.meetingId === prevState.meetingId) return;
      get().clear();
    });
  },
}));
