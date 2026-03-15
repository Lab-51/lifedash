// === FILE PURPOSE ===
// Zustand store for per-card AI agent conversations.
// Handles message loading, streaming with chunk/tool events, threads, and abort.
// Event listeners are cleaned up in finally blocks to prevent memory leaks.

import { create } from 'zustand';
import type { CardAgentMessage, CardAgentThread, AgentAction } from '../../shared/types/card-agent';
import { toast } from '../hooks/useToast';

interface ToolEvent {
  toolName: string;
  type: 'call' | 'result';
  args?: unknown;
  result?: unknown;
}

interface CardAgentStore {
  cardId: string | null;
  messages: CardAgentMessage[];
  streaming: boolean;
  streamingText: string;
  toolEvents: ToolEvent[];
  actions: AgentAction[];
  loading: boolean;
  messageCount: number;
  threads: CardAgentThread[];
  activeThreadId: string | null;
  threadsLoading: boolean;

  loadMessages: (cardId: string) => Promise<void>;
  sendMessage: (cardId: string, content: string) => Promise<void>;
  clearMessages: (cardId: string) => Promise<void>;
  abort: (cardId: string) => Promise<void>;
  loadMessageCount: (cardId: string) => Promise<void>;
  loadThreads: (cardId: string) => Promise<void>;
  switchThread: (cardId: string, threadId: string) => Promise<void>;
  newThread: () => void;
  deleteThread: (cardId: string, threadId: string) => Promise<void>;
  reset: () => void;
}

const initialState = {
  cardId: null as string | null,
  messages: [] as CardAgentMessage[],
  streaming: false,
  streamingText: '',
  toolEvents: [] as ToolEvent[],
  actions: [] as AgentAction[],
  loading: false,
  messageCount: 0,
  threads: [] as CardAgentThread[],
  activeThreadId: null as string | null,
  threadsLoading: false,
};

export const useCardAgentStore = create<CardAgentStore>((set, get) => ({
  ...initialState,

  loadThreads: async (cardId: string) => {
    set({ threadsLoading: true });
    try {
      const threads = await window.electronAPI.cardAgentGetThreads(cardId);
      const state: Partial<CardAgentStore> = { threads, threadsLoading: false };
      if (threads.length > 0 && get().activeThreadId === null) {
        state.activeThreadId = threads[0].id;
      }
      set(state);
    } catch (error) {
      console.error('Failed to load card agent threads:', error);
      set({ threadsLoading: false });
    }
  },

  switchThread: async (cardId: string, threadId: string) => {
    set({ activeThreadId: threadId, loading: true });
    try {
      const messages = await window.electronAPI.cardAgentGetMessages(cardId, threadId);
      set({ messages, loading: false });
    } catch (error) {
      console.error('Failed to switch card agent thread:', error);
      set({ loading: false });
    }
  },

  newThread: () => {
    set({ activeThreadId: null, messages: [] });
  },

  deleteThread: async (cardId: string, threadId: string) => {
    try {
      await window.electronAPI.cardAgentDeleteThread(threadId);
      const remaining = get().threads.filter((t) => t.id !== threadId);
      set({ threads: remaining });

      if (get().activeThreadId === threadId) {
        if (remaining.length > 0) {
          // switchThread sets activeThreadId, loads messages
          get().switchThread(cardId, remaining[0].id);
        } else {
          set({ activeThreadId: null, messages: [] });
        }
      }
      // Refresh badge count
      get().loadMessageCount(cardId);
    } catch (error) {
      console.error('Failed to delete card agent thread:', error);
      toast('Failed to delete thread', 'error');
    }
  },

  loadMessages: async (cardId: string) => {
    // Reset streaming state on load — clears any stale stuck state from prior sessions
    set({ loading: true, cardId, streaming: false, streamingText: '', toolEvents: [] });
    try {
      const activeThreadId = get().activeThreadId;
      const messages = await window.electronAPI.cardAgentGetMessages(cardId, activeThreadId ?? undefined);
      set({ messages, loading: false });

      // Load threads if we haven't yet
      if (get().threads.length === 0) {
        get().loadThreads(cardId);
      }
    } catch (error) {
      console.error('Failed to load card agent messages:', error);
      set({ loading: false });
    }
  },

  sendMessage: async (cardId: string, content: string) => {
    if (get().streaming) return;

    const tempId = `temp-${Date.now()}`;
    const tempUserMsg: CardAgentMessage = {
      id: tempId,
      cardId,
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
    const cleanupChunk = window.electronAPI.onCardAgentChunk((data) => {
      if (data.cardId === cardId) {
        set({ streamingText: get().streamingText + data.chunk });
      }
    });

    const cleanupToolEvent = window.electronAPI.onCardAgentToolEvent((data) => {
      if (data.cardId === cardId) {
        set({
          toolEvents: [
            ...get().toolEvents,
            {
              toolName: data.toolName,
              type: data.type,
              args: data.args,
              result: data.result,
            },
          ],
        });
      }
    });

    try {
      // 90s safety timeout — prevents the UI from being stuck forever if the API hangs
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Agent request timed out. Try again.')), 90_000),
      );
      const result = await Promise.race([
        window.electronAPI.cardAgentSendMessage(cardId, content, get().activeThreadId ?? undefined),
        timeout,
      ]);

      if (result) {
        // If this was a new thread (activeThreadId was null), capture the returned threadId
        if (result.threadId && get().activeThreadId === null) {
          set({ activeThreadId: result.threadId });
          // Refresh thread list to include the newly created thread
          get().loadThreads(cardId);
        }

        // Reload messages to get server-assigned IDs for both messages
        const activeThreadId = get().activeThreadId;
        const serverMessages = await window.electronAPI.cardAgentGetMessages(cardId, activeThreadId ?? undefined);
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
          messages: get().messages.filter((m) => m.id !== tempId),
          streaming: false,
          streamingText: '',
          toolEvents: [],
        });
      }
    } catch (error) {
      console.error('Card agent sendMessage error:', error);
      const msg = error instanceof Error ? error.message : 'Failed to send message';
      toast(msg, 'error');
      // Remove optimistic message on error
      set({
        messages: get().messages.filter((m) => m.id !== tempId),
        streaming: false,
        streamingText: '',
        toolEvents: [],
      });
    } finally {
      cleanupChunk();
      cleanupToolEvent();
    }
  },

  clearMessages: async (cardId: string) => {
    await window.electronAPI.cardAgentClearMessages(cardId);
    set({ messages: [], messageCount: 0 });
  },

  abort: async (cardId: string) => {
    try {
      await window.electronAPI.cardAgentAbort(cardId);
    } catch {
      // Abort is best-effort
    }
    // Always reset streaming state so the UI is never stuck
    set({ streaming: false, streamingText: '', toolEvents: [] });
  },

  loadMessageCount: async (cardId: string) => {
    const count = await window.electronAPI.cardAgentGetMessageCount(cardId);
    set({ messageCount: count });
  },

  reset: () => {
    set({ ...initialState });
  },
}));
