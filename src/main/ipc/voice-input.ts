// === FILE PURPOSE ===
// IPC handler for voice-to-text input. Receives raw 16kHz mono PCM Int16 from
// the renderer (decoded via AudioContext) and transcribes it using the
// configured provider (local Whisper or cloud API).

import { ipcMain } from 'electron';
import * as transcriptionProviderService from '../services/transcriptionProviderService';
import * as whisperModelManager from '../services/whisperModelManager';
import * as deepgramTranscriber from '../services/deepgramTranscriber';
import * as assemblyaiTranscriber from '../services/assemblyaiTranscriber';
import { createLogger } from '../services/logger';
import { getDb } from '../db/connection';
import { settings } from '../db/schema';
import { eq } from 'drizzle-orm';
import { validateInput } from '../../shared/validation/ipc-validator';
import { voiceAudioBufferSchema } from '../../shared/validation/schemas';

const log = createLogger('VoiceInput');

export function registerVoiceInputHandlers(): void {
  ipcMain.handle('voice:transcribe', async (_event, audioBuffer: unknown) => {
    const validBuffer = validateInput(voiceAudioBufferSchema, audioBuffer);

    const config = await transcriptionProviderService.getConfig();
    const provider = config.type;

    // Resolve language from settings
    const db = getDb();
    const langRows = await db.select().from(settings).where(eq(settings.key, 'transcription:language'));
    const language = langRows.length > 0 ? langRows[0].value : 'en';

    // Audio arrives as raw 16kHz mono Int16 PCM (decoded in the renderer)
    const pcmBuffer = Buffer.from(validBuffer);

    if (pcmBuffer.byteLength < 1600) {
      // Less than 0.05 seconds of audio — too short
      return { text: '' };
    }

    log.info(`Transcribing voice input (${(pcmBuffer.byteLength / 32000).toFixed(1)}s, provider: ${provider})`);

    if (provider === 'local') {
      const modelPath = await whisperModelManager.getDefaultModelPath();
      if (!modelPath) {
        throw new Error('No Whisper model installed. Go to Settings > Transcription to download one.');
      }

      const { context: ctx, backend } = await whisperModelManager.createWhisperContext(modelPath);
      log.info(`Whisper backend: ${backend}`);

      try {
        // Pass raw Int16 PCM ArrayBuffer to Whisper (same as transcriptionService)
        const arrayBuffer = pcmBuffer.buffer.slice(
          pcmBuffer.byteOffset,
          pcmBuffer.byteOffset + pcmBuffer.byteLength,
        ) as ArrayBuffer;

        const whisperOpts: Record<string, unknown> = {
          beamSize: 5,
          bestOf: 5,
          temperature: 0,
          temperatureInc: 0.2,
        };
        if (language !== 'auto') {
          whisperOpts.language = language;
        }

        const { promise } = ctx.transcribeData(arrayBuffer, whisperOpts);
        const result = await promise;
        const text = (result.result ?? '').trim();
        return { text };
      } finally {
        await ctx.release().catch(() => {});
      }
    } else if (provider === 'deepgram') {
      const result = await deepgramTranscriber.transcribeSegment(pcmBuffer, 0, language);
      return { text: result.text.trim() };
    } else if (provider === 'assemblyai') {
      const result = await assemblyaiTranscriber.transcribeSegment(pcmBuffer, 0, language);
      return { text: result.text.trim() };
    }

    throw new Error(`Unknown transcription provider: ${provider}`);
  });
}
