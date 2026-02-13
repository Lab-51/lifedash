// === FILE PURPOSE ===
// Deepgram REST API transcriber — sends PCM audio segments and receives
// transcribed text. Uses the /v1/listen endpoint with pre-recorded audio.
//
// === DEPENDENCIES ===
// Electron net (for fetch in main process), transcriptionProviderService (for API key)
//
// === LIMITATIONS ===
// - REST API (not WebSocket streaming) — transcribes 10-sec segments after recording
// - English-only for now (language parameter hardcoded)
// - No speaker diarization in this implementation (deferred to Plan 7.7)

import { net } from 'electron';
import * as transcriptionProviderService from './transcriptionProviderService';
import type { TranscriberResult } from '../../shared/types';

const DEEPGRAM_API_URL = 'https://api.deepgram.com/v1/listen';

/**
 * Transcribe a PCM audio segment using Deepgram's REST API.
 * @param pcmBuffer Raw PCM audio (16-bit mono, 16kHz)
 * @param startTimeMs Absolute start time of this segment in the recording (ms)
 */
export async function transcribeSegment(
  pcmBuffer: Buffer,
  startTimeMs: number,
): Promise<TranscriberResult> {
  const apiKey = await transcriptionProviderService.getDecryptedKey('deepgram');
  if (!apiKey) {
    throw new Error('Deepgram API key not configured');
  }

  const url = `${DEEPGRAM_API_URL}?model=nova-2&language=en&punctuate=true&smart_format=true&encoding=linear16&sample_rate=16000`;

  const response = await net.fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${apiKey}`,
      'Content-Type': 'audio/raw',
    },
    body: new Uint8Array(pcmBuffer),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`Deepgram API error ${response.status}: ${bodyText}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await response.json();

  const transcript: string =
    data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const words: Array<{ word: string; start: number; end: number; confidence: number }> =
    data.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];

  // Build result — word timing is in seconds (float), convert to ms
  if (words.length === 0) {
    return {
      text: transcript,
      segments: [{
        text: transcript,
        startMs: startTimeMs,
        endMs: startTimeMs + 10000,
      }],
    };
  }

  return {
    text: transcript,
    segments: [{
      text: transcript,
      startMs: startTimeMs + Math.round((words[0]?.start ?? 0) * 1000),
      endMs: startTimeMs + Math.round((words[words.length - 1]?.end ?? 10) * 1000),
    }],
  };
}

/**
 * Test connectivity to Deepgram by sending 1 second of silence.
 * A 200 OK response (even with empty transcript) confirms auth works.
 */
export async function testConnection(): Promise<{
  success: boolean;
  error?: string;
  latencyMs?: number;
}> {
  const start = Date.now();
  try {
    // 1 second of silence: 16000 samples * 2 bytes = 32000 bytes
    const silence = Buffer.alloc(32000);
    await transcribeSegment(silence, 0);
    return { success: true, latencyMs: Date.now() - start };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Deepgram connection failed';
    return { success: false, error: message, latencyMs: Date.now() - start };
  }
}
