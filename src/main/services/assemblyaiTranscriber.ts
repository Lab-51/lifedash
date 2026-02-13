// === FILE PURPOSE ===
// AssemblyAI REST API transcriber — uploads audio and polls for
// transcription results. Uses upload + transcript + polling workflow.
//
// === DEPENDENCIES ===
// Electron net (for fetch in main process), transcriptionProviderService (for API key), wavefile (WAV conversion)
//
// === LIMITATIONS ===
// - Polling-based (adds 3-10 seconds of latency per segment)
// - No speaker diarization in this implementation (deferred to Plan 7.7)
// - English-only for now

import { net } from 'electron';
import { WaveFile } from 'wavefile';
import * as transcriptionProviderService from './transcriptionProviderService';
import type { TranscriberResult } from '../../shared/types';

const ASSEMBLYAI_API_URL = 'https://api.assemblyai.com/v2';
const POLL_INTERVAL_MS = 1000;
const MAX_POLL_ATTEMPTS = 30;

/**
 * Convert raw PCM buffer (16-bit mono 16kHz) to a WAV buffer.
 * AssemblyAI needs WAV format, not raw PCM.
 */
function pcmToWav(pcmBuffer: Buffer): Buffer {
  const wav = new WaveFile();
  wav.fromScratch(1, 16000, '16', pcmBuffer);
  return Buffer.from(wav.toBuffer());
}

/**
 * Transcribe a PCM audio segment using AssemblyAI's REST API.
 * Workflow: upload audio -> submit transcription -> poll until complete.
 * @param pcmBuffer Raw PCM audio (16-bit mono, 16kHz)
 * @param startTimeMs Absolute start time of this segment in the recording (ms)
 */
export async function transcribeSegment(
  pcmBuffer: Buffer,
  startTimeMs: number,
): Promise<TranscriberResult> {
  const apiKey = await transcriptionProviderService.getDecryptedKey('assemblyai');
  if (!apiKey) {
    throw new Error('AssemblyAI API key not configured');
  }

  // Step 1: Convert PCM to WAV
  const wavBuffer = pcmToWav(pcmBuffer);

  // Step 2: Upload audio
  const uploadResponse = await net.fetch(`${ASSEMBLYAI_API_URL}/upload`, {
    method: 'POST',
    headers: {
      'Authorization': apiKey, // No prefix for AssemblyAI
      'Content-Type': 'application/octet-stream',
    },
    body: new Uint8Array(wavBuffer),
  });

  if (!uploadResponse.ok) {
    const bodyText = await uploadResponse.text();
    throw new Error(`AssemblyAI upload error ${uploadResponse.status}: ${bodyText}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uploadData: any = await uploadResponse.json();
  const uploadUrl: string = uploadData.upload_url;

  if (!uploadUrl) {
    throw new Error('AssemblyAI upload did not return upload_url');
  }

  // Step 3: Submit transcription request
  const transcriptResponse = await net.fetch(`${ASSEMBLYAI_API_URL}/transcript`, {
    method: 'POST',
    headers: {
      'Authorization': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ audio_url: uploadUrl, language_code: 'en' }),
  });

  if (!transcriptResponse.ok) {
    const bodyText = await transcriptResponse.text();
    throw new Error(`AssemblyAI transcript error ${transcriptResponse.status}: ${bodyText}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transcriptData: any = await transcriptResponse.json();
  const transcriptId: string = transcriptData.id;

  if (!transcriptId) {
    throw new Error('AssemblyAI transcript did not return id');
  }

  // Step 4: Poll for result
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const pollResponse = await net.fetch(
      `${ASSEMBLYAI_API_URL}/transcript/${transcriptId}`,
      { headers: { 'Authorization': apiKey } },
    );

    if (!pollResponse.ok) {
      const bodyText = await pollResponse.text();
      throw new Error(`AssemblyAI poll error ${pollResponse.status}: ${bodyText}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await pollResponse.json();

    if (result.status === 'completed') {
      const text: string = result.text || '';

      // AssemblyAI words have { text, start, end, confidence } with ms timestamps
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const words: Array<{ text: string; start: number; end: number }> = result.words ?? [];

      if (words.length > 0) {
        return {
          text,
          segments: [{
            text,
            startMs: startTimeMs + words[0].start,
            endMs: startTimeMs + words[words.length - 1].end,
          }],
        };
      }

      return {
        text,
        segments: [{
          text,
          startMs: startTimeMs,
          endMs: startTimeMs + 10000,
        }],
      };
    }

    if (result.status === 'error') {
      throw new Error(`AssemblyAI error: ${result.error}`);
    }

    // status is 'queued' or 'processing' — keep polling
  }

  throw new Error('AssemblyAI transcription timed out after polling');
}

/**
 * Test connectivity to AssemblyAI by uploading 1 second of silence.
 * A successful upload (200 OK + upload_url) proves authentication works.
 * We don't run a full transcription — upload success is sufficient.
 */
export async function testConnection(): Promise<{
  success: boolean;
  error?: string;
  latencyMs?: number;
}> {
  const start = Date.now();
  try {
    const apiKey = await transcriptionProviderService.getDecryptedKey('assemblyai');
    if (!apiKey) {
      throw new Error('AssemblyAI API key not configured');
    }

    // 1 second of silence as WAV
    const silence = Buffer.alloc(32000);
    const wavBuffer = pcmToWav(silence);

    const uploadResponse = await net.fetch(`${ASSEMBLYAI_API_URL}/upload`, {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/octet-stream',
      },
      body: new Uint8Array(wavBuffer),
    });

    if (!uploadResponse.ok) {
      const bodyText = await uploadResponse.text();
      throw new Error(`Upload failed (${uploadResponse.status}): ${bodyText}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await uploadResponse.json();
    if (!data.upload_url) {
      throw new Error('Upload succeeded but no upload_url returned');
    }

    return { success: true, latencyMs: Date.now() - start };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'AssemblyAI connection failed';
    return { success: false, error: message, latencyMs: Date.now() - start };
  }
}
