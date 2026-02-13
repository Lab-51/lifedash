// === FILE PURPOSE ===
// Meeting CRUD service — data access layer for meetings and transcript segments.
// Used by IPC handlers. Plans 4.2-4.3 extend this with recording/transcription.

// === DEPENDENCIES ===
// drizzle-orm, ../db/connection, ../db/schema

// === LIMITATIONS ===
// - No pagination on list queries yet.
// - No recording/transcription logic (that's Plans 4.2-4.3).

import { eq, desc, asc } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { meetings, transcripts } from '../db/schema';
import type {
  Meeting,
  MeetingWithTranscript,
  TranscriptSegment,
  CreateMeetingInput,
  UpdateMeetingInput,
} from '../../shared/types';

/** Map a DB meeting row to the shared Meeting type (timestamps -> ISO strings) */
function toMeeting(row: typeof meetings.$inferSelect): Meeting {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    audioPath: row.audioPath,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Map a DB transcript row to the shared TranscriptSegment type */
function toTranscriptSegment(row: typeof transcripts.$inferSelect): TranscriptSegment {
  return {
    id: row.id,
    meetingId: row.meetingId,
    content: row.content,
    startTime: row.startTime,
    endTime: row.endTime,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getMeetings(): Promise<Meeting[]> {
  const db = getDb();
  const rows = await db.select().from(meetings).orderBy(desc(meetings.startedAt));
  return rows.map(toMeeting);
}

export async function getMeeting(id: string): Promise<MeetingWithTranscript | null> {
  const db = getDb();
  const [row] = await db.select().from(meetings).where(eq(meetings.id, id));
  if (!row) return null;

  const segments = await db
    .select()
    .from(transcripts)
    .where(eq(transcripts.meetingId, id))
    .orderBy(asc(transcripts.startTime));

  return {
    ...toMeeting(row),
    segments: segments.map(toTranscriptSegment),
  };
}

export async function createMeeting(data: CreateMeetingInput): Promise<Meeting> {
  const db = getDb();
  const [row] = await db
    .insert(meetings)
    .values({
      title: data.title,
      projectId: data.projectId ?? null,
      startedAt: new Date(),
      status: 'recording',
    })
    .returning();
  return toMeeting(row);
}

export async function updateMeeting(id: string, data: UpdateMeetingInput): Promise<Meeting> {
  const db = getDb();
  const updateData: Record<string, unknown> = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.projectId !== undefined) updateData.projectId = data.projectId;
  if (data.endedAt !== undefined) updateData.endedAt = new Date(data.endedAt);
  if (data.audioPath !== undefined) updateData.audioPath = data.audioPath;
  if (data.status !== undefined) updateData.status = data.status;

  const [row] = await db
    .update(meetings)
    .set(updateData)
    .where(eq(meetings.id, id))
    .returning();
  return toMeeting(row);
}

export async function deleteMeeting(id: string): Promise<void> {
  const db = getDb();
  await db.delete(meetings).where(eq(meetings.id, id));
}

export async function addTranscriptSegment(
  meetingId: string,
  content: string,
  startTime: number,
  endTime: number,
): Promise<TranscriptSegment> {
  const db = getDb();
  const [row] = await db
    .insert(transcripts)
    .values({ meetingId, content, startTime, endTime })
    .returning();
  return toTranscriptSegment(row);
}

export async function getTranscripts(meetingId: string): Promise<TranscriptSegment[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(transcripts)
    .where(eq(transcripts.meetingId, meetingId))
    .orderBy(asc(transcripts.startTime));
  return rows.map(toTranscriptSegment);
}
