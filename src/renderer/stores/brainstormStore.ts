// === FILE PURPOSE ===
// Zustand store for brainstorming state — sessions, messages, and streaming.
// Handles real-time streaming accumulator pattern for AI responses.
//
// === DEPENDENCIES ===
// zustand, shared types, window.electronAPI
//
// === LIMITATIONS ===
// - Streaming relies on onBrainstormChunk IPC event
// - Optimistic user message replaced after server round-trip

import { create } from 'zustand';
import type {
  BrainstormSession,
  BrainstormMessage,
  BrainstormSessionWithMessages,
  CreateBrainstormSessionInput,
  BrainstormSessionStatus,
  Idea,
} from '../../shared/types';

interface BrainstormStore {
  // Session state
  sessions: BrainstormSession[];
  activeSession: BrainstormSessionWithMessages | null;
  loadingSessions: boolean;
  loadingSession: boolean;
  error: string | null;

  // Streaming state
  streaming: boolean;
  streamingText: string;

  // Session actions
  loadSessions: () => Promise<void>;
  loadSession: (id: string) => Promise<void>;
  createSession: (data: CreateBrainstormSessionInput) => Promise<BrainstormSession>;
  updateSession: (id: string, data: { title?: string; status?: BrainstormSessionStatus }) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  clearActiveSession: () => void;

  // Chat actions
  sendMessage: (content: string) => Promise<void>;
  abortStream: () => Promise<void>;

  // Export actions
  exportToIdea: (messageId: string) => Promise<Idea>;
  exportToCard: (messageId: string) => Promise<void>;
}

export const useBrainstormStore = create<BrainstormStore>((set, get) => ({
  sessions: [],
  activeSession: null,
  loadingSessions: false,
  loadingSession: false,
  error: null,
  streaming: false,
  streamingText: '',

  loadSessions: async () => {
    set({ loadingSessions: true, error: null });
    try {
      const sessions = await window.electronAPI.getBrainstormSessions();
      set({ sessions, loadingSessions: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load sessions',
        loadingSessions: false,
      });
    }
  },

  loadSession: async (id: string) => {
    set({ loadingSession: true, error: null });
    try {
      const session = await window.electronAPI.getBrainstormSession(id);
      set({ activeSession: session, loadingSession: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load session',
        loadingSession: false,
      });
    }
  },

  createSession: async (data: CreateBrainstormSessionInput) => {
    const session = await window.electronAPI.createBrainstormSession(data);
    set({ sessions: [session, ...get().sessions] });
    return session;
  },

  updateSession: async (id: string, data) => {
    const updated = await window.electronAPI.updateBrainstormSession(id, data);
    set({
      sessions: get().sessions.map(s => (s.id === id ? updated : s)),
      activeSession: get().activeSession?.id === id
        ? { ...get().activeSession!, ...updated }
        : get().activeSession,
    });
  },

  deleteSession: async (id: string) => {
    await window.electronAPI.deleteBrainstormSession(id);
    set({
      sessions: get().sessions.filter(s => s.id !== id),
      activeSession: get().activeSession?.id === id ? null : get().activeSession,
    });
  },

  clearActiveSession: () => set({ activeSession: null }),

  sendMessage: async (content: string) => {
    const session = get().activeSession;
    if (!session || get().streaming) return;

    // Optimistically add user message
    const tempUserMsg: BrainstormMessage = {
      id: `temp-${Date.now()}`,
      sessionId: session.id,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };

    set({
      activeSession: {
        ...session,
        messages: [...session.messages, tempUserMsg],
      },
      streaming: true,
      streamingText: '',
      error: null,
    });

    // Subscribe to stream chunks
    const cleanup = window.electronAPI.onBrainstormChunk((data) => {
      if (data.sessionId === session.id) {
        set({ streamingText: get().streamingText + data.chunk });
      }
    });

    try {
      await window.electronAPI.sendBrainstormMessage(session.id, content);

      // Reload session to get server-assigned message IDs
      const updatedSession = await window.electronAPI.getBrainstormSession(session.id);
      set({
        activeSession: updatedSession,
        streaming: false,
        streamingText: '',
        sessions: get().sessions.map(s =>
          s.id === session.id ? { ...s, updatedAt: new Date().toISOString() } : s
        ),
      });
    } catch (error) {
      set({
        streaming: false,
        streamingText: '',
        error: error instanceof Error ? error.message : 'Failed to send message',
      });
    } finally {
      cleanup();
    }
  },

  abortStream: async () => {
    if (!get().streaming) return;
    try {
      await window.electronAPI.abortBrainstorm();
    } catch {
      // Abort is best-effort — stream may have already finished
    }
    set({ streaming: false, streamingText: '' });
  },

  exportToIdea: async (messageId: string) => {
    const session = get().activeSession;
    if (!session) throw new Error('No active session');
    return window.electronAPI.exportBrainstormToIdea(session.id, messageId);
  },

  exportToCard: async (messageId: string) => {
    const session = get().activeSession;
    if (!session) throw new Error('No active session');
    await window.electronAPI.exportBrainstormToCard(session.id, messageId);
  },
}));
