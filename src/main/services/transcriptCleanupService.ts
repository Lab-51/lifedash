// === FILE PURPOSE ===
// One-shot startup sweep that permanently deletes previously-stored Whisper
// hallucination segments (subtitle-credit boilerplate, "thanks for watching"
// outros) from the `transcripts` table. Runs once, gated by a settings flag,
// following the LOCAL-RT.2 startup-reconcile pattern established in
// builtinProviderSetup.ts (`reconcileBuiltinFromDisk`).
//
// === SAFETY ===
// This permanently deletes user data. The SQL ILIKE filter below is a
// PREFILTER ONLY — it exists to avoid pulling every transcript segment into JS
// for a full-table scan. It NEVER decides a deletion. The single source of
// truth for "is this a hallucination" is the shared `isHallucinatedSegment`
// predicate (src/shared/transcription/hallucinationFilter.ts) — the exact same
// predicate that gates the live transcription persist loop (TRANS-HALL.1 Task
// 1). Do not loosen it, do not add extra matching here, and never let the SQL
// prefilter itself decide a row is deleted.
//
// Non-fatal by design: this function may throw (e.g. a DB error mid-sweep).
// The flag is written ONLY after a successful delete, so a thrown error always
// leaves the flag unset and the sweep retries on the next launch. The caller
// (main.ts, mirroring reconcileBuiltinRuntime) is responsible for catching and
// logging — this module never swallows its own errors.

import { eq, ilike, inArray, or } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { settings, transcripts } from '../db/schema';
import { HALLUCINATION_PHRASES, isHallucinatedSegment } from '../../shared/transcription/hallucinationFilter';
import { createLogger } from './logger';

const log = createLogger('TranscriptCleanup');

/** Settings key gating the one-shot sweep — written only after a successful run. */
export const CLEANUP_FLAG_KEY = 'maintenance:transcript-hallucination-cleanup:v1';

/** Escape ILIKE wildcard chars in a literal phrase (same convention as meetingService.searchTranscripts). */
function escapeIlike(phrase: string): string {
  return phrase.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

async function alreadyRun(): Promise<boolean> {
  const db = getDb();
  const rows = await db.select().from(settings).where(eq(settings.key, CLEANUP_FLAG_KEY)).limit(1);
  return rows.length > 0;
}

async function markDone(): Promise<void> {
  const db = getDb();
  await db
    .insert(settings)
    .values({ key: CLEANUP_FLAG_KEY, value: 'true' })
    .onConflictDoUpdate({ target: settings.key, set: { value: 'true', updatedAt: new Date() } });
}

/**
 * Runs the one-shot cleanup. Returns the number of segments deleted — 0 is a
 * valid, logged outcome, because silence would be indistinguishable from
 * "did not run". No-ops (returns 0 without querying transcripts) if the flag
 * is already set.
 */
export async function sweepHallucinatedTranscripts(): Promise<number> {
  if (await alreadyRun()) {
    log.info('Hallucination cleanup already completed — skipping');
    return 0;
  }

  const db = getDb();

  // PREFILTER ONLY: narrows candidates via a per-phrase SQL ILIKE so we never
  // pull every transcript segment into JS. Deliberately loose — the actual
  // deletion decision happens below, via isHallucinatedSegment alone.
  const phraseConditions = HALLUCINATION_PHRASES.map((phrase) =>
    ilike(transcripts.content, `%${escapeIlike(phrase)}%`),
  );
  const candidates = await db
    .select({ id: transcripts.id, content: transcripts.content })
    .from(transcripts)
    .where(or(...phraseConditions));

  // The predicate — not the SQL — is the decider. Every candidate is
  // re-checked here before it is eligible for deletion.
  const idsToDelete = candidates.filter((row) => isHallucinatedSegment(row.content)).map((row) => row.id);

  if (idsToDelete.length > 0) {
    await db.delete(transcripts).where(inArray(transcripts.id, idsToDelete));
  }

  await markDone();
  log.info(`Hallucination cleanup: deleted ${idsToDelete.length} hallucinated transcript segments`);
  return idsToDelete.length;
}
