// === FILE PURPOSE ===
// Computes meeting analytics from transcript segments and action items.
// All values are derived on-demand (not stored) — always fresh.
//
// === DEPENDENCIES ===
// meetingService, drizzle (for action item counts)
//
// === LIMITATIONS ===
// - Speaker breakdown only available if meeting has been diarized
// - Words per minute is an approximation (based on total words / duration)

import { getDb } from '../db/connection';
import { meetings, transcripts, actionItems } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import type { MeetingAnalytics, SpeakerStats } from '../../shared/types';

/**
 * Calculate analytics for a completed meeting.
 * All values are derived from existing transcript segments and action items.
 */
export async function calculateAnalytics(meetingId: string): Promise<MeetingAnalytics> {
  const db = getDb();

  // 1. Load meeting record
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId));

  if (!meeting) {
    throw new Error(`Meeting ${meetingId} not found`);
  }

  // 2. Load all transcript segments
  const segments = await db.select().from(transcripts).where(eq(transcripts.meetingId, meetingId));

  // 3. Query action item counts by status
  const actionRows = await db
    .select({
      status: actionItems.status,
      count: sql<number>`count(*)::int`,
    })
    .from(actionItems)
    .where(eq(actionItems.meetingId, meetingId))
    .groupBy(actionItems.status);

  const actionItemCounts = {
    total: 0,
    pending: 0,
    approved: 0,
    dismissed: 0,
    converted: 0,
  };
  for (const row of actionRows) {
    const status = row.status as keyof typeof actionItemCounts;
    if (status in actionItemCounts && status !== 'total') {
      actionItemCounts[status] = row.count;
      actionItemCounts.total += row.count;
    }
  }

  // 4. Calculate duration
  const durationMs = meeting.endedAt
    ? new Date(meeting.endedAt.toISOString()).getTime() - new Date(meeting.startedAt.toISOString()).getTime()
    : 0;

  // 5. Calculate total words
  const totalWords = segments.reduce((sum, seg) => sum + seg.content.split(/\s+/).filter(Boolean).length, 0);

  // 6. Speaker breakdown (if diarized)
  const hasDiarization = segments.some((s) => s.speaker !== null);
  let speakers: SpeakerStats[] = [];

  if (hasDiarization) {
    const bySpkr = new Map<string, typeof segments>();
    for (const seg of segments) {
      const spkr = seg.speaker ?? 'Unknown';
      if (!bySpkr.has(spkr)) bySpkr.set(spkr, []);
      bySpkr.get(spkr)!.push(seg);
    }

    const totalTalkTime = segments.reduce((sum, s) => sum + (s.endTime - s.startTime), 0);

    speakers = Array.from(bySpkr.entries())
      .map(([speaker, segs]) => {
        const talkTimeMs = segs.reduce((sum, s) => sum + (s.endTime - s.startTime), 0);
        const wordCount = segs.reduce((sum, s) => sum + s.content.split(/\s+/).filter(Boolean).length, 0);
        return {
          speaker,
          segmentCount: segs.length,
          wordCount,
          talkTimeMs,
          talkTimePercent: totalTalkTime > 0 ? Math.round((talkTimeMs / totalTalkTime) * 100) : 0,
        };
      })
      .sort((a, b) => b.talkTimeMs - a.talkTimeMs);
  }

  // 7. Words per minute
  const durationMin = durationMs / 60000;
  const wordsPerMinute = durationMin > 0 ? Math.round(totalWords / durationMin) : 0;

  return {
    meetingId,
    durationMs,
    totalSegments: segments.length,
    totalWords,
    hasDiarization,
    speakers,
    actionItemCounts,
    wordsPerMinute,
  };
}
