// === FILE PURPOSE ===
// Hook + singleton SoundManager for UI sound effects (click, hover).
// Uses Web Audio API for low-latency playback (~5ms vs HTMLAudioElement's ~50-100ms).
// Singleton pattern avoids creating multiple AudioContexts (browser limits to ~6).

import { useCallback } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import clickSoundUrl from '../assets/sounds/click-sound.ogg';
import hoverSoundUrl from '../assets/sounds/hover-sound.ogg';

// ---------------------------------------------------------------------------
// SoundManager — module-level singleton
// ---------------------------------------------------------------------------

class SoundManager {
  private ctx: AudioContext | null = null;
  private clickBuffer: AudioBuffer | null = null;
  private hoverBuffer: AudioBuffer | null = null;
  private lastHoverTime = 0;
  private initPromise: Promise<void> | null = null;

  /** Lazily create AudioContext and decode both WAV files. */
  private init(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      this.ctx = new AudioContext();

      const [clickResp, hoverResp] = await Promise.all([fetch(clickSoundUrl), fetch(hoverSoundUrl)]);

      const [clickArr, hoverArr] = await Promise.all([clickResp.arrayBuffer(), hoverResp.arrayBuffer()]);

      const [clickBuf, hoverBuf] = await Promise.all([
        this.ctx.decodeAudioData(clickArr),
        this.ctx.decodeAudioData(hoverArr),
      ]);

      this.clickBuffer = clickBuf;
      this.hoverBuffer = hoverBuf;
    })();

    return this.initPromise;
  }

  /** Play an AudioBuffer through the context destination at a given volume (0-1) and playback rate. */
  private playBuffer(buffer: AudioBuffer, volume = 1, rate = 1): void {
    if (!this.ctx) return;

    // Resume context if suspended (browsers suspend until user gesture)
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;

    if (volume < 1) {
      const gain = this.ctx.createGain();
      gain.gain.value = volume;
      source.connect(gain);
      gain.connect(this.ctx.destination);
    } else {
      source.connect(this.ctx.destination);
    }

    source.start(0);
  }

  /** Play the click sound. */
  async playClick(): Promise<void> {
    await this.init();
    if (this.clickBuffer) {
      this.playBuffer(this.clickBuffer, 0.15);
    }
  }

  /** Play the hover sound with a 100ms cooldown to prevent rapid-fire. */
  async playHover(): Promise<void> {
    const now = performance.now();
    if (now - this.lastHoverTime < 100) return;
    this.lastHoverTime = now;

    await this.init();
    if (this.hoverBuffer) {
      this.playBuffer(this.hoverBuffer, 0.15, 1.6);
    }
  }
}

const soundManager = new SoundManager();

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

/**
 * Returns stable `playClick` and `playHover` callbacks.
 * Reads the `app.uiSounds` setting from settingsStore (default: enabled).
 * When disabled, both functions are no-ops.
 */
export function useSoundEffect() {
  const enabled = useSettingsStore((s) => (s.settings['app.uiSounds'] ?? 'true') === 'true');

  const playClick = useCallback(() => {
    if (!enabled) return;
    soundManager.playClick();
  }, [enabled]);

  const playHover = useCallback(() => {
    if (!enabled) return;
    soundManager.playHover();
  }, [enabled]);

  return { playClick, playHover };
}
