// === FILE PURPOSE ===
// V3.4 local embedding pipeline. Populates the frozen `embeddings` vector index
// (Task 1) from three sources — meeting BRIEFS, finalized TRANSCRIPTS (chunked at
// segment boundaries), and CARDS (title + description) — via the frozen
// `ai-provider.embed()`. Everything runs on a low-priority SERIAL queue that
// PAUSES while a session is recording and drains afterward, so bulk embedding
// never competes with live triage/assistant for the local model.
//
// === GUARANTEES (see .planning/stories/STORY-4.md) ===
//  - NEVER blocks or fails a card write / brief / session: enqueue is async and
//    fire-and-forget; every job is individually try/caught.
//  - IDEMPOTENT: a job is skipped when an embedding row for
//    (entityType, entityId, chunkIndex) already stores identical content — so
//    re-running the backfill embeds nothing new. (The frozen schema has no hash
//    column, so the stored `content` column IS the idempotency key.)
//  - NEVER silently mixes vector spaces: every write records the provider-ECHOED
//    model in `embedding_index_meta`; if a later embed echoes a DIFFERENT model,
//    the new vector is NOT inserted and a non-blocking "rebuild?" affordance is
//    surfaced (a settings flag the Settings UI reads).
//  - NO silent cloud: `resolveTaskModel('embedding')` returns null unless the user
//    explicitly assigned an embedding model in Settings (Task 1's privacy choice),
//    so bulk content only leaves the device after a visible, explicit choice.
//
// === BOOT WIRING ===
// initEmbeddingService() (called from ipc/embedding.ts at boot) self-registers the
// post-session hook. The HNSW cosine index is created lazily on first write
// (registerIpcHandlers runs BEFORE connectDatabase, so no DB touch at init time).

import { eq, and, asc, desc, sql } from 'drizzle-orm';
import { getDb } from '../db/connection';
import {
  embeddings,
  embeddingIndexMeta,
  EMBEDDING_DIM,
  EMBEDDING_INDEX_META_ID,
  meetings,
  transcripts,
  meetingBriefs,
  cards,
  columns,
  boards,
  settings,
} from '../db/schema';
import { embed, resolveTaskModel } from './ai-provider';
import { registerPostSessionHook, type PostSessionContext } from './postSessionDispatcher';
import { getIsRecording } from './recordingState';
import { createLogger } from './logger';

const log = createLogger('Embedding');

type DB = ReturnType<typeof getDb>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Target chunk size for transcripts (~1000 chars), split at whole segments. */
const TARGET_CHUNK_CHARS = 1000;
/** How often the paused worker re-checks whether recording has stopped. */
const RESUME_POLL_MS = 3000;
/** Settings key: the non-blocking model-mismatch / rebuild affordance. */
const MISMATCH_SETTING_KEY = 'embedding.indexMismatch';
/** Settings key: user dismissed/deferred the backfill prompt. */
const BACKFILL_DISMISSED_KEY = 'embedding.backfillDismissed';
/** Provider families that embed entirely on-device (never leave the machine). */
const LOCAL_EMBEDDING_PROVIDERS = new Set<string>(['ollama', 'lmstudio']);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EntityType = 'brief' | 'card' | 'transcript_chunk';

interface EmbedJob {
  entityType: EntityType;
  entityId: string;
  chunkIndex: number;
  content: string;
  meetingId: string | null;
  projectId: string | null;
}

export interface EmbeddingRoute {
  providerName: string;
  isLocal: boolean;
}

export interface EmbeddingStatus {
  indexed: number;
  total: number;
  running: boolean;
  route: EmbeddingRoute | null;
  mismatch: { stored: string; current: string } | null;
  backfillDismissed: boolean;
}

// ---------------------------------------------------------------------------
// Module state (single serial worker)
// ---------------------------------------------------------------------------

let queue: EmbedJob[] = [];
let drainPromise: Promise<void> | null = null;
let resumeTimer: ReturnType<typeof setTimeout> | null = null;
let indexEnsured = false;
let hooksRegistered = false;

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Group transcript segments into ~`target`-char chunks WITHOUT ever splitting a
 * segment — the boundary between two chunks always falls on a segment boundary.
 * A single oversized segment becomes its own chunk (still whole, never mid-sentence).
 */
export function chunkTranscript(
  segments: { content: string; startTime: number }[],
  target = TARGET_CHUNK_CHARS,
): string[] {
  const sorted = [...segments].sort((a, b) => a.startTime - b.startTime);
  const chunks: string[] = [];
  let cur = '';
  for (const seg of sorted) {
    const piece = seg.content?.trim();
    if (!piece) continue;
    if (cur === '') cur = piece;
    else if (cur.length + 1 + piece.length > target) {
      chunks.push(cur);
      cur = piece;
    } else cur += ' ' + piece;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** Plain-text embedding content for a card: title + description (HTML stripped). */
export function buildCardContent(title: string, description: string | null): string {
  const desc = description
    ? description
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
  return desc ? `${title}\n\n${desc}` : title;
}

// ---------------------------------------------------------------------------
// Provider routing (no-silent-cloud guard lives here)
// ---------------------------------------------------------------------------

/**
 * Resolve where embedding runs, or null when unavailable. Task 1 guarantees
 * `resolveTaskModel('embedding')` NEVER auto-falls-back to a cloud provider, so a
 * non-null result means the user explicitly chose the model in Settings — that is
 * the "explicit, visible choice" that authorizes a cloud route. `isLocal` lets the
 * Settings surface show whether bulk content stays on-device.
 */
export async function getEmbeddingRoute(): Promise<EmbeddingRoute | null> {
  const provider = await resolveTaskModel('embedding');
  if (!provider) return null;
  return { providerName: provider.providerName, isLocal: LOCAL_EMBEDDING_PROVIDERS.has(provider.providerName) };
}

// ---------------------------------------------------------------------------
// Index-meta provenance + mismatch flag + HNSW index
// ---------------------------------------------------------------------------

/** Create the HNSW cosine index once (lazy — DB isn't connected at boot). */
async function ensureVectorIndex(db: DB): Promise<void> {
  if (indexEnsured) return;
  indexEnsured = true; // set first so a failure never retries on every job
  try {
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS embeddings_hnsw_cosine_idx ON embeddings USING hnsw (embedding vector_cosine_ops)`,
    );
  } catch (err) {
    // The index is a pure optimization — exact scan still returns correct results.
    log.error('HNSW index creation failed (falling back to exact scan):', err);
  }
}

/** Record the ECHOED model + measured dimension as the index provenance. */
async function upsertMeta(db: DB, model: string): Promise<void> {
  await db
    .insert(embeddingIndexMeta)
    .values({ id: EMBEDDING_INDEX_META_ID, model, dimensions: EMBEDDING_DIM })
    .onConflictDoUpdate({
      target: embeddingIndexMeta.id,
      set: { model, dimensions: EMBEDDING_DIM, updatedAt: new Date() },
    });
}

async function setMismatch(db: DB, stored: string, current: string): Promise<void> {
  const value = JSON.stringify({ stored, current });
  await db
    .insert(settings)
    .values({ key: MISMATCH_SETTING_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
  log.warn(
    `Embedding model changed (index built with ${stored}, now ${current}) — rebuild needed to avoid mixed spaces.`,
  );
}

async function clearMismatch(db: DB): Promise<void> {
  await db.delete(settings).where(eq(settings.key, MISMATCH_SETTING_KEY));
}

/**
 * Persist the non-blocking model-mismatch "rebuild?" affordance (the SAME settings
 * key {@link getEmbeddingStatus} reads). Exported so the READ side (searchService)
 * can surface the rebuild prompt when it detects a mismatch on an already-indexed
 * corpus that produces no new writes — the write-side {@link setMismatch} is skipped
 * by content-idempotency for already-indexed items, so nothing else would flag it.
 * Best-effort: a failure to record must NEVER break search (the caller degrades to
 * FTS-only regardless). The settings-key + shape logic lives here, in one place.
 */
export async function recordEmbeddingModelMismatch(stored: string, current: string): Promise<void> {
  try {
    await setMismatch(getDb(), stored, current);
  } catch (err) {
    log.error('Failed to record embedding model mismatch:', err);
  }
}

async function readSetting(db: DB, key: string): Promise<string | null> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).limit(1);
  return row?.value ?? null;
}

// ---------------------------------------------------------------------------
// The serial worker
// ---------------------------------------------------------------------------

/** Embed one job. Idempotent (content-hash skip) and mixed-space-safe. */
async function processJob(job: EmbedJob): Promise<void> {
  const db = getDb();

  // Content-hash idempotency: identical content already indexed for this key → skip.
  const [existing] = await db
    .select({ content: embeddings.content })
    .from(embeddings)
    .where(
      and(
        eq(embeddings.entityType, job.entityType),
        eq(embeddings.entityId, job.entityId),
        eq(embeddings.chunkIndex, job.chunkIndex),
      ),
    )
    .limit(1);
  if (existing && existing.content === job.content) return;

  const [meta] = await db
    .select()
    .from(embeddingIndexMeta)
    .where(eq(embeddingIndexMeta.id, EMBEDDING_INDEX_META_ID))
    .limit(1);

  const { embeddings: vectors, model: echoedModel } = await embed([job.content], 'embedding');
  const vec = vectors[0];
  if (!vec || vec.length !== EMBEDDING_DIM) {
    log.error(
      `Embedding for ${job.entityType}:${job.entityId} had length ${vec?.length ?? 0} (expected ${EMBEDDING_DIM}); skipping`,
    );
    return;
  }

  // Never silently mix vector spaces: an echoed model different from the one the
  // index was built with means the new vector lives in a different space. Surface
  // a rebuild affordance and skip the insert (the rebuild re-embeds everything).
  if (meta && meta.model !== echoedModel) {
    await setMismatch(db, meta.model, echoedModel);
    return;
  }

  await ensureVectorIndex(db);
  await db.transaction(async (tx) => {
    await tx
      .delete(embeddings)
      .where(
        and(
          eq(embeddings.entityType, job.entityType),
          eq(embeddings.entityId, job.entityId),
          eq(embeddings.chunkIndex, job.chunkIndex),
        ),
      );
    await tx.insert(embeddings).values({
      entityType: job.entityType,
      entityId: job.entityId,
      chunkIndex: job.chunkIndex,
      content: job.content,
      embedding: vec,
      meetingId: job.meetingId,
      projectId: job.projectId,
    });
  });

  await upsertMeta(db, echoedModel);
  await clearMismatch(db);
}

/**
 * Drain the queue serially. Returns early (leaving the queue intact) while a
 * session is recording — a resume poll re-kicks it once recording stops. A single
 * route lookup gates the whole drain: null ⇒ graceful no-op (no provider / no
 * silent cloud), the pending on-write jobs are dropped (the backfill recovers
 * anything historical once a model is configured).
 */
async function drainQueue(): Promise<void> {
  const route = await getEmbeddingRoute();
  if (!route) {
    queue = [];
    return;
  }
  while (queue.length > 0) {
    if (getIsRecording()) {
      scheduleResume();
      return;
    }
    const job = queue[0];
    try {
      await processJob(job);
    } catch (err) {
      // An embedding failure can never break the pipeline for other jobs.
      log.error('Embedding job failed:', err);
    }
    queue.shift();
  }
}

/** Single-flight drain: concurrent callers share one in-flight drain promise. */
function kickDrain(): Promise<void> {
  if (!drainPromise) {
    drainPromise = drainQueue().finally(() => {
      drainPromise = null;
    });
  }
  return drainPromise;
}

function scheduleResume(): void {
  if (resumeTimer) return;
  resumeTimer = setTimeout(() => {
    resumeTimer = null;
    void kickDrain();
  }, RESUME_POLL_MS);
  resumeTimer.unref?.();
}

function enqueue(jobs: EmbedJob[]): void {
  if (jobs.length === 0) return;
  queue.push(...jobs);
  void kickDrain();
}

// ---------------------------------------------------------------------------
// On-write hooks
// ---------------------------------------------------------------------------

/**
 * Enqueue a card embedding. Called from the single card create/update write seam
 * (ipc/cards.ts). Fire-and-forget and fully guarded — a card write NEVER waits on
 * or fails because of embedding.
 */
export function enqueueCardEmbed(
  card: { id: string; title: string; description: string | null; sourceMeetingId?: string | null },
  projectId?: string | null,
): void {
  try {
    const content = buildCardContent(card.title, card.description);
    if (!content.trim()) return;
    enqueue([
      {
        entityType: 'card',
        entityId: card.id,
        chunkIndex: 0,
        content,
        // Cards are NOT session-lifecycle rows. `meetingId` carries the ON DELETE
        // cascade FK, so populating it with the card's sourceMeetingId would make a
        // meeting delete cascade-drop a SURVIVING card's embedding. Store null — the
        // card row is pruned on CARD delete, not meeting delete. (sourceMeetingId is
        // still accepted for caller compatibility but intentionally not indexed here.)
        meetingId: null,
        projectId: projectId ?? null,
      },
    ]);
  } catch (err) {
    log.error('Failed to enqueue card embed:', err);
  }
}

/** Build brief + transcript-chunk jobs for a finished session. */
async function buildSessionJobs(ctx: PostSessionContext): Promise<EmbedJob[]> {
  const db = getDb();
  const meetingId = ctx.meetingId;
  const [row] = await db
    .select({ projectId: meetings.projectId })
    .from(meetings)
    .where(eq(meetings.id, meetingId))
    .limit(1);
  const projectId = row?.projectId ?? null;

  const jobs: EmbedJob[] = [];
  const summary = ctx.brief?.summary?.trim();
  if (ctx.brief?.id && summary) {
    jobs.push({ entityType: 'brief', entityId: ctx.brief.id, chunkIndex: 0, content: summary, meetingId, projectId });
  }

  const segs = await db
    .select({ content: transcripts.content, startTime: transcripts.startTime })
    .from(transcripts)
    .where(eq(transcripts.meetingId, meetingId))
    .orderBy(asc(transcripts.startTime));
  chunkTranscript(segs, TARGET_CHUNK_CHARS).forEach((content, i) => {
    jobs.push({ entityType: 'transcript_chunk', entityId: meetingId, chunkIndex: i, content, meetingId, projectId });
  });
  return jobs;
}

/** Post-session hook: embed the brief + finalized transcript. Error-isolated. */
export async function handlePostSession(ctx: PostSessionContext): Promise<void> {
  try {
    enqueue(await buildSessionJobs(ctx));
  } catch (err) {
    log.error('Failed to enqueue session embeddings:', err);
  }
}

// ---------------------------------------------------------------------------
// Backfill / rebuild / status
// ---------------------------------------------------------------------------

/** Gather every historical brief/card/transcript as embed jobs (idempotent-safe). */
async function collectBackfillJobs(db: DB): Promise<EmbedJob[]> {
  const jobs: EmbedJob[] = [];

  // Briefs — latest per meeting.
  const briefRows = await db
    .select({
      id: meetingBriefs.id,
      summary: meetingBriefs.summary,
      meetingId: meetingBriefs.meetingId,
      projectId: meetings.projectId,
    })
    .from(meetingBriefs)
    .innerJoin(meetings, eq(meetings.id, meetingBriefs.meetingId))
    .orderBy(desc(meetingBriefs.createdAt));
  const seenMeeting = new Set<string>();
  for (const r of briefRows) {
    if (seenMeeting.has(r.meetingId)) continue;
    seenMeeting.add(r.meetingId);
    const summary = r.summary?.trim();
    if (summary)
      jobs.push({
        entityType: 'brief',
        entityId: r.id,
        chunkIndex: 0,
        content: summary,
        meetingId: r.meetingId,
        projectId: r.projectId ?? null,
      });
  }

  // Cards — title + description, with the owning project. meetingId is null: a card
  // embedding must NOT ride the meeting ON DELETE cascade (see enqueueCardEmbed).
  const cardRows = await db
    .select({
      id: cards.id,
      title: cards.title,
      description: cards.description,
      projectId: boards.projectId,
    })
    .from(cards)
    .innerJoin(columns, eq(cards.columnId, columns.id))
    .innerJoin(boards, eq(columns.boardId, boards.id));
  for (const c of cardRows) {
    const content = buildCardContent(c.title, c.description);
    if (content.trim())
      jobs.push({
        entityType: 'card',
        entityId: c.id,
        chunkIndex: 0,
        content,
        meetingId: null,
        projectId: c.projectId ?? null,
      });
  }

  // Transcripts — chunked per meeting that has segments.
  const meetingRows = await db.selectDistinct({ meetingId: transcripts.meetingId }).from(transcripts);
  for (const m of meetingRows) {
    const segs = await db
      .select({ content: transcripts.content, startTime: transcripts.startTime })
      .from(transcripts)
      .where(eq(transcripts.meetingId, m.meetingId))
      .orderBy(asc(transcripts.startTime));
    const [pj] = await db
      .select({ projectId: meetings.projectId })
      .from(meetings)
      .where(eq(meetings.id, m.meetingId))
      .limit(1);
    chunkTranscript(segs, TARGET_CHUNK_CHARS).forEach((content, i) => {
      jobs.push({
        entityType: 'transcript_chunk',
        entityId: m.meetingId,
        chunkIndex: i,
        content,
        meetingId: m.meetingId,
        projectId: pj?.projectId ?? null,
      });
    });
  }
  return jobs;
}

/**
 * Idempotent, resumable, skippable backfill over historical content. Re-running is
 * cheap: each job is content-hash-skipped, so nothing already indexed is re-embedded.
 * No-op when no embedding model is configured (graceful).
 */
export async function runBackfill(): Promise<void> {
  const route = await getEmbeddingRoute();
  if (!route) {
    log.info('Backfill skipped — no embedding model configured.');
    return;
  }
  const db = getDb();
  queue.push(...(await collectBackfillJobs(db)));
  await kickDrain();
}

/**
 * Rebuild the index from scratch with the CURRENT model — the action behind the
 * mismatch "rebuild?" affordance. Wipes vectors + provenance + mismatch flag, then
 * re-embeds everything, so no two models' vectors ever coexist.
 */
export async function rebuildIndex(): Promise<void> {
  const db = getDb();
  queue = [];
  await db.delete(embeddings);
  await db.delete(embeddingIndexMeta);
  await clearMismatch(db);
  await runBackfill();
}

/** Persist the user's dismissal/deferral of the backfill prompt. */
export async function dismissBackfill(): Promise<void> {
  const db = getDb();
  await db
    .insert(settings)
    .values({ key: BACKFILL_DISMISSED_KEY, value: 'true' })
    .onConflictDoUpdate({ target: settings.key, set: { value: 'true', updatedAt: new Date() } });
}

/** Distinct-entity progress across briefs, cards, and transcripts (for Settings). */
async function computeProgress(db: DB): Promise<{ indexed: number; total: number }> {
  const num = (v: unknown) => Number(v ?? 0);
  const [tBriefs] = await db.select({ v: sql<number>`count(distinct ${meetingBriefs.meetingId})` }).from(meetingBriefs);
  const [tCards] = await db.select({ v: sql<number>`count(*)` }).from(cards);
  const [tTrans] = await db.select({ v: sql<number>`count(distinct ${transcripts.meetingId})` }).from(transcripts);
  const [iBriefs] = await db
    .select({ v: sql<number>`count(distinct ${embeddings.meetingId})` })
    .from(embeddings)
    .where(eq(embeddings.entityType, 'brief'));
  const [iCards] = await db
    .select({ v: sql<number>`count(distinct ${embeddings.entityId})` })
    .from(embeddings)
    .where(eq(embeddings.entityType, 'card'));
  const [iTrans] = await db
    .select({ v: sql<number>`count(distinct ${embeddings.meetingId})` })
    .from(embeddings)
    .where(eq(embeddings.entityType, 'transcript_chunk'));

  const totalBriefs = num(tBriefs?.v);
  const totalCards = num(tCards?.v);
  const totalTrans = num(tTrans?.v);
  const indexed =
    Math.min(num(iBriefs?.v), totalBriefs) +
    Math.min(num(iCards?.v), totalCards) +
    Math.min(num(iTrans?.v), totalTrans);
  return { indexed, total: totalBriefs + totalCards + totalTrans };
}

/** Everything the Settings "Semantic index" section renders. */
export async function getEmbeddingStatus(): Promise<EmbeddingStatus> {
  const db = getDb();
  const route = await getEmbeddingRoute();
  const { indexed, total } = await computeProgress(db);
  const mismatchRaw = await readSetting(db, MISMATCH_SETTING_KEY);
  let mismatch: { stored: string; current: string } | null = null;
  if (mismatchRaw) {
    try {
      mismatch = JSON.parse(mismatchRaw);
    } catch {
      mismatch = null;
    }
  }
  const backfillDismissed = (await readSetting(db, BACKFILL_DISMISSED_KEY)) === 'true';
  return { indexed, total, running: queue.length > 0 || drainPromise !== null, route, mismatch, backfillDismissed };
}

// ---------------------------------------------------------------------------
// Boot wiring + test helpers
// ---------------------------------------------------------------------------

/** Idempotently self-register the post-session embedding hook. Called at boot from
 *  ipc/embedding.ts (the module that pulls embeddingService into the boot chain). */
export function initEmbeddingService(): void {
  if (hooksRegistered) return;
  hooksRegistered = true;
  registerPostSessionHook((ctx) => handlePostSession(ctx));
}

/** Test-only: await the current drain to idle (or a paused stop). */
export function flushQueue(): Promise<void> {
  return kickDrain();
}

/** Test-only: reset all module state between suites. */
export function _reset(): void {
  queue = [];
  drainPromise = null;
  if (resumeTimer) {
    clearTimeout(resumeTimer);
    resumeTimer = null;
  }
  indexEnsured = false;
  hooksRegistered = false;
}
