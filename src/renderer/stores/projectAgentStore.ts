// === FILE PURPOSE ===
// Zustand store for per-project AI agent conversations.
// Handles message loading, streaming with chunk/tool events, threads, and abort.
// Event listeners are cleaned up in finally blocks to prevent memory leaks.

import { create } from 'zustand';
import type { ProjectAgentMessage, ProjectAgentThread, ProjectAgentAction } from '../../shared/types/project-agent';
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
  threads: ProjectAgentThread[];
  activeThreadId: string | null;
  threadsLoading: boolean;

  loadMessages: (projectId: string) => Promise<void>;
  sendMessage: (projectId: string, content: string) => Promise<void>;
  clearMessages: (projectId: string) => Promise<void>;
  abort: (projectId: string) => Promise<void>;
  loadMessageCount: (projectId: string) => Promise<void>;
  loadThreads: (projectId: string) => Promise<void>;
  switchThread: (projectId: string, threadId: string) => Promise<void>;
  newThread: () => void;
  deleteThread: (projectId: string, threadId: string) => Promise<void>;
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
  threads: [] as ProjectAgentThread[],
  activeThreadId: null as string | null,
  threadsLoading: false,
};

export const useProjectAgentStore = create<ProjectAgentStore>((set, get) => ({
  ...initialState,

  loadThreads: async (projectId: string) => {
    set({ threadsLoading: true });
    try {
      const threads = await window.electronAPI.projectAgentGetThreads(projectId);
      const state: Partial<ProjectAgentStore> = { threads, threadsLoading: false };
      if (threads.length > 0 && get().activeThreadId === null) {
        state.activeThreadId = threads[0].id;
      }
      set(state);
    } catch (error) {
      console.error('Failed to load project agent threads:', error);
      set({ threadsLoading: false });
    }
  },

  switchThread: async (projectId: string, threadId: string) => {
    set({ activeThreadId: threadId, loading: true });
    try {
      const messages = await window.electronAPI.projectAgentGetMessages(projectId, threadId);
      set({ messages, loading: false });
    } catch (error) {
      console.error('Failed to switch project agent thread:', error);
      set({ loading: false });
    }
  },

  newThread: () => {
    set({ activeThreadId: null, messages: [] });
  },

  deleteThread: async (projectId: string, threadId: string) => {
    try {
      await window.electronAPI.projectAgentDeleteThread(threadId);
      const remaining = get().threads.filter(t => t.id !== threadId);
      set({ threads: remaining });

      if (get().activeThreadId === threadId) {
        if (remaining.length > 0) {
          get().switchThread(projectId, remaining[0].id);
        } else {
          set({ activeThreadId: null, messages: [] });
        }
      }
      // Refresh badge count
      get().loadMessageCount(projectId);
    } catch (error) {
      console.error('Failed to delete project agent thread:', error);
      toast('Failed to delete thread', 'error');
    }
  },

  loadMessages: async (projectId: string) => {
    // Reset streaming state on load — clears any stale stuck state from prior sessions
    set({ loading: true, projectId, streaming: false, streamingText: '', toolEvents: [] });
    try {
      const activeThreadId = get().activeThreadId;
      const messages = await window.electronAPI.projectAgentGetMessages(projectId, activeThreadId ?? undefined);
      set({ messages, loading: false });

      // Load threads if we haven't yet
      if (get().threads.length === 0) {
        get().loadThreads(projectId);
      }
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
      threadId: get().activeThreadId ?? null,
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
        window.electronAPI.projectAgentSendMessage(projectId, content, get().activeThreadId ?? undefined),
        timeout,
      ]);

      if (result) {
        // If this was a new thread (activeThreadId was null), capture the returned threadId
        if (result.threadId && get().activeThreadId === null) {
          set({ activeThreadId: result.threadId });
          // Refresh thread list to include the newly created thread
          get().loadThreads(projectId);
        }

        // Reload messages to get server-assigned IDs for both messages
        const activeThreadId = get().activeThreadId;
        const serverMessages = await window.electronAPI.projectAgentGetMessages(projectId, activeThreadId ?? undefined);
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
