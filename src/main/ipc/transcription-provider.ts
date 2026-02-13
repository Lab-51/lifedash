// === FILE PURPOSE ===
// IPC handlers for transcription provider configuration — get/set provider type,
// manage API keys, and test provider availability.
//
// === DEPENDENCIES ===
// Electron (ipcMain), transcriptionProviderService, whisperModelManager

import { ipcMain } from 'electron';
import * as transcriptionProviderService from '../services/transcriptionProviderService';
import type { TranscriptionProviderType } from '../../shared/types';

export function registerTranscriptionProviderHandlers(): void {
  ipcMain.handle('transcription:get-config', async () => {
    return transcriptionProviderService.getStatus();
  });

  ipcMain.handle(
    'transcription:set-provider',
    async (_event, type: TranscriptionProviderType) => {
      await transcriptionProviderService.setProviderType(type);
    },
  );

  ipcMain.handle(
    'transcription:set-api-key',
    async (_event, provider: 'deepgram' | 'assemblyai', apiKey: string) => {
      await transcriptionProviderService.setApiKey(provider, apiKey);
    },
  );

  ipcMain.handle(
    'transcription:test-provider',
    async (_event, type: TranscriptionProviderType) => {
      // Test implementation depends on provider:
      // 'local' -> check if whisperModelManager.getDefaultModelPath() returns non-null
      // 'deepgram' / 'assemblyai' -> wired in Task 2 (cloud provider adapters)
      if (type === 'local') {
        const { getDefaultModelPath } = await import('../services/whisperModelManager');
        const modelPath = getDefaultModelPath();
        return {
          success: !!modelPath,
          error: modelPath ? undefined : 'No Whisper model downloaded',
        };
      }

      // Cloud providers: test actual API connectivity
      if (type === 'deepgram') {
        const { testConnection } = await import('../services/deepgramTranscriber');
        return testConnection();
      }
      if (type === 'assemblyai') {
        const { testConnection } = await import('../services/assemblyaiTranscriber');
        return testConnection();
      }

      return { success: false, error: `Unknown provider type: ${type}` };
    },
  );
}
