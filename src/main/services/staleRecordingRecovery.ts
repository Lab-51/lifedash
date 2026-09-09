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
//
// === RECOVERY ALSO WRITES AN HONEST COVERAGE RECORD (TRANS-COV.1) ===
// The live per-window tally (transcriptionService.getCoverageTally()) lives in
// the process that crashed — it died with it, so a recovered row can never
// report real channel counters. What it CAN report is the untranscribed tail:
// from the last transcript segment this meeting actually persisted to the end
// of the recorded audio, as a single `unknown` gap. See buildRecoveredCoverage.

import { eq, isNull, max, and } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { meetings, transcripts } from '../db/schema';
import { createLogger } from './logger';
import { resolveRecordingWav, durationFromFileMs } from './wavSpanReader';
import { emptyCoverageTally } from '../../shared/types/transcriptionCoverage';
import type { CoverageGap, TranscriptionCoverage } from '../../shared/types/transcriptionCoverage';
import { WINDOW_STAMP_MS, WINDOW_ADVANCE_MS, audioMsToStampedMs } from '../../shared/transcription/timeCoordinates';

const log = createLogger('StaleRecordingRecovery');

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
    .select({ id: meetings.id, startedAt: meetings.startedAt, audioPath: meetings.audioPath })
    .from(meetings)
    .where(and(eq(meetings.status, 'recording'), isNull(meetings.endedAt)));

  if (stale.length === 0) return 0;

  let recovered = 0;

  for (const row of stale) {
    try {
      // The furthest transcript segment actually persisted — the floor for
      // ended_at's transcript fallback below, and (independent of which source
      // wins) the start of the coverage gap the crash left behind.
      const [agg] = await db
        .select({ lastEnd: max(transcripts.endTime) })
        .from(transcripts)
        .where(eq(transcripts.meetingId, row.id));
      const lastSegmentEndMs = agg?.lastEnd ?? null;

      const wavPath = await resolveRecordingWav({ id: row.id, audioPath: row.audioPath });
      const audioMs = wavPath ? await durationFromFileMs(wavPath) : null;

      let durationMs = audioMs;
      let source = 'wav';

      if (durationMs === null && lastSegmentEndMs != null) {
        durationMs = lastSegmentEndMs;
        source = 'transcript';
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

      await persistRecoveredCoverage(db, row.id, audioMs, lastSegmentEndMs);
    } catch (err) {
      // One bad row must not strand the others, and there is no flag to wedge —
      // whatever fails here is simply retried on the next launch.
      log.warn(`Failed to recover stuck recording ${row.id}:`, err);
    }
  }

  log.info(`Stale recording recovery: closed ${recovered} of ${stale.length} stuck session(s)`);
  return recovered;
}

/**
 * An honest 'recovered' coverage record (TRANS-COV.1) for a session closed by
 * crash recovery. The live per-window tally died with the process that would
 * have counted it, so every channel counter is zero (emptyCoverageTally()) and
 * the record's only signal is a single gap: from the last persisted segment's
 * stamped endTime (0 when there is none) to the WAV's own length converted to
 * the stamped coordinate — the span the user should retranscribe. Reported
 * only when that span outlasts one window; a shorter tail is not worth flagging.
 */
function buildRecoveredCoverage(audioMs: number | null, lastSegmentEndMs: number | null): TranscriptionCoverage {
  const gaps: CoverageGap[] = [];
  if (audioMs != null) {
    const gapStartMs = lastSegmentEndMs ?? 0;
    const gapEndMs = audioMsToStampedMs(audioMs);
    if (gapEndMs - gapStartMs > WINDOW_STAMP_MS) {
      gaps.push({ startMs: gapStartMs, endMs: gapEndMs, channel: 'mixed', reason: 'unknown' });
    }
  }

  return {
    version: 1,
    endedBy: 'recovered',
    audioMs,
    provider: 'unknown',
    model: null,
    windowStampMs: WINDOW_STAMP_MS,
    windowAdvanceMs: WINDOW_ADVANCE_MS,
    channels: emptyCoverageTally().channels,
    gaps,
    retranscribed: [],
    // The language tally lived in the crashed process; nothing to reconstruct.
    languages: {},
    detectedLanguage: null,
  };
}

/**
 * Writes the coverage record for a just-recovered row. NEVER throws — mirrors
 * audioProcessor's persistCoverage: the row is already closed by the time this
 * runs, and un-sticking it beats accounting for it, so a write failure here is
 * logged and otherwise ignored.
 */
async function persistRecoveredCoverage(
  db: ReturnType<typeof getDb>,
  meetingId: string,
  audioMs: number | null,
  lastSegmentEndMs: number | null,
): Promise<void> {
  try {
    const coverage = buildRecoveredCoverage(audioMs, lastSegmentEndMs);
    await db.update(meetings).set({ transcriptionCoverage: coverage }).where(eq(meetings.id, meetingId));
  } catch (err) {
    log.error(`Failed to persist recovered-coverage record for ${meetingId}:`, err);
  }
}
