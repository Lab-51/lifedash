// Store-level tests for the inactivity auto-stop wiring in recordingStore (GUARD.1).
// The detector service is mocked so these assert the store's decision logic:
// whether/how it starts the detector from settings, and that stop/keepRecording
// tear it down and reset the inactivity slice. Timing behaviour of the detector
// itself lives in inactivityDetectorService.test.ts.

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../services/audioCaptureService', () => ({
  startCapture: vi.fn().mockResolvedValue(undefined),
  stopCapture: vi.fn().mockResolvedValue(undefined),
  onAudioInterrupted: vi.fn(),
  getAudioLevel: vi.fn(() => 0),
}));

vi.mock('../../services/inactivityDetectorService', () => ({
  startInactivityDetector: vi.fn(),
  stopInactivityDetector: vi.fn(),
  keepRecording: vi.fn(),
}));

vi.mock('../gamificationStore', () => ({
  useGamificationStore: { getState: () => ({ awardXP: vi.fn() }) },
}));

const meetingStoreState = vi.hoisted(() => ({
  selectedMeeting: null as { id: string } | null,
  addTranscriptSegment: vi.fn(),
  loadMeeting: vi.fn().mockResolvedValue(undefined),
  loadMeetings: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../meetingStore', () => ({
  useMeetingStore: { getState: () => meetingStoreState },
}));

/** The callbacks initListener registered, by channel name. */
const listeners = vi.hoisted(() => ({}) as Record<string, (data?: unknown) => void>);
const listen = (name: string) =>
  vi.fn((cb: (data?: unknown) => void) => {
    listeners[name] = cb;
    return () => undefined;
  });

vi.mock('../../hooks/useToast', () => ({
  toast: vi.fn(),
}));

let settings: Record<string, string> = {};

vi.stubGlobal('electronAPI', {
  createMeeting: vi.fn().mockResolvedValue({ id: 'meeting-1' }),
  startRecording: vi.fn().mockResolvedValue(undefined),
  stopRecording: vi.fn().mockResolvedValue('/path/audio.wav'),
  updateMeeting: vi.fn().mockResolvedValue(undefined),
  deleteMeeting: vi.fn().mockResolvedValue(undefined),
  recordingSetState: vi.fn(),
  getSetting: vi.fn((key: string) => Promise.resolve(settings[key] ?? null)),
  setSetting: vi.fn().mockResolvedValue(undefined),
  onRecordingState: listen('recordingState'),
  onRecordingForceStop: listen('forceStop'),
  onProcessingProgress: listen('progress'),
  onTranscriptionStatus: listen('transcriptionStatus'),
  onTranscriptSegment: listen('segment'),
  onTranscriptFinished: listen('finished'),
});
vi.stubGlobal('window', globalThis);

import {
  startInactivityDetector,
  stopInactivityDetector,
  keepRecording as keepRecordingDetector,
} from '../../services/inactivityDetectorService';
import { onAudioInterrupted, startCapture } from '../../services/audioCaptureService';
import { toast } from '../../hooks/useToast';

const { useRecordingStore } = await import('../recordingStore');

const startDetector = vi.mocked(startInactivityDetector);
const stopDetector = vi.mocked(stopInactivityDetector);
const keepDetector = vi.mocked(keepRecordingDetector);

describe('recordingStore — inactivity auto-stop wiring', () => {
  beforeEach(() => {
    settings = {};
    vi.clearAllMocks();
    useRecordingStore.setState({
      isRecording: false,
      isProcessing: false,
      meetingId: null,
      inactivityState: 'idle',
      inactivitySecondsLeft: 0,
    });
  });

  it('does NOT start the detector when recording:autoStopEnabled is "false"', async () => {
    settings['recording:autoStopEnabled'] = 'false';
    await useRecordingStore.getState().startRecording('Test');
    expect(startDetector).not.toHaveBeenCalled();
  });

  it('starts the detector with the default 10 minutes when settings are unset (default ON)', async () => {
    await useRecordingStore.getState().startRecording('Test');
    expect(startDetector).toHaveBeenCalledTimes(1);
    expect(startDetector).toHaveBeenCalledWith(expect.objectContaining({ thresholdMinutes: 10 }));
  });

  it('uses the configured minutes when recording:autoStopMinutes is a valid value', async () => {
    settings['recording:autoStopMinutes'] = '25';
    await useRecordingStore.getState().startRecording('Test');
    expect(startDetector).toHaveBeenCalledWith(expect.objectContaining({ thresholdMinutes: 25 }));
  });

  it('clamps an out-of-range minutes setting into the sane range', async () => {
    settings['recording:autoStopMinutes'] = '500';
    await useRecordingStore.getState().startRecording('Test');
    expect(startDetector).toHaveBeenCalledWith(expect.objectContaining({ thresholdMinutes: 120 }));
  });

  it('stopRecording tears down the detector and resets the inactivity slice', async () => {
    useRecordingStore.setState({ meetingId: 'meeting-1', inactivityState: 'countdown', inactivitySecondsLeft: 42 });
    await useRecordingStore.getState().stopRecording();
    expect(stopDetector).toHaveBeenCalled();
    expect(useRecordingStore.getState().inactivityState).toBe('idle');
    expect(useRecordingStore.getState().inactivitySecondsLeft).toBe(0);
  });

  it('cancelRecording tears down the detector and resets the inactivity slice', async () => {
    useRecordingStore.setState({ meetingId: 'meeting-1', inactivityState: 'countdown', inactivitySecondsLeft: 42 });
    await useRecordingStore.getState().cancelRecording();
    expect(stopDetector).toHaveBeenCalled();
    expect(useRecordingStore.getState().inactivityState).toBe('idle');
    expect(useRecordingStore.getState().inactivitySecondsLeft).toBe(0);
  });

  it('keepRecording action calls the detector and resets the inactivity slice', () => {
    useRecordingStore.setState({ inactivityState: 'countdown', inactivitySecondsLeft: 42 });
    useRecordingStore.getState().keepRecording();
    expect(keepDetector).toHaveBeenCalledTimes(1);
    expect(useRecordingStore.getState().inactivityState).toBe('idle');
    expect(useRecordingStore.getState().inactivitySecondsLeft).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// POST-FLOW.1 Task 2: `completedMeetingId` is the ONLY trigger for the
// stop → session-page navigation (useCompletedSessionNav), so which paths set it
// decides which paths navigate.
// ---------------------------------------------------------------------------
describe('recordingStore — completedMeetingId is set by stop and by nothing else', () => {
  beforeEach(() => {
    settings = {};
    vi.clearAllMocks();
    useRecordingStore.setState({
      isRecording: false,
      isProcessing: false,
      meetingId: null,
      completedMeetingId: null,
    });
  });

  it('stopRecording sets it to the finished meeting — this is what navigates', async () => {
    useRecordingStore.setState({ meetingId: 'meeting-1' });
    await useRecordingStore.getState().stopRecording();
    expect(useRecordingStore.getState().completedMeetingId).toBe('meeting-1');
  });

  it('cancelRecording NEVER sets it — a discarded recording must not navigate', async () => {
    useRecordingStore.setState({ meetingId: 'meeting-1' });
    await useRecordingStore.getState().cancelRecording();
    expect(useRecordingStore.getState().completedMeetingId).toBeNull();
  });

  it('clearCompletedMeetingId resets it, so the navigation can only fire once', () => {
    useRecordingStore.setState({ completedMeetingId: 'meeting-1' });
    useRecordingStore.getState().clearCompletedMeetingId();
    expect(useRecordingStore.getState().completedMeetingId).toBeNull();
  });
});

// 2026-11-25: Stop frees the screen once the audio is saved; main finishes the
// transcript in the background and owns the 'completed' flip.
describe('recordingStore — the transcript finishes in the background', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    meetingStoreState.selectedMeeting = null;
    useRecordingStore.setState({
      isRecording: false,
      isProcessing: false,
      meetingId: null,
      completedMeetingId: null,
      finishingMeetingId: null,
      processingProgress: null,
      liveSegments: [],
    });
    useRecordingStore.getState().initListener();
  });

  it('stop frees the screen, records the end, and leaves the status to main', async () => {
    useRecordingStore.setState({ isRecording: true, meetingId: 'meeting-1' });

    await useRecordingStore.getState().stopRecording();

    const state = useRecordingStore.getState();
    expect(state.isProcessing).toBe(false);
    expect(state.finishingMeetingId).toBe('meeting-1');
    const [, update] = vi.mocked(window.electronAPI.updateMeeting).mock.calls[0];
    expect(update).toMatchObject({ audioPath: '/path/audio.wav', endedAt: expect.any(String) });
    expect(update).not.toHaveProperty('status');
  });

  it('cancel discards: the stop is told to drop the queue before the meeting is deleted', async () => {
    useRecordingStore.setState({ isRecording: true, meetingId: 'meeting-1' });

    await useRecordingStore.getState().cancelRecording();

    expect(window.electronAPI.stopRecording).toHaveBeenCalledWith({ discard: true });
    expect(vi.mocked(window.electronAPI.stopRecording).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(window.electronAPI.deleteMeeting).mock.invocationCallOrder[0],
    );
  });

  it('the finished event clears the indicator, refreshes the open session and says so', () => {
    useRecordingStore.setState({ finishingMeetingId: 'meeting-1' });
    meetingStoreState.selectedMeeting = { id: 'meeting-1' };

    listeners.finished({ meetingId: 'meeting-1' });

    expect(useRecordingStore.getState().finishingMeetingId).toBeNull();
    expect(meetingStoreState.loadMeeting).toHaveBeenCalledWith('meeting-1');
    expect(toast).toHaveBeenCalledWith('Transcript ready', 'success', expect.anything(), 5000);
  });

  it('a finished event that beats the stop return never leaves a stale indicator', async () => {
    useRecordingStore.setState({ isRecording: true, meetingId: 'meeting-early' });
    vi.mocked(window.electronAPI.stopRecording).mockImplementationOnce(async () => {
      listeners.finished({ meetingId: 'meeting-early' });
      return '/path/audio.wav';
    });

    await useRecordingStore.getState().stopRecording();

    expect(useRecordingStore.getState().finishingMeetingId).toBeNull();
  });

  it('segments of a stopped meeting go to its session page, not the next live feed', () => {
    useRecordingStore.setState({ isRecording: true, meetingId: 'meeting-new' });
    const old = { id: 's1', meetingId: 'meeting-old', content: 'tail', startTime: 0, endTime: 1 };
    const live = { id: 's2', meetingId: 'meeting-new', content: 'hello', startTime: 0, endTime: 1 };

    listeners.segment(old);
    listeners.segment(live);

    expect(useRecordingStore.getState().liveSegments).toEqual([live]);
    expect(meetingStoreState.addTranscriptSegment).toHaveBeenCalledTimes(2);
  });
});

// AUDIO-DEVICE.1: audio:micProcessing reaches the capture start; unset or unreadable means on.
describe('recordingStore — mic voice processing setting', () => {
  beforeEach(() => {
    settings = {};
    vi.clearAllMocks();
  });

  it('passes processing off with the chosen mic when the setting is "off", and on when it is unset', async () => {
    settings = { 'audio:inputDeviceId': 'headset-mic', 'audio:micProcessing': 'off' };
    await useRecordingStore.getState().startRecording('Test');
    expect(startCapture).toHaveBeenLastCalledWith(true, 'headset-mic', false);

    settings = {};
    await useRecordingStore.getState().startRecording('Test');
    expect(startCapture).toHaveBeenLastCalledWith(true, undefined, true);
  });

  it('keeps processing on when the setting cannot be read', async () => {
    vi.mocked(window.electronAPI.getSetting).mockImplementation((key: string) =>
      key === 'audio:micProcessing' ? Promise.reject(new Error('db down')) : Promise.resolve(settings[key] ?? null),
    );
    try {
      await useRecordingStore.getState().startRecording('Test');
      expect(startCapture).toHaveBeenLastCalledWith(true, undefined, true);
    } finally {
      vi.mocked(window.electronAPI.getSetting).mockImplementation((key: string) =>
        Promise.resolve(settings[key] ?? null),
      );
    }
  });
});

// AUDIO-DEVICE.1 Task 3: the capture service re-acquires lost system audio by
// itself, so the lost toast no longer asks for a restart and recovery is announced.
describe('recordingStore — audio interruption toasts', () => {
  beforeEach(() => {
    settings = {};
    vi.clearAllMocks();
  });

  it('says lost system audio reconnects by itself, and confirms when it is back', async () => {
    await useRecordingStore.getState().startRecording('Test');
    const onInterrupted = vi.mocked(onAudioInterrupted).mock.calls[0][0]!;

    onInterrupted('system', false);
    expect(toast).toHaveBeenLastCalledWith(
      'System audio lost — it will reconnect automatically',
      'error',
      undefined,
      8000,
    );
    onInterrupted('system', true);
    expect(toast).toHaveBeenLastCalledWith('System audio reconnected', 'success', undefined, 3000);
  });
});
