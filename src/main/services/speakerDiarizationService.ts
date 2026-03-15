// === FILE PURPOSE ===
// Orchestrates post-recording speaker diarization. Reads the full WAV file,
// sends it to the configured API provider with diarization enabled, then maps
// speaker labels back to existing transcript segments by timestamp overlap.
//
// === DEPENDENCIES ===
// fs (read WAV file), meetingService, deepgramTranscriber, assemblyaiTranscriber,
// transcriptionProviderService
//
// === LIMITATIONS ===
// - Requires a cloud API provider (Deepgram or AssemblyAI) — local Whisper has no diarization
// - Requires audioPath to be set on the meeting (WAV file must exist on disk)
// - Speaker labels are best-effort — short meetings or quick speaker switches may be inaccurate

import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import * as meetingService from './meetingService';
import * as deepgramTranscriber from './deepgramTranscriber';
import * as assemblyaiTranscriber from './assemblyaiTranscriber';
import * as transcriptionProviderService from './transcriptionProviderService';
import { getDb } from '../db/connection';
import { settings } from '../db/schema';
import { createLogger } from './logger';
import type { DiarizationWord, TranscriptSegment } from '../../shared/types';

const log = createLogger('Diarization');

/**
 * Resolve which API provider to use for diarization.
 * Diarization requires a cloud provider — local Whisper has no diarization support.
 * If the active provider is 'local', we check if either API has a key configured.
 */
async function resolveProvider(): Promise<'deepgram' | 'assemblyai' | null> {
  const config = await transcriptionProviderService.getConfig();

  if (config.type === 'deepgram' || config.type === 'assemblyai') {
    return config.type;
  }

  // Active provider is 'local' — check if either API key is configured
  const deepgramKey = await transcriptionProviderService.getDecryptedKey('deepgram');
  if (deepgramKey) return 'deepgram';

  const assemblyaiKey = await transcriptionProviderService.getDecryptedKey('assemblyai');
  if (assemblyaiKey) return 'assemblyai';

  return null;
}

/**
 * Map diarization words to existing transcript segments by timestamp overlap.
 * For each segment, find all words whose time range overlaps the segment's range,
 * count speaker occurrences, and assign the majority speaker.
 */
function mapSpeakersToSegments(segments: TranscriptSegment[], words: DiarizationWord[]): Map<string, string> {
  const speakerMap = new Map<string, string>();

  for (const segment of segments) {
    // Find words that overlap this segment's time range
    const overlapping = words.filter((w) => w.startMs < segment.endTime && w.endMs > segment.startTime);

    if (overlapping.length === 0) continue;

    // Count speaker occurrences
    const counts = new Map<string, number>();
    for (const w of overlapping) {
      counts.set(w.speaker, (counts.get(w.speaker) ?? 0) + 1);
    }

    // Assign the majority speaker
    let maxCount = 0;
    let majoritySpeaker = '';
    for (const [speaker, count] of counts) {
      if (count > maxCount) {
        maxCount = count;
        majoritySpeaker = speaker;
      }
    }

    if (majoritySpeaker) {
      speakerMap.set(segment.id, majoritySpeaker);
    }
  }

  return speakerMap;
}

/**
 * Run post-recording speaker diarization on a completed meeting.
 * Reads the full WAV file, sends to cloud API with diarization enabled,
 * maps speaker labels to existing transcript segments, and updates the DB.
 */
export async function diarizeMeeting(
  meetingId: string,
): Promise<{ success: boolean; speakers: string[]; error?: string }> {
  try {
    // 1. Load meeting with transcript
    const meeting = await meetingService.getMeeting(meetingId);
    if (!meeting) {
      return { success: false, speakers: [], error: 'Meeting not found' };
    }

    // 2. Validate meeting state
    if (meeting.status !== 'completed') {
      return { success: false, speakers: [], error: 'Meeting must be completed before diarization' };
    }

    if (!meeting.audioPath) {
      return { success: false, speakers: [], error: 'No audio file available for this meeting' };
    }

    if (!fs.existsSync(meeting.audioPath)) {
      return { success: false, speakers: [], error: 'Audio file not found on disk' };
    }

    if (meeting.segments.length === 0) {
      return { success: false, speakers: [], error: 'No transcript segments to diarize' };
    }

    // 3. Resolve provider
    const provider = await resolveProvider();
    if (!provider) {
      return {
        success: false,
        speakers: [],
        error:
          'Speaker diarization requires a cloud transcription provider (Deepgram or AssemblyAI). Configure an API key in Settings.',
      };
    }

    // 4. Read WAV file
    const wavBuffer = fs.readFileSync(meeting.audioPath);

    // 5. Read language setting from DB (default: 'en')
    const db = getDb();
    const langRows = await db.select().from(settings).where(eq(settings.key, 'transcription:language'));
    const language = langRows.length > 0 ? langRows[0].value : 'en';

    // 6. Call provider with diarization
    log.info(`Starting ${provider} diarization for meeting ${meetingId}`);
    const result =
      provider === 'deepgram'
        ? await deepgramTranscriber.transcribeFileWithDiarization(wavBuffer, language)
        : await assemblyaiTranscriber.transcribeFileWithDiarization(wavBuffer, language);

    log.debug(`Got ${result.words.length} words, ${result.speakers.length} speakers`);

    // 7. Map speakers to existing segments
    const speakerMap = mapSpeakersToSegments(meeting.segments, result.words);

    // 8. Update DB
    if (speakerMap.size > 0) {
      await meetingService.updateSegmentSpeakers(meetingId, speakerMap);
      log.debug(`Updated ${speakerMap.size} segments with speaker labels`);
    }

    return { success: true, speakers: result.speakers };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Diarization failed';
    log.error('Error:', message);
    return { success: false, speakers: [], error: message };
  }
}
