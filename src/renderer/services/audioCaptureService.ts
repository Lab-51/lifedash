// === FILE PURPOSE ===
// Audio capture bridge -- thin layer that captures system audio via
// electron-audio-loopback AND optionally the user's microphone, keeps the two
// on SEPARATE channels of one ScriptProcessorNode (via a ChannelMergerNode),
// extracts Int16 PCM per channel plus their mono sum, and streams all three to
// the main process via IPC.
//
// === DEPENDENCIES ===
// Web Audio API (AudioContext, ScriptProcessorNode, ChannelMergerNode, GainNode),
// window.electronAPI
//
// === LIMITATIONS ===
// - Uses deprecated ScriptProcessorNode (migrate to AudioWorklet in v2)
// - Channel 0 is the mic and channel 1 is system audio ONLY as long as the
//   merger keeps them apart; a host that downmixed the merger's output would
//   make both channels identical (see the note on onaudioprocess below)
// - Single recording at a time
// - getDisplayMedia shows system picker dialog (user must select screen)
// - Mic failure is non-fatal (falls back to system-only)

import type { AudioChunkPayload } from '../../shared/types';

/** Minimal info about an audio device for UI display. */
export interface AudioDeviceInfo {
  deviceId: string;
  label: string;
  kind: 'audioinput' | 'audiooutput';
}

const SAMPLE_RATE = 16000; // 16kHz for Whisper
const BUFFER_SIZE = 4096; // ScriptProcessorNode buffer size (samples per callback)
// Two input channels: 0 = microphone, 1 = system audio. The ChannelMergerNode
// forces each of its inputs to mono (channelCount 1, channelCountMode
// 'explicit'), which is the same stereo->mono downmix the old single-input
// graph applied at the processor's input.
const INPUT_CHANNELS = 2;
const MIC_CHANNEL = 0;
const SYSTEM_CHANNEL = 1;
const OUTPUT_CHANNELS = 1; // Mono output

// System audio resources
let audioContext: AudioContext | null = null;
let mediaStream: MediaStream | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let systemGainNode: GainNode | null = null;
let mergerNode: ChannelMergerNode | null = null;
let processorNode: ScriptProcessorNode | null = null;

// Microphone resources
let micStream: MediaStream | null = null;
let micSourceNode: MediaStreamAudioSourceNode | null = null;
let micGainNode: GainNode | null = null;

// Audio level monitoring
let currentAudioLevel = 0; // 0.0 (silence) to 1.0 (max)
let audioLevelCallback: ((level: number) => void) | null = null;

// Track health monitoring
let audioInterruptedCallback: ((type: 'mic' | 'system', recovered: boolean) => void) | null = null;
let currentMicDeviceId: string | undefined = undefined;

/**
 * Calculate RMS (root-mean-square) level of Float32 audio samples.
 * Returns a value between 0.0 (silence) and 1.0 (max).
 */
function calculateRMS(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Convert Float32 audio samples to Int16 PCM.
 * Clamps values to [-1, 1] range before scaling.
 */
function float32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

/**
 * Enumerate available audio devices (inputs and outputs).
 * Requests mic permission first so device labels are populated (browsers hide
 * labels until permission is granted).
 */
export async function enumerateAudioDevices(): Promise<AudioDeviceInfo[]> {
  // Request mic permission so labels are available
  try {
    const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    tempStream.getTracks().forEach((t) => t.stop());
  } catch {
    // Permission denied — labels may be empty but deviceIds still work
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter(
      (d): d is MediaDeviceInfo & { kind: 'audioinput' | 'audiooutput' } =>
        d.kind === 'audioinput' || d.kind === 'audiooutput',
    )
    .map((d) => ({
      deviceId: d.deviceId,
      label: d.label || `${d.kind === 'audioinput' ? 'Microphone' : 'Speaker'} (${d.deviceId.slice(0, 8)})`,
      kind: d.kind,
    }));
}

/**
 * Attempt to acquire the user's microphone stream.
 * Returns null on failure (permission denied, no hardware, etc.) — non-fatal.
 *
 * @param deviceId Optional specific microphone device ID to use
 */
async function acquireMicStream(deviceId?: string): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch {
    // Permission denied or no mic hardware — fall back to system-only
    console.warn('Microphone not available, recording system audio only.');
    return null;
  }
}

/**
 * Start capturing system audio, optionally mixed with microphone input.
 *
 * Audio graph (SPEAKER.1):
 *   getUserMedia (mic)       → micSource    → micGain    → merger input 0 ─┐
 *                                                                          ├→ processorNode(4096, 2, 1) → IPC
 *   getDisplayMedia (system) → systemSource → systemGain → merger input 1 ─┘
 *
 * The merger keeps the two sources on separate channels instead of letting Web
 * Audio sum them at a shared input, so `onaudioprocess` can read each one on its
 * own. The mono sum every existing consumer expects is computed in JS from those
 * two channels — one clock, one callback, frame-aligned channels for free.
 *
 * @param includeMic Whether to also capture the user's microphone (default: true)
 * @param micDeviceId Optional specific microphone device ID to use
 * @throws If user cancels the picker dialog or system audio capture fails
 */
export async function startCapture(includeMic: boolean = true, micDeviceId?: string): Promise<void> {
  if (audioContext) {
    throw new Error('Already capturing. Call stopCapture() first.');
  }

  // Step 1: Enable loopback (patches getDisplayMedia to include system audio)
  await window.electronAPI.enableLoopbackAudio();

  try {
    // Step 2: Get system audio via patched getDisplayMedia
    // IMPORTANT: video: true is REQUIRED by the API even though we don't want video
    mediaStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });
  } catch (error) {
    // User cancelled the picker dialog or permission denied
    await window.electronAPI.disableLoopbackAudio();
    throw error;
  }

  // Step 3: Remove video tracks (we only need audio)
  mediaStream.getVideoTracks().forEach((track) => {
    track.stop();
    mediaStream!.removeTrack(track);
  });

  // Step 4: Disable loopback (restores normal getDisplayMedia behavior)
  await window.electronAPI.disableLoopbackAudio();

  // Verify we have audio tracks
  const audioTracks = mediaStream.getAudioTracks();
  if (audioTracks.length === 0) {
    cleanup();
    throw new Error('No audio tracks in captured stream.');
  }

  // Watch for system audio track ending unexpectedly (e.g., screen share stopped)
  // Recovery is NOT attempted — getDisplayMedia requires user interaction via picker dialog
  const systemTrack = audioTracks[0];
  systemTrack.onended = () => {
    // Bail if recording already stopped
    if (!audioContext) return;

    console.error('[audioCaptureService] System audio track ended unexpectedly — cannot auto-recover.');
    if (audioInterruptedCallback) audioInterruptedCallback('system', false);
  };

  // Step 5: Create AudioContext at 16kHz -- browser handles resampling from 48kHz
  audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });

  // Step 6: Build audio pipeline with GainNodes for mixing
  sourceNode = audioContext.createMediaStreamSource(mediaStream);
  systemGainNode = audioContext.createGain();
  systemGainNode.gain.value = 1.0;

  mergerNode = audioContext.createChannelMerger(INPUT_CHANNELS);
  processorNode = audioContext.createScriptProcessor(BUFFER_SIZE, INPUT_CHANNELS, OUTPUT_CHANNELS);

  // Connect system audio: source → gain → merger input 1 (mic takes input 0)
  sourceNode.connect(systemGainNode);
  systemGainNode.connect(mergerNode, 0, SYSTEM_CHANNEL);
  mergerNode.connect(processorNode);

  // Step 7: Optionally add microphone input
  currentMicDeviceId = micDeviceId;
  if (includeMic) {
    micStream = await acquireMicStream(currentMicDeviceId);
    if (micStream) {
      micSourceNode = audioContext.createMediaStreamSource(micStream);
      micGainNode = audioContext.createGain();
      micGainNode.gain.value = 1.0;
      // Connect mic: source → gain → merger input 0 (its own channel)
      micSourceNode.connect(micGainNode);
      micGainNode.connect(mergerNode, 0, MIC_CHANNEL);

      // Watch for mic track ending unexpectedly (e.g., device disconnected)
      const micTrack = micStream.getAudioTracks()[0];
      if (micTrack) {
        micTrack.onended = async () => {
          // Bail if recording already stopped
          if (!audioContext) return;

          console.warn('[audioCaptureService] Mic track ended unexpectedly — attempting recovery...');

          // Disconnect old mic nodes before re-wiring
          if (micSourceNode) {
            micSourceNode.disconnect();
            micSourceNode = null;
          }
          if (micGainNode) {
            micGainNode.disconnect();
            micGainNode = null;
          }
          if (micStream) {
            micStream.getTracks().forEach((t) => t.stop());
            micStream = null;
          }

          const recoveredStream = await acquireMicStream(currentMicDeviceId);
          if (recoveredStream && audioContext && micGainNode === null) {
            micStream = recoveredStream;
            micSourceNode = audioContext.createMediaStreamSource(micStream);
            micGainNode = audioContext.createGain();
            micGainNode.gain.value = 1.0;
            micSourceNode.connect(micGainNode);
            micGainNode.connect(mergerNode!, 0, MIC_CHANNEL);
            console.info('[audioCaptureService] Mic recovered successfully.');
            if (audioInterruptedCallback) audioInterruptedCallback('mic', true);
          } else {
            console.warn('[audioCaptureService] Mic recovery failed — continuing with system audio only.');
            if (audioInterruptedCallback) audioInterruptedCallback('mic', false);
          }
        };
      }
    }
  }

  // Step 8: Extract per-channel PCM, calculate level, and send to main.
  //
  // SPEAKER.1: channel 0 is the mic and channel 1 is system audio because the
  // ChannelMergerNode routes them there. `mixed` reproduces exactly what the old
  // single-input graph produced — Web Audio summed the two gains at the shared
  // input in Float32, and so do we, before the same float32ToInt16 clamp — so
  // the WAV file on disk and every other mixed-stream consumer are unchanged.
  processorNode.onaudioprocess = (event: AudioProcessingEvent) => {
    const micSamples = event.inputBuffer.getChannelData(MIC_CHANNEL);
    const systemSamples = event.inputBuffer.getChannelData(SYSTEM_CHANNEL);

    const mixedSamples = new Float32Array(micSamples.length);
    for (let i = 0; i < mixedSamples.length; i++) {
      mixedSamples[i] = micSamples[i] + systemSamples[i];
    }

    // Calculate audio level for UI meter from the MIXED sum (scale RMS to 0-1
    // range). Multiply by ~5 to make the meter more visually responsive.
    const rms = calculateRMS(mixedSamples);
    currentAudioLevel = Math.min(1, rms * 5);
    if (audioLevelCallback) audioLevelCallback(currentAudioLevel);

    // Send raw Int16 PCM bytes to main process (one-way, fire-and-forget).
    // `micGainNode` is the live "mic is connected" flag: the track-ended handler
    // above clears it and only restores it on a successful recovery, so a null
    // `mic` here means the device genuinely produced nothing for this window.
    // Casts are safe: Int16Array created via `new Int16Array(n)` always uses ArrayBuffer.
    const payload: AudioChunkPayload = {
      mixed: float32ToInt16(mixedSamples).buffer as ArrayBuffer,
      mic: micGainNode ? (float32ToInt16(micSamples).buffer as ArrayBuffer) : null,
      system: float32ToInt16(systemSamples).buffer as ArrayBuffer,
    };
    window.electronAPI.sendAudioChunk(payload);
  };

  // Connect to destination to keep the processor running
  // (ScriptProcessorNode requires being connected to output)
  processorNode.connect(audioContext.destination);
}

/**
 * Stop capturing audio and clean up all resources.
 */
export async function stopCapture(): Promise<void> {
  cleanup();
}

/**
 * Check if currently capturing.
 */
export function isCapturing(): boolean {
  return audioContext !== null;
}

/**
 * Get the current audio level (0.0 = silence, 1.0 = loud).
 * Updated ~4 times per second during capture.
 */
export function getAudioLevel(): number {
  return currentAudioLevel;
}

/**
 * Set a callback to receive audio level updates during capture.
 * Callback fires ~4 times per second. Pass null to remove.
 */
export function onAudioLevel(callback: ((level: number) => void) | null): void {
  audioLevelCallback = callback;
}

/**
 * Set a callback to receive track interruption notifications during capture.
 * Fired when a mic or system audio track ends unexpectedly.
 * - type: 'mic' | 'system' — which track was lost
 * - recovered: true if mic was successfully re-acquired; always false for system audio
 * Pass null to remove.
 */
export function onAudioInterrupted(callback: ((type: 'mic' | 'system', recovered: boolean) => void) | null): void {
  audioInterruptedCallback = callback;
}

/**
 * Internal cleanup -- disconnect nodes, stop tracks, close context.
 */
function cleanup(): void {
  currentAudioLevel = 0;
  audioLevelCallback = null;
  audioInterruptedCallback = null;
  currentMicDeviceId = undefined;

  if (processorNode) {
    processorNode.disconnect();
    processorNode.onaudioprocess = null;
    processorNode = null;
  }
  // Clean up mic resources
  if (micGainNode) {
    micGainNode.disconnect();
    micGainNode = null;
  }
  if (micSourceNode) {
    micSourceNode.disconnect();
    micSourceNode = null;
  }
  if (micStream) {
    micStream.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    micStream = null;
  }
  if (mergerNode) {
    mergerNode.disconnect();
    mergerNode = null;
  }
  // Clean up system audio resources
  if (systemGainNode) {
    systemGainNode.disconnect();
    systemGainNode = null;
  }
  if (sourceNode) {
    sourceNode.disconnect();
    sourceNode = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    mediaStream = null;
  }
  if (audioContext) {
    audioContext.close().catch(() => {});
    audioContext = null;
  }
}
