// === FILE PURPOSE ===
// Zustand store for recording state management.
// Coordinates audio capture (renderer) with recording backend (main).
//
// === DEPENDENCIES ===
// zustand, audioCaptureService, shared types, window.electronAPI (preload bridge)
//
// === LIMITATIONS ===
// - Single recording at a time
// - Elapsed time updates depend on main process pushing RecordingState events

import { create } from 'zustand';
import * as audioCaptureService from '../services/audioCaptureService';
import type { RecordingState, MeetingTemplateType } from '../../shared/types';

interface RecordingStore {
  // State
  isRecording: boolean;
  meetingId: string | null;
  elapsed: number;
  lastTranscript: string;
  error: string | null;
  starting: boolean;
  includeMic: boolean;

  // Actions
  setIncludeMic: (value: boolean) => void;
  startRecording: (title: string, projectId?: string, template?: MeetingTemplateType) => Promise<void>;
  stopRecording: () => Promise<void>;
  initListener: () => () => void;
}

export const useRecordingStore = create<RecordingStore>((set, get) => ({
  isRecording: false,
  meetingId: null,
  elapsed: 0,
  lastTranscript: '',
  error: null,
  starting: false,
  includeMic: true,

  setIncludeMic: (value: boolean) => set({ includeMic: value }),

  startRecording: async (title: string, projectId?: string, template?: MeetingTemplateType) => {
    set({ starting: true, error: null });
    try {
      // Step 1: Create meeting in DB
      const meeting = await window.electronAPI.createMeeting({
        title,
        projectId,
        template: template ?? 'none',
      });

      // Step 2: Tell main process to start recording
      await window.electronAPI.startRecording(meeting.id);

      // Step 3: Load selected mic device from settings (if configured)
      let micDeviceId: string | undefined;
      try {
        const savedMicId = await window.electronAPI.getSetting('audio:inputDeviceId');
        if (savedMicId) micDeviceId = savedMicId;
      } catch {
        // Settings unavailable — use default device
      }

      // Step 4: Start audio capture in renderer (with optional mic mixing)
      await audioCaptureService.startCapture(get().includeMic, micDeviceId);

      set({
        isRecording: true,
        meetingId: meeting.id,
        elapsed: 0,
        starting: false,
      });
    } catch (error) {
      // Clean up if anything failed
      const meetingId = get().meetingId;
      if (meetingId) {
        try { await window.electronAPI.stopRecording(); } catch { /* ignore */ }
        try { await window.electronAPI.deleteMeeting(meetingId); } catch { /* ignore */ }
      }
      set({
        isRecording: false,
        meetingId: null,
        starting: false,
        error: error instanceof Error ? error.message : 'Failed to start recording',
      });
    }
  },

  stopRecording: async () => {
    try {
      // Step 1: Stop audio capture in renderer
      await audioCaptureService.stopCapture();

      // Step 2: Tell main process to stop recording (saves WAV)
      const audioPath = await window.electronAPI.stopRecording();

      // Step 3: Update meeting with audioPath and completion
      const meetingId = get().meetingId;
      if (meetingId) {
        await window.electronAPI.updateMeeting(meetingId, {
          endedAt: new Date().toISOString(),
          audioPath,
          status: 'completed',
        });
      }

      set({
        isRecording: false,
        meetingId: null,
        elapsed: 0,
        lastTranscript: '',
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to stop recording',
      });
    }
  },

  initListener: () => {
    const cleanup = window.electronAPI.onRecordingState((state: RecordingState) => {
      set({
        isRecording: state.isRecording,
        meetingId: state.meetingId,
        elapsed: state.elapsed,
        lastTranscript: state.lastTranscript,
      });
    });
    return cleanup;
  },
}));
