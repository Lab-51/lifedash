// === FILE PURPOSE ===
// IPC handlers for transcription provider configuration — get/set provider type,
// manage API keys, and test provider availability.
//
// === DEPENDENCIES ===
// Electron (ipcMain), transcriptionProviderService, whisperModelManager

import { ipcMain } from 'electron';
import { z } from 'zod';
import * as transcriptionProviderService from '../services/transcriptionProviderService';
import { validateInput } from '../../shared/validation/ipc-validator';
import {
  transcriptionProviderTypeSchema,
  transcriptionApiKeyProviderSchema,
} from '../../shared/validation/schemas';

export function registerTranscriptionProviderHandlers(): void {
  ipcMain.handle('transcription:get-config', async () => {
    return transcriptionProviderService.getStatus();
  });

  ipcMain.handle(
    'transcription:set-provider',
    async (_event, type: unknown) => {
      const validType = validateInput(transcriptionProviderTypeSchema, type);
      await transcriptionProviderService.setProviderType(validType);
    },
  );

  ipcMain.handle(
    'transcription:set-api-key',
    async (_event, provider: unknown, apiKey: unknown) => {
      const validProvider = validateInput(transcriptionApiKeyProviderSchema, provider);
      const validApiKey = validateInput(z.string().min(1), apiKey);
      await transcriptionProviderService.setApiKey(validProvider, validApiKey);
    },
  );

  ipcMain.handle(
    'transcription:test-provider',
    async (_event, type: unknown) => {
      const validType = validateInput(transcriptionProviderTypeSchema, type);
      // Test implementation depends on provider:
      // 'local' -> check if whisperModelManager.getDefaultModelPath() returns non-null
      // 'deepgram' / 'assemblyai' -> wired in Task 2 (cloud provider adapters)
      if (validType === 'local') {
        const { getDefaultModelPath } = await import('../services/whisperModelManager');
        const modelPath = getDefaultModelPath();
        return {
          success: !!modelPath,
          error: modelPath ? undefined : 'No Whisper model downloaded',
        };
      }

      // Cloud providers: test actual API connectivity
      if (validType === 'deepgram') {
        const { testConnection } = await import('../services/deepgramTranscriber');
        return testConnection();
      }
      if (validType === 'assemblyai') {
        const { testConnection } = await import('../services/assemblyaiTranscriber');
        return testConnection();
      }

      return { success: false, error: `Unknown provider type: ${validType}` };
    },
  );
}
