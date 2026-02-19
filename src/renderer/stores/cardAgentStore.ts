// === FILE PURPOSE ===
// Zustand store for per-card AI agent conversations.
// Handles message loading, streaming with chunk/tool events, and abort.
// Event listeners are cleaned up in finally blocks to prevent memory leaks.

import { create } from 'zustand';
import type { CardAgentMessage, AgentAction } from '../../shared/types/card-agent';

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

  loadMessages: (cardId: string) => Promise<void>;
  sendMessage: (cardId: string, content: string) => Promise<void>;
  clearMessages: (cardId: string) => Promise<void>;
  abort: (cardId: string) => Promise<void>;
  loadMessageCount: (cardId: string) => Promise<void>;
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
};

export const useCardAgentStore = create<CardAgentStore>((set, get) => ({
  ...initialState,

  loadMessages: async (cardId: string) => {
    set({ loading: true, cardId });
    try {
      const messages = await window.electronAPI.cardAgentGetMessages(cardId);
      set({ messages, loading: false });
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
      const result = await window.electronAPI.cardAgentSendMessage(cardId, content);

      if (result) {
        // The result contains the assistantMessage; the user message was persisted server-side.
        // Reload messages to get server-assigned IDs for both messages.
        const serverMessages = await window.electronAPI.cardAgentGetMessages(cardId);
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
      console.error('Card agent sendMessage error:', error);
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

  clearMessages: async (cardId: string) => {
    await window.electronAPI.cardAgentClearMessages(cardId);
    set({ messages: [], messageCount: 0 });
  },

  abort: async (cardId: string) => {
    await window.electronAPI.cardAgentAbort(cardId);
  },

  loadMessageCount: async (cardId: string) => {
    const count = await window.electronAPI.cardAgentGetMessageCount(cardId);
    set({ messageCount: count });
  },

  reset: () => {
    set({ ...initialState });
  },
}));
