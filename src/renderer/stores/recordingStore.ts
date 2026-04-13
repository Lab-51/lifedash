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
import { useGamificationStore } from './gamificationStore';
import { toast } from '../hooks/useToast';
import type { RecordingState, MeetingTemplateType, TranscriptionProgress } from '../../shared/types';

interface RecordingStore {
  // State
  isRecording: boolean;
  isProcessing: boolean;
  meetingId: string | null;
  completedMeetingId: string | null;
  elapsed: number;
  lastTranscript: string;
  error: string | null;
  starting: boolean;
  includeMic: boolean;
  prepBriefing: string | null;
  processingProgress: TranscriptionProgress | null;

  // Actions
  setIncludeMic: (value: boolean) => void;
  setPrepBriefing: (text: string | null) => void;
  startRecording: (
    title: string,
    projectId?: string,
    template?: MeetingTemplateType,
    transcriptionLanguage?: string,
  ) => Promise<void>;
  stopRecording: () => Promise<void>;
  cancelRecording: () => Promise<void>;
  clearCompletedMeetingId: () => void;
  initListener: () => () => void;
}

export const useRecordingStore = create<RecordingStore>((set, get) => ({
  isRecording: false,
  isProcessing: false,
  meetingId: null,
  completedMeetingId: null,
  elapsed: 0,
  lastTranscript: '',
  error: null,
  starting: false,
  includeMic: true,
  prepBriefing: null,
  processingProgress: null,

  setIncludeMic: (value: boolean) => set({ includeMic: value }),
  setPrepBriefing: (text: string | null) => set({ prepBriefing: text }),

  startRecording: async (
    title: string,
    projectId?: string,
    template?: MeetingTemplateType,
    transcriptionLanguage?: string,
  ) => {
    set({ starting: true, error: null });
    try {
      // Step 1: Create meeting in DB
      const meeting = await window.electronAPI.createMeeting({
        title,
        projectId,
        template: template ?? 'none',
        prepBriefing: get().prepBriefing ?? undefined,
        transcriptionLanguage,
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

      // Step 5: Register interruption callback to surface audio issues via toast
      audioCaptureService.onAudioInterrupted((type, recovered) => {
        if (type === 'mic' && recovered === true) {
          toast('Microphone reconnected', 'success', undefined, 3000);
        } else if (type === 'mic' && recovered === false) {
          toast('Microphone disconnected — recording continues with system audio only', 'error', undefined, 5000);
        } else if (type === 'system' && recovered === false) {
          toast('System audio lost — restart recording to resume capture', 'error', undefined, 8000);
        }
      });

      // Notify main process that recording is active (close guard)
      window.electronAPI.recordingSetState(true);

      set({
        isRecording: true,
        meetingId: meeting.id,
        elapsed: 0,
        starting: false,
        prepBriefing: null,
      });
    } catch (error) {
      // Clean up if anything failed
      const meetingId = get().meetingId;
      if (meetingId) {
        try {
          await window.electronAPI.stopRecording();
        } catch {
          /* ignore */
        }
        try {
          await window.electronAPI.deleteMeeting(meetingId);
        } catch {
          /* ignore */
        }
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
    const meetingId = get().meetingId;
    set({ isRecording: false, isProcessing: true });

    // Notify main process that recording has stopped (close guard)
    window.electronAPI.recordingSetState(false);

    try {
      // Step 1: Clear interruption callback before stopping (prevent callbacks during cleanup)
      audioCaptureService.onAudioInterrupted(null);

      // Step 2: Stop audio capture in renderer
      await audioCaptureService.stopCapture();

      // Step 3: Tell main process to stop recording (saves WAV)
      const audioPath = await window.electronAPI.stopRecording();

      // Step 4: Update meeting with audioPath and completion
      if (meetingId) {
        await window.electronAPI.updateMeeting(meetingId, {
          endedAt: new Date().toISOString(),
          ...(audioPath ? { audioPath } : {}),
          status: 'completed',
        });
      }

      set({
        isProcessing: false,
        processingProgress: null,
        meetingId: null,
        completedMeetingId: meetingId,
        elapsed: 0,
        lastTranscript: '',
      });
      if (meetingId) {
        useGamificationStore.getState().awardXP('meeting_complete', meetingId);
        toast(
          'Meeting processed',
          'success',
          {
            label: 'View Results',
            onClick: () => {
              window.location.hash = '#/meetings';
            },
          },
          5000,
        );
      }
    } catch (error) {
      set({
        isProcessing: false,
        processingProgress: null,
        error: error instanceof Error ? error.message : 'Failed to stop recording',
      });
    }
  },

  cancelRecording: async () => {
    const meetingId = get().meetingId;
    set({ isRecording: false, isProcessing: false, processingProgress: null });
    window.electronAPI.recordingSetState(false);
    try {
      audioCaptureService.onAudioInterrupted(null);
      await audioCaptureService.stopCapture();
      await window.electronAPI.stopRecording();
      if (meetingId) {
        await window.electronAPI.deleteMeeting(meetingId);
      }
    } catch {
      /* best-effort cleanup */
    }
    set({ meetingId: null, elapsed: 0, lastTranscript: '' });
  },

  clearCompletedMeetingId: () => set({ completedMeetingId: null }),

  initListener: () => {
    const cleanupState = window.electronAPI.onRecordingState((state: RecordingState) => {
      set({
        isRecording: state.isRecording,
        meetingId: state.meetingId,
        elapsed: state.elapsed,
        lastTranscript: state.lastTranscript,
      });
    });

    // Listen for force-stop from main process (user confirmed close during recording)
    const cleanupForceStop = window.electronAPI.onRecordingForceStop(() => {
      if (get().isRecording) {
        get().stopRecording();
      }
    });

    // Listen for processing progress (transcription segments, saving audio, etc.)
    const cleanupProgress = window.electronAPI.onProcessingProgress((progress) => {
      set({ processingProgress: progress });
    });

    // Listen for transcription status changes (failures, fallbacks)
    const cleanupTranscription = window.electronAPI.onTranscriptionStatus((data) => {
      if (data.status === 'failed' || data.status === 'error') {
        toast(data.reason, 'error', undefined, 5000);
      } else if (data.status === 'fallback') {
        toast(data.reason, 'info', undefined, 4000);
      }
    });

    return () => {
      cleanupState();
      cleanupForceStop();
      cleanupProgress();
      cleanupTranscription();
    };
  },
}));
