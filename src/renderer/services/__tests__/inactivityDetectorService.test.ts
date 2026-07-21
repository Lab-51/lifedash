// Unit tests for the renderer inactivity auto-stop detector (GUARD.1).
// Fake timers + a mocked audioCaptureService.getAudioLevel drive the silence
// clock deterministically. The detector holds module-scoped state, so every test
// resets it via stopInactivityDetector() in beforeEach/afterEach.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../audioCaptureService', () => ({
  getAudioLevel: vi.fn(() => 0),
  // AudioLevelMeter (imported transitively for SILENCE_EPSILON) references this;
  // never invoked here, but provided so the mock is a faithful module shape.
  onAudioLevel: vi.fn(),
}));

import * as audioCaptureService from '../audioCaptureService';
import {
  startInactivityDetector,
  stopInactivityDetector,
  keepRecording,
  type InactivityDetectorOptions,
} from '../inactivityDetectorService';

const POLL_MS = 5000;
const THRESHOLD_MIN = 10;
const THRESHOLD_MS = THRESHOLD_MIN * 60_000; // 600_000
const COUNTDOWN_SECONDS = 120;

const level = vi.mocked(audioCaptureService.getAudioLevel);
const setLevel = (v: number) => level.mockReturnValue(v);

function makeOpts(): {
  onWarn: ReturnType<typeof vi.fn>;
  onCountdownTick: ReturnType<typeof vi.fn>;
  onAutoStop: ReturnType<typeof vi.fn>;
  onActivityResume: ReturnType<typeof vi.fn>;
  opts: InactivityDetectorOptions;
} {
  const onWarn = vi.fn();
  const onCountdownTick = vi.fn();
  const onAutoStop = vi.fn();
  const onActivityResume = vi.fn();
  return {
    onWarn,
    onCountdownTick,
    onAutoStop,
    onActivityResume,
    opts: { thresholdMinutes: THRESHOLD_MIN, onWarn, onCountdownTick, onAutoStop, onActivityResume },
  };
}

describe('inactivityDetectorService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stopInactivityDetector(); // reset module state before each test
    level.mockReset();
    setLevel(0); // silent by default
  });

  afterEach(() => {
    stopInactivityDetector();
    vi.useRealTimers();
  });

  it('fires onWarn + starts the countdown exactly at the silence threshold boundary', () => {
    const { onWarn, onCountdownTick, opts } = makeOpts();
    startInactivityDetector(opts);

    // One poll short of the threshold: no warning yet.
    vi.advanceTimersByTime(THRESHOLD_MS - POLL_MS);
    expect(onWarn).not.toHaveBeenCalled();
    expect(onCountdownTick).not.toHaveBeenCalled();

    // The poll that crosses the threshold triggers the warning + initial tick.
    vi.advanceTimersByTime(POLL_MS);
    expect(onWarn).toHaveBeenCalledTimes(1);
    expect(onCountdownTick).toHaveBeenCalledTimes(1);
    expect(onCountdownTick).toHaveBeenLastCalledWith(COUNTDOWN_SECONDS);
  });

  it('resets the silence clock when audio activity is detected', () => {
    const { onWarn, opts } = makeOpts();
    startInactivityDetector(opts);

    // Almost at the threshold...
    vi.advanceTimersByTime(THRESHOLD_MS - POLL_MS);
    expect(onWarn).not.toHaveBeenCalled();

    // ...activity for one poll resets the clock.
    setLevel(0.5);
    vi.advanceTimersByTime(POLL_MS);
    expect(onWarn).not.toHaveBeenCalled();

    // Back to silence: a fresh full window is required before warning.
    setLevel(0);
    vi.advanceTimersByTime(THRESHOLD_MS - POLL_MS);
    expect(onWarn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(POLL_MS);
    expect(onWarn).toHaveBeenCalledTimes(1);
  });

  it('cancels the countdown and fires onActivityResume when audio returns during it', () => {
    const { onActivityResume, onAutoStop, opts } = makeOpts();
    startInactivityDetector(opts);

    vi.advanceTimersByTime(THRESHOLD_MS); // warn + countdown running
    expect(onActivityResume).not.toHaveBeenCalled();

    // Audio returns; the next poll cancels the countdown.
    setLevel(0.5);
    vi.advanceTimersByTime(POLL_MS);
    expect(onActivityResume).toHaveBeenCalledTimes(1);

    // Well past the original countdown window: no auto-stop.
    vi.advanceTimersByTime(COUNTDOWN_SECONDS * 1000 + POLL_MS);
    expect(onAutoStop).not.toHaveBeenCalled();
  });

  it('keepRecording suppresses an immediate re-warn (full new window required)', () => {
    const { onWarn, onAutoStop, opts } = makeOpts();
    startInactivityDetector(opts);

    vi.advanceTimersByTime(THRESHOLD_MS); // warn #1 + countdown
    expect(onWarn).toHaveBeenCalledTimes(1);

    keepRecording(); // cancel countdown, reset to monitoring, reset silence clock

    // One poll of continued silence must NOT re-warn immediately.
    vi.advanceTimersByTime(POLL_MS);
    expect(onWarn).toHaveBeenCalledTimes(1);

    // Only after another full silence window does it warn again.
    vi.advanceTimersByTime(THRESHOLD_MS - POLL_MS);
    expect(onWarn).toHaveBeenCalledTimes(2);

    // keepRecording cancelled the countdown, so no auto-stop occurred.
    expect(onAutoStop).not.toHaveBeenCalled();
  });

  it('fires onAutoStop exactly once when the countdown expires, then stops itself', () => {
    const { onAutoStop, onCountdownTick, opts } = makeOpts();
    startInactivityDetector(opts);

    vi.advanceTimersByTime(THRESHOLD_MS); // warn + countdown starts (tick 120)
    expect(onAutoStop).not.toHaveBeenCalled();

    // Run the full 120s countdown to expiry.
    vi.advanceTimersByTime(COUNTDOWN_SECONDS * 1000);
    expect(onAutoStop).toHaveBeenCalledTimes(1);

    // Detector stopped itself: no further ticks or repeat auto-stop.
    onCountdownTick.mockClear();
    vi.advanceTimersByTime(THRESHOLD_MS + COUNTDOWN_SECONDS * 1000);
    expect(onAutoStop).toHaveBeenCalledTimes(1);
    expect(onCountdownTick).not.toHaveBeenCalled();
  });

  it('clears all timers on stop — advancing time afterwards fires no callbacks', () => {
    const { onWarn, onCountdownTick, onAutoStop, onActivityResume, opts } = makeOpts();
    startInactivityDetector(opts);

    vi.advanceTimersByTime(THRESHOLD_MS); // warn + countdown active
    stopInactivityDetector();

    onWarn.mockClear();
    onCountdownTick.mockClear();
    onAutoStop.mockClear();
    onActivityResume.mockClear();

    vi.advanceTimersByTime(THRESHOLD_MS + COUNTDOWN_SECONDS * 1000);
    expect(onWarn).not.toHaveBeenCalled();
    expect(onCountdownTick).not.toHaveBeenCalled();
    expect(onAutoStop).not.toHaveBeenCalled();
    expect(onActivityResume).not.toHaveBeenCalled();
  });

  it('double start restarts cleanly (no orphaned poll timer double-counting silence)', () => {
    const first = makeOpts();
    startInactivityDetector(first.opts);
    vi.advanceTimersByTime(THRESHOLD_MS - POLL_MS); // accumulate silence, no warn yet

    // Restart with fresh callbacks; the old poll timer must be gone.
    const second = makeOpts();
    startInactivityDetector(second.opts);

    // A near-full (but not full) window: if the old timer were still running the
    // combined count would cross the threshold — it must not.
    vi.advanceTimersByTime(THRESHOLD_MS - POLL_MS);
    expect(first.onWarn).not.toHaveBeenCalled();
    expect(second.onWarn).not.toHaveBeenCalled();

    // The restarted detector warns after its own full window.
    vi.advanceTimersByTime(POLL_MS);
    expect(second.onWarn).toHaveBeenCalledTimes(1);
    expect(first.onWarn).not.toHaveBeenCalled();
  });
});
