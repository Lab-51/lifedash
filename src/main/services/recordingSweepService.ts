// === FILE PURPOSE ===
// One-time startup sweep that permanently deletes recording WAV files that no
// meeting references. Historic deletions never unlinked their audio, so real
// orphans exist on disk today (450 MB single files observed). Mirrors the
// MEET-DEL.1 one-shot pattern established by transcriptCleanupService.ts:
// settings-key completion flag, "already completed — skipping" log on a
// second run, and failure does NOT mark completion (so it retries next
// launch).
//
// === SAFETY ===
// This permanently deletes user files. Deletion is scoped to a single,
// non-recursive listing of the resolved recordings directory: subdirectories
// and symlinks (a Dirent can never be both) are always skipped, never
// descended into. This project has a documented incident (2026-07-21) where a
// recursive delete followed an NTFS junction and wiped a real directory
// outside the intended scope — this sweep structurally cannot repeat that,
// because it never recurses into anything, ever.
//
// === RECON FINDING (verified against audioProcessor.ts + recordingStore.ts) ===
// The story's assumption to verify was whether the ACTIVE recording's
// in-progress file lives somewhere else until finalize. It does not.
// audioProcessor.ts opens `<recordingsDir>/<meetingId>.wav` directly when
// recording STARTS and streams chunks into it for the whole session;
// finalizeWav() only rewrites the 44-byte WAV header in place and closes the
// handle — the path never changes. Meanwhile `meetings.audioPath` is only
// written once, atomically together with `status: 'completed'`, in the
// renderer's stopRecording flow (recordingStore.ts) — i.e. for the entire
// span of a live recording, and for a recording abandoned by a crash, the row
// stays at status 'recording' with audioPath NULL while its file already
// exists in this exact directory under the exact filename convention. Matching
// on `audioPath` alone would therefore delete an in-progress or
// crash-interrupted recording (and would also miss the rarer case of a
// finalize failure leaving `status: 'completed'` with audioPath still NULL).
// To close all of these without any IPC round-trip or coupling to
// audioProcessor's in-memory state, every meeting row protects one
// conventional path: its stored `audioPath` if set, or the `<id>.wav`
// convention path if not. A fully-deleted meeting row protects nothing — that
// is exactly the orphan class this sweep exists to reclaim.
//
// === EXPLICIT NON-GOAL ===
// This sweep does NOT retroactively clean up twin facts orphaned by PAST
// meeting deletions. A fact's `sourceMeetingId IS NULL` is ambiguous with
// interview-learned facts (which never had a source meeting), so there is no
// reliable heuristic to tell "orphaned by a past delete" apart from "never
// had one." The user's existing test-meeting facts need one manual Forget
// pass on the memory map. Only MEET-DEL.1 Task 1's new deletion cascade
// prevents *new* orphaned facts going forward — do not attempt a heuristic
// fact cleanup here.
//
// Non-fatal by design: this function may throw (e.g. a DB error mid-sweep, or
// a directory read failure other than ENOENT). The flag is written ONLY after
// a run with no per-file delete failures, so any thrown error — or any
// individual delete failure — always leaves the flag unset and the sweep
// retries on the next launch. The caller (main.ts) is responsible for
// catching and logging a thrown error — this module never swallows one.

import * as fsp from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { meetings, settings } from '../db/schema';
import { createLogger } from './logger';

const log = createLogger('RecordingSweep');

/** Settings key gating the one-shot sweep — written only after a failure-free run. */
export const SWEEP_FLAG_KEY = 'maintenance:recording-orphan-sweep:v1';

/**
 * Derives the recordings directory exactly the way audioProcessor.ts does
 * (getRecordingsDir there): the user-configurable `recordings:savePath`
 * setting when present, else `<userData>/recordings`. Duplicated rather than
 * imported to avoid coupling this one-shot sweep to the live-recording
 * module's mutable state — this is a plain, side-effect-free read.
 */
async function getRecordingsDir(): Promise<string> {
  try {
    const db = getDb();
    const rows = await db.select().from(settings).where(eq(settings.key, 'recordings:savePath')).limit(1);
    if (rows.length > 0 && rows[0].value) {
      return rows[0].value;
    }
  } catch (err) {
    log.error('Failed to read recordings:savePath from settings, using default:', err);
  }
  return path.join(app.getPath('userData'), 'recordings');
}

/**
 * Windows (the primary dev/test platform) is case-insensitive on paths.
 * Folding case can only make the match set MORE permissive — it protects
 * more paths, never fewer — so it is safe on every platform: the worst case
 * on a case-sensitive filesystem is a missed reclaim, never a wrongful
 * delete, which is the one unacceptable failure mode here.
 */
function normalizePath(p: string): string {
  return path.resolve(p).toLowerCase();
}

async function alreadyRun(): Promise<boolean> {
  const db = getDb();
  const rows = await db.select().from(settings).where(eq(settings.key, SWEEP_FLAG_KEY)).limit(1);
  return rows.length > 0;
}

async function markDone(): Promise<void> {
  const db = getDb();
  await db
    .insert(settings)
    .values({ key: SWEEP_FLAG_KEY, value: 'true' })
    .onConflictDoUpdate({ target: settings.key, set: { value: 'true', updatedAt: new Date() } });
}

/**
 * Runs the one-shot orphaned-recording sweep. Returns the number of files
 * deleted — 0 is a valid, logged outcome (nothing orphaned, no recordings
 * directory yet, or the flag was already set). No-ops (returns 0 without
 * touching the filesystem or the meetings table) once the flag is set.
 */
export async function sweepOrphanedRecordings(): Promise<number> {
  if (await alreadyRun()) {
    log.info('Recording orphan sweep already completed — skipping');
    return 0;
  }

  const db = getDb();
  const recordingsDir = path.resolve(await getRecordingsDir());

  let entries: Dirent[];
  try {
    entries = await fsp.readdir(recordingsDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      entries = []; // Nothing saved yet (fresh install, or saving disabled) — a valid, complete no-op.
    } else {
      throw err;
    }
  }

  // See the RECON FINDING above: every meeting row protects its audioPath if
  // set, else the `<id>.wav` convention path.
  const meetingRows = await db.select({ id: meetings.id, audioPath: meetings.audioPath }).from(meetings);
  const referenced = new Set<string>();
  for (const row of meetingRows) {
    const claimedPath = row.audioPath || path.join(recordingsDir, `${row.id}.wav`);
    referenced.add(normalizePath(claimedPath));
  }

  let reclaimedFiles = 0;
  let reclaimedBytes = 0;
  let hadFailure = false;

  for (const entry of entries) {
    // A Dirent is exactly one of file/directory/symlink/etc. — this both skips
    // subdirectories (never recurse) and skips symlinks (never follow a link),
    // in the same check.
    if (!entry.isFile()) continue;

    const fullPath = path.join(recordingsDir, entry.name);
    if (referenced.has(normalizePath(fullPath))) continue; // referenced or claimed by a meeting row — never delete

    try {
      const st = await fsp.lstat(fullPath);
      await fsp.unlink(fullPath);
      reclaimedFiles += 1;
      reclaimedBytes += st.size;
    } catch (err) {
      hadFailure = true;
      log.warn(`Failed to delete orphaned recording "${entry.name}":`, err);
    }
  }

  // Per-file delete failures do not block the rest of the run, but they do
  // block marking the sweep complete — a failed file must be retried next
  // launch, same contract as a thrown error.
  if (!hadFailure) {
    await markDone();
  }

  log.info(
    `Recording orphan sweep: reclaimed ${reclaimedFiles} files / ${(reclaimedBytes / 1024 / 1024).toFixed(1)} MB`,
  );
  return reclaimedFiles;
}
