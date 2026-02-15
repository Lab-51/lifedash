// === FILE PURPOSE ===
// Zustand store for meeting state management.
// Manages the meeting list, selected meeting detail, and CRUD operations.
//
// === DEPENDENCIES ===
// zustand, shared types, window.electronAPI

import { create } from 'zustand';
import type {
  Meeting,
  MeetingWithTranscript,
  TranscriptSegment,
  UpdateMeetingInput,
  ActionItemStatus,
  MeetingAnalytics,
} from '../../shared/types';

interface MeetingStore {
  // State
  meetings: Meeting[];
  selectedMeeting: MeetingWithTranscript | null;
  loading: boolean;
  error: string | null;
  actionItemCounts: Record<string, number>;

  // Intelligence generation state
  generatingBrief: boolean;
  generatingActions: boolean;

  // Diarization state
  diarizing: boolean;
  diarizationError: string | null;
  // Analytics state
  analytics: MeetingAnalytics | null;
  analyticsLoading: boolean;

  // Actions
  loadMeetings: () => Promise<void>;
  loadMeeting: (id: string) => Promise<void>;
  loadActionItemCounts: () => Promise<void>;
  updateMeeting: (id: string, data: UpdateMeetingInput) => Promise<void>;
  deleteMeeting: (id: string) => Promise<void>;
  clearSelectedMeeting: () => void;
  addTranscriptSegment: (segment: TranscriptSegment) => void;

  // Intelligence actions
  generateBrief: (meetingId: string) => Promise<void>;
  generateActionItems: (meetingId: string) => Promise<void>;
  updateActionItemStatus: (id: string, status: ActionItemStatus) => Promise<void>;
  convertActionToCard: (actionItemId: string, columnId: string) => Promise<string>;

  // Diarization + Analytics actions
  diarizeMeeting: (meetingId: string) => Promise<void>;
  loadAnalytics: (meetingId: string) => Promise<void>;
  clearAnalytics: () => void;
}

export const useMeetingStore = create<MeetingStore>((set, get) => ({
  meetings: [],
  selectedMeeting: null,
  loading: false,
  error: null,
  actionItemCounts: {},
  generatingBrief: false,
  generatingActions: false,
  diarizing: false,
  diarizationError: null,
  analytics: null,
  analyticsLoading: false,

  loadMeetings: async () => {
    set({ loading: true, error: null });
    try {
      const meetings = await window.electronAPI.getMeetings();
      set({ meetings, loading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load meetings',
        loading: false,
      });
    }
  },

  loadMeeting: async (id: string) => {
    try {
      const meeting = await window.electronAPI.getMeeting(id);
      set({ selectedMeeting: meeting });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load meeting',
      });
    }
  },

  loadActionItemCounts: async () => {
    const meetingIds = get().meetings.map(m => m.id);
    if (meetingIds.length === 0) return;
    try {
      const counts = await window.electronAPI.getActionItemCounts(meetingIds);
      set({ actionItemCounts: counts });
    } catch {
      // Non-critical — silently ignore
    }
  },

  updateMeeting: async (id, data) => {
    const updated = await window.electronAPI.updateMeeting(id, data);
    set({
      meetings: get().meetings.map(m => (m.id === id ? updated : m)),
      selectedMeeting: get().selectedMeeting?.id === id
        ? { ...get().selectedMeeting!, ...updated }
        : get().selectedMeeting,
    });
  },

  deleteMeeting: async (id) => {
    await window.electronAPI.deleteMeeting(id);
    set({
      meetings: get().meetings.filter(m => m.id !== id),
      selectedMeeting: get().selectedMeeting?.id === id ? null : get().selectedMeeting,
    });
  },

  clearSelectedMeeting: () => set({ selectedMeeting: null, analytics: null, analyticsLoading: false, diarizing: false, diarizationError: null }),

  // Append a transcript segment to the selected meeting (for real-time updates)
  addTranscriptSegment: (segment: TranscriptSegment) => {
    const selected = get().selectedMeeting;
    if (selected && selected.id === segment.meetingId) {
      set({
        selectedMeeting: {
          ...selected,
          segments: [...selected.segments, segment],
        },
      });
    }
  },

  // Generate AI brief for a meeting
  generateBrief: async (meetingId) => {
    set({ generatingBrief: true, error: null });
    try {
      const brief = await window.electronAPI.generateBrief(meetingId);
      const selected = get().selectedMeeting;
      if (selected && selected.id === meetingId) {
        set({ selectedMeeting: { ...selected, brief } });
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to generate brief' });
    } finally {
      set({ generatingBrief: false });
    }
  },

  // Generate AI action items from transcript
  generateActionItems: async (meetingId) => {
    set({ generatingActions: true, error: null });
    try {
      const actionItems = await window.electronAPI.generateActionItems(meetingId);
      const selected = get().selectedMeeting;
      if (selected && selected.id === meetingId) {
        set({ selectedMeeting: { ...selected, actionItems } });
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to generate action items' });
    } finally {
      set({ generatingActions: false });
    }
  },

  // Update action item status (approve/dismiss)
  updateActionItemStatus: async (id, status) => {
    try {
      const updated = await window.electronAPI.updateActionItemStatus(id, status);
      const selected = get().selectedMeeting;
      if (selected) {
        set({
          selectedMeeting: {
            ...selected,
            actionItems: selected.actionItems.map(a => (a.id === id ? updated : a)),
          },
        });
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to update action item' });
    }
  },

  // Convert action item to board card
  convertActionToCard: async (actionItemId, columnId) => {
    try {
      const result = await window.electronAPI.convertActionToCard(actionItemId, columnId);
      const selected = get().selectedMeeting;
      if (selected) {
        set({
          selectedMeeting: {
            ...selected,
            actionItems: selected.actionItems.map(a =>
              a.id === actionItemId ? result.actionItem : a,
            ),
          },
        });
      }
      return result.cardId;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to convert action to card' });
      throw error;
    }
  },

  // Trigger speaker diarization
  diarizeMeeting: async (meetingId) => {
    set({ diarizing: true, diarizationError: null });
    try {
      const result = await window.electronAPI.diarizeMeeting(meetingId);
      if (result.success) {
        // Reload the meeting to get updated segments with speaker labels
        const meeting = await window.electronAPI.getMeeting(meetingId);
        set({ selectedMeeting: meeting, diarizing: false });
        // Also refresh analytics
        get().loadAnalytics(meetingId);
      } else {
        set({ diarizing: false, diarizationError: result.error ?? 'Diarization failed' });
      }
    } catch (err) {
      set({ diarizing: false, diarizationError: err instanceof Error ? err.message : 'Diarization failed' });
    }
  },

  // Load analytics for a meeting
  loadAnalytics: async (meetingId) => {
    set({ analyticsLoading: true });
    try {
      const analytics = await window.electronAPI.getMeetingAnalytics(meetingId);
      set({ analytics, analyticsLoading: false });
    } catch {
      set({ analyticsLoading: false });
    }
  },

  // Clear analytics + diarization state
  clearAnalytics: () => set({ analytics: null, analyticsLoading: false, diarizing: false, diarizationError: null }),
}));
