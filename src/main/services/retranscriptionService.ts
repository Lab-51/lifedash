// === FILE PURPOSE ===
// Redo ONE span of a finished recording's transcript from the WAV, with a
// whisper model the user chose (TRANS-COV.1 Task 4).
//
// === THIS DELETES USER DATA ===
// Every transcript row of this meeting that OVERLAPS the requested span is
// removed and replaced by what the chosen model hears in that stretch of audio.
// Three properties make that safe, and each one is load-bearing:
//
//  1. GUARDED. `transcriptionService.isActive()` is checked FIRST, before any
//     file, model or context work: a live recording is writing the very rows
//     this would delete and holds the whisper context. A second concurrent
//     retranscription is refused for the same reason (whisper contexts are
//     heavy, and two overlapping span replacements could interleave).
//  2. TRANSACTIONAL. The delete, the insert and the coverage note are ONE
//     `db.transaction`. Whisper runs to completion BEFORE the transaction is
//     opened, so a transcription failure leaves the old rows untouched — the
//     transaction never starts. (Verified at build time: `db.transaction` is
//     available on this PGlite drizzle handle and is already used by
//     meetingService, entityNameFoldSweep, autoPushService and others.)
//  3. TYPED. Never throws across IPC. Every way this can decline is a named
//     reason in `RetranscribeFailureReason`, and `ok: false` always means
//     nothing was deleted.
//
// === THE COORDINATE RULE ===
// A span arrives in the STAMPED coordinate (what `transcripts.start_time`
// holds); the WAV is seeked in the AUDIO coordinate. `stampedMsToAudioMs` is
// NOT monotonic across a window boundary (stamped 19,999 -> 18,999 but
// 20,000 -> 18,000), so a span is converted by taking its START through the
// function and ADDING its own length — never by converting the end pointwise,
// which silently drops the last second. See timeCoordinates.ts and Task 1's
// review finding. The reverse direction (`audioMsToStampedMs`) IS strictly
// monotonic, so mapping whisper's own segment bounds back is safe pointwise.
//
// === A FRESH CONTEXT, ALWAYS RELEASED ===
// The live `whisperContext` inside transcriptionService is never touched. This
// builds its own from the chosen model file and releases it in a `finally`, on
// success and on failure alike — a leaked context pins the model in RAM/VRAM
// for the life of the process.
//
// === WHAT IS DELIBERATELY *NOT* APPLIED ===
// No RMS gate, no VAD gate, no hallucination filter: the user picked this span
// on purpose, precisely because the live pipeline's gates are the suspects. A
// retranscription that silently returns nothing because a gate fired again
// would be useless. `speaker` is null on every inserted row — the WAV is the
// mixed sum and carries no channel identity (SPEAKER.1 writes `Me` from the
// separate mic stream, which is not recorded).
//
// === TWO DROP RULES, IN TWO COORDINATES, AND WHY BOTH ARE NEEDED ===
// A piece is discarded in AUDIO space when it lies WHOLLY inside the padding —
// that audio was read for context and was never part of the selection.
//
// A piece is ALSO discarded in STAMPED space when its start lands at or past
// `holeEnd`, and that rule is load-bearing rather than cosmetic. The read covers
// the span's full audio LENGTH, but `audioMsToStampedMs` names every overlap
// second by the LATER window, so the span's trailing audio carries the NEXT
// window's stamps — stamps past the hole this run made, where the live rows were
// NOT deleted and already name that same audio. Without this rule every redo
// re-inserts them: 1 s of duplicated text per window boundary crossed, and the
// read crosses one every 9,000 ms of audio, so 6 s on a one-minute span and 66 s
// on the 10-minute maximum. It scales with the span, which is what makes it a
// defect and not an edge.
//
// === THE BOUND IS THE HOLE, NOT THE REQUEST ===
// `holeEnd` is `max(clampedEndMs, the largest end_time the DELETE returned)`, and
// using the requested `clampedEndMs` instead is its own data-loss bug. The delete
// takes WHOLE overlapping rows, so a selection ending mid-window removes the row
// covering its end entirely, and the hole then runs past the request to that
// row's `end_time`. Replacement text stamped in that tail is the ONLY thing
// naming its audio — no survivor is left to duplicate — so discarding it loses
// text outright, up to `9,000 - (clampedEndMs % 10,000)` ms per run, with nothing
// to show for it but a smaller `inserted` count. `holeEnd` is exactly the line
// between the two failures: past it a piece would duplicate a survivor, inside it
// a piece is the only record of what was said.
//
// What survives is a genuine straddler: a piece that STARTS inside the hole and
// runs past its end is kept, at its true stamped time, up to about two seconds
// beyond `clampedEndMs` where the neighbouring row still lives — the span's own
// last second of audio is already NAMED one second past `clampedEndMs` by the
// next window, and the 1 s of trailing padding adds another. So a boundary WORD
// can briefly appear twice. That is the same 1-second overlap the live pipeline
// already produces between consecutive windows, and it is the deliberate trade:
// clamping such a row to the selection would put text at a timestamp the audio is
// not at, which is exactly the class of error this phase exists to remove.

import { and, eq, gt, lt } from 'drizzle-orm';
import type { TranscribeResult } from '@fugood/whisper.node';
import { getDb } from '../db/connection';
import { meetings, settings, transcripts } from '../db/schema';
import { createLogger } from './logger';
import * as transcriptionService from './transcriptionService';
import * as whisperModelManager from './whisperModelManager';
import * as whisperPromptService from './whisperPromptService';
import { InvalidSpanError, readPcmSpan, resolveRecordingWav, type PcmSpan } from './wavSpanReader';
import { audioMsToStampedMs, stampedMsToAudioMs } from '../../shared/transcription/timeCoordinates';
import { resolveLanguagePreset } from '../../shared/types/transcription';
import type { RetranscribeResult, RetranscribeSpanInput, TranscriptSegment } from '../../shared/types';
import type { RetranscribedSpan, TranscriptionCoverage } from '../../shared/types/transcriptionCoverage';

const log = createLogger('Retranscription');

type Db = ReturnType<typeof getDb>;

/**
 * Audio read on EACH side of the requested span, so whisper hears a word that
 * begins just before the span starts (or ends just after it ends) instead of
 * half of one. Same reason the live pipeline overlaps its windows by 1 s.
 * Anything whisper returns that lies WHOLLY inside this padding is dropped.
 */
const PADDING_MS = 1000;

/**
 * One at a time. A module singleton rather than a queue: a second request is
 * REFUSED with a reason the renderer can print, never silently queued behind a
 * run that may take minutes.
 */
let inFlight = false;

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Redo `[startMs, endMs)` of this meeting's transcript from its WAV.
 *
 * Never rejects. On `ok: true` the returned `segments` are the rows now in the
 * database for that span; on `ok: false` nothing was changed.
 */
export async function retranscribeSpan(input: RetranscribeSpanInput): Promise<RetranscribeResult> {
  // FIRST, before a file is opened or a context is created.
  if (transcriptionService.isActive()) {
    return { ok: false, reason: 'recording-active', detail: 'A recording is in progress.' };
  }
  if (inFlight) {
    return { ok: false, reason: 'recording-active', detail: 'Another retranscription is already running.' };
  }

  inFlight = true;
  try {
    return await run(input);
  } catch (err) {
    // The typed union is the contract, so nothing escapes to IPC. Reaching here
    // means the DB write itself failed, or the options build did (whisper
    // failures are already typed below) — either way the transaction never
    // committed, so the old rows are still there, which is what
    // 'transcription-failed' promises. `detail` carries the truth.
    log.error(`Retranscription of ${input.meetingId} failed:`, err);
    return { ok: false, reason: 'transcription-failed', detail: describe(err) };
  } finally {
    inFlight = false;
  }
}

async function run(input: RetranscribeSpanInput): Promise<RetranscribeResult> {
  const { meetingId, startMs, endMs, modelFileName } = input;
  const db = getDb();

  const [meeting] = await db
    .select({
      id: meetings.id,
      audioPath: meetings.audioPath,
      transcriptionLanguage: meetings.transcriptionLanguage,
    })
    .from(meetings)
    .where(eq(meetings.id, meetingId))
    .limit(1);
  if (!meeting) return { ok: false, reason: 'no-audio', detail: 'No such session.' };

  const wavPath = await resolveRecordingWav(meeting);
  if (!wavPath) return { ok: false, reason: 'no-audio', detail: 'This session has no recording file.' };

  // THE COORDINATE RULE (see the header): convert the START, add the LENGTH.
  const audioStartMs = stampedMsToAudioMs(startMs);
  const audioEndMs = audioStartMs + (endMs - startMs);

  let span: PcmSpan;
  try {
    span = await readPcmSpan(wavPath, Math.max(0, audioStartMs - PADDING_MS), audioEndMs + PADDING_MS);
  } catch (err) {
    if (err instanceof InvalidSpanError) return { ok: false, reason: 'span-too-long', detail: err.message };
    return { ok: false, reason: 'no-audio', detail: describe(err) };
  }

  // readPcmSpan clamps to the file's real length and reports what it served, so
  // a span running past the end of the recording shortens rather than lying.
  const servedAudioEndMs = Math.min(audioEndMs, span.audioEndMs);
  if (span.pcm.byteLength === 0 || servedAudioEndMs <= audioStartMs) {
    return { ok: false, reason: 'no-audio', detail: 'That span is past the end of the recording.' };
  }
  // Back to STAMPED the same way round: start + length, never a pointwise end.
  // This is the end of the range whose rows are replaced, so getting it wrong
  // means deleting rows the user did not select.
  const clampedEndMs = startMs + (servedAudioEndMs - audioStartMs);

  // Only a model the manager reports as downloaded, and the path is built from
  // the CATALOG's own file name rather than the caller's string.
  const model = whisperModelManager.getLocalModels().find((m) => m.fileName === modelFileName);
  if (!model) {
    return { ok: false, reason: 'model-missing', detail: `${modelFileName} is not downloaded.` };
  }

  // OUTSIDE the try below on purpose: a failure to read the language setting or
  // build the glossary is not a whisper failure, and logging it as one sends the
  // next reader of the log to the wrong component. It falls to the caller's
  // catch, which is equally safe — nothing has been written yet either way.
  const options = await buildOptions(db, meetingId, meeting.transcriptionLanguage);

  let whisper: TranscribeResult;
  try {
    whisper = await transcribeWithFreshContext(whisperModelManager.getModelPath(model.fileName), span.pcm, options);
  } catch (err) {
    // Nothing has been written at this point: the transaction below has not
    // been opened, so the existing rows are exactly as they were.
    log.error(`Whisper failed retranscribing ${meetingId} [${startMs}, ${clampedEndMs}):`, err);
    return { ok: false, reason: 'transcription-failed', detail: describe(err) };
  }

  // CANDIDATES: every piece the audio rule kept. The stamped bound is applied
  // inside the transaction, where the hole the delete made is known.
  const candidates = mapToStampedRows(whisper, meetingId, span.audioStartMs, audioStartMs, servedAudioEndMs);

  const { replaced, segments } = await replaceSpan(db, meetingId, startMs, clampedEndMs, candidates, {
    startMs,
    endMs: clampedEndMs,
    model: model.fileName,
    at: new Date().toISOString(),
  });

  log.info(
    `Retranscribed ${meetingId} [${startMs}, ${clampedEndMs}) with ${model.fileName}: ` +
      `${replaced} row(s) replaced, ${segments.length} written`,
  );

  return { ok: true, replaced, inserted: segments.length, segments, clampedEndMs };
}

/**
 * Whisper options for a redo: the `accurate` preset regardless of what the
 * session ran on (a redo is not on a latency budget), deterministic decoding,
 * and the meeting's own glossary as the prompt — roster names, project terms
 * and the preset glossary, with NO rolling context, because there is no
 * previous window here to carry forward.
 *
 * Language: the meeting's OWN recorded language wins over the global
 * `transcription:language` setting. The plan named the setting alone; a
 * recording is redone in the language it was actually spoken in, and the global
 * setting may well have moved on since it was made. The setting remains the
 * fallback for a meeting that never recorded one, resolved through
 * `resolveLanguagePreset` exactly as speakerDiarizationService does.
 */
async function buildOptions(
  db: Db,
  meetingId: string,
  meetingLanguage: string | null,
): Promise<Record<string, unknown>> {
  let presetCode = meetingLanguage;
  if (!presetCode) {
    const rows = await db.select().from(settings).where(eq(settings.key, 'transcription:language'));
    presetCode = rows.length > 0 ? rows[0].value : 'en';
  }

  const opts: Record<string, unknown> = {
    ...transcriptionService.WHISPER_PRESETS.accurate,
    temperature: 0,
    temperatureInc: 0.2,
  };
  const language = resolveLanguagePreset(presetCode).baseLanguage;
  if (language !== 'auto') opts.language = language;

  const prompt = await whisperPromptService.buildInitialPrompt(meetingId, presetCode);
  if (prompt) opts.prompt = prompt;

  return opts;
}

/**
 * One transcribeData call on a context built for this run alone, released in a
 * `finally` on every path. The live `whisperContext` is never touched.
 *
 * A release failure is logged and swallowed: it must not turn a successful
 * retranscription into a failed one, and there is nothing a caller could do.
 */
async function transcribeWithFreshContext(
  modelPath: string,
  pcm: Buffer,
  options: Record<string, unknown>,
): Promise<TranscribeResult> {
  const { context } = await whisperModelManager.createWhisperContext(modelPath);
  try {
    const audio = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer;
    const { promise } = context.transcribeData(audio, options);
    return await promise;
  } finally {
    try {
      await context.release();
    } catch (err) {
      log.warn('Failed to release the retranscription whisper context:', err);
    }
  }
}

interface NewTranscriptRow {
  meetingId: string;
  content: string;
  startTime: number;
  endTime: number;
  speaker: null;
}

/**
 * Whisper reports offsets relative to the buffer it was given, which starts at
 * `bufferAudioStartMs` (the padded, clamped read position). Each piece is moved
 * to an absolute AUDIO offset, dropped when it lies WHOLLY inside the padding,
 * and converted back to STAMPED.
 *
 * These are CANDIDATES. The second drop rule — the stamped one — is deliberately
 * NOT here: it needs `holeEnd`, which is not known until the delete has run, so
 * `replaceSpan` applies it immediately before the insert (see the header).
 *
 * Pointwise conversion is correct in THIS direction: `audioMsToStampedMs` is
 * strictly increasing, unlike its inverse.
 */
function mapToStampedRows(
  whisper: TranscribeResult,
  meetingId: string,
  bufferAudioStartMs: number,
  spanAudioStartMs: number,
  spanAudioEndMs: number,
): NewTranscriptRow[] {
  const rows: NewTranscriptRow[] = [];

  for (const seg of whisper.segments) {
    const content = seg.text.trim();
    if (!content) continue;

    // whisper.cpp can return denormalized floats — sanitized exactly as the
    // live dispatch path does before they reach an integer column.
    const t0 = Number.isFinite(seg.t0) ? Math.round(seg.t0) : 0;
    const t1 = Number.isFinite(seg.t1) ? Math.round(seg.t1) : 0;
    const fromMs = bufferAudioStartMs + t0;
    const toMs = bufferAudioStartMs + t1;

    // Wholly inside the leading or trailing padding — it belongs to the
    // neighbouring rows, which were not asked about and are not being replaced.
    if (toMs <= spanAudioStartMs || fromMs >= spanAudioEndMs) continue;

    const startTime = audioMsToStampedMs(Math.max(0, fromMs));

    rows.push({
      meetingId,
      content,
      startTime,
      endTime: Math.max(startTime, audioMsToStampedMs(Math.max(0, toMs))),
      speaker: null,
    });
  }

  return rows;
}

/**
 * The whole write, in ONE transaction: remove every row of this meeting whose
 * `[startTime, endTime)` OVERLAPS `[startMs, clampedEndMs)`, insert the new
 * rows, and note the run on the meeting's coverage record.
 *
 * The overlap predicate (`startTime < end AND endTime > start`) is the same one
 * diarization uses to match a span, and it is what makes a partial-window row
 * at either edge of the selection go with it rather than survive as a duplicate.
 *
 * That predicate is also why the candidates are filtered HERE and not in
 * `mapToStampedRows`: taking whole rows means the hole can reach past the
 * requested end, and only the delete's own `returning` knows how far. See the
 * header's "the bound is the hole, not the request".
 *
 * The coverage note is INSIDE the transaction on purpose. This is the audit
 * record of a destructive edit: rows deleted with no record of why is a worse
 * outcome than a retranscription the user has to run again, so a failure to
 * write the note rolls the replacement back rather than being swallowed the way
 * audioProcessor's own coverage write is.
 */
async function replaceSpan(
  db: Db,
  meetingId: string,
  startMs: number,
  clampedEndMs: number,
  candidates: NewTranscriptRow[],
  // Neither count is knowable until the delete and the insert have run, so these
  // are the two fields this function fills in rather than accepts — the note
  // must record what the database did, never the size of the array it was
  // offered.
  note: Omit<RetranscribedSpan, 'replaced' | 'inserted'>,
): Promise<{ replaced: number; segments: TranscriptSegment[] }> {
  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(transcripts)
      .where(
        and(
          eq(transcripts.meetingId, meetingId),
          lt(transcripts.startTime, clampedEndMs),
          gt(transcripts.endTime, startMs),
        ),
      )
      .returning({ id: transcripts.id, endTime: transcripts.endTime });

    // The far edge of the hole this delete just made. `reduce` from
    // `clampedEndMs` rather than a spread `Math.max`, so an empty delete yields
    // exactly `clampedEndMs` and a long span cannot spread hundreds of rows into
    // an argument list.
    const holeEnd = deleted.reduce((end, row) => Math.max(end, row.endTime), clampedEndMs);
    const keep = candidates.filter((row) => row.startTime < holeEnd);

    const inserted = keep.length > 0 ? await tx.insert(transcripts).values(keep).returning() : [];

    await appendCoverageNote(tx as unknown as Db, meetingId, {
      ...note,
      replaced: deleted.length,
      inserted: inserted.length,
    });

    return {
      replaced: deleted.length,
      segments: inserted.map((row) => ({
        id: row.id,
        meetingId: row.meetingId,
        content: row.content,
        startTime: row.startTime,
        endTime: row.endTime,
        speaker: row.speaker ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  });
}

/**
 * Append this run to `meetings.transcription_coverage.retranscribed`.
 *
 * A meeting with NO coverage record keeps none: a session that predates
 * TRANS-COV.1 is honestly "unknown", and inventing a record with zeroed
 * counters and an `endedBy` nobody observed would turn "not recorded" into a
 * false claim that nothing was missed. Logged instead.
 */
async function appendCoverageNote(tx: Db, meetingId: string, entry: RetranscribedSpan): Promise<void> {
  const [row] = await tx
    .select({ coverage: meetings.transcriptionCoverage })
    .from(meetings)
    .where(eq(meetings.id, meetingId))
    .limit(1);

  const existing = row?.coverage;
  if (!existing || typeof existing !== 'object') {
    log.info(`Meeting ${meetingId} has no coverage record — retranscription not noted on it.`);
    return;
  }

  const coverage = existing as TranscriptionCoverage;
  const priorRuns = Array.isArray(coverage.retranscribed) ? coverage.retranscribed : [];
  await tx
    .update(meetings)
    .set({ transcriptionCoverage: { ...coverage, retranscribed: [...priorRuns, entry] } })
    .where(eq(meetings.id, meetingId));
}
