// === Preload bridge: Transcription provider configuration ===
import { ipcRenderer } from 'electron';
import type { RetranscribeResult, RetranscribeSpanInput, TranscriptionProviderType } from '../../shared/types';

export const transcriptionBridge = {
  transcriptionGetConfig: () => ipcRenderer.invoke('transcription:get-config'),
  transcriptionSetProvider: (type: TranscriptionProviderType) => ipcRenderer.invoke('transcription:set-provider', type),
  transcriptionSetApiKey: (provider: 'deepgram' | 'assemblyai', apiKey: string) =>
    ipcRenderer.invoke('transcription:set-api-key', provider, apiKey),
  transcriptionTestProvider: (type: TranscriptionProviderType) =>
    ipcRenderer.invoke('transcription:test-provider', type),

  // Redo one span of a finished recording's transcript from its WAV
  // (TRANS-COV.1 Task 4). Resolves to a TYPED result and does NOT reject on a
  // refusal — check `ok` and print `reason`/`detail`.
  // The picker that calls this is Task 5; the models to offer are already
  // reachable through the existing `getWhisperModels()` (whisper:list-models),
  // filtered to `available === true` — no second channel for that.
  retranscribeSpan: (input: RetranscribeSpanInput): Promise<RetranscribeResult> =>
    ipcRenderer.invoke('transcript:retranscribe-span', input),
};
