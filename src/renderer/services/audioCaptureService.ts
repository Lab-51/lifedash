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
// - System audio comes from electron-audio-loopback's patched getDisplayMedia,
//   which the main process answers itself: no picker is shown
// - The processor is connected to `destination` only to keep it firing; the
//   context is created with a 'none' sink where supported (audioContextNoSink.ts)
//   so no output device is opened
// - Mic failure is non-fatal (falls back to system-only)
// - A lost mic or system track is re-acquired by audioDeviceWatcher once its device
//   is back; a CHOSEN mic is waited for, never replaced by another device

import type { AudioCaptureChannel, AudioChunkPayload } from '../../shared/types';
import { emitAudioEvent, trackLabel } from './audioCaptureEvents';
import { createCaptureContext } from './audioContextNoSink';
import {
  openSystemAudio,
  releaseStream,
  startDeviceWatcher,
  streamState,
  type DeviceWatcher,
  type ReacquireOutcome,
} from './audioDeviceWatcher';

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
let micEnabled = false; // the mic was requested for this capture
let deviceWatcher: DeviceWatcher | null = null;
// Bumped by cleanup: a re-acquisition that sees another value after an await
// belongs to a stopped capture and must not touch the graph.
let captureSession = 0;
// Name of the error behind the last failed mic acquisition, for the main log.
// Only the error NAME is kept (e.g. NotFoundError) — never a message.
let lastMicErrorName = 'none';

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

type AudioMediaDeviceInfo = MediaDeviceInfo & { kind: 'audioinput' | 'audiooutput' };

function isAudioDevice(d: MediaDeviceInfo): d is AudioMediaDeviceInfo {
  return d.kind === 'audioinput' || d.kind === 'audiooutput';
}

/** True when audio devices exist but none carries a label (mic permission not granted yet). */
function needsLabelPermission(devices: MediaDeviceInfo[]): boolean {
  const audio = devices.filter(isAudioDevice);
  return audio.length > 0 && audio.every((d) => !d.label);
}

/**
 * Enumerate available audio devices (inputs and outputs).
 * Labels are hidden by the browser until mic permission is granted, so a
 * temporary mic stream is opened to get them -- but only when no label is
 * visible yet; once permission exists the list is read without touching the mic.
 */
export async function enumerateAudioDevices(): Promise<AudioDeviceInfo[]> {
  let devices = await navigator.mediaDevices.enumerateDevices();
  if (needsLabelPermission(devices)) {
    // Labels are hidden until mic permission exists. Open the temporary stream
    // only then: every open/close can make a Bluetooth headset switch profile.
    try {
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      tempStream.getTracks().forEach((t) => t.stop());
    } catch {
      // Permission denied — labels may be empty but deviceIds still work
    }
    devices = await navigator.mediaDevices.enumerateDevices();
  }
  return devices.filter(isAudioDevice).map((d) => ({
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
  lastMicErrorName = 'none';
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (error) {
    // Permission denied or no mic hardware — fall back to system-only
    lastMicErrorName = error instanceof Error ? error.name : 'UnknownError';
    console.warn('Microphone not available, recording system audio only.');
    return null;
  }
}

/** Report a track's mute/unmute to the main log; used for the system track and every mic track. */
function watchMuteState(track: MediaStreamTrack, channel: AudioCaptureChannel): void {
  track.onmute = () => {
    if (audioContext) emitAudioEvent('track-muted', channel, `label="${trackLabel(track)}"`);
  };
  track.onunmute = () => {
    if (audioContext) emitAudioEvent('track-unmuted', channel, `label="${trackLabel(track)}"`);
  };
}

/** The mic half of the `capture-started` detail: its label, or why there is none. */
function describeMic(includeMic: boolean): string {
  if (!includeMic) return 'off';
  const track = micStream?.getAudioTracks()[0];
  return track ? `"${trackLabel(track)}"` : `unavailable error=${lastMicErrorName}`;
}

/** Report a system track's end; the device watcher re-acquires it on its next check. */
function watchSystemTrack(track: MediaStreamTrack): void {
  track.onended = () => {
    if (!audioContext) return; // recording already stopped
    console.warn('[audioCaptureService] System audio track ended; it is re-acquired when a device is available.');
    emitAudioEvent('track-ended', 'system', `label="${trackLabel(track)}"`);
    audioInterruptedCallback?.('system', false);
  };
  watchMuteState(track, 'system');
}

/**
 * Report a mic track's end and silence the channel at once (mic chunks are null
 * from the next callback). The device watcher re-acquires it on a later check;
 * the ended stream is kept until its replacement is connected.
 */
function watchMicTrack(track: MediaStreamTrack): void {
  track.onended = () => {
    if (!audioContext) return; // recording already stopped
    console.warn('[audioCaptureService] Mic track ended; it is re-acquired when the device is back.');
    emitAudioEvent('track-ended', 'mic', `label="${trackLabel(track)}"`);
    micSourceNode?.disconnect();
    micSourceNode = null;
    micGainNode?.disconnect();
    micGainNode = null;
    audioInterruptedCallback?.('mic', false);
  };
  watchMuteState(track, 'mic');
}

/** Put `stream` on the mic channel (merger input 0), then release the stream it replaces. */
function connectMic(stream: MediaStream): void {
  const replaced = { source: micSourceNode, stream: micStream };
  micSourceNode = audioContext!.createMediaStreamSource(stream);
  if (!micGainNode) {
    micGainNode = audioContext!.createGain();
    micGainNode.gain.value = 1.0;
    micGainNode.connect(mergerNode!, 0, MIC_CHANNEL);
  }
  micSourceNode.connect(micGainNode);
  micStream = stream;
  const track = stream.getAudioTracks()[0];
  if (track) watchMicTrack(track);
  replaced.source?.disconnect();
  if (replaced.stream) releaseStream(replaced.stream);
}

/** Put `stream` on the system channel (into systemGainNode), then release the stream it replaces. */
function connectSystem(stream: MediaStream): void {
  const replaced = { source: sourceNode, stream: mediaStream };
  sourceNode = audioContext!.createMediaStreamSource(stream);
  sourceNode.connect(systemGainNode!);
  mediaStream = stream;
  watchSystemTrack(stream.getAudioTracks()[0]);
  replaced.source?.disconnect();
  if (replaced.stream) releaseStream(replaced.stream);
}

/**
 * One re-acquisition for the device watcher; the processor is never touched.
 * Resolves null when capture `session` stopped, or the watcher abandoned the attempt
 * (`signal`), during an await -- a stream opened after that is released, never connected.
 */
async function reacquire(
  channel: AudioCaptureChannel,
  session: number,
  signal: AbortSignal,
): Promise<ReacquireOutcome | null> {
  const isCurrent = () => session === captureSession && !signal.aborted;
  const discard = (stream: MediaStream | null) => {
    if (stream) releaseStream(stream);
    return null;
  };
  if (channel === 'mic') {
    // A chosen id is opened with `exact`, so no other mic can stand in for it.
    const stream = await acquireMicStream(currentMicDeviceId);
    if (!isCurrent()) return discard(stream);
    if (!stream) return { ok: false, detail: `error=${lastMicErrorName}` };
    connectMic(stream);
    return { ok: true, detail: `label="${trackLabel(stream.getAudioTracks()[0])}"` };
  }
  const stream = await openSystemAudio(isCurrent, signal); // rejects on an error, a timeout or a stop
  if (!isCurrent()) return discard(stream);
  const track = stream?.getAudioTracks()[0];
  if (!stream || !track) {
    discard(stream);
    return { ok: false, detail: 'error=NoAudioTrack' };
  }
  connectSystem(stream);
  return { ok: true, detail: `label="${trackLabel(track)}"` };
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
 * @throws If system audio capture is denied or fails
 */
export async function startCapture(includeMic: boolean = true, micDeviceId?: string): Promise<void> {
  if (audioContext) {
    throw new Error('Already capturing. Call stopCapture() first.');
  }

  // Steps 1-4: enable loopback (patches getDisplayMedia to include system audio),
  // get system audio, drop the video track, disable loopback again -- also when
  // getDisplayMedia fails, whose error is rethrown here.
  const systemStream = await openSystemAudio();

  // Verify we have audio tracks
  const systemTrack = systemStream?.getAudioTracks()[0];
  if (!systemStream || !systemTrack) {
    if (systemStream) releaseStream(systemStream);
    cleanup();
    throw new Error('No audio tracks in captured stream.');
  }

  // Step 5: Create AudioContext at 16kHz -- browser handles resampling from 48kHz.
  // With a 'none' sink where supported, so no output stream opens on the headset.
  const { ctx, sink, fallbackReason } = createCaptureContext(SAMPLE_RATE);
  audioContext = ctx;
  if (sink === 'default') emitAudioEvent('sink-fallback', null, fallbackReason);

  // Step 6: Build audio pipeline with GainNodes for mixing
  systemGainNode = audioContext.createGain();
  systemGainNode.gain.value = 1.0;

  mergerNode = audioContext.createChannelMerger(INPUT_CHANNELS);
  processorNode = audioContext.createScriptProcessor(BUFFER_SIZE, INPUT_CHANNELS, OUTPUT_CHANNELS);

  // Connect system audio: source → gain → merger input 1 (mic takes input 0)
  systemGainNode.connect(mergerNode, 0, SYSTEM_CHANNEL);
  mergerNode.connect(processorNode);
  connectSystem(systemStream);

  // Step 7: Optionally add microphone input: source → gain → merger input 0 (its own channel)
  currentMicDeviceId = micDeviceId;
  micEnabled = includeMic;
  if (includeMic) {
    const stream = await acquireMicStream(currentMicDeviceId);
    if (stream) connectMic(stream);
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
    // `micGainNode` is the live "mic is connected" flag: watchMicTrack's end
    // handler clears it and only connectMic restores it, so a null `mic` here
    // means the device genuinely produced nothing for this window.
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

  emitAudioEvent(
    'capture-started',
    null,
    `mic=${describeMic(includeMic)} system="${trackLabel(systemTrack)}" sink=${sink}`,
  );

  // Step 9: Re-acquire a lost (or default-switched) channel when its device is back.
  const session = captureSession;
  deviceWatcher = startDeviceWatcher({
    chosenMicId: micDeviceId,
    channelStates: () => ({ mic: micEnabled ? streamState(micStream) : 'off', system: streamState(mediaStream) }),
    reacquire: (channel, signal) => reacquire(channel, session, signal),
    onRecovered: (channel) => audioInterruptedCallback?.(channel, true),
  });
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
 * Fired when a mic or system audio track ends unexpectedly, and again when the
 * device watcher has re-acquired it.
 * - type: 'mic' | 'system' — which track was lost
 * - recovered: false when it was lost; true once a lost track was re-acquired
 * Pass null to remove.
 */
export function onAudioInterrupted(callback: ((type: 'mic' | 'system', recovered: boolean) => void) | null): void {
  audioInterruptedCallback = callback;
}

/**
 * Internal cleanup -- disconnect nodes, stop tracks, close context.
 */
function cleanup(): void {
  deviceWatcher?.stop();
  deviceWatcher = null;
  captureSession++; // an in-flight re-acquisition now sees a stopped capture
  micEnabled = false;
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
    releaseStream(micStream);
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
    releaseStream(mediaStream);
    mediaStream = null;
  }
  if (audioContext) {
    audioContext.close().catch(() => {});
    audioContext = null;
  }
}
