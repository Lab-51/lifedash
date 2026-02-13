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
} from '../../shared/types';

interface MeetingStore {
  // State
  meetings: Meeting[];
  selectedMeeting: MeetingWithTranscript | null;
  loading: boolean;
  error: string | null;

  // Actions
  loadMeetings: () => Promise<void>;
  loadMeeting: (id: string) => Promise<void>;
  updateMeeting: (id: string, data: UpdateMeetingInput) => Promise<void>;
  deleteMeeting: (id: string) => Promise<void>;
  clearSelectedMeeting: () => void;
  addTranscriptSegment: (segment: TranscriptSegment) => void;
}

export const useMeetingStore = create<MeetingStore>((set, get) => ({
  meetings: [],
  selectedMeeting: null,
  loading: false,
  error: null,

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

  clearSelectedMeeting: () => set({ selectedMeeting: null }),

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
}));
