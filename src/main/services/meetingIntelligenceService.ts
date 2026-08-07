// === FILE PURPOSE ===
// Meeting intelligence service — AI-powered brief generation, action item extraction,
// and action item lifecycle management (approve/dismiss/convert to card).
//
// === DEPENDENCIES ===
// drizzle-orm, ai-provider.ts (generate), meetingService.ts (getMeeting), DB schema,
// twinProfileService (buildProfileContext — V3.3 Task 2 profile injection, see
// injectTwinProfileContext below), promptBudget.ts (AI-CTX.1 context sizing)
//
// === LIMITATIONS ===
// - Prompt templates are hardcoded (no user customization yet)
// - No streaming support for AI generation (uses full generateText)
// - The chunked map-reduce path (AI-CTX.1) labels its output in English only
//
// === VERIFICATION STATUS ===
// - generate() API: verified from ai-provider.ts source
// - DB schema: verified from meetings.ts and cards.ts
// - Shared types: verified from types.ts

import { eq, desc, asc, count, and, ne, isNotNull, inArray } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { meetingBriefs, actionItems, cards, meetings, projects, liveSuggestions, calendarEvents } from '../db/schema';
import { isForeignKeyViolation } from '../db/errors';
import { generate, resolveTaskModel, type ResolvedProvider } from './ai-provider';
import { getMeeting, updateMeeting } from './meetingService';
import { createLogger } from './logger';
import { autoPushActionItems, readAutoPushSetting } from './autoPushService';
import { ensureUnassignedProject } from './unassignedProjectService';
import { detectProjectFromTranscript } from './projectDetectionService';
import { buildProfileContext } from './twinProfileService';
import { dispatchPostSession } from './postSessionDispatcher';
import { chunkSegments, contextWindowTokens, estimateTokens, promptCharBudget } from './promptBudget';
import type { MeetingBrief, ActionItem, ActionItemStatus, MeetingTemplateType } from '../../shared/types';
import { MEETING_TEMPLATES } from '../../shared/types';
import { parseActionItems } from '../../shared/utils/action-item-parser';
import { BRIEF_FAILURE_SENTINEL } from '../../shared/briefSentinel';

const log = createLogger('MeetingIntelligence');

// ---------------------------------------------------------------------------
// Prompt Templates
// ---------------------------------------------------------------------------

const BASE_SUMMARIZATION_PROMPT = `You are a meeting summarization assistant. Summarize the transcript into three sections. Cover every distinct topic, decision, and follow-up mentioned — do not omit topics for the sake of brevity. Each bullet must be one short sentence (max 25 words).

Format:

## Key Points
- [One-sentence summary of a main topic discussed]

## Decisions Made
- [One-sentence decision, or "None" if no decisions were made]

## Follow-ups
- [One-sentence follow-up task with owner if mentioned]

Example output for a 30-minute product meeting:

## Key Points
- Team agreed to launch the beta in Q2 instead of Q1
- Mobile app has 3 critical bugs blocking release
- Design team presented new onboarding flow, well received
- Customer support requests doubled — need dedicated triage process
- API rate limits causing issues for enterprise clients

## Decisions Made
- Push beta launch to April 15 to fix critical bugs
- Hire one more QA engineer for the mobile team
- Adopt weekly bug triage meetings starting next sprint

## Follow-ups
- Sarah: share updated timeline with stakeholders by Friday
- Dev team: fix the 3 critical bugs before next sprint
- PM: draft proposal for enterprise rate limit increase

Rules:
- Aim for 4-10 bullets in Key Points — one bullet per distinct topic discussed
- Maximum 10 bullets per section
- No filler phrases ("The team discussed...", "It was mentioned that...")
- Start Key Points with the topic, not "Discussion about..."
- Start Follow-ups with the person responsible if known
- If a section has nothing, write "- None"`;

function getSummarizationPrompt(template: MeetingTemplateType): string {
  const templateInfo = MEETING_TEMPLATES.find((t) => t.type === template);
  if (!templateInfo || !templateInfo.aiPromptHint) {
    return BASE_SUMMARIZATION_PROMPT;
  }
  return `${BASE_SUMMARIZATION_PROMPT}\n\nIMPORTANT CONTEXT: ${templateInfo.aiPromptHint}`;
}

const BASE_ACTION_EXTRACTION_PROMPT = `You are a meeting action item extractor. Given a meeting transcript, identify concrete action items — tasks, assignments, and follow-ups.

Respond with a bullet list of action items:

- Schedule follow-up meeting with design team
- Update the Q4 budget spreadsheet with new numbers
- Send project timeline to stakeholders by Friday

Rules:
- Start each item with a verb (Schedule, Update, Review, Create, Send, etc.)
- One item per line, prefixed with "- "
- If no clear action items exist, respond with: No action items.
- Maximum 10 items
- Do NOT include observations, summaries, or commentary — only actionable tasks`;

function getActionExtractionPrompt(template: MeetingTemplateType): string {
  if (template === 'standup') {
    return `${BASE_ACTION_EXTRACTION_PROMPT}\n\nThis is a standup — prioritize extracting blocker-resolution tasks and follow-up items.`;
  }
  if (template === 'retro') {
    return `${BASE_ACTION_EXTRACTION_PROMPT}\n\nThis is a retrospective — focus on improvement action items the team agreed to pursue.`;
  }
  if (template === 'planning') {
    return `${BASE_ACTION_EXTRACTION_PROMPT}\n\nThis is a planning meeting — extract task assignments and commitments with owners when mentioned.`;
  }
  return BASE_ACTION_EXTRACTION_PROMPT;
}

/**
 * Map a transcription language code to a display name for AI prompt injection.
 * Returns null for English, auto-detect, null, or unknown codes — these need no
 * special instruction since prompts are already in English.
 */
function getLanguageName(code: string | null | undefined): string | null {
  const names: Record<string, string> = { cs: 'Czech', fr: 'French' };
  return code ? (names[code] ?? null) : null;
}

// ---------------------------------------------------------------------------
// Project auto-detect + brief threading constants
// ---------------------------------------------------------------------------

/** Confidence threshold for auto-assigning a meeting to a detected project. */
const DETECTION_CONFIDENCE_THRESHOLD = 0.8;

/** Max prior briefs to thread into a new brief prompt as continuity context. */
const THREADING_BRIEF_LIMIT = 3;

/**
 * Soft cap for the combined brief prompt size when threading is added.
 * 1 token ≈ 4 chars (English) — 12k tokens ≈ 48000 chars. Drop oldest brief
 * first when exceeded. Char-count approximation avoids a tokenizer dep.
 */
const THREADING_TOTAL_CHAR_BUDGET = 48000;

/**
 * Char budget for the live-suggestion suppression list injected into the
 * action-extraction prompt (LIVE.2 anti-duplication). Titles are dropped from
 * the tail once exceeded so the prompt can never blow the context window.
 */
const SUPPRESSION_CHAR_BUDGET = 4000;

// ---------------------------------------------------------------------------
// Row Mappers
// ---------------------------------------------------------------------------

function toBrief(row: typeof meetingBriefs.$inferSelect): MeetingBrief {
  return {
    id: row.id,
    meetingId: row.meetingId,
    summary: row.summary,
    createdAt: row.createdAt.toISOString(),
  };
}

function toActionItem(row: typeof actionItems.$inferSelect): ActionItem {
  return {
    id: row.id,
    meetingId: row.meetingId,
    cardId: row.cardId,
    description: row.description,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Project auto-detect + brief threading helpers
// ---------------------------------------------------------------------------

/** Format meeting segments into a timestamped transcript string. */
function formatTranscript(segments: { startTime: number; content: string }[]): string {
  return segments
    .slice()
    .sort((a, b) => a.startTime - b.startTime)
    .map((segment) => {
      const minutes = Math.floor(segment.startTime / 60000);
      const seconds = Math.floor((segment.startTime % 60000) / 1000);
      const timestamp = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
      return `[${timestamp}] ${segment.content}`;
    })
    .join('\n');
}

/**
 * Build the classifier's calendar hint (Phase G Task 5) from the cached
 * `calendar_events` row linked to a meeting — title + attendee NAMES ONLY,
 * NEVER emails (emails stay in the DB; names ride the same task-routed model
 * that already sees the full transcript, so they add no new exposure class).
 *
 * Returns `undefined` when there's no linked event, the cached row is absent
 * (e.g. purged after disconnect), or the lookup fails — in all cases the
 * caller omits `calendarContext` and the built prompt stays byte-identical
 * to today's. Never throws — bonus context, not core classification.
 */
async function buildCalendarContext(calendarEventId: string | null | undefined): Promise<string | undefined> {
  if (!calendarEventId) return undefined;
  try {
    const db = getDb();
    const [event] = await db
      .select({ title: calendarEvents.title, attendees: calendarEvents.attendees })
      .from(calendarEvents)
      .where(eq(calendarEvents.id, calendarEventId));
    if (!event) return undefined; // not cached (never synced, or purged on disconnect)

    const names = (event.attendees ?? [])
      .map((a) => a.name)
      .filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
    const attendeeText = names.length > 0 ? names.join(', ') : 'none listed';
    return `${event.title}; attendees: ${attendeeText}`;
  } catch (err) {
    log.error('Calendar context lookup failed for event', calendarEventId, ':', err);
    return undefined;
  }
}

/**
 * Run project auto-detect for a meeting that does not yet have a projectId,
 * then assign the resolved project (or the system Unassigned project for
 * low-confidence cases) via updateMeeting. Returns the resolved projectId.
 *
 * Returns null only if no projects are available AND the Unassigned project
 * cannot be created — that's never expected in practice but handled gracefully.
 *
 * `calendarEventId`, when present, feeds the classifier's optional calendar
 * hint (Phase G Task 5) — see {@link buildCalendarContext}.
 */
async function runProjectDetection(
  meetingId: string,
  transcript: string,
  calendarEventId?: string | null,
): Promise<string | null> {
  const db = getDb();

  // Load classifier candidates: non-archived, non-system projects
  const candidateRows = await db
    .select({ id: projects.id, name: projects.name, description: projects.description })
    .from(projects)
    .where(and(eq(projects.archived, false), eq(projects.system, false)));

  const candidates = candidateRows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? null,
  }));

  const calendarContext = await buildCalendarContext(calendarEventId);

  const detection = await detectProjectFromTranscript({
    transcript,
    projects: candidates,
    calendarContext,
  });

  // High confidence + valid projectId → auto-assign
  if (detection.projectId && detection.confidence > DETECTION_CONFIDENCE_THRESHOLD) {
    log.info(
      `Auto-assigning meeting ${meetingId} to project ${detection.projectId} (confidence ${detection.confidence.toFixed(2)})`,
    );
    await updateMeeting(meetingId, { projectId: detection.projectId });
    return detection.projectId;
  }

  // Otherwise → route to Unassigned + flag pending
  log.info(
    `Routing meeting ${meetingId} to Unassigned (confidence ${detection.confidence.toFixed(2)}, reason: ${detection.reason})`,
  );
  const unassigned = await ensureUnassignedProject(db);
  await updateMeeting(meetingId, {
    projectId: unassigned.id,
    unassignedPending: true,
  });
  return unassigned.id;
}

/**
 * Fetch the most recent N briefs for a project, excluding the current meeting.
 * Returns summaries newest-first. Skips threading entirely when projectId is
 * the Unassigned (system) project.
 *
 * Exported for reuse by the Live Assistant (meetingAgentService.getMeetingContext) —
 * both features want the same project-continuity context, so the logic lives here.
 */
export async function fetchPriorBriefs(projectId: string, currentMeetingId: string, limit: number): Promise<string[]> {
  const db = getDb();

  // Skip threading for the system Unassigned project
  const [proj] = await db.select({ system: projects.system }).from(projects).where(eq(projects.id, projectId));
  if (!proj || proj.system) return [];

  const rows = await db
    .select({ summary: meetingBriefs.summary, createdAt: meetingBriefs.createdAt })
    .from(meetingBriefs)
    .innerJoin(meetings, eq(meetings.id, meetingBriefs.meetingId))
    .where(and(eq(meetings.projectId, projectId), ne(meetings.id, currentMeetingId), isNotNull(meetingBriefs.summary)))
    .orderBy(desc(meetingBriefs.createdAt))
    .limit(limit);

  return rows.map((r) => r.summary).filter((s): s is string => typeof s === 'string' && s.length > 0);
}

/**
 * Build a continuity preamble from prior brief summaries. Returns an empty
 * string when no priors are provided. Caller is responsible for budget
 * trimming (see {@link trimBriefsToBudget}).
 */
function buildThreadingPreamble(priorBriefs: string[]): string {
  if (priorBriefs.length === 0) return '';
  const lines = priorBriefs.map((summary, i) => `${i + 1}. ${summary}`);
  return [
    'Recent context from this project (last meetings, most recent first):',
    '',
    ...lines,
    '',
    'Use these to maintain continuity in your brief. Do NOT repeat their content unless this meeting explicitly refers back to them. Treat them as background context only.',
    '',
  ].join('\n');
}

/**
 * Trim the prior-briefs list so the combined prompt size stays under the
 * char-count budget. Drops the OLDEST brief first (priors are passed in
 * newest-first order, so we drop from the tail).
 *
 * Returns the kept-priors list (still newest-first).
 */
export function trimBriefsToBudget(
  priors: string[],
  baseSize: number,
  totalBudget: number = THREADING_TOTAL_CHAR_BUDGET,
): string[] {
  // Try with all priors, drop oldest until under budget or empty
  const kept = priors.slice();
  while (kept.length > 0) {
    const preamble = buildThreadingPreamble(kept);
    if (baseSize + preamble.length <= totalBudget) {
      return kept;
    }
    // Drop the oldest (last in list — list is newest-first)
    kept.pop();
  }
  return kept;
}

// ---------------------------------------------------------------------------
// LIVE.2 anti-duplication: live-accepted suggestions feed the post-meeting flow
// ---------------------------------------------------------------------------
// The proactive triage loop (liveTriageService) lets the user one-tap accept
// action items / decisions / questions DURING the meeting (see
// liveSuggestionService.acceptSuggestion). Without the wiring below, every
// accepted item would reappear here after the meeting and — for action items —
// get auto-pushed as a duplicate card (see autoPushActionItems above). Queried
// directly against the live_suggestions table (not via liveSuggestionService)
// to avoid a circular import: meetingAgentService already depends on this file
// for fetchPriorBriefs, and liveSuggestionService depends on meetingAgentService
// for its card-creation rail.

/** Titles of accepted live-triage action items for a meeting (extraction suppression). */
async function getAcceptedLiveActionItemTitles(meetingId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ title: liveSuggestions.title })
    .from(liveSuggestions)
    .where(
      and(
        eq(liveSuggestions.meetingId, meetingId),
        eq(liveSuggestions.status, 'accepted'),
        eq(liveSuggestions.type, 'action_item'),
      ),
    );
  return rows.map((r) => r.title);
}

interface ConfirmedLiveItem {
  type: 'decision' | 'question';
  title: string;
  description: string | null;
}

/** Accepted live decisions/questions for a meeting (brief "confirmed during the meeting" context). */
async function getAcceptedLiveDecisionsAndQuestions(meetingId: string): Promise<ConfirmedLiveItem[]> {
  const db = getDb();
  const rows = await db
    .select({ type: liveSuggestions.type, title: liveSuggestions.title, description: liveSuggestions.description })
    .from(liveSuggestions)
    .where(
      and(
        eq(liveSuggestions.meetingId, meetingId),
        eq(liveSuggestions.status, 'accepted'),
        inArray(liveSuggestions.type, ['decision', 'question']),
      ),
    );
  return rows.map((r) => ({ type: r.type as 'decision' | 'question', title: r.title, description: r.description }));
}

/**
 * Build a "do NOT re-extract" instruction block from already-accepted live
 * action item titles, capped to a char budget so it can never blow the context
 * window. Returns '' when there is nothing to suppress.
 */
export function buildSuppressionInstruction(titles: string[], budget: number = SUPPRESSION_CHAR_BUDGET): string {
  const kept: string[] = [];
  let total = 0;
  for (const title of titles) {
    const line = `- ${title}`;
    const sep = kept.length > 0 ? 1 : 0;
    if (total + sep + line.length > budget) break;
    kept.push(line);
    total += sep + line.length;
  }
  if (kept.length === 0) return '';
  return `\n\nAlready captured live during the meeting — do NOT re-extract these as new action items:\n${kept.join('\n')}`;
}

/**
 * Build a "confirmed during the meeting" preamble from accepted live
 * decisions/questions, capped to a char budget. Returns '' when empty.
 */
export function buildConfirmedPreamble(
  items: ConfirmedLiveItem[],
  budget: number = THREADING_TOTAL_CHAR_BUDGET,
): string {
  if (items.length === 0) return '';
  const header =
    'Confirmed during the meeting (accepted live via the Live Assistant) — treat as established, do not contradict:';
  const kept: string[] = [];
  let total = header.length;
  for (const item of items) {
    const label = item.type === 'decision' ? 'Decision' : 'Question';
    const line = item.description ? `- [${label}] ${item.title}: ${item.description}` : `- [${label}] ${item.title}`;
    if (total + 1 + line.length > budget) break;
    kept.push(line);
    total += 1 + line.length;
  }
  if (kept.length === 0) return '';
  return [header, '', ...kept, ''].join('\n');
}

/**
 * Fetch + prepend the LIVE.2 "confirmed during the meeting" preamble to a brief
 * user prompt. Extracted from generateBrief to keep its complexity bounded.
 * Never throws — a lookup failure just skips the preamble (bonus context, not
 * core brief generation).
 */
async function injectConfirmedLiveContext(meetingId: string, userPrompt: string): Promise<string> {
  try {
    const confirmed = await getAcceptedLiveDecisionsAndQuestions(meetingId);
    const preamble = buildConfirmedPreamble(confirmed);
    return preamble ? `${preamble}\n${userPrompt}` : userPrompt;
  } catch (err) {
    log.error('Live-suggestion context lookup failed for meeting', meetingId, ':', err);
    return userPrompt;
  }
}

// ---------------------------------------------------------------------------
// V3.3 Task 2: Digital Twin profile injection
// ---------------------------------------------------------------------------

/**
 * Prepend the digital-twin profile context block (see twinProfileService) to a
 * brief/action-item system prompt (`summarization` task type, ~1200 char brief
 * budget). Read fresh from the DB on every call — no caching — so profile edits
 * apply on the very next generation without a restart. Never blocks generation
 * on failure — mirrors injectConfirmedLiveContext above: a lookup failure just
 * skips the block (bonus context, not core generation), returning
 * `systemPrompt` unchanged — byte-identical to today.
 */
export async function injectTwinProfileContext(systemPrompt: string): Promise<string> {
  try {
    const profileBlock = await buildProfileContext('summarization');
    return profileBlock ? `${profileBlock}\n\n${systemPrompt}` : systemPrompt;
  } catch (err) {
    log.error('Twin profile context lookup failed:', err);
    return systemPrompt;
  }
}

// ---------------------------------------------------------------------------
// MEET-DEL.1: deleted-meeting race absorption
// ---------------------------------------------------------------------------

/**
 * Persist the generated brief and — when `opts.dispatch` is true — fire the
 * post-session dispatch, or discard as a benign no-op if the meeting was
 * deleted first. Extracted from generateBrief to keep its complexity bounded
 * (same precedent as injectConfirmedLiveContext above).
 *
 * Guarded by TWO independent signals, closing the race window opened by
 * generateBrief's long-running generate() call: a fresh existence recheck
 * immediately before the write, and catching the insert's own FK violation
 * for the narrower gap the recheck cannot close. Either signal logs once at
 * info and returns null — never a raw SQL error carrying the generated
 * summary text, never a throw into IPC. A genuine (non-FK) insert failure
 * still propagates, unchanged from before this extraction.
 *
 * AI-RESIL.1: `opts.dispatch` is false on every generateBrief failure path
 * (thrown error or empty response) — the brief itself is still persisted (as
 * a classified failure card, see generateBriefText) so Regenerate and manual
 * review both work, but the post-session hooks (fact extraction, embedding,
 * entity extraction) never run against failure text. fact extraction reads
 * ONLY the brief text by contract, so dispatching on failure is exactly how
 * the twin's memory previously went dark for these sessions.
 */
async function persistBriefAndDispatch(
  meetingId: string,
  summaryText: string,
  opts: { dispatch: boolean },
): Promise<MeetingBrief | null> {
  if (!(await getMeeting(meetingId))) {
    log.info(`Meeting ${meetingId} deleted before brief generation completed — discarded`);
    return null;
  }

  const db = getDb();
  let insertedRows: (typeof meetingBriefs.$inferSelect)[];
  try {
    insertedRows = await db
      .insert(meetingBriefs)
      .values({
        meetingId,
        summary: summaryText,
      })
      .returning();
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      // The existence check above closes most of the race window; a delete
      // landing between that check and this insert still hits the FK — same
      // benign no-op, never a raw SQL error carrying the generated summary text.
      log.info(`Meeting ${meetingId} deleted before brief generation completed — discarded`);
      return null;
    }
    throw err; // genuine failure — never silently swallowed
  }

  const brief = toBrief(insertedRows[0]);

  // Post-session dispatcher seam (V3.4) — fire-and-forget, error-isolated. The
  // living-memory modules (fact extraction, embedding, entity extraction)
  // register hooks with the dispatcher; a failing/slow hook can never affect
  // this brief. This is the ONE call site for the phase — new post-session work
  // registers a hook, it does NOT edit generateBrief. Skipped on a failure card
  // (opts.dispatch false) — see the AI-RESIL.1 note above.
  if (opts.dispatch) {
    dispatchPostSession({ meetingId, brief });
  }

  return brief;
}

// ---------------------------------------------------------------------------
// AI-RESIL.1: failure-aware brief generation
// ---------------------------------------------------------------------------
// The user-reported bug (2026-08-07): generateBrief's catch persisted a bare
// BRIEF_FAILURE_SENTINEL with the real reason (timeout / connection refused /
// context overflow) going only to the log, so a repeat failure card looked
// random with zero diagnostic; a resolved-but-EMPTY generation was treated as
// success and persisted/dispatched unchanged. Both paths are classified into
// ONE failure shape below and kept out of generateBrief's own branching
// entirely — see the complexity ceiling note on generateBrief.

/** Recognizable prefix of the context-overflow message generate() already
 *  rethrows for local providers (see ai-provider.ts's LOCAL_CONTEXT_HINTS
 *  path) — passed through unchanged rather than reclassified below, since it
 *  is already a specific, actionable message naming the exact setting to
 *  change. */
const CONTEXT_OVERFLOW_PREFIX = 'Request too large for the local model.';

/** Char cap for the catch-all classification bucket only — mirrors
 *  ai-provider.ts's friendlyConnectionError truncation so a pathological
 *  error message can never blow up the persisted brief. */
const FAILURE_REASON_CHAR_CAP = 200;

/**
 * Classify a generateBrief() failure into a short, human-readable reason for
 * the persisted failure card (see BRIEF_FAILURE_SENTINEL in
 * src/shared/briefSentinel.ts). Extracted as a private helper so this
 * branching never lands inline in generateBrief.
 */
function classifyBriefFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.startsWith(CONTEXT_OVERFLOW_PREFIX)) return message;

  const lower = message.toLowerCase();
  if (lower.includes('econnrefused') || lower.includes('connection refused') || lower.includes('fetch failed')) {
    return 'the local AI server is not reachable';
  }
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('abort')) {
    return 'the model did not respond in time';
  }
  // The BUILT-IN runtime's own startup failures (llamaRuntimeService.waitForHealth)
  // say neither "timeout" nor "refused", so without these they fall through to the
  // raw catch-all — and a missed health deadline is the likeliest built-in failure
  // in practice. LlamaRole is only `chat | embedding`, so every chat task shares ONE
  // sidecar: routing two tasks to different models makes each alternation stop and
  // cold-start a multi-GB model. Naming that on the card is the whole point of this
  // classifier (see the AI-RESIL.1 correction in DECISIONS.md).
  if (lower.includes('did not become healthy')) {
    return 'the built-in model did not finish loading in time (switching models between tasks forces a full reload)';
  }
  if (lower.includes('exited during startup')) {
    return 'the built-in AI runtime failed to start';
  }
  // AI-CTX.1 belt-and-braces. The budget gate (fitsContextWindow) is supposed to
  // make this unreachable: a prompt too large for the window takes the chunked
  // map-reduce path instead of being sent. So if this card is ever seen in the
  // field, the char->token estimate was wrong for that model — a diagnosable
  // bug with a specific next step, not noise. Placed BEFORE the catch-all and
  // AFTER the built-in branches above, which it must not disturb.
  if (/exceeds the available context size|maximum context length|context.window/i.test(message)) {
    return 'the request outgrew the model context window even though the chunking gate should have prevented it — please report this, the size estimate is wrong for this model';
  }
  return message.length > FAILURE_REASON_CHAR_CAP ? `${message.slice(0, FAILURE_REASON_CHAR_CAP - 3)}...` : message;
}

/** Build the persisted failure-card text: the sentinel plus a classified
 *  provider/model/reason paragraph. */
function buildBriefFailureText(provider: ResolvedProvider, reason: string): string {
  return `${BRIEF_FAILURE_SENTINEL}\n\nReason: ${provider.providerName}/${provider.model} — ${reason}`;
}

/**
 * Run the summarization call for a brief and classify the outcome. Treats a
 * resolved-but-EMPTY response (ai-provider.ts already logs this case and
 * returns `text: ''`) the same as a thrown error — previously an empty brief
 * was persisted AND dispatched to the post-session hooks unchanged, and
 * fact extraction reads ONLY the brief text by contract, so this is exactly
 * how the twin's memory went dark for these sessions. Extracted so the
 * empty-text check lives beside the `generate` call instead of adding a new
 * inline branch to generateBrief (complexity ceiling).
 */
async function generateBriefText(
  provider: ResolvedProvider,
  userPrompt: string,
  systemPrompt: string,
): Promise<{ summaryText: string; failed: boolean }> {
  try {
    const result = await generate({
      providerId: provider.providerId,
      providerName: provider.providerName,
      apiKeyEncrypted: provider.apiKeyEncrypted,
      baseUrl: provider.baseUrl,
      model: provider.model,
      taskType: 'summarization',
      prompt: userPrompt,
      system: systemPrompt,
      temperature: provider.temperature,
      maxTokens: provider.maxTokens,
    });
    if (!result.text) {
      return { summaryText: buildBriefFailureText(provider, 'the model returned an empty response'), failed: true };
    }
    return { summaryText: result.text, failed: false };
  } catch (err) {
    log.error('Brief generation failed:', err);
    return { summaryText: buildBriefFailureText(provider, classifyBriefFailure(err)), failed: true };
  }
}

// ---------------------------------------------------------------------------
// Brief prompt assembly
// ---------------------------------------------------------------------------
// Extracted verbatim from generateBrief (AI-CTX.1) so the single pass and the
// chunked reduce pass assemble the SAME way, and so generateBrief's own
// branching stays under the eslint complexity ceiling of 15 — the same
// extraction-not-gate-widening discipline AI-RESIL.1 used.

/**
 * Run project auto-detect when the meeting has no projectId yet, so brief
 * threading can use the resolved id. Detection must never block brief
 * generation: a failure just leaves the id unresolved (exactly as before).
 */
async function resolveBriefProjectId(meeting: {
  id: string;
  projectId: string | null;
  segments: PromptSegment[];
  calendarEventId?: string | null;
}): Promise<string | null> {
  if (meeting.projectId) return meeting.projectId;
  try {
    // Raw transcript text (no timestamps) for classification
    const classifierTranscript = meeting.segments
      .slice()
      .sort((a, b) => a.startTime - b.startTime)
      .map((s) => s.content)
      .join(' ');
    return await runProjectDetection(meeting.id, classifierTranscript, meeting.calendarEventId);
  } catch (err) {
    log.error('Project detection failed for meeting', meeting.id, ':', err);
    return null;
  }
}

/** Summarization system prompt: template-aware, language-aware, then the V3.3
 *  digital-twin profile block prepended. Built BEFORE the user prompt so its
 *  length can be charged against the context budget (AI-CTX.1). */
async function buildBriefSystemPrompt(meeting: {
  template: MeetingTemplateType;
  transcriptionLanguage: string | null;
}): Promise<string> {
  let systemPrompt = getSummarizationPrompt(meeting.template);
  const briefLangName = getLanguageName(meeting.transcriptionLanguage);
  if (briefLangName) {
    systemPrompt += `\n\nIMPORTANT: The meeting transcript is in ${briefLangName}. Write the entire summary in ${briefLangName}.`;
  }
  return injectTwinProfileContext(systemPrompt);
}

/**
 * Wrap a brief "core" block — the raw transcript on the single pass, the part
 * summaries on the chunked reduce pass — in every preamble and appendix the
 * brief prompt carries: the pre-meeting prep reference, the project threading
 * preamble (MEET-INTEL.1-3) and the LIVE.2 confirmed-live context.
 *
 * `budget` / `systemPromptLength` size the threading preamble against the
 * PROVIDER's window instead of the historical fixed 48k soft cap (AI-CTX.1).
 * That cap remains the ceiling for large-window providers — the provider window
 * only governs small ones — so this is byte-identical for cloud providers.
 */
async function assembleBriefUserPrompt(
  meeting: BriefMeetingFields,
  projectId: string | null,
  core: string,
  budget: number,
  systemPromptLength: number,
): Promise<string> {
  let userPrompt = core;

  // Optionally include pre-meeting prep for undiscussed-item flagging
  const prepBriefing = meeting.prepBriefing;
  if (prepBriefing && prepBriefing.trim()) {
    userPrompt += `\n\n## Pre-Meeting Prep Reference\nThe following prep briefing was generated before this meeting:\n---\n${prepBriefing}\n---\n\nIMPORTANT: After generating the summary, add a section:\n## Items Not Discussed\nList any topics from the prep briefing that were NOT covered in this meeting.\nIf all prep items were addressed, write "All prep items were discussed."`;
  }

  // Brief threading — prior briefs from this project (skipped for Unassigned)
  if (projectId) {
    try {
      const priors = await fetchPriorBriefs(projectId, meeting.id, THREADING_BRIEF_LIMIT);
      if (priors.length > 0) {
        const totalBudget = Math.max(
          0,
          Math.min(THREADING_TOTAL_CHAR_BUDGET, budget - userPrompt.length - systemPromptLength),
        );
        const trimmed = trimBriefsToBudget(priors, userPrompt.length, totalBudget);
        if (trimmed.length > 0) {
          const preamble = buildThreadingPreamble(trimmed);
          userPrompt = `${preamble}\n${userPrompt}`;
          log.info(
            `Threaded ${trimmed.length} prior brief(s) into prompt for meeting ${meeting.id} (${priors.length - trimmed.length} dropped for budget)`,
          );
        }
      }
    } catch (err) {
      // Threading is bonus context — never block brief generation on its failure
      log.error('Brief threading failed for meeting', meeting.id, ':', err);
    }
  }

  // Live-accepted context (LIVE.2) — decisions/questions the user confirmed
  // during the meeting via the Live Assistant's proactive triage. Injected as
  // established facts so the brief does not contradict them.
  return injectConfirmedLiveContext(meeting.id, userPrompt);
}

// ---------------------------------------------------------------------------
// AI-CTX.1: context-budget gate + bounded chunked map-reduce
// ---------------------------------------------------------------------------
// The field failure (2026-08-07): a long meeting on the built-in 16k-context
// sidecar produced "request (22202 tokens) exceeds the available context size
// (16384 tokens)" deterministically on every Regenerate. Raising --ctx-size is
// NOT the fix — it is a deliberate VRAM bound (whisper shares the GPU) and no
// fixed number survives the next longer meeting. The PROMPT becomes elastic
// instead: a transcript that does not fit is summarized part-by-part and the
// parts are reduced into the real brief. Never silently — the brief prompt's own
// contract says "cover every distinct topic", so the persisted brief carries an
// honest "Summarized in N passes" note.

/** The only two segment fields prompt assembly in this file reads. */
type PromptSegment = { startTime: number; content: string };

/** Output-token reserve assumed by the fit check when a task has no configured
 *  maxTokens. Mirrors promptBudget.ts's DEFAULT_OUTPUT_RESERVE_TOKENS (private
 *  there) — the same reservation carved out of the same window. */
const DEFAULT_OUTPUT_RESERVE_TOKENS = 4096;

/** Chat-template / message-framing overhead the char measurement cannot see.
 *  Mirrors promptBudget.ts's FRAMING_OVERHEAD_TOKENS. */
const FRAMING_OVERHEAD_TOKENS = 1024;

/** Headroom reserved inside a chunk's char budget for the "Part i of N" header
 *  and the `Transcript:` framing wrapped around the segments themselves. */
const CHUNK_HEADROOM_CHARS = 512;

/** Floor for a chunk's char budget — a starved window must still make progress
 *  (same rationale as promptBudget.ts's MIN_PROMPT_CHAR_BUDGET). */
const MIN_CHUNK_CHAR_BUDGET = 1000;

/** Extra map-reduce levels allowed when the reduce prompt ITSELF overflows.
 *  Explicitly bounded: a pathological many-hour meeting must terminate with a
 *  classified failure card, never loop or recurse unbounded. */
const MAX_REDUCE_LEVELS = 2;

/**
 * True when the system + user prompt, plus the task's output reserve and the
 * chat-template framing overhead, fit the provider's context window. This is
 * the single gate deciding single-pass vs chunked for BOTH generateBrief and
 * generateActionItems — one estimate, one place to be wrong.
 */
function fitsContextWindow(provider: ResolvedProvider, systemPrompt: string, userPrompt: string): boolean {
  const needed =
    estimateTokens(systemPrompt + userPrompt) +
    (provider.maxTokens ?? DEFAULT_OUTPUT_RESERVE_TOKENS) +
    FRAMING_OVERHEAD_TOKENS;
  return needed <= contextWindowTokens(provider.providerName);
}

/** Char budget for one chunk of transcript: the provider's prompt budget minus
 *  the system prompt that rides along with every chunk, minus header headroom. */
function chunkCharBudget(budget: number, systemPrompt: string): number {
  return Math.max(MIN_CHUNK_CHAR_BUDGET, budget - systemPrompt.length - CHUNK_HEADROOM_CHARS);
}

/**
 * System prompt for a single map (part-summary) pass. Deliberately compact and
 * factual: the chunk pass gets NO twin profile, NO threading, NO live-item
 * suppression and NO prep briefing. Those belong to the final reduce pass — the
 * one that actually writes the brief — and keeping them out here is what keeps
 * each chunk prompt small enough to be worth chunking for.
 */
const CHUNK_SUMMARY_PROMPT = `You are summarizing ONE PART of a long meeting transcript. A later pass merges all part summaries into the final brief, so nothing may be lost here.

Rules:
- Preserve EVERY distinct topic discussed, decision made, action item (with its owner and date when stated), and open question.
- Use terse bullets, one fact per line. No preamble, no closing remarks.
- Never invent content. Omit a category entirely if this part contains none.
- Keep names, numbers, and dates exactly as they were said.`;

function buildChunkSystemPrompt(langName: string | null): string {
  if (!langName) return CHUNK_SUMMARY_PROMPT;
  return `${CHUNK_SUMMARY_PROMPT}\n\nIMPORTANT: The meeting transcript is in ${langName}. Write the part summary in ${langName}.`;
}

/** User prompt for one map pass — the part header plus that part's transcript. */
function buildChunkPrompt(chunk: PromptSegment[], index: number, total: number, title: string): string {
  return `Part ${index + 1} of ${total} of meeting "${title}"\n\nTranscript:\n${formatTranscript(chunk)}`;
}

/**
 * One map level: summarize every chunk SEQUENTIALLY. Sequential on purpose —
 * the built-in sidecar runs with `--parallel 1` (llamaRuntimeConfig), so
 * concurrent chunk requests would queue anyway while making failure attribution
 * harder (AI-RESIL.2).
 *
 * Returns a failure reason instead of a partial result on the FIRST chunk that
 * throws or resolves empty: a brief silently built from half a meeting is worse
 * than an honest failure card, and AI-RESIL.1's contract forbids dispatching
 * either to the twin.
 */
async function summarizeChunks(
  provider: ResolvedProvider,
  chunks: PromptSegment[][],
  title: string,
  systemPrompt: string,
): Promise<{ summaries: string[] } | { failureReason: string }> {
  const summaries: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const where = `part ${i + 1} of ${chunks.length}`;
    try {
      const result = await generate({
        providerId: provider.providerId,
        providerName: provider.providerName,
        apiKeyEncrypted: provider.apiKeyEncrypted,
        baseUrl: provider.baseUrl,
        model: provider.model,
        taskType: 'summarization',
        prompt: buildChunkPrompt(chunks[i], i, chunks.length, title),
        system: systemPrompt,
        temperature: provider.temperature,
        maxTokens: provider.maxTokens,
      });
      if (!result.text) return { failureReason: `${where} of the transcript returned an empty response` };
      summaries.push(result.text);
    } catch (err) {
      log.error(`Chunked brief: ${where} failed:`, err);
      return { failureReason: `${where} of the transcript failed — ${classifyBriefFailure(err)}` };
    }
  }
  return { summaries };
}

/** The reduce pass's core user-prompt block — it fills exactly the slot the
 *  single pass fills with the raw transcript, so every preamble
 *  assembleBriefUserPrompt adds lands identically on both paths. */
function buildReduceCore(title: string, summaries: string[]): string {
  const parts = summaries.map((summary, i) => `--- Part ${i + 1} ---\n${summary}`).join('\n\n');
  return `Meeting: ${title}\n\nPart summaries (${summaries.length} parts):\n${parts}`;
}

/** The brief-prompt fields both paths read off a meeting row. */
interface BriefMeetingFields {
  id: string;
  title: string;
  prepBriefing: string | null;
  segments: PromptSegment[];
}

interface ChunkedBriefContext {
  provider: ResolvedProvider;
  meeting: BriefMeetingFields;
  projectId: string | null;
  systemPrompt: string;
  budget: number;
  langName: string | null;
}

/** Persist a classified failure card for a chunked-path exit. Never dispatches
 *  (AI-RESIL.1): the post-session hooks must never learn from failure text. */
function persistChunkedFailure(ctx: ChunkedBriefContext, reason: string): Promise<MeetingBrief | null> {
  log.error(`Chunked brief for meeting ${ctx.meeting.id} failed: ${reason}`);
  return persistBriefAndDispatch(ctx.meeting.id, buildBriefFailureText(ctx.provider, reason), { dispatch: false });
}

/** Final reduce pass — writes the real brief from the part summaries, with the
 *  honest long-meeting note appended (English only; see LIMITATIONS). */
async function reduceChunkSummaries(
  ctx: ChunkedBriefContext,
  userPrompt: string,
  passes: number,
): Promise<MeetingBrief | null> {
  const { summaryText, failed } = await generateBriefText(ctx.provider, userPrompt, ctx.systemPrompt);
  if (failed) return persistBriefAndDispatch(ctx.meeting.id, summaryText, { dispatch: false });
  return persistBriefAndDispatch(ctx.meeting.id, `${summaryText}\n\n_Summarized in ${passes} passes (long meeting)._`, {
    dispatch: true,
  });
}

/**
 * Map-reduce a transcript that does not fit the provider's context window.
 *
 * Bounded explicitly: one map level always runs, and a reduce prompt that
 * ITSELF still overflows re-maps the part summaries as pseudo-segments at most
 * MAX_REDUCE_LEVELS more times before giving up with a classified failure card.
 * A loop, not recursion, so the bound is visible at the call site.
 */
async function generateBriefChunked(ctx: ChunkedBriefContext): Promise<MeetingBrief | null> {
  const chunkSystemPrompt = buildChunkSystemPrompt(ctx.langName);
  const budgetPerChunk = chunkCharBudget(ctx.budget, chunkSystemPrompt);
  let segments: PromptSegment[] = ctx.meeting.segments;
  let passes = 0;

  for (let level = 0; level <= MAX_REDUCE_LEVELS; level++) {
    const chunks = chunkSegments(segments, budgetPerChunk);
    log.info(`Chunked brief for meeting ${ctx.meeting.id}: level ${level}, ${chunks.length} part(s)`);

    const mapped = await summarizeChunks(ctx.provider, chunks, ctx.meeting.title, chunkSystemPrompt);
    if ('failureReason' in mapped) return persistChunkedFailure(ctx, mapped.failureReason);
    passes += chunks.length;

    // The reduce prompt carries every preamble the single pass carries, so the
    // final brief keeps template-awareness, threading continuity and twin voice.
    const userPrompt = await assembleBriefUserPrompt(
      ctx.meeting,
      ctx.projectId,
      buildReduceCore(ctx.meeting.title, mapped.summaries),
      ctx.budget,
      ctx.systemPrompt.length,
    );
    if (fitsContextWindow(ctx.provider, ctx.systemPrompt, userPrompt)) {
      return reduceChunkSummaries(ctx, userPrompt, passes + 1);
    }

    // Pathological: even the part summaries overflow. Treat them as pseudo-
    // segments and run the same map again (startTime is just the ordering key).
    segments = mapped.summaries.map((content, i) => ({ startTime: i, content }));
  }

  return persistChunkedFailure(
    ctx,
    `the transcript is still too large for this model after ${MAX_REDUCE_LEVELS + 1} rounds of summarization`,
  );
}

// ---------------------------------------------------------------------------
// Exported Functions
// ---------------------------------------------------------------------------

/**
 * Generate an AI-powered meeting brief (structured summary) from the transcript.
 * Stores the result in `meeting_briefs` and returns the mapped object.
 *
 * Flow (added in MEET-INTEL.1-3, extended in LIVE.2 Task 2 and V3.3 Task 2):
 *   1. If meeting has no projectId, run project auto-detect classifier.
 *      High confidence → assign via updateMeeting (triggers link-time auto-push hook).
 *      Low confidence → route to system Unassigned + set unassignedPending=true.
 *   2. Fetch up to 3 prior briefs from the same project (skipped for Unassigned)
 *      and inject as a continuity preamble in the brief prompt.
 *   3. Inject accepted live decisions/questions (LIVE.2) as a "confirmed during
 *      the meeting" preamble.
 *   4. Inject the digital-twin profile context (V3.3) into the system prompt.
 *   5. Generate the brief and persist it.
 *
 * MEET-DEL.1: returns `null` (never throws) when the meeting was deleted while
 * the (long-running) generate() call above was in flight — detected by a fresh
 * existence recheck immediately before the write, and by catching the insert's
 * own FK violation as a second, closing signal. Mirrors this file's own
 * `getBrief`, which already returns `MeetingBrief | null` for "no brief exists".
 *
 * AI-RESIL.1: a thrown generation error OR a resolved-but-empty response
 * persists a classified failure card (the sentinel from
 * src/shared/briefSentinel.ts plus a "Reason: provider/model — ..." paragraph)
 * instead of the bare sentinel, and skips the post-session dispatch — see
 * generateBriefText / classifyBriefFailure / persistBriefAndDispatch.
 *
 * AI-CTX.1: when the assembled prompt does not fit the provider's context
 * window, the transcript is summarized part-by-part and the parts reduced into
 * the brief (see generateBriefChunked), with an honest "Summarized in N passes"
 * note appended. A fitting transcript takes exactly the single call it always
 * did, with a byte-identical prompt.
 */
export async function generateBrief(meetingId: string): Promise<MeetingBrief | null> {
  const meeting = await getMeeting(meetingId);
  if (!meeting) throw new Error(`Meeting not found: ${meetingId}`);
  if (!meeting.segments || meeting.segments.length === 0) {
    throw new Error(`Meeting ${meetingId} has no transcript segments`);
  }

  // 1. Project auto-detect — only when projectId is not already set. Detection
  //    happens BEFORE brief generation so threading uses the resolved id.
  const resolvedProjectId = await resolveBriefProjectId(meeting);

  // Resolve AI provider
  const provider = await resolveTaskModel('summarization');
  if (!provider) throw new Error('No AI provider available for summarization');

  // 2. System prompt (template + language + V3.3 twin profile). Built before the
  //    user prompt so its length can be charged against the context budget.
  const systemPrompt = await buildBriefSystemPrompt(meeting);

  // 3. User prompt: the transcript plus every preamble (prep / threading /
  //    LIVE.2 confirmed context) — see assembleBriefUserPrompt.
  const budget = promptCharBudget(provider);
  const userPrompt = await assembleBriefUserPrompt(
    meeting,
    resolvedProjectId,
    `Meeting: ${meeting.title}\n\nTranscript:\n${formatTranscript(meeting.segments)}`,
    budget,
    systemPrompt.length,
  );

  // 4. AI-CTX.1 budget gate. Over the window → bounded map-reduce instead of a
  //    request the model is guaranteed to reject (the field failure this exists
  //    for). Under it → exactly the single call this function always made.
  if (!fitsContextWindow(provider, systemPrompt, userPrompt)) {
    log.info(
      `Brief prompt for meeting ${meetingId} exceeds ${provider.providerName}'s context window — summarizing in parts`,
    );
    return generateBriefChunked({
      provider,
      meeting,
      projectId: resolvedProjectId,
      systemPrompt,
      budget,
      langName: getLanguageName(meeting.transcriptionLanguage),
    });
  }

  // 5. Generate the summary. A thrown error or an empty response both
  //    classify as a failure card (see generateBriefText) so Regenerate has a
  //    real diagnostic instead of a silent repeat (AI-RESIL.1).
  const { summaryText, failed } = await generateBriefText(provider, userPrompt, systemPrompt);

  // 6. Persist + dispatch, or discard as a benign no-op if the meeting was
  //    deleted while generate() above was in flight — see
  //    persistBriefAndDispatch (extracted to keep this function's complexity
  //    bounded; MEET-DEL.1). Dispatch is skipped on a failure card so the
  //    post-session hooks never learn from failure text (AI-RESIL.1).
  return persistBriefAndDispatch(meetingId, summaryText, { dispatch: !failed });
}

/**
 * Action-extraction system prompt: template-aware, language-aware, plus the
 * LIVE.2 suppression list and the V3.3 digital-twin profile block. Extracted
 * from generateActionItems verbatim (AI-CTX.1 complexity ceiling).
 */
async function buildActionSystemPrompt(meeting: {
  id: string;
  template: MeetingTemplateType;
  transcriptionLanguage: string | null;
}): Promise<string> {
  let actionSystemPrompt = getActionExtractionPrompt(meeting.template);
  const actionLangName = getLanguageName(meeting.transcriptionLanguage);
  if (actionLangName) {
    actionSystemPrompt += `\n\nIMPORTANT: The meeting transcript is in ${actionLangName}. Write action item descriptions in ${actionLangName}.`;
  }

  // LIVE.2 anti-duplication: suppress action items already accepted live during
  // the meeting so MEET-INTEL.1's auto-push never creates a duplicate card.
  // Already char-capped at SUPPRESSION_CHAR_BUDGET, so it rides along with every
  // chunk on the chunked path without threatening the window.
  try {
    const acceptedTitles = await getAcceptedLiveActionItemTitles(meeting.id);
    actionSystemPrompt += buildSuppressionInstruction(acceptedTitles);
  } catch (err) {
    // Suppression is a safety net, not core extraction — never block on its failure
    log.error('Live-suggestion suppression lookup failed for meeting', meeting.id, ':', err);
  }

  // Digital-twin profile context (V3.3 Task 2) — who the user is, prepended to
  // the system prompt so extracted action items read like they know the professional.
  return injectTwinProfileContext(actionSystemPrompt);
}

/** The action-extraction user prompt for a whole transcript or one chunk of it. */
function buildActionPrompt(title: string, segments: PromptSegment[]): string {
  return `Meeting: ${title}\n\nTranscript:\n${formatTranscript(segments)}`;
}

/**
 * Merge per-part action item lists in part order, dropping cross-part repeats
 * (case-insensitive, whitespace-normalized). A chunk boundary is exactly where
 * the same commitment tends to get restated, so two parts can legitimately both
 * report it — the user must not see it twice. Exported for direct unit test.
 */
export function mergeActionDescriptions(lists: string[][]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const list of lists) {
    for (const description of list) {
      const key = description.trim().replace(/\s+/g, ' ').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(description);
    }
  }
  return merged;
}

/** One extraction call against a whole transcript or a single chunk. */
async function runActionPass(provider: ResolvedProvider, prompt: string, systemPrompt: string): Promise<string[]> {
  const result = await generate({
    providerId: provider.providerId,
    providerName: provider.providerName,
    apiKeyEncrypted: provider.apiKeyEncrypted,
    baseUrl: provider.baseUrl,
    model: provider.model,
    taskType: 'summarization',
    prompt,
    system: systemPrompt,
    temperature: provider.temperature,
    maxTokens: provider.maxTokens,
  });
  return parseActionItems(result.text);
}

/**
 * Run action extraction, chunking the transcript when it does not fit the
 * provider's context window (AI-CTX.1). Chunks run sequentially for the same
 * reason the brief's do (one sidecar, `--parallel 1`).
 *
 * Returns null when generation failed — the caller's pre-existing "degrade to an
 * empty array" contract. A failing chunk aborts the whole extraction rather than
 * returning what it has: a partial list is indistinguishable from a complete one
 * to the user, which is worse than none.
 */
async function extractActionDescriptions(
  provider: ResolvedProvider,
  meeting: { title: string; segments: PromptSegment[] },
  systemPrompt: string,
  budget: number,
): Promise<string[] | null> {
  const singlePassPrompt = buildActionPrompt(meeting.title, meeting.segments);
  try {
    if (fitsContextWindow(provider, systemPrompt, singlePassPrompt)) {
      return await runActionPass(provider, singlePassPrompt, systemPrompt);
    }
    const chunks = chunkSegments(meeting.segments, chunkCharBudget(budget, systemPrompt));
    log.info(`Action extraction: transcript exceeds ${provider.providerName}'s window — ${chunks.length} part(s)`);
    const lists: string[][] = [];
    for (const chunk of chunks) {
      lists.push(await runActionPass(provider, buildActionPrompt(meeting.title, chunk), systemPrompt));
    }
    return mergeActionDescriptions(lists);
  } catch (err) {
    log.error('Action item extraction failed:', err);
    return null;
  }
}

/**
 * Extract action items from a meeting transcript using AI.
 * Parses the AI response as JSON (with a bullet-point fallback),
 * inserts each item into `action_items`, and returns the mapped array.
 *
 * AI-CTX.1: a transcript too large for the provider's context window is
 * extracted part-by-part and the parts merged (deduped) before the insert path
 * below — which is unchanged. A fitting transcript takes exactly the single
 * call it always did, with a byte-identical prompt.
 */
export async function generateActionItems(meetingId: string): Promise<ActionItem[]> {
  const meeting = await getMeeting(meetingId);
  if (!meeting) throw new Error(`Meeting not found: ${meetingId}`);
  if (!meeting.segments || meeting.segments.length === 0) {
    throw new Error(`Meeting ${meetingId} has no transcript segments`);
  }

  // Resolve AI provider
  const provider = await resolveTaskModel('summarization');
  if (!provider) throw new Error('No AI provider available for action extraction');

  const actionSystemPrompt = await buildActionSystemPrompt(meeting);

  const descriptions = await extractActionDescriptions(
    provider,
    meeting,
    actionSystemPrompt,
    promptCharBudget(provider),
  );
  if (descriptions === null) return [];

  // MEET-DEL.1: re-check existence immediately before the write — extraction
  // above is a long-running LLM call (or several, on the chunked path), which is
  // exactly the window a delete can land in. This alone cannot close the race
  // (see the FK catch below); it just closes most of it cheaply, before spending
  // writes on a meeting that is already gone. Mirrors this function's own
  // degrade-gracefully convention (an empty array — see the null branch above).
  if (!(await getMeeting(meetingId))) {
    log.info(`Meeting ${meetingId} deleted before action items completed — discarded`);
    return [];
  }

  // Insert into DB
  const db = getDb();
  const items: ActionItem[] = [];

  try {
    for (const description of descriptions) {
      const [row] = await db
        .insert(actionItems)
        .values({
          meetingId,
          description,
          status: 'pending',
        })
        .returning();
      items.push(toActionItem(row));
    }
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      // The existence check above closes most of the race window; a delete
      // landing mid-batch still hits the FK — discard the WHOLE batch (never a
      // partial result) as the same benign no-op.
      log.info(`Meeting ${meetingId} deleted before action items completed — discarded`);
      return [];
    }
    throw err; // genuine failure — never silently swallowed
  }

  // Auto-push to Inbox column when the meeting is linked to a project
  if (meeting.projectId && items.length > 0) {
    try {
      const autoPushEnabled = await readAutoPushSetting(db);
      await autoPushActionItems({
        db,
        meetingId,
        projectId: meeting.projectId,
        actionItems: items,
        userSettings: { autoPushEnabled },
      });
      // Re-query so returned items reflect the converted status set by auto-push
      const refreshed = await db.select().from(actionItems).where(eq(actionItems.meetingId, meetingId));
      return refreshed.map((row) => ({
        id: row.id,
        meetingId: row.meetingId,
        cardId: row.cardId,
        description: row.description,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
      }));
    } catch (err) {
      // Auto-push failure must not prevent action items from being returned
      log.error('Auto-push failed for meeting', meetingId, ':', err);
    }
  }

  return items;
}

/**
 * Get the most recent brief for a meeting, or null if none exists.
 */
export async function getBrief(meetingId: string): Promise<MeetingBrief | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(meetingBriefs)
    .where(eq(meetingBriefs.meetingId, meetingId))
    .orderBy(desc(meetingBriefs.createdAt))
    .limit(1);

  return row ? toBrief(row) : null;
}

/**
 * Get all action items for a meeting, ordered by creation time.
 */
export async function getActionItems(meetingId: string): Promise<ActionItem[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(actionItems)
    .where(eq(actionItems.meetingId, meetingId))
    .orderBy(asc(actionItems.createdAt));

  return rows.map(toActionItem);
}

/**
 * Update the status of an action item (pending -> approved/dismissed/converted).
 */
export async function updateActionItemStatus(id: string, status: ActionItemStatus): Promise<ActionItem> {
  const db = getDb();
  const [row] = await db.update(actionItems).set({ status }).where(eq(actionItems.id, id)).returning();

  if (!row) throw new Error(`Action item not found: ${id}`);
  return toActionItem(row);
}

/**
 * Convert an action item into a board card.
 * Creates a new card in the specified column and marks the action item as 'converted'.
 */
export async function convertActionToCard(
  actionItemId: string,
  columnId: string,
): Promise<{ actionItem: ActionItem; cardId: string }> {
  const db = getDb();

  // Get the action item
  const [item] = await db.select().from(actionItems).where(eq(actionItems.id, actionItemId));

  if (!item) throw new Error(`Action item not found: ${actionItemId}`);

  // Count existing cards in target column for position
  const [{ value: cardCount }] = await db.select({ value: count() }).from(cards).where(eq(cards.columnId, columnId));

  // Create card
  const [card] = await db
    .insert(cards)
    .values({
      columnId,
      title: item.description.slice(0, 100),
      description: item.description,
      priority: 'medium',
      position: cardCount,
    })
    .returning();

  // Update action item
  const [updatedItem] = await db
    .update(actionItems)
    .set({ status: 'converted', cardId: card.id })
    .where(eq(actionItems.id, actionItemId))
    .returning();

  return {
    actionItem: toActionItem(updatedItem),
    cardId: card.id,
  };
}

/**
 * Delete an action item by id.
 */
export async function deleteActionItem(id: string): Promise<void> {
  const db = getDb();
  await db.delete(actionItems).where(eq(actionItems.id, id));
}
