// === Preload bridge: Voice-to-text input ===
import { ipcRenderer } from 'electron';

export const voiceInputBridge = {
  voiceTranscribe: (audioBuffer: ArrayBuffer) =>
    ipcRenderer.invoke('voice:transcribe', audioBuffer),
};
