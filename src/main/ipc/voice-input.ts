// === FILE PURPOSE ===
// IPC handler for voice-to-text input. Receives a WebM audio blob from the
// renderer, decodes it to PCM, and transcribes it using the configured
// transcription provider (local Whisper or cloud API).

import { ipcMain } from 'electron';
import * as transcriptionProviderService from '../services/transcriptionProviderService';
import * as whisperModelManager from '../services/whisperModelManager';
import * as deepgramTranscriber from '../services/deepgramTranscriber';
import * as assemblyaiTranscriber from '../services/assemblyaiTranscriber';
import { createLogger } from '../services/logger';
import { getDb } from '../db/connection';
import { settings } from '../db/schema';
import { eq } from 'drizzle-orm';

const log = createLogger('VoiceInput');

/**
 * Decode a WebM/Opus audio buffer to 16kHz mono PCM Int16 using ffmpeg
 * via Electron's native module or a child process.
 */
async function webmToPcm(webmBuffer: Buffer): Promise<Buffer> {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const { tmpdir } = await import('os');
  const { join } = await import('path');
  const { writeFile, readFile, unlink } = await import('fs/promises');
  const { randomUUID } = await import('crypto');
  const execFileAsync = promisify(execFile);

  const id = randomUUID().slice(0, 8);
  const inputPath = join(tmpdir(), `voice-input-${id}.webm`);
  const outputPath = join(tmpdir(), `voice-input-${id}.pcm`);

  try {
    await writeFile(inputPath, webmBuffer);

    // Use ffmpeg to convert WebM/Opus -> 16kHz mono 16-bit PCM
    // ffmpeg should be available on the system or bundled with the app
    await execFileAsync('ffmpeg', [
      '-i', inputPath,
      '-f', 's16le',
      '-acodec', 'pcm_s16le',
      '-ar', '16000',
      '-ac', '1',
      '-y',
      outputPath,
    ], { timeout: 15000 });

    const pcm = await readFile(outputPath);
    return pcm;
  } finally {
    // Cleanup temp files
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}

export function registerVoiceInputHandlers(): void {
  ipcMain.handle('voice:transcribe', async (_event, audioBuffer: ArrayBuffer) => {
    if (!audioBuffer || audioBuffer.byteLength === 0) {
      throw new Error('No audio data received');
    }

    const config = await transcriptionProviderService.getConfig();
    const provider = config.type;

    // Resolve language from settings
    const db = getDb();
    const langRows = await db.select().from(settings).where(eq(settings.key, 'transcription:language'));
    const language = langRows.length > 0 ? langRows[0].value : 'en';

    // Convert WebM to PCM
    let pcmBuffer: Buffer;
    try {
      pcmBuffer = await webmToPcm(Buffer.from(audioBuffer));
    } catch (err) {
      log.error('Failed to decode audio:', err);
      throw new Error('Failed to decode audio. Ensure ffmpeg is installed.');
    }

    if (pcmBuffer.byteLength < 1600) {
      // Less than 0.05 seconds of audio — too short
      return { text: '' };
    }

    log.info(`Transcribing voice input (${(pcmBuffer.byteLength / 32000).toFixed(1)}s, provider: ${provider})`);

    if (provider === 'local') {
      const modelPath = whisperModelManager.getDefaultModelPath();
      if (!modelPath) {
        throw new Error('No Whisper model installed. Go to Settings > Transcription to download one.');
      }

      const { initWhisper } = await import('@fugood/whisper.node');
      const ctx = await initWhisper({ filePath: modelPath });

      try {
        // Convert Buffer to Float32Array for Whisper
        const int16 = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.byteLength / 2);
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) {
          float32[i] = int16[i] / 32768;
        }

        const whisperOpts: Record<string, unknown> = {};
        if (language !== 'auto') {
          whisperOpts.language = language;
        }

        const { promise } = ctx.transcribeData(float32.buffer, whisperOpts);
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
