// === FILE PURPOSE ===
// Pins the one place the transcript's two time coordinates are related
// (TRANS-COV.1). A window is stamped 10,000 ms after the previous one while the
// audio only advances 9,000 ms (ISSUES #40), so a stamped timestamp and a real
// offset into the WAV are NOT the same number — and the divergence is asserted
// here as an exact number, deliberately: the day #40 is fixed, this file fails
// and the pair has to be updated with it rather than silently lying.

import { describe, it, expect } from 'vitest';
import { WINDOW_ADVANCE_MS, WINDOW_STAMP_MS, audioMsToStampedMs, stampedMsToAudioMs } from '../timeCoordinates';

// 9,999 sits in the 1-second overlap tail of window 0 — the one value below that
// cannot round-trip FROM the stamped side, and the reason is in the third test.
const SAMPLES = [0, 9_999, 10_000, 88_000, 3_600_000];

describe('transcript time coordinates', () => {
  it('round-trips every audio offset through the stamped coordinate', () => {
    // audio -> stamped is injective, so this direction is an identity for all.
    for (const audioMs of SAMPLES) {
      expect(stampedMsToAudioMs(audioMsToStampedMs(audioMs))).toBe(audioMs);
    }
  });

  it('round-trips a stamp that is not in the overlap tail', () => {
    for (const stampedMs of SAMPLES.filter((ms) => ms % WINDOW_STAMP_MS < WINDOW_ADVANCE_MS)) {
      expect(audioMsToStampedMs(stampedMsToAudioMs(stampedMs))).toBe(stampedMs);
    }
  });

  it('names overlapping audio by the later window, so the tail does not round-trip', () => {
    // The last second of window 0 IS the first second of window 1's audio: both
    // stamps point at the same place in the WAV.
    expect(stampedMsToAudioMs(9_999)).toBe(9_999);
    expect(stampedMsToAudioMs(10_999)).toBe(9_999);
    // Asked which stamp names that audio, the pair answers with the later window
    // — the canonical branch, whose offset is always below the advance step.
    expect(audioMsToStampedMs(9_999)).toBe(10_999);
  });

  it('puts the stamp 10% ahead of the audio after an hour', () => {
    // The number, not the rule: 3,600,000 stamped ms of a recording is only
    // 3,240,000 ms — 54 minutes — of actual audio. Fixing ISSUES #40 makes both
    // functions the identity and MUST break this assertion.
    expect(stampedMsToAudioMs(3_600_000)).toBe(3_240_000);
    expect(3_600_000 - stampedMsToAudioMs(3_600_000)).toBe(360_000);
    expect(WINDOW_STAMP_MS).toBe(10_000);
    expect(WINDOW_ADVANCE_MS).toBe(9_000);
  });

  it('never returns a negative or NaN offset', () => {
    // A garbage input must not become a negative seek into the WAV.
    for (const bad of [-1, -10_000, NaN, Infinity]) {
      expect(stampedMsToAudioMs(bad)).toBe(0);
      expect(audioMsToStampedMs(bad)).toBe(0);
    }
  });
});
