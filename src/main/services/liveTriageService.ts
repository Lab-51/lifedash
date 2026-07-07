// === FILE PURPOSE ===
// Proactive triage loop (LIVE.2/LIVE.3) — during a recording, periodically inspects
// new transcript segments and proposes action items / decisions / questions the user
// can one-tap accept later. Persists proposals as 'proposed' rows in
// live_suggestions and emits `live-triage:suggestion` to the renderer per row.
//
// LIVE.3: when the recording's meeting has NO linked project AND no 'project'
// suggestion has been proposed yet (any status — a dismissed one means "user said
// no", so we never nag again), triage also offers a fourth kind: "project" — a
// single "Create project" chip for a clearly-distinct new initiative. The model
// NEVER creates the project; the user's one-tap accept does (liveSuggestionService).
// At most ONE project chip is ever proposed per meeting (filtered at persist).
//
// === DESIGN / FAILURE TOLERANCE ===
// This loop MUST NEVER throw into the recording pipeline. It:
//   - triggers only after >= CADENCE_SEGMENTS new segments (~40s of speech),
//   - never runs two triage passes for a meeting at once (in-flight guard),
//   - SKIPS (never queues) while a Live Assistant chat stream is in flight, so
//     chat keeps priority on the single local model,
//   - SKIPS (never queues) while transcription is in flight, yielding the shared
//     GPU to whisper/cloud transcription. During long uninterrupted speech this
//     DELAYS proposals until the transcription queue drains — degrading to
//     "later proposals", never lost: pending is retained and the next speech lull
//     fires the deferred run,
//   - caps MAX_PROPOSALS per run and de-dupes against existing proposal titles,
//   - on JSON parse/validation failure retries ONCE (error appended), then skips
//     the run — degrading to "fewer proposals" rather than crashing.
//
// === DEPENDENCIES ===
// electron (BrowserWindow), meetingService (getMeeting), ai-provider
// (resolveTaskModel/generate), ipc/meeting-agent (chat in-flight signal), zod,
// twinProfileService (buildProfileContext — V3.3 Task 2 profile injection into
// the triage system prompt, see buildTriageSystemPrompt below).
// The transcription busy-signal is INJECTED (setTranscriptionBusyProbe), not
// imported: transcriptionService imports this module (onSegment), so importing it
// back would recreate a cycle CODE-Q.1 removed.

import { BrowserWindow } from 'electron';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { liveSuggestions } from '../db/schema';
import { getMeeting } from './meetingService';
import { resolveTaskModel, generate } from './ai-provider';
import { isMeetingAgentStreamActive } from '../ipc/meeting-agent';
import { buildProfileContext } from './twinProfileService';
import { createLogger } from './logger';
import type { LiveSuggestion } from '../../shared/types';

const log = createLogger('LiveTriage');

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

/** New segments (~10s each) that must accumulate before a triage run fires. */
export const CADENCE_SEGMENTS = 4;

/** Hard cap on proposals produced per run — keeps the chip list uncluttered. */
export const MAX_PROPOSALS = 3;

/**
 * Char budget for the transcript delta fed to the model (~6k tokens at ~4
 * chars/token) so a 14B local model's context never overflows. Oldest delta
 * lines are dropped first. Char approximation avoids a tokenizer dep.
 */
const DELTA_CHAR_BUDGET = 12000;

/** The "project" kind — only offered when the meeting is unlinked and no chip exists yet. */
const PROJECT_KIND =
  '- "project": ONLY if the conversation is clearly about a distinct new initiative that is not yet tracked. title = the proposed project NAME (max ~5 words); description = one sentence on its scope. Propose at most ONE project, and only when confident.';

/**
 * Build the system prompt. When `projectEligible`, a fourth "project" kind is
 * offered (see PROJECT_KIND); otherwise the base three kinds only. Conditional
 * because the model must never propose a project for an already-linked meeting
 * (or one it has already proposed to) — filtering happens again at persist time,
 * but omitting the kind up front avoids wasted proposals.
 */
export function buildSystemPrompt(projectEligible: boolean): string {
  const kinds = [
    '- "action_item": a task, assignment, or follow-up someone committed to.',
    '- "decision": a concrete decision the group agreed on.',
    '- "question": an open question that was raised and left unanswered.',
    ...(projectEligible ? [PROJECT_KIND] : []),
  ].join('\n');
  const typeUnion = projectEligible
    ? '"action_item" | "decision" | "question" | "project"'
    : '"action_item" | "decision" | "question"';
  return `You extract concrete, one-tap-actionable proposals from a LIVE meeting transcript as it happens.

From the NEW transcript excerpt, identify up to ${MAX_PROPOSALS} items of these kinds:
${kinds}

Rules:
- Only propose items clearly supported by the excerpt — never invent content.
- Do NOT repeat any item already in the "Existing proposals" list.
- Prefer quality over quantity; return an empty array [] if nothing new qualifies.
- Each title is a short imperative phrase (max ~12 words). description is optional (1 sentence).

Respond with ONLY a JSON array (no prose, no markdown fences) matching:
[{ "type": ${typeUnion}, "title": string, "description"?: string }]`;
}

/**
 * Build the triage system prompt: base task instructions (buildSystemPrompt)
 * with the digital-twin profile context (V3.3 Task 2, live_triage priority/
 * ~800 char budget) prepended when a profile exists. Read fresh from the DB
 * on every run — no caching — so profile edits apply on the very next triage
 * pass. This loop must never throw into the recording pipeline (see file
 * header): if buildProfileContext throws for any reason, the base
 * instructions are returned unchanged — byte-identical to today.
 */
export async function buildTriageSystemPrompt(projectEligible: boolean): Promise<string> {
  const instructions = buildSystemPrompt(projectEligible);
  let profileBlock = '';
  try {
    profileBlock = await buildProfileContext('live_triage');
  } catch (err) {
    log.debug('Twin profile context lookup failed for triage (skipped):', err instanceof Error ? err.message : err);
  }
  return profileBlock ? `${profileBlock}\n\n${instructions}` : instructions;
}

// ---------------------------------------------------------------------------
// Validation (JSON-schema-constrained via zod)
// ---------------------------------------------------------------------------

// 'project' is always accepted by the schema (the model may return it); whether a
// 'project' draft is actually persisted is gated separately at persist time.
const suggestionDraftSchema = z.object({
  type: z.enum(['action_item', 'decision', 'question', 'project']),
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().min(1).optional(),
});

const suggestionArraySchema = z.array(suggestionDraftSchema);

type SuggestionDraft = z.infer<typeof suggestionDraftSchema>;

/**
 * Strip an optional ```json fence and parse+validate the model output into a
 * bounded list of drafts. Throws (with a terse reason) on malformed output so
 * the caller can retry once then skip.
 */
export function parseSuggestions(raw: string): SuggestionDraft[] {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch {
    throw new Error('Output was not valid JSON');
  }
  const result = suggestionArraySchema.safeParse(json);
  if (!result.success) {
    throw new Error(`JSON did not match the required schema: ${result.error.issues[0]?.message ?? 'invalid'}`);
  }
  return result.data.slice(0, MAX_PROPOSALS);
}

// ---------------------------------------------------------------------------
// Per-meeting loop state
// ---------------------------------------------------------------------------

interface TriageState {
  /** Segments already consumed by a prior run — the delta watermark (index). */
  processed: number;
  /** New segments since the last trigger; reset when a run starts. */
  pending: number;
  /** In-flight guard — true while a run is executing for this meeting. */
  running: boolean;
}

const states = new Map<string, TriageState>();

let mainWindow: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win;
}

// ---------------------------------------------------------------------------
// Transcription-priority probe (injected — see header)
// ---------------------------------------------------------------------------

/**
 * Predicate reporting whether whisper/cloud transcription is actively consuming
 * the shared GPU. transcriptionService registers this via setTranscriptionBusyProbe;
 * triage SKIPS (never queues) a run while it returns true, mirroring the chat-
 * priority skip. Injected rather than imported to avoid a cycle — transcriptionService
 * imports THIS module (onSegment), so importing it back would recreate one.
 */
let transcriptionBusyProbe: (() => boolean) | null = null;

/** Register (or clear, with null) the transcription busy-probe. */
export function setTranscriptionBusyProbe(probe: (() => boolean) | null): void {
  transcriptionBusyProbe = probe;
}

/** True only when a probe is registered AND it reports transcription in flight. */
function isTranscriptionBusy(): boolean {
  return transcriptionBusyProbe?.() ?? false;
}

/** Begin tracking a meeting for proactive triage. Idempotent. */
export function startTriage(meetingId: string): void {
  states.set(meetingId, { processed: 0, pending: 0, running: false });
  log.debug(`Triage started for meeting ${meetingId.slice(0, 8)}`);
}

/** Stop tracking a meeting and clear its watermark/state. Idempotent. */
export function stopTriage(meetingId: string | null): void {
  if (!meetingId) return;
  if (states.delete(meetingId)) {
    log.debug(`Triage stopped for meeting ${meetingId.slice(0, 8)}`);
  }
}

/**
 * Notify the loop that a new transcript segment was persisted. Synchronous and
 * non-throwing — safe to call from the transcription pipeline. Fires a run once
 * cadence is met, unless a run is already in flight or chat has the model.
 */
export function onSegment(meetingId: string | null): void {
  if (!meetingId) return;
  const state = states.get(meetingId);
  if (!state) return;

  state.pending += 1;
  if (state.pending < CADENCE_SEGMENTS) return;
  if (state.running) return;
  // Chat priority: SKIP (do not queue). pending is retained so the next segment
  // re-checks and the run fires as soon as chat frees the local model.
  if (isMeetingAgentStreamActive()) return;
  // Transcription priority: same SKIP semantics — yield the shared GPU to
  // in-flight transcription; pending is retained for the next segment.
  if (isTranscriptionBusy()) return;

  void runTriage(meetingId);
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * Execute one triage pass. Guaranteed not to reject — every failure path is
 * caught and logged so it can never crash the recording pipeline.
 */
async function runTriage(meetingId: string): Promise<void> {
  const state = states.get(meetingId);
  if (!state || state.running) return;

  // Claim the run synchronously (before any await) to close the re-entrancy race.
  state.running = true;
  state.pending = 0;

  try {
    // Re-check chat priority now that we're about to hit the model.
    if (isMeetingAgentStreamActive()) return;
    // Re-check transcription priority (a segment may have begun transcribing
    // between the onSegment gate and here).
    if (isTranscriptionBusy()) return;

    const meeting = await getMeeting(meetingId);
    if (!meeting) return; // meeting gone (deleted mid-recording) — nothing to do

    const segments = meeting.segments ?? [];
    const total = segments.length;
    const delta = segments.slice(state.processed);
    if (delta.length === 0) return;

    const provider = await resolveTaskModel('live_triage');
    if (!provider) {
      log.debug('No AI provider configured for live_triage — skipping run');
      return; // leave watermark so content is retried once a provider exists
    }

    const existing = await getExistingProposals(meetingId);
    const existingTitles = existing.map((e) => e.title);
    // A 'project' chip is offered ONLY when the meeting is still unlinked AND none
    // has ever been proposed for it (any status — a dismissed one counts as "no").
    const projectEligible = meeting.projectId == null && !existing.some((e) => e.type === 'project');
    const deltaText = buildDeltaText(delta);
    const basePrompt = buildPrompt(meeting.title, existingTitles, deltaText);

    const systemPrompt = await buildTriageSystemPrompt(projectEligible);
    const drafts = await generateDrafts(provider, basePrompt, systemPrompt);
    // Consume this delta whether or not it yielded proposals (degrade to fewer,
    // never re-process the same content forever).
    state.processed = total;
    if (!drafts) return; // parse/validation failed twice — already logged; skip

    await persistAndEmit(meetingId, drafts, existingTitles, projectEligible);
  } catch (err) {
    // NEVER propagate into the recording pipeline.
    log.error('Triage run failed (skipped):', err instanceof Error ? err.message : err);
  } finally {
    // The meeting may have stopped while we awaited — re-read before touching state.
    const current = states.get(meetingId);
    if (current) current.running = false;
  }
}

/**
 * Generate + validate drafts, retrying ONCE with the parse error appended.
 * Returns null when both attempts fail (caller skips the run).
 */
async function generateDrafts(
  provider: NonNullable<Awaited<ReturnType<typeof resolveTaskModel>>>,
  basePrompt: string,
  systemPrompt: string,
): Promise<SuggestionDraft[] | null> {
  let prompt = basePrompt;
  for (let attempt = 0; attempt < 2; attempt++) {
    let text: string;
    try {
      const result = await generate({
        providerId: provider.providerId,
        providerName: provider.providerName,
        apiKeyEncrypted: provider.apiKeyEncrypted,
        baseUrl: provider.baseUrl,
        model: provider.model,
        taskType: 'live_triage',
        prompt,
        system: systemPrompt,
        temperature: provider.temperature,
        maxTokens: provider.maxTokens ?? 512,
      });
      text = result.text ?? '';
    } catch (err) {
      // Generation/network failure — not a JSON problem; don't burn the retry
      // on a re-prompt, just skip this run (watermark still advances).
      log.debug('Triage generation call failed:', err instanceof Error ? err.message : err);
      return null;
    }

    try {
      return parseSuggestions(text);
    } catch (parseErr) {
      const reason = parseErr instanceof Error ? parseErr.message : 'invalid output';
      if (attempt === 0) {
        log.debug(`Triage output invalid (${reason}) — retrying once`);
        prompt = `${basePrompt}\n\nYour previous reply was rejected: ${reason}. Reply with ONLY the JSON array.`;
        continue;
      }
      log.info(`Triage output invalid after retry (${reason}) — skipping run`);
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Prompt + persistence helpers
// ---------------------------------------------------------------------------

/** Join the delta segments into a timestamped block, oldest lines dropped to budget. */
function buildDeltaText(delta: { startTime: number; content: string }[]): string {
  const lines = delta.map((s) => {
    const totalSeconds = Math.floor(s.startTime / 1000);
    const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const ss = String(totalSeconds % 60).padStart(2, '0');
    return `[${mm}:${ss}] ${s.content}`;
  });

  // Keep newest-first under budget, then restore chronological order.
  const kept: string[] = [];
  let total = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const sep = kept.length > 0 ? 1 : 0;
    if (total + sep + lines[i].length > DELTA_CHAR_BUDGET) break;
    kept.unshift(lines[i]);
    total += sep + lines[i].length;
  }
  return kept.join('\n');
}

function buildPrompt(title: string, existingTitles: string[], deltaText: string): string {
  const existing = existingTitles.length > 0 ? existingTitles.map((t) => `- ${t}`).join('\n') : '(none yet)';
  return [
    `Meeting: ${title}`,
    '',
    'Existing proposals (do NOT repeat these):',
    existing,
    '',
    'New transcript excerpt since your last pass:',
    deltaText,
  ].join('\n');
}

/**
 * All existing proposals for a meeting (any status) as {title, type}. Powers both
 * title de-dupe AND the "already proposed a project?" gate (single query — a
 * dismissed 'project' row still counts, so we never re-propose one).
 */
async function getExistingProposals(meetingId: string): Promise<{ title: string; type: string }[]> {
  const db = getDb();
  return db
    .select({ title: liveSuggestions.title, type: liveSuggestions.type })
    .from(liveSuggestions)
    .where(eq(liveSuggestions.meetingId, meetingId));
}

/**
 * Insert deduped drafts as 'proposed' rows and emit one event per new row.
 * 'project' drafts are dropped unless `projectEligible` (unlinked meeting + none
 * proposed yet), and capped to ONE per run — the model may return several.
 */
async function persistAndEmit(
  meetingId: string,
  drafts: SuggestionDraft[],
  existingTitles: string[],
  projectEligible: boolean,
): Promise<void> {
  const db = getDb();
  const seen = new Set(existingTitles.map((t) => t.toLowerCase()));
  let projectProposed = false; // cap ONE project chip per run

  for (const draft of drafts) {
    // Gate 'project' drafts: only when eligible, and at most one per run.
    if (draft.type === 'project' && (!projectEligible || projectProposed)) continue;

    const key = draft.title.toLowerCase();
    if (seen.has(key)) continue; // dedupe against existing + within this batch
    seen.add(key);
    if (draft.type === 'project') projectProposed = true;

    const [row] = await db
      .insert(liveSuggestions)
      .values({
        meetingId,
        type: draft.type,
        title: draft.title,
        description: draft.description ?? null,
        status: 'proposed',
      })
      .returning();

    const suggestion = toLiveSuggestion(row);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('live-triage:suggestion', suggestion);
    }
    log.debug(`Proposed ${suggestion.type}: ${suggestion.title}`);
  }
}

function toLiveSuggestion(row: typeof liveSuggestions.$inferSelect): LiveSuggestion {
  return {
    id: row.id,
    meetingId: row.meetingId,
    type: row.type,
    title: row.title,
    description: row.description,
    status: row.status,
    acceptedCardId: row.acceptedCardId,
    acceptedProjectId: row.acceptedProjectId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
