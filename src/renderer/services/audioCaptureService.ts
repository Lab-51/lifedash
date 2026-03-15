// === FILE PURPOSE ===
// Audio capture bridge -- thin layer that captures system audio via
// electron-audio-loopback AND optionally the user's microphone,
// mixes them via Web Audio API, extracts PCM via ScriptProcessorNode,
// and streams Int16 chunks to the main process via IPC.
//
// === DEPENDENCIES ===
// Web Audio API (AudioContext, ScriptProcessorNode, GainNode), window.electronAPI
//
// === LIMITATIONS ===
// - Uses deprecated ScriptProcessorNode (migrate to AudioWorklet in v2)
// - Single recording at a time
// - getDisplayMedia shows system picker dialog (user must select screen)
// - Mic failure is non-fatal (falls back to system-only)

/** Minimal info about an audio device for UI display. */
export interface AudioDeviceInfo {
  deviceId: string;
  label: string;
  kind: 'audioinput' | 'audiooutput';
}

const SAMPLE_RATE = 16000; // 16kHz for Whisper
const BUFFER_SIZE = 4096; // ScriptProcessorNode buffer size (samples per callback)
const INPUT_CHANNELS = 1; // Mono (browser handles stereo->mono downmix)
const OUTPUT_CHANNELS = 1; // Mono output

// System audio resources
let audioContext: AudioContext | null = null;
let mediaStream: MediaStream | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let systemGainNode: GainNode | null = null;
let processorNode: ScriptProcessorNode | null = null;

// Microphone resources
let micStream: MediaStream | null = null;
let micSourceNode: MediaStreamAudioSourceNode | null = null;
let micGainNode: GainNode | null = null;

// Audio level monitoring
let currentAudioLevel = 0; // 0.0 (silence) to 1.0 (max)
let audioLevelCallback: ((level: number) => void) | null = null;

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
 * Audio graph:
 *   getDisplayMedia (system) → systemSource → systemGain ─┐
 *                                                          ├→ processorNode → IPC
 *   getUserMedia (mic)       → micSource    → micGain    ─┘
 *
 * Web Audio API automatically sums signals connected to the same input node.
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

  // Step 5: Create AudioContext at 16kHz -- browser handles resampling from 48kHz
  audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });

  // Step 6: Build audio pipeline with GainNodes for mixing
  sourceNode = audioContext.createMediaStreamSource(mediaStream);
  systemGainNode = audioContext.createGain();
  systemGainNode.gain.value = 1.0;

  processorNode = audioContext.createScriptProcessor(BUFFER_SIZE, INPUT_CHANNELS, OUTPUT_CHANNELS);

  // Connect system audio: source → gain → processor
  sourceNode.connect(systemGainNode);
  systemGainNode.connect(processorNode);

  // Step 7: Optionally add microphone input
  if (includeMic) {
    micStream = await acquireMicStream(micDeviceId);
    if (micStream) {
      micSourceNode = audioContext.createMediaStreamSource(micStream);
      micGainNode = audioContext.createGain();
      micGainNode.gain.value = 1.0;
      // Connect mic: source → gain → processor (sums with system audio)
      micSourceNode.connect(micGainNode);
      micGainNode.connect(processorNode);
    }
  }

  // Step 8: Extract PCM, calculate level, and send to main
  processorNode.onaudioprocess = (event: AudioProcessingEvent) => {
    const float32Data = event.inputBuffer.getChannelData(0);

    // Calculate audio level for UI meter (scale RMS to 0-1 range)
    // Multiply by ~5 to make the meter more visually responsive
    const rms = calculateRMS(float32Data);
    currentAudioLevel = Math.min(1, rms * 5);
    if (audioLevelCallback) audioLevelCallback(currentAudioLevel);

    const int16Data = float32ToInt16(float32Data);
    // Send raw Int16 PCM bytes to main process (one-way, fire-and-forget)
    // Cast is safe: Int16Array created via `new Int16Array(n)` always uses ArrayBuffer
    window.electronAPI.sendAudioChunk(int16Data.buffer as ArrayBuffer);
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
 * Internal cleanup -- disconnect nodes, stop tracks, close context.
 */
function cleanup(): void {
  currentAudioLevel = 0;
  audioLevelCallback = null;

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
    micStream.getTracks().forEach((track) => track.stop());
    micStream = null;
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
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
  if (audioContext) {
    audioContext.close().catch(() => {});
    audioContext = null;
  }
}
