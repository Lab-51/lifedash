// === Preload bridge: Transcription provider configuration ===
import { ipcRenderer } from 'electron';
import type { TranscriptionProviderType } from '../../shared/types';

export const transcriptionBridge = {
  transcriptionGetConfig: () => ipcRenderer.invoke('transcription:get-config'),
  transcriptionSetProvider: (type: TranscriptionProviderType) =>
    ipcRenderer.invoke('transcription:set-provider', type),
  transcriptionSetApiKey: (provider: 'deepgram' | 'assemblyai', apiKey: string) =>
    ipcRenderer.invoke('transcription:set-api-key', provider, apiKey),
  transcriptionTestProvider: (type: TranscriptionProviderType) =>
    ipcRenderer.invoke('transcription:test-provider', type),
};
