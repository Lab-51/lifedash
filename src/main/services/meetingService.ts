// === FILE PURPOSE ===
// Meeting CRUD service — data access layer for meetings and transcript segments.
// Used by IPC handlers. Plans 4.2-4.3 extend this with recording/transcription.

// === DEPENDENCIES ===
// drizzle-orm, ../db/connection, ../db/schema

// === LIMITATIONS ===
// - No pagination on list queries yet.
// - No recording/transcription logic (that's Plans 4.2-4.3).

import { eq, desc, asc, count, inArray, ilike, and, ne } from 'drizzle-orm';
import fsp from 'node:fs/promises';
import { getDb } from '../db/connection';
import { meetings, transcripts, meetingBriefs, actionItems, twinFacts } from '../db/schema';
import { autoPushActionItems, readAutoPushSetting } from './autoPushService';
import { notifyDataChanged } from './dataChangeNotifier';
import { createLogger } from './logger';
import { getActiveMeetingId } from './recordingState';
import { labelFor } from '../../shared/twin/factLabel';
import type {
  Meeting,
  MeetingStatus,
  MeetingBrief,
  ActionItem,
  MeetingWithTranscript,
  TranscriptSegment,
  TranscriptSearchResult,
  CreateMeetingInput,
  UpdateMeetingInput,
  DeleteMeetingOptions,
  MeetingDeleteImpact,
} from '../../shared/types';

const log = createLogger('MeetingService');

/** Max fact labels returned by getMeetingDeleteImpact's preview. */
const IMPACT_FACT_LABEL_PREVIEW_COUNT = 8;

// ---------------------------------------------------------------------------
// Meeting-completed hook seam (TWIN-LEARN.1)
// ---------------------------------------------------------------------------
// A recording that reaches 'completed' must ALWAYS get its post-session work
// (brief, action items, twin learning) — whether or not the session page is ever
// opened. The status transition inside updateMeeting is the one main-side seam
// every completion path funnels through, but meetingIntelligenceService already
// imports THIS module, so calling it directly would be a cycle. Same fix the
// V3.4 learning modules use for the same problem: a tiny registry the consumer
// self-registers with (see postSessionDispatcher + entityFactService).
//
// Contract, mirroring postSessionDispatcher's:
//  - FIRE-AND-FORGET: updateMeeting never waits on a hook.
//  - ERROR-ISOLATED: a hook that throws or rejects can NEVER fail or delay
//    updateMeeting, and one failing hook never stops the others.
//  - TRANSITION-ONLY: fires on prev !== 'completed' → 'completed', so a repeat
//    write of the same status is a no-op at the seam itself.

/** A meeting-completed hook, receiving the id of the meeting that just reached
 *  'completed'. May be sync or async, and may throw/reject freely — the runner
 *  below isolates it. */
export type MeetingCompletedHook = (meetingId: string) => void | Promise<void>;

const meetingCompletedHooks: MeetingCompletedHook[] = [];

/** Register a hook to run when a meeting first reaches status 'completed'.
 *  Registration order is the run order. */
export function registerMeetingCompletedHook(hook: MeetingCompletedHook): void {
  meetingCompletedHooks.push(hook);
}

/** Clear all registered meeting-completed hooks. Test-only — keeps suites isolated. */
export function _resetMeetingCompletedHooks(): void {
  meetingCompletedHooks.length = 0;
}

/** Runs every hook, isolating each one. NEVER rejects — which is what makes the
 *  detached (un-awaited) call in updateMeeting safe. */
async function runMeetingCompletedHooks(meetingId: string): Promise<void> {
  for (const hook of meetingCompletedHooks) {
    try {
      await hook(meetingId);
    } catch (err) {
      log.error(`Meeting-completed hook failed for meeting ${meetingId}:`, err);
    }
  }
}

/** Thrown by deleteMeeting when the target meeting is the one currently being
 *  recorded — deleting it out from under an in-progress recording would pull the
 *  row out from under audioProcessor/transcriptionService mid-write. */
export class ActiveRecordingDeleteError extends Error {
  constructor(message = 'Cannot delete a meeting while it is currently recording.') {
    super(message);
    this.name = 'ActiveRecordingDeleteError';
  }
}

/** Map a DB meeting row to the shared Meeting type (timestamps -> ISO strings) */
function toMeeting(row: typeof meetings.$inferSelect): Meeting {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    template: row.template,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    audioPath: row.audioPath,
    status: row.status,
    prepBriefing: row.prepBriefing ?? null,
    transcriptionLanguage: row.transcriptionLanguage ?? null,
    unassignedPending: row.unassignedPending,
    calendarEventId: row.calendarEventId ?? null,
    calendarSeriesId: row.calendarSeriesId ?? null,
    participants: row.participants ?? null,
    speakerNames: row.speakerNames ?? null,
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
    speaker: row.speaker ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toBrief(row: typeof meetingBriefs.$inferSelect): MeetingBrief {
  return {
    id: row.id,
    meetingId: row.meetingId,
    summary: row.summary,
    // The `structure` jsonb column is validated on the way out by the service
    // that writes it (meetingIntelligenceService.parseBriefStructure). Here it is
    // passed through as-is: this mapper feeds the detail view, and a brief whose
    // structure failed validation must still render its summary.
    structure: (row.structure as MeetingBrief['structure']) ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toActionItem(row: typeof actionItems.$inferSelect): ActionItem {
  return {
    id: row.id,
    meetingId: row.meetingId,
    cardId: row.cardId,
    description: row.description,
    owner: row.owner ?? null,
    dueText: row.dueText ?? null,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Get total count of pending action items across all meetings */
export async function getPendingActionCount(): Promise<number> {
  const db = getDb();
  const [row] = await db.select({ value: count() }).from(actionItems).where(eq(actionItems.status, 'pending'));
  return row?.value ?? 0;
}

/** Get action item counts for a batch of meetings (meetingId -> count) */
export async function getActionItemCounts(meetingIds: string[]): Promise<Record<string, number>> {
  if (meetingIds.length === 0) return {};
  const db = getDb();
  const rows = await db
    .select({ meetingId: actionItems.meetingId, value: count() })
    .from(actionItems)
    .where(
      and(
        inArray(actionItems.meetingId, meetingIds),
        ne(actionItems.status, 'dismissed'),
        ne(actionItems.status, 'converted'),
      ),
    )
    .groupBy(actionItems.meetingId);

  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.meetingId] = row.value;
  }
  return result;
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

  const [briefRow] = await db
    .select()
    .from(meetingBriefs)
    .where(eq(meetingBriefs.meetingId, id))
    .orderBy(desc(meetingBriefs.createdAt))
    .limit(1);

  const actionRows = await db
    .select()
    .from(actionItems)
    .where(eq(actionItems.meetingId, id))
    .orderBy(asc(actionItems.createdAt));

  return {
    ...toMeeting(row),
    segments: segments.map(toTranscriptSegment),
    brief: briefRow ? toBrief(briefRow) : null,
    actionItems: actionRows.map(toActionItem),
  };
}

export async function createMeeting(data: CreateMeetingInput): Promise<Meeting> {
  const db = getDb();
  const [row] = await db
    .insert(meetings)
    .values({
      title: data.title,
      projectId: data.projectId ?? null,
      template: data.template ?? 'none',
      prepBriefing: data.prepBriefing ?? null,
      transcriptionLanguage: data.transcriptionLanguage ?? null,
      calendarEventId: data.calendarEventId ?? null,
      calendarSeriesId: data.calendarSeriesId ?? null,
      participants: data.participants ?? null,
      startedAt: new Date(),
      status: 'recording',
    })
    .returning();
  return toMeeting(row);
}

/**
 * Update a meeting's participant list (BRIEF-QUAL.1) — a dedicated write, kept
 * separate from updateMeeting so a roster edit never touches the project-link /
 * completion-transition logic that guards that function.
 */
export async function updateMeetingParticipants(meetingId: string, participants: string[]): Promise<Meeting> {
  const db = getDb();
  const [row] = await db.update(meetings).set({ participants }).where(eq(meetings.id, meetingId)).returning();
  return toMeeting(row);
}

/** Map the partial update input to the DB column set (only provided fields). */
function buildMeetingUpdateData(data: UpdateMeetingInput): Record<string, unknown> {
  const updateData: Record<string, unknown> = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.projectId !== undefined) updateData.projectId = data.projectId;
  if (data.endedAt !== undefined) updateData.endedAt = new Date(data.endedAt);
  if (data.audioPath !== undefined) updateData.audioPath = data.audioPath;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.unassignedPending !== undefined) updateData.unassignedPending = data.unassignedPending;
  return updateData;
}

/** The row values as they were BEFORE an update — the UPDATE's own `returning`
 *  yields the new row only, so anything transition-shaped has to be read first.
 *  Two consumers:
 *   - projectId: detect a REAL project change (link / switch / unlink), which
 *     drives link-time auto-push and a refresh broadcast (the Brain and
 *     project-keyed boards only update on a data:changed event — a relink is
 *     otherwise invisible to them).
 *   - status: detect the transition into 'completed' that fires the
 *     meeting-completed hooks (TWIN-LEARN.1).
 *  Returns undefined without querying when the write touches neither field, so a
 *  plain title/endedAt edit still costs exactly one statement, as before. */
async function readPreviousMeetingState(
  id: string,
  data: UpdateMeetingInput,
): Promise<{ projectId: string | null; status: MeetingStatus } | undefined> {
  if (data.projectId === undefined && data.status === undefined) return undefined;
  const db = getDb();
  const [current] = await db
    .select({ projectId: meetings.projectId, status: meetings.status })
    .from(meetings)
    .where(eq(meetings.id, id));
  return current;
}

/** True only when this write is the moment the meeting FINISHED, never for a
 *  repeat write of a status it already had (TWIN-LEARN.1). `previous` is
 *  undefined when the update didn't read it, which is never a transition. */
function isCompletionTransition(previous: { status: MeetingStatus } | undefined, nextStatus: MeetingStatus): boolean {
  if (!previous) return false;
  return previous.status !== 'completed' && nextStatus === 'completed';
}

export async function updateMeeting(id: string, data: UpdateMeetingInput): Promise<Meeting> {
  const db = getDb();

  const previous = await readPreviousMeetingState(id, data);
  const oldProjectId = data.projectId !== undefined ? (previous?.projectId ?? null) : undefined;
  const newlyLinked = data.projectId != null && oldProjectId === null;

  const updateData = buildMeetingUpdateData(data);
  const [row] = await db.update(meetings).set(updateData).where(eq(meetings.id, id)).returning();

  // Trigger auto-push for pending items when the meeting is newly linked to a project
  if (newlyLinked && data.projectId != null) {
    const pendingItems = await db
      .select()
      .from(actionItems)
      .where(and(eq(actionItems.meetingId, id), eq(actionItems.status, 'pending')));

    if (pendingItems.length > 0) {
      const autoPushEnabled = await readAutoPushSetting(db);
      try {
        await autoPushActionItems({
          db,
          meetingId: id,
          projectId: data.projectId,
          actionItems: pendingItems.map(toActionItem),
          userSettings: { autoPushEnabled },
        });
      } catch (err) {
        // Auto-push failure must NOT roll back the project linkage
        log.error('Link-time auto-push failed for meeting', id, ':', err);
      }
    }
  }

  // A project link CHANGE (link / switch / unlink) isn't otherwise a data:changed
  // event, so the Brain's session-scope tree and any project-keyed board would go
  // stale. Emit ONLY when projectId actually changed (never on plain title/status/
  // endedAt edits, to avoid a broadcast storm). scope 'projects' wakes
  // useBrainLiveSync (refreshes the active Brain scope regardless of projectId) and
  // useBoardLiveSync for the affected project. Covers the dropdown, auto-detect,
  // accept-chip, agent tool, and Unassigned reassignment — they all funnel here.
  if (data.projectId !== undefined && data.projectId !== oldProjectId) {
    notifyDataChanged({ scope: 'projects', projectId: data.projectId ?? oldProjectId ?? undefined });
  }

  // TWIN-LEARN.1: the meeting just FINISHED. Fires only on the transition, and
  // only after the row is persisted (a hook's first read must see 'completed').
  // Detached on purpose — `void` marks it intentionally un-awaited, and
  // runMeetingCompletedHooks never rejects, so stopRecording can neither be
  // delayed nor failed by post-session generation.
  if (isCompletionTransition(previous, row.status)) {
    void runMeetingCompletedHooks(id);
  }

  return toMeeting(row);
}

/**
 * Read-only preview of what deleting a meeting would affect (MEET-DEL.1) — no
 * side effects. Used by the confirm UI before the user picks the default
 * (forget) or keep path.
 */
export async function getMeetingDeleteImpact(id: string): Promise<MeetingDeleteImpact> {
  const db = getDb();

  const [meetingRow] = await db.select({ audioPath: meetings.audioPath }).from(meetings).where(eq(meetings.id, id));

  // No status filter: a delete expunges BOTH active and forgotten facts, so the
  // impact preview counts both. Ordered so "first 8" is deterministic.
  const facts = await db
    .select()
    .from(twinFacts)
    .where(eq(twinFacts.sourceMeetingId, id))
    .orderBy(asc(twinFacts.createdAt));

  const [briefRow] = await db
    .select({ id: meetingBriefs.id })
    .from(meetingBriefs)
    .where(eq(meetingBriefs.meetingId, id))
    .limit(1);

  const [{ value: transcriptSegmentCount }] = await db
    .select({ value: count() })
    .from(transcripts)
    .where(eq(transcripts.meetingId, id));

  let audioBytes = 0;
  if (meetingRow?.audioPath) {
    try {
      const stat = await fsp.stat(meetingRow.audioPath);
      audioBytes = stat.size;
    } catch {
      audioBytes = 0; // missing/unreadable file — the preview reports 0, never throws
    }
  }

  return {
    factCount: facts.length,
    // labelFor() is the ONLY accessor a fact label is ever read through — a raw
    // null (unlabelled fact) is never returned here.
    factLabels: facts.slice(0, IMPACT_FACT_LABEL_PREVIEW_COUNT).map((fact) => labelFor(fact)),
    audioBytes,
    hasBrief: !!briefRow,
    transcriptSegmentCount,
  };
}

/**
 * Delete a meeting and its learned-fact influence in one transaction
 * (MEET-DEL.1). Default path hard-deletes the meeting's twin_facts (both
 * active and forgotten — the source is being expunged, not "forgotten by
 * choice"); `keepLearnedFacts: true` instead snapshots human-readable
 * provenance onto each fact and leaves the rows alive with their FK nulled by
 * the schema's own `onDelete: 'set null'` when the meeting row goes. Briefs /
 * transcripts / action items already cascade via their own FK — not
 * re-implemented here. Audio cleanup happens AFTER commit and never throws: a
 * successful DB deletion must never be reported as a failure because of a
 * file-system hiccup.
 */
export async function deleteMeeting(id: string, opts?: DeleteMeetingOptions): Promise<void> {
  if (getActiveMeetingId() === id) {
    throw new ActiveRecordingDeleteError();
  }

  const db = getDb();

  // Read BEFORE the row is gone: audioPath (post-commit unlink) and title (the
  // keep-path provenance snapshot) are both unreadable once the row is deleted.
  const [row] = await db
    .select({ audioPath: meetings.audioPath, title: meetings.title })
    .from(meetings)
    .where(eq(meetings.id, id));
  const audioPath = row?.audioPath ?? null;

  await db.transaction(async (tx) => {
    if (opts?.keepLearnedFacts) {
      const snapshotLabel = `${row?.title ?? 'Untitled meeting'} — deleted ${new Date().toISOString().slice(0, 10)}`;
      await tx.update(twinFacts).set({ sourceMeetingLabel: snapshotLabel }).where(eq(twinFacts.sourceMeetingId, id));
    } else {
      await tx.delete(twinFacts).where(eq(twinFacts.sourceMeetingId, id));
    }

    // Cascades briefs/transcripts/action items (onDelete: 'cascade'), and sets
    // sourceMeetingId null on any fact row still pointing here — the keep path
    // only, since the default path already removed them above.
    await tx.delete(meetings).where(eq(meetings.id, id));
  });

  if (!audioPath) return;

  try {
    await fsp.unlink(audioPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      log.debug(`Recording already absent, nothing to remove: ${audioPath}`);
    } else {
      // DB deletion already committed — a file-cleanup failure must never
      // surface as a deletion failure. Log once and move on.
      log.error(`Failed to remove recording file after meeting delete: ${audioPath}`, err);
    }
  }
}

/**
 * Persist one transcript segment.
 *
 * @param speaker Optional capture-time speaker label. `'Me'` is written for the
 *   microphone channel (SPEAKER.1); everything else stays null, which is what
 *   the renderer and the brief prompts already treat as "unlabelled". Omitting
 *   it is identical to passing null, so existing callers are unaffected.
 */
export async function addTranscriptSegment(
  meetingId: string,
  content: string,
  startTime: number,
  endTime: number,
  speaker?: string | null,
): Promise<TranscriptSegment> {
  const db = getDb();
  const [row] = await db
    .insert(transcripts)
    .values({
      meetingId,
      content,
      startTime: Math.round(startTime),
      endTime: Math.round(endTime),
      speaker: speaker ?? null,
    })
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

/**
 * Update speaker labels for transcript segments of a meeting.
 * @param meetingId The meeting to update
 * @param speakerMap Map of segment ID -> speaker label
 */
export async function updateSegmentSpeakers(meetingId: string, speakerMap: Map<string, string>): Promise<void> {
  const db = getDb();
  for (const [segmentId, speaker] of speakerMap) {
    await db.update(transcripts).set({ speaker }).where(eq(transcripts.id, segmentId));
  }
}

export async function searchTranscripts(query: string, limit = 20): Promise<TranscriptSearchResult[]> {
  const db = getDb();
  const escaped = query.replace(/%/g, '\\%').replace(/_/g, '\\_');
  const rows = await db
    .select({
      segmentId: transcripts.id,
      meetingId: transcripts.meetingId,
      meetingTitle: meetings.title,
      content: transcripts.content,
      startTime: transcripts.startTime,
      speaker: transcripts.speaker,
      startedAt: meetings.startedAt,
    })
    .from(transcripts)
    .innerJoin(meetings, eq(transcripts.meetingId, meetings.id))
    .where(ilike(transcripts.content, `%${escaped}%`))
    .orderBy(desc(meetings.startedAt), asc(transcripts.startTime))
    .limit(limit);

  return rows.map((row) => ({
    segmentId: row.segmentId,
    meetingId: row.meetingId,
    meetingTitle: row.meetingTitle,
    content: row.content,
    startTime: row.startTime,
    speaker: row.speaker ?? null,
  }));
}
