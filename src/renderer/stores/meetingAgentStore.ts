// === FILE PURPOSE ===
// Zustand store for the in-meeting "Live Assistant" conversation (LIVE.1 Phase A).
// One thread per meeting (no thread switching, unlike cardAgentStore) — mirrors
// cardAgentStore's send/stream/tool-event pattern: listeners are registered per
// `send()` call and cleaned up in a `finally` block once that request settles,
// independent of whether the calling component is still mounted (so a stream
// keeps updating the store even if the drawer is closed mid-answer).

import { create } from 'zustand';
import type { MeetingAgentMessage } from '../../shared/types';

interface ToolEvent {
  toolName: string;
  type: 'call' | 'result';
  args?: unknown;
  result?: unknown;
}

interface MeetingAgentStore {
  meetingId: string | null;
  messages: MeetingAgentMessage[];
  streaming: boolean;
  streamingText: string;
  toolEvents: ToolEvent[];
  loading: boolean;
  error: string | null;

  load: (meetingId: string) => Promise<void>;
  send: (meetingId: string, content: string) => Promise<void>;
  stop: (meetingId: string) => Promise<void>;
  reset: () => void;
}

const initialState = {
  meetingId: null as string | null,
  messages: [] as MeetingAgentMessage[],
  streaming: false,
  streamingText: '',
  toolEvents: [] as ToolEvent[],
  loading: false,
  error: null as string | null,
};

export const useMeetingAgentStore = create<MeetingAgentStore>((set, get) => ({
  ...initialState,

  load: async (meetingId: string) => {
    set({ loading: true, meetingId, error: null });
    try {
      const messages = await window.electronAPI.meetingAgentLoad(meetingId);
      // Reset streaming state on load — clears any stale stuck state from prior sessions.
      set({ messages, loading: false, streaming: false, streamingText: '', toolEvents: [] });
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : 'Failed to load conversation' });
    }
  },

  send: async (meetingId: string, content: string) => {
    if (get().streaming) return;

    const tempUserMsg: MeetingAgentMessage = {
      id: `temp-${Date.now()}`,
      threadId: '',
      role: 'user',
      content,
      toolCalls: null,
      toolResults: null,
      createdAt: new Date().toISOString(),
    };

    set({
      meetingId,
      messages: [...get().messages, tempUserMsg],
      streaming: true,
      streamingText: '',
      toolEvents: [],
      error: null,
    });

    const cleanupDelta = window.electronAPI.onMeetingAgentTextDelta((data) => {
      if (data.meetingId === meetingId) {
        set({ streamingText: get().streamingText + data.chunk });
      }
    });
    const cleanupToolCall = window.electronAPI.onMeetingAgentToolCall((data) => {
      if (data.meetingId === meetingId) {
        set({ toolEvents: [...get().toolEvents, { toolName: data.toolName, type: 'call', args: data.args }] });
      }
    });
    const cleanupToolResult = window.electronAPI.onMeetingAgentToolResult((data) => {
      if (data.meetingId === meetingId) {
        set({ toolEvents: [...get().toolEvents, { toolName: data.toolName, type: 'result', result: data.result }] });
      }
    });
    // 'done' finalizes the assistant message — it fires (synchronously, before the
    // invoke() reply) in every case except "aborted before any output existed",
    // which is handled below via the `!result` branch instead.
    const cleanupDone = window.electronAPI.onMeetingAgentDone((data) => {
      set({
        messages: [...get().messages, data.assistantMessage],
        streaming: false,
        streamingText: '',
        toolEvents: [],
      });
    });
    const cleanupError = window.electronAPI.onMeetingAgentError((data) => {
      if (data.meetingId === meetingId) {
        set({ streaming: false, streamingText: '', toolEvents: [], error: data.error });
      }
    });

    try {
      const result = await window.electronAPI.meetingAgentSend(meetingId, content);
      if (!result && get().streaming) {
        // Aborted before any text/tool-call existed — main never emits 'done' for
        // this case, so reset the streaming state ourselves.
        set({ streaming: false, streamingText: '', toolEvents: [] });
      }
    } catch (error) {
      // Fallback for failures that occur before any event fires (e.g. validation).
      // If the 'error' event already handled it, streaming is already false here.
      if (get().streaming) {
        const message = error instanceof Error ? error.message : 'Failed to reach the Live Assistant.';
        set({ streaming: false, streamingText: '', toolEvents: [], error: message });
      }
    } finally {
      cleanupDelta();
      cleanupToolCall();
      cleanupToolResult();
      cleanupDone();
      cleanupError();
    }
  },

  stop: async (meetingId: string) => {
    try {
      await window.electronAPI.meetingAgentStop(meetingId);
    } catch {
      // Abort is best-effort
    }
    // Unblock the UI immediately — the in-flight send() promise still settles
    // naturally (via the 'done' event or a null result) and finalizes any partial
    // message, so we don't need to wait for it here.
    set({ streaming: false, streamingText: '', toolEvents: [] });
  },

  reset: () => set({ ...initialState }),
}));
