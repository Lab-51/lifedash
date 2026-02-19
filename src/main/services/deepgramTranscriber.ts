// === FILE PURPOSE ===
// Deepgram REST API transcriber — sends PCM audio segments and receives
// transcribed text. Uses the /v1/listen endpoint with pre-recorded audio.
//
// === DEPENDENCIES ===
// Electron net (for fetch in main process), transcriptionProviderService (for API key)
//
// === LIMITATIONS ===
// - REST API (not WebSocket streaming) — transcribes 10-sec segments after recording
// - Speaker diarization via transcribeFileWithDiarization (full-file, post-recording)

import { net } from 'electron';
import * as transcriptionProviderService from './transcriptionProviderService';
import type { TranscriberResult, DiarizationResult, DiarizationWord } from '../../shared/types';

const DEEPGRAM_API_URL = 'https://api.deepgram.com/v1/listen';

// --- Deepgram API response types ---

interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
  speaker?: number;
}

interface DeepgramResponse {
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
        words?: DeepgramWord[];
      }>;
    }>;
  };
  metadata?: {
    duration?: number;
  };
}

/**
 * Transcribe a PCM audio segment using Deepgram's REST API.
 * @param pcmBuffer Raw PCM audio (16-bit mono, 16kHz)
 * @param startTimeMs Absolute start time of this segment in the recording (ms)
 * @param language Language code ('en', 'cs', etc.) or 'auto' for auto-detection (default: 'en')
 */
export async function transcribeSegment(
  pcmBuffer: Buffer,
  startTimeMs: number,
  language: string = 'en',
): Promise<TranscriberResult> {
  const apiKey = await transcriptionProviderService.getDecryptedKey('deepgram');
  if (!apiKey) {
    throw new Error('Deepgram API key not configured');
  }

  const langParam = language === 'auto' ? 'detect_language=true' : `language=${language}`;
  const url = `${DEEPGRAM_API_URL}?model=nova-2&${langParam}&punctuate=true&smart_format=true&encoding=linear16&sample_rate=16000`;

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

  const data = await response.json() as DeepgramResponse;

  const transcript: string =
    data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';

  const words: DeepgramWord[] =
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

/**
 * Transcribe a full WAV file with speaker diarization using Deepgram.
 * Returns words with speaker labels for post-recording speaker identification.
 * @param wavBuffer Complete WAV file buffer
 * @param language Language code ('en', 'cs', etc.) or 'auto' for auto-detection (default: 'en')
 */
export async function transcribeFileWithDiarization(
  wavBuffer: Buffer,
  language: string = 'en',
): Promise<DiarizationResult> {
  const apiKey = await transcriptionProviderService.getDecryptedKey('deepgram');
  if (!apiKey) throw new Error('Deepgram API key not configured');

  const langParam = language === 'auto' ? 'detect_language=true' : `language=${language}`;
  const url = `${DEEPGRAM_API_URL}?model=nova-2&${langParam}&punctuate=true&diarize=true&encoding=linear16&sample_rate=16000`;

  const response = await net.fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${apiKey}`,
      'Content-Type': 'audio/wav',
    },
    body: new Uint8Array(wavBuffer),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`Deepgram diarization error ${response.status}: ${bodyText}`);
  }

  const data = await response.json() as DeepgramResponse;
  const words: DeepgramWord[] = data.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];

  // Deepgram speakers are integers (0, 1, 2...) — normalize to "Speaker 1", "Speaker 2"
  const speakerSet = new Set<string>();
  const diarizationWords: DiarizationWord[] = words.map((w: DeepgramWord) => {
    const speaker = `Speaker ${(w.speaker ?? 0) + 1}`;
    speakerSet.add(speaker);
    return {
      text: w.word,
      startMs: Math.round((w.start ?? 0) * 1000),
      endMs: Math.round((w.end ?? 0) * 1000),
      speaker,
    };
  });

  const duration = data.metadata?.duration ?? 0;
  return {
    words: diarizationWords,
    speakers: Array.from(speakerSet).sort(),
    durationMs: Math.round(duration * 1000),
  };
}
