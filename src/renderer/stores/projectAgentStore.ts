// === FILE PURPOSE ===
// Zustand store for per-project AI agent conversations.
// Handles message loading, streaming with chunk/tool events, and abort.
// Event listeners are cleaned up in finally blocks to prevent memory leaks.

import { create } from 'zustand';
import type { ProjectAgentMessage, ProjectAgentAction } from '../../shared/types/project-agent';
import { toast } from '../hooks/useToast';

interface ToolEvent {
  toolName: string;
  type: 'call' | 'result';
  args?: unknown;
  result?: unknown;
}

interface ProjectAgentStore {
  projectId: string | null;
  messages: ProjectAgentMessage[];
  streaming: boolean;
  streamingText: string;
  toolEvents: ToolEvent[];
  actions: ProjectAgentAction[];
  loading: boolean;
  messageCount: number;

  loadMessages: (projectId: string) => Promise<void>;
  sendMessage: (projectId: string, content: string) => Promise<void>;
  clearMessages: (projectId: string) => Promise<void>;
  abort: (projectId: string) => Promise<void>;
  loadMessageCount: (projectId: string) => Promise<void>;
  reset: () => void;
}

const initialState = {
  projectId: null as string | null,
  messages: [] as ProjectAgentMessage[],
  streaming: false,
  streamingText: '',
  toolEvents: [] as ToolEvent[],
  actions: [] as ProjectAgentAction[],
  loading: false,
  messageCount: 0,
};

export const useProjectAgentStore = create<ProjectAgentStore>((set, get) => ({
  ...initialState,

  loadMessages: async (projectId: string) => {
    // Reset streaming state on load — clears any stale stuck state from prior sessions
    set({ loading: true, projectId, streaming: false, streamingText: '', toolEvents: [] });
    try {
      const messages = await window.electronAPI.projectAgentGetMessages(projectId);
      set({ messages, loading: false });
    } catch (error) {
      console.error('Failed to load project agent messages:', error);
      set({ loading: false });
    }
  },

  sendMessage: async (projectId: string, content: string) => {
    if (get().streaming) return;

    const tempId = `temp-${Date.now()}`;
    const tempUserMsg: ProjectAgentMessage = {
      id: tempId,
      projectId,
      role: 'user',
      content,
      toolCalls: null,
      toolResults: null,
      createdAt: new Date().toISOString(),
    };

    set({
      messages: [...get().messages, tempUserMsg],
      streaming: true,
      streamingText: '',
      toolEvents: [],
      actions: [],
    });

    // Register stream listeners
    const cleanupChunk = window.electronAPI.onProjectAgentChunk((data) => {
      if (data.projectId === projectId) {
        set({ streamingText: get().streamingText + data.chunk });
      }
    });

    const cleanupToolEvent = window.electronAPI.onProjectAgentToolEvent((data) => {
      if (data.projectId === projectId) {
        set({
          toolEvents: [...get().toolEvents, {
            toolName: data.toolName,
            type: data.type,
            args: data.args,
            result: data.result,
          }],
        });
      }
    });

    try {
      // 90s safety timeout — prevents the UI from being stuck forever if the API hangs
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Agent request timed out. Try again.')), 90_000),
      );
      const result = await Promise.race([
        window.electronAPI.projectAgentSendMessage(projectId, content),
        timeout,
      ]);

      if (result) {
        // The result contains the assistantMessage; the user message was persisted server-side.
        // Reload messages to get server-assigned IDs for both messages.
        const serverMessages = await window.electronAPI.projectAgentGetMessages(projectId);
        set({
          messages: serverMessages,
          actions: result.actions,
          streaming: false,
          streamingText: '',
          toolEvents: [],
        });
      } else {
        // Aborted — remove optimistic user message
        set({
          messages: get().messages.filter(m => m.id !== tempId),
          streaming: false,
          streamingText: '',
          toolEvents: [],
        });
      }
    } catch (error) {
      console.error('Project agent sendMessage error:', error);
      const msg = error instanceof Error ? error.message : 'Failed to send message';
      toast(msg, 'error');
      // Remove optimistic message on error
      set({
        messages: get().messages.filter(m => m.id !== tempId),
        streaming: false,
        streamingText: '',
        toolEvents: [],
      });
    } finally {
      cleanupChunk();
      cleanupToolEvent();
    }
  },

  clearMessages: async (projectId: string) => {
    await window.electronAPI.projectAgentClearMessages(projectId);
    set({ messages: [], messageCount: 0 });
  },

  abort: async (projectId: string) => {
    try {
      await window.electronAPI.projectAgentAbort(projectId);
    } catch {
      // Abort is best-effort
    }
    // Always reset streaming state so the UI is never stuck
    set({ streaming: false, streamingText: '', toolEvents: [] });
  },

  loadMessageCount: async (projectId: string) => {
    const count = await window.electronAPI.projectAgentGetMessageCount(projectId);
    set({ messageCount: count });
  },

  reset: () => {
    set({ ...initialState });
  },
}));
