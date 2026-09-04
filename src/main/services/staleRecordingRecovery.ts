// === FILE PURPOSE ===
// Every-launch reconciliation that closes meetings left stuck at
// status 'recording' because the app was closed or crashed mid-recording.
//
// === WHY THIS EXISTS ===
// The ONLY place a meeting transitions to 'completed' is the RENDERER's stop
// flow (recordingStore.ts, step 4: updateMeeting with endedAt + status). Main
// never writes that transition. So if the window is closed, the process is
// killed, or the app crashes while recording, the row keeps
// status 'recording' with ended_at NULL — forever. The sessions list renders
// `ended_at === null` as "Running..." (MeetingCardModern.tsx), so those
// meetings sit there looking live, with no way to clear them and nothing that
// ever reconciles them. sessionRecoveryService writes a crash marker and
// snapshots the active recording, but nothing consumes that to close the row.
//
// === WHY IT IS *NOT* ONE-SHOT ===
// The three sibling maintenance passes (transcriptCleanupService,
// recordingSweepService, entityNameFoldSweep) are all one-shot behind a
// settings flag, because each repairs a historical data defect that can only
// exist once. This one is different in kind: it repairs an ONGOING failure
// mode. A crash can happen on any run, so a flag-gated version would fix the
// backlog once and then skip forever — logging "already completed — skipping"
// while new stuck sessions piled up behind it. It must run every launch.
//
// === THE SAFETY INVARIANT ===
// This runs at startup, from main, before any recording can have been started
// in this process. Therefore EVERY row still at status 'recording' at this
// moment is, by construction, a leftover from a previous process — there is no
// live recording to race with. That invariant is what makes an unconditional
// "close every 'recording' row" safe, and it is why this must be called during
// bootstrap and never later.
//
// === HOOKS ARE DELIBERATELY BYPASSED ===
// It writes through drizzle directly rather than meetingService.updateMeeting,
// because updateMeeting fires runMeetingCompletedHooks on the
// not-completed -> completed transition (TWIN-LEARN.1), which would kick off
// brief generation for every recovered session at once — minutes of local GPU
// per meeting, unannounced, on a launch the user did not ask anything of.
// Recovery's job is to un-stick the row and give the user their transcript
// back; generating a brief stays a deliberate click on Regenerate.
//
// === ended_at IS DERIVED FROM THE AUDIO, NOT THE TRANSCRIPT ===
// Best evidence is the WAV's own length: audioProcessor streams 16 kHz mono
// Int16 into <recordingsDir>/<meetingId>.wav, i.e. exactly 32,000 bytes per
// second after the 44-byte header, so duration is arithmetic on the file size
// and is exact even when the header was never finalized. The transcript's
// timestamps are the WORSE source: per ISSUES #40 they run ~1.000 s fast per
// 10-second window (windows are stamped at index x 10 s while the accumulator
// advances 9 s), so the last segment's end_time overstates a long recording by
// roughly 10%. Transcript end_time is kept only as the fallback when no WAV
// exists (audio saving disabled), and startedAt as the floor when there is
// neither.
//
// Non-fatal by design: a failure here must never block startup, and a row that
// cannot be closed this launch is simply retried next launch — there is no
// flag to get wedged.

import * as fsp from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import { eq, isNull, max, and } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { meetings, transcripts, settings } from '../db/schema';
import { createLogger } from './logger';

const log = createLogger('StaleRecordingRecovery');

/** 16 kHz, mono, Int16 — the format audioProcessor writes. */
const WAV_BYTES_PER_SECOND = 16000 * 2;
/** Canonical RIFF/WAVE header length written by audioProcessor. */
const WAV_HEADER_BYTES = 44;

/**
 * Mirrors audioProcessor/recordingSweepService: the user-configurable
 * `recordings:savePath` when set, else <userData>/recordings. Duplicated
 * rather than imported for the same reason recordingSweepService duplicates
 * it — this is a side-effect-free read that must not couple to the
 * live-recording module's mutable state.
 */
async function getRecordingsDir(): Promise<string> {
  try {
    const db = getDb();
    const rows = await db.select().from(settings).where(eq(settings.key, 'recordings:savePath')).limit(1);
    if (rows.length > 0 && rows[0].value) return rows[0].value;
  } catch (err) {
    log.error('Failed to read recordings:savePath, using default:', err);
  }
  return path.join(app.getPath('userData'), 'recordings');
}

/**
 * Duration in ms from the recording's WAV, or null when there is no readable
 * file. Exact by construction (see the header note) and immune to the
 * transcript timestamp drift of ISSUES #40.
 */
async function durationFromWav(recordingsDir: string, meetingId: string): Promise<number | null> {
  try {
    const st = await fsp.stat(path.join(recordingsDir, `${meetingId}.wav`));
    const audioBytes = st.size - WAV_HEADER_BYTES;
    if (audioBytes <= 0) return null;
    return Math.round((audioBytes / WAV_BYTES_PER_SECOND) * 1000);
  } catch {
    return null; // No saved audio (saving disabled, or the file never landed) — fall back.
  }
}

/**
 * Closes every meeting still marked as recording. Returns how many rows were
 * recovered; 0 is the normal, healthy outcome on a clean launch.
 *
 * MUST be called during bootstrap, before any recording can start in this
 * process — see THE SAFETY INVARIANT above.
 */
export async function recoverStaleRecordings(): Promise<number> {
  const db = getDb();

  const stale = await db
    .select({ id: meetings.id, startedAt: meetings.startedAt })
    .from(meetings)
    .where(and(eq(meetings.status, 'recording'), isNull(meetings.endedAt)));

  if (stale.length === 0) return 0;

  const recordingsDir = path.resolve(await getRecordingsDir());
  let recovered = 0;

  for (const row of stale) {
    try {
      let durationMs = await durationFromWav(recordingsDir, row.id);
      let source = 'wav';

      if (durationMs === null) {
        // Fallback: the furthest transcript segment we actually persisted.
        const [agg] = await db
          .select({ lastEnd: max(transcripts.endTime) })
          .from(transcripts)
          .where(eq(transcripts.meetingId, row.id));
        if (agg?.lastEnd != null) {
          durationMs = agg.lastEnd;
          source = 'transcript';
        }
      }

      // Floor: a recording that produced neither audio nor transcript ends
      // when it started, giving a 0-length session rather than a false span.
      if (durationMs === null || durationMs < 0) {
        durationMs = 0;
        source = 'none';
      }

      const endedAt = new Date(row.startedAt.getTime() + durationMs);

      await db.update(meetings).set({ status: 'completed', endedAt }).where(eq(meetings.id, row.id));

      recovered += 1;
      log.info(
        `Recovered stuck recording ${row.id}: ended_at derived from ${source}, duration ${(durationMs / 1000).toFixed(1)}s`,
      );
    } catch (err) {
      // One bad row must not strand the others, and there is no flag to wedge —
      // whatever fails here is simply retried on the next launch.
      log.warn(`Failed to recover stuck recording ${row.id}:`, err);
    }
  }

  log.info(`Stale recording recovery: closed ${recovered} of ${stale.length} stuck session(s)`);
  return recovered;
}
