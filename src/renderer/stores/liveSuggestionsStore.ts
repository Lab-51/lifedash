// === FILE PURPOSE ===
// Zustand store for the in-meeting proactive-triage proposals feed (LIVE.2 Task 5).
// Consumes the `live-triage:suggestion` event (Task 1) and the accept/dismiss/list
// IPC surface (Task 2). Registered ONCE at app root via initListener() (mirrors
// recordingStore's own initListener pattern — see App.tsx) so it stays alive even
// while LiveModeOverlay/LiveProposalsFeed are unmounted (Live Mode minimized):
// RecordingIndicator's pending-count badge needs an accurate count regardless of
// whether the feed component itself is mounted.
//
// Lifecycle is driven reactively off recordingStore.meetingId (one-way dependency,
// no cycle — recordingStore does not know about this store): meetingId transitions
// to a value -> load existing suggestions for that meeting; transitions to null
// (stop/cancel) -> clear all state.
//
// === DEPENDENCIES ===
// zustand, recordingStore (read-only, meetingId transitions), window.electronAPI
// (preload bridge), shared LiveSuggestion type

import { create } from 'zustand';
import { useRecordingStore } from './recordingStore';
import type { LiveSuggestion } from '../../shared/types';

interface LiveSuggestionsStore {
  meetingId: string | null;
  suggestions: LiveSuggestion[];
  error: string | null;

  /** Optimistic accept with rollback on IPC failure. Returns the updated row (with acceptedCardId for action_items) or null if it was rolled back. */
  accept: (id: string) => Promise<LiveSuggestion | null>;
  /** Optimistic dismiss with rollback on IPC failure. */
  dismiss: (id: string) => Promise<void>;
  /** Reset all state (called on recording stop/cancel). */
  clear: () => void;
  /** Registers the live-triage:suggestion IPC listener + the recordingStore reaction. Returns a cleanup function. */
  initListener: () => () => void;
}

export const useLiveSuggestionsStore = create<LiveSuggestionsStore>((set, get) => {
  /** Load (replacing) the suggestions list for a newly-active meeting. */
  async function loadForMeeting(meetingId: string): Promise<void> {
    set({ meetingId, suggestions: [], error: null });
    try {
      const suggestions = await window.electronAPI.listLiveSuggestions(meetingId);
      // Guard against a race where meetingId changed again while this was in flight.
      if (get().meetingId === meetingId) set({ suggestions });
    } catch (error) {
      if (get().meetingId === meetingId) {
        set({ error: error instanceof Error ? error.message : 'Failed to load live suggestions' });
      }
    }
  }

  return {
    meetingId: null,
    suggestions: [],
    error: null,

    accept: async (id: string) => {
      const prevSuggestions = get().suggestions;
      const target = prevSuggestions.find((s) => s.id === id);
      if (!target || target.status !== 'proposed') return null;

      // Optimistic: mark accepted immediately — the meeting can't wait on a round-trip.
      set({
        suggestions: prevSuggestions.map((s) => (s.id === id ? { ...s, status: 'accepted' } : s)),
        error: null,
      });

      try {
        const updated = await window.electronAPI.acceptLiveSuggestion(id);
        // A null result means the row was already processed/claimed elsewhere — the
        // optimistic 'accepted' flip above already matches reality, so leave it.
        if (updated) set({ suggestions: get().suggestions.map((s) => (s.id === id ? updated : s)) });
        return updated;
      } catch (error) {
        // Rollback — restore the chip so the user can retry.
        set({
          suggestions: prevSuggestions,
          error: error instanceof Error ? error.message : 'Failed to accept suggestion',
        });
        return null;
      }
    },

    dismiss: async (id: string) => {
      const prevSuggestions = get().suggestions;
      const target = prevSuggestions.find((s) => s.id === id);
      if (!target || target.status !== 'proposed') return;

      set({
        suggestions: prevSuggestions.map((s) => (s.id === id ? { ...s, status: 'dismissed' } : s)),
        error: null,
      });

      try {
        const updated = await window.electronAPI.dismissLiveSuggestion(id);
        set({ suggestions: get().suggestions.map((s) => (s.id === id ? updated : s)) });
      } catch (error) {
        set({
          suggestions: prevSuggestions,
          error: error instanceof Error ? error.message : 'Failed to dismiss suggestion',
        });
      }
    },

    clear: () => set({ meetingId: null, suggestions: [], error: null }),

    initListener: () => {
      const cleanupSuggestion = window.electronAPI.onLiveTriageSuggestion((suggestion) => {
        const state = get();
        if (suggestion.meetingId !== state.meetingId) return; // stray event for a different/closed meeting
        if (state.suggestions.some((s) => s.id === suggestion.id)) return; // defensive de-dupe
        set({ suggestions: [...state.suggestions, suggestion] });
      });

      const cleanupRecording = useRecordingStore.subscribe((state, prevState) => {
        if (state.meetingId === prevState.meetingId) return;
        if (state.meetingId) {
          void loadForMeeting(state.meetingId);
        } else {
          get().clear();
        }
      });

      // Pick up an already-active recording (e.g. hot reload) instead of waiting
      // for the next meetingId transition.
      const activeMeetingId = useRecordingStore.getState().meetingId;
      if (activeMeetingId) void loadForMeeting(activeMeetingId);

      return () => {
        cleanupSuggestion();
        cleanupRecording();
      };
    },
  };
});

/** Pending (un-actioned) proposals, oldest first — the chips shown in LiveProposalsFeed. */
export const selectPendingProposals = (s: LiveSuggestionsStore): LiveSuggestion[] =>
  s.suggestions.filter((suggestion) => suggestion.status === 'proposed');

/** Count of pending proposals — drives the RecordingIndicator badge. */
export const selectPendingCount = (s: LiveSuggestionsStore): number => selectPendingProposals(s).length;
