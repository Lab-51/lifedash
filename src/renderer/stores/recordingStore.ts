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
import {
  startInactivityDetector,
  stopInactivityDetector,
  keepRecording as keepRecordingDetector,
} from '../services/inactivityDetectorService';
import { useGamificationStore } from './gamificationStore';
import { useMeetingStore } from './meetingStore';
import { toast } from '../hooks/useToast';
import type { RecordingState, MeetingTemplateType, TranscriptionProgress, TranscriptSegment } from '../../shared/types';
import {
  SETTING_AUTO_STOP_ENABLED,
  SETTING_AUTO_STOP_MINUTES,
  INACTIVITY_COUNTDOWN_SECONDS,
  clampAutoStopMinutes,
} from '../../shared/types/recording';

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
  /** Live transcript segments accumulated for the active recording (app-wide, not tied to any single view). */
  liveSegments: TranscriptSegment[];
  /** When true, the full-screen LiveModeOverlay is collapsed to the recording pill. Reset to false on each new recording. */
  liveModeMinimized: boolean;
  /**
   * Inactivity auto-stop guard state (GUARD.1). 'countdown' means sustained
   * silence hit the threshold and the auto-stop countdown is running; 'idle'
   * otherwise. Task 2 renders the warning banner purely from this + inactivitySecondsLeft.
   */
  inactivityState: 'idle' | 'countdown';
  /** Seconds remaining in the auto-stop countdown (0 when not counting down). */
  inactivitySecondsLeft: number;

  // Actions
  setIncludeMic: (value: boolean) => void;
  setPrepBriefing: (text: string | null) => void;
  /** Collapse Live Mode to the recording pill (deliberate escape hatch — never stops recording). */
  minimizeLiveMode: () => void;
  /** Return to the full-screen Live Mode overlay from the recording pill. */
  restoreLiveMode: () => void;
  startRecording: (
    title: string,
    projectId?: string,
    template?: MeetingTemplateType,
    transcriptionLanguage?: string,
  ) => Promise<void>;
  stopRecording: () => Promise<void>;
  cancelRecording: () => Promise<void>;
  /** User pressed "Keep recording": cancel the inactivity countdown and resume monitoring. */
  keepRecording: () => void;
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
  liveSegments: [],
  liveModeMinimized: false,
  inactivityState: 'idle',
  inactivitySecondsLeft: 0,

  setIncludeMic: (value: boolean) => set({ includeMic: value }),
  setPrepBriefing: (text: string | null) => set({ prepBriefing: text }),
  minimizeLiveMode: () => set({ liveModeMinimized: true }),
  restoreLiveMode: () => set({ liveModeMinimized: false }),

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

      // Step 6: Start the inactivity auto-stop guard when enabled (default ON).
      // Renderer-side because audio level is renderer-side; the store callbacks
      // only mutate the inactivity slice + stop via the normal path — no UI here.
      try {
        const rawEnabled = await window.electronAPI.getSetting(SETTING_AUTO_STOP_ENABLED);
        // Unset/null → default true, mirroring meetings:autoPushEnabled.
        if (rawEnabled !== 'false') {
          const rawMinutes = await window.electronAPI.getSetting(SETTING_AUTO_STOP_MINUTES);
          const minutes = clampAutoStopMinutes(parseInt(rawMinutes ?? '', 10));
          startInactivityDetector({
            thresholdMinutes: minutes,
            onWarn: () => set({ inactivityState: 'countdown', inactivitySecondsLeft: INACTIVITY_COUNTDOWN_SECONDS }),
            onCountdownTick: (secondsLeft) => set({ inactivitySecondsLeft: secondsLeft }),
            onAutoStop: () => {
              set({ inactivityState: 'idle', inactivitySecondsLeft: 0 });
              void get().stopRecording();
            },
            onActivityResume: () => set({ inactivityState: 'idle', inactivitySecondsLeft: 0 }),
          });
        }
      } catch {
        // Settings unavailable — skip the inactivity guard (non-fatal).
      }

      set({
        isRecording: true,
        meetingId: meeting.id,
        elapsed: 0,
        starting: false,
        prepBriefing: null,
        // Auto-enter Live Mode: a new recording always starts as the full-screen takeover.
        liveModeMinimized: false,
        inactivityState: 'idle',
        inactivitySecondsLeft: 0,
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
    // Tear down the inactivity guard first so no stray countdown/poll fires
    // during processing.
    stopInactivityDetector();
    set({ isRecording: false, isProcessing: true, inactivityState: 'idle', inactivitySecondsLeft: 0 });

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
        liveSegments: [],
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
    stopInactivityDetector();
    set({
      isRecording: false,
      isProcessing: false,
      processingProgress: null,
      inactivityState: 'idle',
      inactivitySecondsLeft: 0,
    });
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
    set({ meetingId: null, elapsed: 0, lastTranscript: '', liveSegments: [] });
  },

  keepRecording: () => {
    keepRecordingDetector();
    set({ inactivityState: 'idle', inactivitySecondsLeft: 0 });
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

    // Listen for live transcript segments (app-wide — single subscription for the
    // whole app, regardless of which view is active). Accumulates into liveSegments
    // for the global Live Mode overlay (LiveTranscriptFeed), and forwards to
    // meetingStore so an open session page keeps showing segments live
    // (preserves prior behavior that used to live in MeetingsModern).
    const cleanupTranscriptSegment = window.electronAPI.onTranscriptSegment((segment) => {
      set((state) => ({ liveSegments: [...state.liveSegments, segment] }));
      useMeetingStore.getState().addTranscriptSegment(segment);
    });

    return () => {
      cleanupState();
      cleanupForceStop();
      cleanupProgress();
      cleanupTranscription();
      cleanupTranscriptSegment();
    };
  },
}));
