// === FILE PURPOSE ===
// Reusable hook for voice-to-text input.
// Captures raw 16kHz mono PCM from the microphone via AudioContext +
// ScriptProcessorNode (same pipeline as meeting recording), then sends
// the accumulated Int16 buffer to main for transcription.

import { useState, useRef, useCallback, useEffect } from 'react';

interface UseVoiceInputOptions {
  onTranscript: (text: string) => void;
}

function float32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return int16;
}

export function useVoiceInput({ onTranscript }: UseVoiceInputOptions) {
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const cleanup = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    chunksRef.current = [];
  }, []);

  const stopAndProcess = useCallback(async () => {
    if (!audioCtxRef.current) return;

    // Grab chunks before cleanup clears them
    const chunks = [...chunksRef.current];
    cleanup();
    setIsListening(false);
    if (chunks.length === 0) return;

    // Merge all captured chunks into one Float32Array
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    // Already at 16kHz (AudioContext created at that rate) — just convert to Int16
    const int16 = float32ToInt16(merged);

    if (int16.byteLength < 3200) return; // < 0.1s

    setIsProcessing(true);
    try {
      const result = await window.electronAPI.voiceTranscribe(int16.buffer as ArrayBuffer);
      if (result.text) {
        onTranscriptRef.current(result.text);
      }
    } catch (err) {
      console.error('Voice transcription failed:', err);
    } finally {
      setIsProcessing(false);
    }
  }, [cleanup]);

  const toggle = useCallback(async () => {
    if (isListening) {
      stopAndProcess();
      return;
    }

    try {
      // Match meeting capture: echo cancellation, noise suppression, auto gain
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      chunksRef.current = [];

      // 16kHz AudioContext — Chromium resamples the mic stream automatically
      // (same approach as audioCaptureService.ts for meeting recording)
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;

      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        // Copy because the buffer gets reused by the audio thread
        chunksRef.current.push(new Float32Array(input));
      };

      source.connect(processor);
      // ScriptProcessorNode requires connection to destination to fire events
      processor.connect(audioCtx.destination);

      setIsListening(true);
    } catch (err) {
      console.error('Failed to access microphone:', err);
      cleanup();
      setIsListening(false);
    }
  }, [isListening, stopAndProcess, cleanup]);

  // Cleanup on unmount
  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  return { isListening, isProcessing, toggle, stop: stopAndProcess };
}
