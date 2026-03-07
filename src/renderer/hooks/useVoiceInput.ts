// === FILE PURPOSE ===
// Reusable hook for voice-to-text input.
// Records mic audio via MediaRecorder, sends to main process for transcription
// using the configured provider (local Whisper, Deepgram, or AssemblyAI).

import { useState, useRef, useCallback, useEffect } from 'react';

interface UseVoiceInputOptions {
  onTranscript: (text: string) => void;
}

export function useVoiceInput({ onTranscript }: UseVoiceInputOptions) {
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const stop = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
  }, []);

  const toggle = useCallback(async () => {
    if (isListening) {
      stop();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        setIsListening(false);

        // Stop mic stream
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;

        const chunks = chunksRef.current;
        chunksRef.current = [];
        if (chunks.length === 0) return;

        // Build audio blob and send to main for transcription
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const arrayBuffer = await blob.arrayBuffer();

        if (arrayBuffer.byteLength < 100) return;

        setIsProcessing(true);
        try {
          const result = await window.electronAPI.voiceTranscribe(arrayBuffer);
          if (result.text) {
            onTranscriptRef.current(result.text);
          }
        } catch (err) {
          console.error('Voice transcription failed:', err);
        } finally {
          setIsProcessing(false);
        }
      };

      recorder.start();
      setIsListening(true);
    } catch (err) {
      console.error('Failed to access microphone:', err);
      setIsListening(false);
    }
  }, [isListening, stop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stop();
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  return { isListening, isProcessing, toggle, stop };
}
