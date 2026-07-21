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

vi.mock('../meetingStore', () => ({
  useMeetingStore: { getState: () => ({ addTranscriptSegment: vi.fn() }) },
}));

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
});
vi.stubGlobal('window', globalThis);

import {
  startInactivityDetector,
  stopInactivityDetector,
  keepRecording as keepRecordingDetector,
} from '../../services/inactivityDetectorService';

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
