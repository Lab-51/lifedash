// === FILE PURPOSE ===
// Audio capture bridge -- thin layer that captures system audio via
// electron-audio-loopback, extracts PCM via ScriptProcessorNode,
// and streams Int16 chunks to the main process via IPC.
//
// === DEPENDENCIES ===
// Web Audio API (AudioContext, ScriptProcessorNode), window.electronAPI
//
// === LIMITATIONS ===
// - Uses deprecated ScriptProcessorNode (migrate to AudioWorklet in v2)
// - Single recording at a time
// - getDisplayMedia shows system picker dialog (user must select screen)
// - No audio level metering (future enhancement)

const SAMPLE_RATE = 16000; // 16kHz for Whisper
const BUFFER_SIZE = 4096; // ScriptProcessorNode buffer size (samples per callback)
const INPUT_CHANNELS = 1; // Mono (browser handles stereo->mono downmix)
const OUTPUT_CHANNELS = 1; // Mono output

let audioContext: AudioContext | null = null;
let mediaStream: MediaStream | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let processorNode: ScriptProcessorNode | null = null;

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
 * Start capturing system audio.
 *
 * Flow:
 * 1. Enable loopback audio (patches getDisplayMedia)
 * 2. Call getDisplayMedia (shows system picker -- user selects screen)
 * 3. Remove video tracks (we only need audio)
 * 4. Disable loopback (restore normal getDisplayMedia)
 * 5. Create AudioContext at 16kHz (browser resamples automatically)
 * 6. Connect: MediaStreamSource -> ScriptProcessorNode
 * 7. On each audio buffer: convert Float32->Int16, send to main via IPC
 *
 * @throws If user cancels the picker dialog or audio capture fails
 */
export async function startCapture(): Promise<void> {
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

  // Step 6: Connect audio pipeline
  sourceNode = audioContext.createMediaStreamSource(mediaStream);
  processorNode = audioContext.createScriptProcessor(
    BUFFER_SIZE,
    INPUT_CHANNELS,
    OUTPUT_CHANNELS,
  );

  // Step 7: Extract PCM and send to main
  processorNode.onaudioprocess = (event: AudioProcessingEvent) => {
    const float32Data = event.inputBuffer.getChannelData(0);
    const int16Data = float32ToInt16(float32Data);
    // Send raw Int16 PCM bytes to main process (one-way, fire-and-forget)
    // Cast is safe: Int16Array created via `new Int16Array(n)` always uses ArrayBuffer
    window.electronAPI.sendAudioChunk(int16Data.buffer as ArrayBuffer);
  };

  sourceNode.connect(processorNode);
  // Connect to destination to keep the processor running
  // (ScriptProcessorNode requires being connected to output)
  processorNode.connect(audioContext.destination);

  console.log('[AudioCapture] Started -- 16kHz mono Int16 PCM');
}

/**
 * Stop capturing audio and clean up all resources.
 */
export async function stopCapture(): Promise<void> {
  cleanup();
  console.log('[AudioCapture] Stopped');
}

/**
 * Check if currently capturing.
 */
export function isCapturing(): boolean {
  return audioContext !== null;
}

/**
 * Internal cleanup -- disconnect nodes, stop tracks, close context.
 */
function cleanup(): void {
  if (processorNode) {
    processorNode.disconnect();
    processorNode.onaudioprocess = null;
    processorNode = null;
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
