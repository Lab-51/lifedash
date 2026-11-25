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
  SETTING_MIC_PROCESSING,
  INACTIVITY_COUNTDOWN_SECONDS,
  clampAutoStopMinutes,
} from '../../shared/types/recording';

/** Meetings whose transcript-finished event already arrived (it can beat stopRecording's own return). */
const finishedEarly = new Set<string>();

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
  /**
   * The stopped meeting whose transcript is still finishing in the background
   * (main sends recording:transcript-finished when it is done). The screen is free
   * meanwhile; only a small indicator shows it.
   */
  finishingMeetingId: string | null;
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
    calendarEventId?: string,
    calendarSeriesId?: string,
    /** Display names as the user typed/prefilled them (BRIEF-QUAL.1). */
    participants?: string[],
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
  finishingMeetingId: null,
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
    calendarEventId?: string,
    calendarSeriesId?: string,
    participants?: string[],
  ) => {
    set({ starting: true, error: null });
    try {
      // Step 1: Create meeting in DB (calendar linkage threads through untouched when absent)
      const meeting = await window.electronAPI.createMeeting({
        title,
        projectId,
        template: template ?? 'none',
        prepBriefing: get().prepBriefing ?? undefined,
        transcriptionLanguage,
        calendarEventId,
        calendarSeriesId,
        participants,
        // Captured renderer-side on purpose (BRIEF-EVID.1): it is the user's
        // machine at the moment they pressed record, read-only context for a
        // spoken relative date — never used to resolve or convert anything.
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });

      // Step 2: Tell main process to start recording
      await window.electronAPI.startRecording(meeting.id);

      // Step 3: Load selected mic device and its voice processing from settings (if configured)
      let micDeviceId: string | undefined;
      let micProcessing = true;
      try {
        const savedMicId = await window.electronAPI.getSetting('audio:inputDeviceId');
        if (savedMicId) micDeviceId = savedMicId;
        micProcessing = (await window.electronAPI.getSetting(SETTING_MIC_PROCESSING)) !== 'off';
      } catch {
        // Settings unavailable — use default device, processing on
      }

      // Step 4: Start audio capture in renderer (with optional mic mixing)
      await audioCaptureService.startCapture(get().includeMic, micDeviceId, micProcessing);

      // Step 5: Register interruption callback to surface audio issues via toast.
      // A lost track is re-acquired by the capture service once its device is back.
      audioCaptureService.onAudioInterrupted((type, recovered) => {
        if (type === 'mic' && recovered === true) {
          toast('Microphone reconnected', 'success', undefined, 3000);
        } else if (type === 'mic' && recovered === false) {
          toast('Microphone disconnected — recording continues with system audio only', 'error', undefined, 5000);
        } else if (type === 'system' && recovered === true) {
          toast('System audio reconnected', 'success', undefined, 3000);
        } else if (type === 'system' && recovered === false) {
          toast('System audio lost — it will reconnect automatically', 'error', undefined, 8000);
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

      // Step 3: Tell main process to stop recording. Resolves once the WAV is saved;
      // the transcript finishes in the background and MAIN marks the meeting
      // completed (which starts the brief) — see onTranscriptFinished below.
      const audioPath = await window.electronAPI.stopRecording();

      // Step 4: Record when the meeting ended and where its audio is. Not the status.
      if (meetingId) {
        await window.electronAPI.updateMeeting(meetingId, {
          endedAt: new Date().toISOString(),
          ...(audioPath ? { audioPath } : {}),
        });
      }

      set({
        isProcessing: false,
        meetingId: null,
        completedMeetingId: meetingId,
        // The finished event can beat this line on a short drain; never resurrect it.
        finishingMeetingId: meetingId && !finishedEarly.has(meetingId) ? meetingId : null,
        elapsed: 0,
        lastTranscript: '',
        liveSegments: [],
      });
      if (meetingId) {
        useGamificationStore.getState().awardXP('meeting_complete', meetingId);
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
      // Discard: queued windows are dropped and nothing writes to the meeting after
      // this resolves, so it can be deleted.
      await window.electronAPI.stopRecording({ discard: true });
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
      // Segments of a stopped meeting keep arriving while it finishes; they belong
      // on its session page, not in the next recording's live feed.
      if (segment.meetingId === get().meetingId) {
        set((state) => ({ liveSegments: [...state.liveSegments, segment] }));
      }
      useMeetingStore.getState().addTranscriptSegment(segment);
    });

    const cleanupTranscriptFinished = window.electronAPI.onTranscriptFinished(({ meetingId }) => {
      finishedEarly.add(meetingId);
      set((state) => ({
        finishingMeetingId: state.finishingMeetingId === meetingId ? null : state.finishingMeetingId,
        processingProgress: state.isRecording ? state.processingProgress : null,
      }));
      // The open session page picks up 'completed' (its brief starts from it).
      if (useMeetingStore.getState().selectedMeeting?.id === meetingId) {
        void useMeetingStore.getState().loadMeeting(meetingId);
      }
      void useMeetingStore.getState().loadMeetings();
      toast(
        'Transcript ready',
        'success',
        {
          label: 'View Results',
          onClick: () => {
            window.location.hash = `#/session/${meetingId}`;
          },
        },
        5000,
      );
    });

    return () => {
      cleanupState();
      cleanupForceStop();
      cleanupProgress();
      cleanupTranscription();
      cleanupTranscriptSegment();
      cleanupTranscriptFinished();
    };
  },
}));
