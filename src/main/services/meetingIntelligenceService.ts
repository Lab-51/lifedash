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
// - The long-meeting passes footer (BRIEF-QUAL.1) is English only
// - A brief is written from the structure briefExtractionService produced; the
//   raw transcript rides along ONLY when it still fits the window
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
import { getMeeting, updateMeeting, registerMeetingCompletedHook } from './meetingService';
import { createLogger } from './logger';
import { autoPushActionItems, formatOwnerDueLines, readAutoPushSetting } from './autoPushService';
import { ensureUnassignedProject } from './unassignedProjectService';
import { detectProjectFromTranscript } from './projectDetectionService';
import { buildProfileContext } from './twinProfileService';
import { dispatchPostSession } from './postSessionDispatcher';
import { chunkBudget, chunkSegments, fitsWindow, promptCharBudget } from './promptBudget';
import { extractMeetingStructure } from './briefExtractionService';
import { buildRoster, formatRosterBlock, type RosterEntry } from './participantRosterService';
import { readBriefLanguageSetting } from './briefLanguageSettings';
import { resolveBriefLanguage } from '../../shared/brief/briefLanguage';
import { MeetingStructureSchema, type Commitment, type MeetingStructure } from '../../shared/types/briefStructure';
import type { MeetingBrief, ActionItem, ActionItemStatus, MeetingTemplateType } from '../../shared/types';
import { MEETING_TEMPLATES } from '../../shared/types';
import { parseActionItems } from '../../shared/utils/action-item-parser';
import { BRIEF_FAILURE_SENTINEL, isFailedBriefText } from '../../shared/briefSentinel';

const log = createLogger('MeetingIntelligence');

// ---------------------------------------------------------------------------
// Prompt Templates
// ---------------------------------------------------------------------------

// BRIEF-QUAL.2: the writer is a JUDGMENT pass, not a renderer. Completeness
// belongs to the RECORD — briefExtractionService's validated structure, persisted
// on meeting_briefs.structure and shown beside the brief as full notes — so the
// writer may now leave a topic or a detail out. BRIEF-QUAL.1 dictated how many
// bullets, in what order and in what shape, and that everything had to appear;
// the model obeyed, so every side topic got a padded bullet — the same defect as
// the caps it replaced, sign flipped, because both dictated SHAPE over PURPOSE.
// Rule-based "Also discussed" tiering and "earned detail" rules were proposed and
// REJECTED — do not reintroduce them.
//
// What is NOT judgment: every decision and every commitment still appears, and
// the truth constraints stay hard rules — never invent an owner, a date or a
// number, keep names and terms exactly, an owner only where the record marks it
// explicit. Judgment is about what to INCLUDE, never about what is TRUE.
//
// Still NO few-shot (the old 30-minute sample was an implicit length anchor), NO
// cap of any kind, and still ONE prompt for every tier down to the built-in
// Qwen3-4B at --ctx-size 16384, where it is expected to degrade flatter — never
// dishonestly, because the truth constraints and the complete record both stay.
//
// Exported for direct assertion (the same reason mergeActionDescriptions and
// buildSuppressionInstruction are): SPEC 255's twin baseline says that with no
// profile the system prompt must BE this string, and only an equality check can
// say that.
export const BRIEF_WRITER_PROMPT = `You write the meeting brief from structured notes. The notes are the complete record of the meeting: everything in them was said, and anything missing from them was not. The full notes are kept and shown next to the brief, so leaving something out of the brief loses nothing.

Write for someone who was not in the meeting and has two minutes: what the meeting was for, what changed, what was decided, who owes what by when, and what is still unresolved. You decide what matters. A detail — a condition, a rationale, a number — belongs in the brief only when it changes what the reader should expect or do. Small talk, logistics and passing mentions do not belong in the brief. When a reader profile precedes these instructions, weigh relevance to that reader.

Sections, in this order (omit a section that would be empty):

## Summary
A short paragraph: what the meeting was for and where it landed.

## Key Points
What mattered, in the order that reads best. Write each point as one clear sentence; add its condition, rationale or number only when it matters.

## Decisions
Every decision in the notes, with its rationale when the notes give one.

## Follow-ups
Every commitment in the notes, grouped by owner: one "### <Owner>" heading per person, in the order the participants are listed. Commitments with no owner, or whose owner the notes do not mark as explicit, go under a "### Unassigned" heading placed LAST. Write each as "- task (due)" when a due is known, otherwise "- task".

## Open Questions
The questions that still need an answer.

Rules:
- Every decision and every commitment in the notes appears in the brief. Never merge two decisions or two commitments into one.
- A condition on a decision or a commitment ("only if", "unless", a deadline) is never a detail to drop — keep it.
- Never invent an owner, a date or a number. If the notes do not say it, do not write it.
- Keep names, terms, numbers and dates exactly as they appear in the notes.
- Output markdown only. No preamble, no closing remarks, no code fence.`;

/** The meeting template's own hint, for ALL SIX templates — MEETING_TEMPLATES is
 *  the source of truth. Returns '' for a template with no hint (including
 *  'none'), keeping the default prompt free of an empty context paragraph. */
function templateHintBlock(template: MeetingTemplateType): string {
  const hint = MEETING_TEMPLATES.find((t) => t.type === template)?.aiPromptHint;
  return hint ? `IMPORTANT CONTEXT: ${hint}` : '';
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
- List every concrete action — there is no maximum
- Do NOT include observations, summaries, or commentary — only actionable tasks`;

/**
 * Action-extraction prompt for a template. BRIEF-QUAL.1: reads the hint from
 * MEETING_TEMPLATES for ALL SIX templates — this used to hardcode bespoke
 * sentences for exactly three (standup/retro/planning), so brainstorm, 1-on-1
 * and general silently got no template context at all while the brief prompt
 * did. One source of truth, same block shape as {@link templateHintBlock}.
 *
 * Only reachable on the LEGACY fallback path now: a brief carrying a persisted
 * structure derives its action items from the structure's commitments with no
 * model call at all (see generateActionItems).
 */
function getActionExtractionPrompt(template: MeetingTemplateType): string {
  const hint = templateHintBlock(template);
  return hint ? `${BASE_ACTION_EXTRACTION_PROMPT}\n\n${hint}` : BASE_ACTION_EXTRACTION_PROMPT;
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

/** The `structure` jsonb column is typed `unknown` on the row (it is written by
 *  this service and read by anything), so it is VALIDATED on the way out rather
 *  than cast. A legacy brief (null), a failure card (null) and a row written by a
 *  future incompatible schemaVersion all resolve to null — readers must already
 *  treat `structure` as optional context, never as a precondition. */
function parseBriefStructure(value: unknown): MeetingStructure | null {
  if (!value) return null;
  const parsed = MeetingStructureSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function toBrief(row: typeof meetingBriefs.$inferSelect): MeetingBrief {
  return {
    id: row.id,
    meetingId: row.meetingId,
    summary: row.summary,
    structure: parseBriefStructure(row.structure),
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
  opts: { dispatch: boolean; structure?: MeetingStructure },
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
        // BRIEF-QUAL.1: the structure is persisted ONLY alongside a real brief.
        // A failure card carries none on purpose — generateActionItems reads the
        // latest row's structure, and deriving commitments from a run that
        // failed would resurrect exactly the garbage AI-RESIL.1 keeps out.
        structure: opts.structure ?? null,
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
  // AI-CTX.1 belt-and-braces. The budget gate (promptBudget.fitsWindow) is supposed to
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

/**
 * The WRITER system prompt: the writer role, the template hint, then the roster +
 * brief-language block (participantRosterService owns that wording, so there is
 * exactly one place either sentence lives), and finally the V3.3 digital-twin
 * profile block prepended. Built BEFORE the user prompt so its length can be
 * charged against the context budget (AI-CTX.1).
 *
 * With no roster, no template hint and English (`langName` null) this returns
 * BRIEF_WRITER_PROMPT byte-for-byte, which is what keeps SPEC 255's twin
 * baseline ("no profile => the system prompt IS the base prompt") checkable.
 */
async function buildBriefSystemPrompt(
  meeting: { template: MeetingTemplateType },
  roster: RosterEntry[],
  langName: string | null,
): Promise<string> {
  const systemPrompt = [BRIEF_WRITER_PROMPT, templateHintBlock(meeting.template), formatRosterBlock(roster, langName)]
    .filter((block) => block.length > 0)
    .join('\n\n');
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
// BRIEF-QUAL.1: the writer pass
// ---------------------------------------------------------------------------
// AI-CTX.1's bounded map-reduce over CHUNK SUMMARIES is gone: summarizing a
// summary is the compression step this phase exists to remove, and
// briefExtractionService is the elastic path now (it extracts part-by-part and
// merges DETERMINISTICALLY in code, so nothing can be summarized away). What
// survives unchanged is every rule AI-CTX.1 established: the window never moves,
// a failing part aborts the whole run, promptBudget.ts owns the arithmetic, and
// a long meeting still says so in the persisted brief.

/** The only two segment fields prompt assembly in this file reads. */
type PromptSegment = { startTime: number; content: string };

/** The brief-prompt fields the writer reads off a meeting row. */
interface BriefMeetingFields {
  id: string;
  title: string;
  prepBriefing: string | null;
  segments: PromptSegment[];
}

/**
 * The structured notes as the writer sees them: the draft sections only. The
 * provenance block is stamped by the service, never written by a model, and is
 * of no use to the writer — putting it in the prompt would just be four more
 * fields for a 4B model to try to render.
 *
 * Indented JSON on purpose: the notes are a small fraction of the prompt next to
 * a transcript, and the weakest tier reads an indented object far more reliably
 * than a single dense line.
 */
function formatStructureNotes(structure: MeetingStructure): string {
  return JSON.stringify(
    {
      topics: structure.topics,
      decisions: structure.decisions,
      commitments: structure.commitments,
      openQuestions: structure.openQuestions,
      terms: structure.terms,
    },
    null,
    2,
  );
}

/**
 * The writer's user prompt: the structured notes first (authoritative), then the
 * raw transcript when it still fits, then every preamble the brief prompt has
 * always carried (prep reference, project threading, LIVE.2 confirmed context)
 * via the unchanged assembleBriefUserPrompt.
 *
 * WHY send the transcript at all when the notes are authoritative: it lets a
 * strong model recover nuance and exact wording. The RECORD's completeness does
 * not depend on it — the extraction pass guarantees that on either path — so the
 * transcript is the FIRST thing dropped when the window is tight.
 *
 * The fit gate is applied to the ASSEMBLED prompt rather than to the core alone,
 * which is strictly stronger: the prep briefing and the confirmed-live preamble
 * are added AFTER the core and are not bounded by the provider's window, so
 * gating on the core could still hand the model a request it must reject. The
 * second assembly costs two cheap DB reads and only ever runs on the path that
 * used to cost N+1 model calls.
 *
 * There is no third fallback: the notes are the irreducible content of the
 * meeting. Notes that alone outgrow the window surface as AI-RESIL.1's
 * classified overflow card, which is the honest answer.
 */
async function buildWriterUserPrompt(
  provider: ResolvedProvider,
  meeting: BriefMeetingFields,
  projectId: string | null,
  systemPrompt: string,
  structure: MeetingStructure,
): Promise<string> {
  const budget = promptCharBudget(provider);
  const notesCore = `Meeting: ${meeting.title}\n\nStructured notes (authoritative — the complete record of the meeting):\n${formatStructureNotes(structure)}`;
  const withTranscript = `${notesCore}\n\nTranscript:\n${formatTranscript(meeting.segments)}`;

  const full = await assembleBriefUserPrompt(meeting, projectId, withTranscript, budget, systemPrompt.length);
  if (fitsWindow(provider, systemPrompt, full)) return full;

  log.info(
    `Writer prompt for meeting ${meeting.id} exceeds ${provider.providerName}'s context window — writing from the structured notes alone`,
  );
  return assembleBriefUserPrompt(meeting, projectId, notesCore, budget, systemPrompt.length);
}

/**
 * The honest long-meeting note. `extractionPasses` is the number of transcript
 * PARTS the extraction pass ran (1 when the transcript fit), and the writer is
 * one more pass on top — so a 3-part extraction reports 4 passes. A transcript
 * that fit gets NO footer at all, which is what keeps the fits-path assertion
 * `not.toContain('Summarized in')` meaningful.
 */
function withPassesFooter(summaryText: string, extractionPasses: number): string {
  if (extractionPasses <= 1) return summaryText;
  return `${summaryText}\n\n_Summarized in ${extractionPasses + 1} passes (long meeting)._`;
}

// ---------------------------------------------------------------------------
// Exported Functions
// ---------------------------------------------------------------------------

/**
 * Generate an AI-powered meeting brief from the transcript, in TWO passes:
 * EXTRACT (briefExtractionService turns the transcript of any length into one
 * validated MeetingStructure) then WRITE (this file renders that structure into
 * the markdown brief). Stores summary + structure in `meeting_briefs` and
 * returns the mapped object.
 *
 * Flow (MEET-INTEL.1-3, LIVE.2 Task 2, V3.3 Task 2, BRIEF-QUAL.1):
 *   1. If the meeting has no projectId, run the project auto-detect classifier.
 *      High confidence -> assign via updateMeeting (fires the link-time auto-push
 *      hook). Low confidence -> system Unassigned + unassignedPending=true.
 *   2. Build the participant roster (WHO was in the room, names only) and resolve
 *      the brief language from the `brief:language` setting.
 *   3. Extract the meeting structure. A failure here is a failure of the whole
 *      brief — see AI-RESIL.1 below.
 *   4. Write the brief from the structure, with the transcript included only
 *      when it still fits (see buildWriterUserPrompt), the prior-brief threading
 *      preamble, the LIVE.2 confirmed-live context and the V3.3 twin profile.
 *   5. Persist the summary AND the structure, and dispatch the post-session hooks.
 *
 * MEET-DEL.1: returns `null` (never throws) when the meeting was deleted while
 * one of the long-running generate() calls was in flight — detected by a fresh
 * existence recheck immediately before the write and by catching the insert's own
 * FK violation as a second, closing signal.
 *
 * AI-RESIL.1: an extraction failure, a thrown writer error and a resolved-but-
 * empty writer response ALL persist a classified failure card (the sentinel from
 * src/shared/briefSentinel.ts plus a "Reason: provider/model — ..." paragraph)
 * with the post-session dispatch skipped and NO structure on the row.
 *
 * AI-CTX.1: the window never moves. A transcript too large for it is extracted
 * part-by-part (briefExtractionService) and the brief carries an honest
 * "Summarized in N passes" note; a transcript that fits costs exactly one
 * extraction call plus one writer call.
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

  // 2. Roster + brief language. Both feed BOTH passes: the extraction pass gets
  //    them as inputs (it builds its own extraction-specific wording from them),
  //    the writer gets them as the rendered roster/language block.
  const roster = await buildRoster(meeting.id);
  const { name: langName } = resolveBriefLanguage(await readBriefLanguageSetting(), meeting.transcriptionLanguage);
  const systemPrompt = await buildBriefSystemPrompt(meeting, roster, langName);

  // 3. EXTRACT. Never throws — an honest reason comes back instead, and it is a
  //    failure of the brief, not a reason to write one from nothing (AI-RESIL.1).
  const extracted = await extractMeetingStructure({ provider, meeting, roster, langName });
  if ('failureReason' in extracted) {
    log.error(`Brief extraction failed for meeting ${meetingId}: ${extracted.failureReason}`);
    return persistBriefAndDispatch(meetingId, buildBriefFailureText(provider, extracted.failureReason), {
      dispatch: false,
    });
  }
  const { structure } = extracted;

  // 4. WRITE. A thrown error or an empty response both classify as a failure
  //    card (see generateBriefText) so Regenerate has a real diagnostic.
  const userPrompt = await buildWriterUserPrompt(provider, meeting, resolvedProjectId, systemPrompt, structure);
  const { summaryText, failed } = await generateBriefText(provider, userPrompt, systemPrompt);
  if (failed) return persistBriefAndDispatch(meetingId, summaryText, { dispatch: false });

  // 5. Persist + dispatch, or discard as a benign no-op if the meeting was
  //    deleted while the calls above were in flight — see persistBriefAndDispatch.
  return persistBriefAndDispatch(meetingId, withPassesFooter(summaryText, structure.provenance.passes), {
    dispatch: true,
    structure,
  });
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
  actionSystemPrompt += buildSuppressionInstruction(await readAcceptedLiveActionTitles(meeting.id));

  // Digital-twin profile context (V3.3 Task 2) — who the user is, prepended to
  // the system prompt so extracted action items read like they know the professional.
  return injectTwinProfileContext(actionSystemPrompt);
}

/**
 * Accepted live action item titles, or [] when the lookup fails. Suppression is a
 * safety net, not core extraction — it must never block either source of action
 * items (the legacy prompt path, which embeds the titles, or the commitments
 * path, which filters on them).
 */
async function readAcceptedLiveActionTitles(meetingId: string): Promise<string[]> {
  try {
    return await getAcceptedLiveActionItemTitles(meetingId);
  } catch (err) {
    log.error('Live-suggestion suppression lookup failed for meeting', meetingId, ':', err);
    return [];
  }
}

/** The action-extraction user prompt for a whole transcript or one chunk of it. */
function buildActionPrompt(title: string, segments: PromptSegment[]): string {
  return `Meeting: ${title}\n\nTranscript:\n${formatTranscript(segments)}`;
}

/** The match key both action-item sources dedupe and suppress on: case-,
 *  whitespace-insensitive. Shared so a commitment and a parsed bullet with the
 *  same text can never both survive. */
function normalizeActionKey(description: string): string {
  return description.trim().replace(/\s+/g, ' ').toLowerCase();
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
      const key = normalizeActionKey(description);
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
): Promise<string[] | null> {
  const singlePassPrompt = buildActionPrompt(meeting.title, meeting.segments);
  try {
    if (fitsWindow(provider, systemPrompt, singlePassPrompt)) {
      return await runActionPass(provider, singlePassPrompt, systemPrompt);
    }
    const chunks = chunkSegments(meeting.segments, chunkBudget(provider, systemPrompt));
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

/** What one action item is built from, whichever source produced it. */
interface ActionItemDraft {
  description: string;
  owner: string | null;
  dueText: string | null;
}

/**
 * The structure persisted on the meeting's current brief, read through `getBrief`
 * so "the latest brief row" has exactly ONE definition (and one validation pass —
 * see parseBriefStructure). Null when there is none: a legacy brief written before
 * BRIEF-QUAL.1, a failure card (which never carries one), or a payload that no
 * longer validates. Null is not an error — it is the signal to fall back to the
 * legacy text extractor.
 */
async function readPersistedStructure(meetingId: string): Promise<MeetingStructure | null> {
  const brief = await getBrief(meetingId);
  return brief?.structure ?? null;
}

/**
 * Commitments -> action item drafts. THE contract of this phase: the structure's
 * commitments ARE the action items, so nothing is re-extracted and nothing can
 * drift between the brief's Follow-ups and the user's task list.
 *
 * `owner` is trusted ONLY when the extraction marked it `explicit` — that flag is
 * the whole defence against a model attributing a task to whoever spoke last, so
 * a non-explicit owner is dropped rather than shown.
 *
 * Applies LIVE.2 suppression (an item the user already accepted live must not be
 * re-created) and the same dedupe key mergeActionDescriptions uses, in one pass.
 */
function commitmentsToDrafts(commitments: Commitment[], acceptedLiveTitles: string[]): ActionItemDraft[] {
  const seen = new Set(acceptedLiveTitles.map(normalizeActionKey).filter((key) => key.length > 0));
  const drafts: ActionItemDraft[] = [];
  for (const commitment of commitments) {
    const key = normalizeActionKey(commitment.task);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    drafts.push({
      description: commitment.task,
      owner: commitment.explicit ? commitment.owner : null,
      dueText: commitment.due,
    });
  }
  return drafts;
}

/**
 * The action items to write, from whichever source applies:
 *   - the persisted structure's commitments (no model call at all), or
 *   - the legacy text extractor, unchanged, for a meeting whose brief predates
 *     this phase, failed, or carries an unreadable structure.
 *
 * Returns null when the legacy extraction failed — the caller's pre-existing
 * "degrade to an empty array" contract.
 */
async function resolveActionItemDrafts(
  meetingId: string,
  meeting: {
    id: string;
    title: string;
    template: MeetingTemplateType;
    transcriptionLanguage: string | null;
    segments: PromptSegment[];
  },
): Promise<ActionItemDraft[] | null> {
  const structure = await readPersistedStructure(meetingId);
  if (structure) {
    return commitmentsToDrafts(structure.commitments, await readAcceptedLiveActionTitles(meeting.id));
  }

  const provider = await resolveTaskModel('summarization');
  if (!provider) throw new Error('No AI provider available for action extraction');
  const descriptions = await extractActionDescriptions(provider, meeting, await buildActionSystemPrompt(meeting));
  if (descriptions === null) return null;
  return descriptions.map((description) => ({ description, owner: null, dueText: null }));
}

/**
 * Extract a meeting's action items and persist them to `action_items`.
 *
 * BRIEF-QUAL.1: the commitments on the brief's persisted structure ARE the action
 * items — same wording, same owner, same due, no second model call and no second
 * chance to disagree with the brief. Only a meeting without a usable structure
 * still runs the AI text extractor (see resolveActionItemDrafts).
 *
 * AI-CTX.1: on that legacy path a transcript too large for the provider's context
 * window is extracted part-by-part and the parts merged (deduped) before the
 * insert path below — which is unchanged.
 */
export async function generateActionItems(meetingId: string): Promise<ActionItem[]> {
  const meeting = await getMeeting(meetingId);
  if (!meeting) throw new Error(`Meeting not found: ${meetingId}`);
  if (!meeting.segments || meeting.segments.length === 0) {
    throw new Error(`Meeting ${meetingId} has no transcript segments`);
  }

  const drafts = await resolveActionItemDrafts(meetingId, meeting);
  if (drafts === null) return [];

  // MEET-DEL.1: re-check existence immediately before the write — resolving the
  // drafts above can be a long-running LLM call (or several, on the legacy
  // chunked path), which is exactly the window a delete can land in. This alone
  // cannot close the race (see the FK catch below); it just closes most of it
  // cheaply, before spending writes on a meeting that is already gone.
  if (!(await getMeeting(meetingId))) {
    log.info(`Meeting ${meetingId} deleted before action items completed — discarded`);
    return [];
  }

  // Insert into DB
  const db = getDb();
  const items: ActionItem[] = [];

  try {
    for (const draft of drafts) {
      const [row] = await db
        .insert(actionItems)
        .values({
          meetingId,
          description: draft.description,
          owner: draft.owner,
          dueText: draft.dueText,
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
      return refreshed.map(toActionItem);
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
      // BRIEF-QUAL.1: the owner/due the meeting actually said, as header lines.
      // Cards have no assignee and the due is never parsed into cards.dueDate —
      // both would mean guessing (see formatOwnerDueLines).
      description: `${formatOwnerDueLines(item.owner, item.dueText)}${item.description}`,
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

// ---------------------------------------------------------------------------
// TWIN-LEARN.1: auto-generation when a meeting completes
// ---------------------------------------------------------------------------
// A session that was recorded but never opened used to get NOTHING — no brief,
// no action items, and therefore no twin learning at all (the post-session
// dispatcher only runs off a SUCCESSFUL brief). The renderer's autoGenerate
// effect was the sole trigger. Main now drives the same chain off the
// status→'completed' transition, and absorbs the resulting double-fire: main is
// the only layer that can see both callers.

/** Single-flight brief generations, keyed by meetingId — same idiom as
 *  embeddingService.kickDrain, keyed. stopRecording navigates straight to the
 *  session page, so the renderer's own generateBrief lands moments after the
 *  auto-run starts; joining the in-flight promise makes that ONE generation
 *  instead of two racing writes. Entries are removed in `finally`, so a failed
 *  run never wedges the meeting. */
const inFlightBriefs = new Map<string, Promise<MeetingBrief | null>>();

/** Same, for action-item extraction, and needed for the same reason: the
 *  renderer fires generateActionItems the moment the brief resolves — which is
 *  exactly when the auto-run is starting its own. generateActionItems has no
 *  "already extracted" guard (it is also the explicit Regenerate path), so a
 *  second run would duplicate every item rather than skip. */
const inFlightActions = new Map<string, Promise<ActionItem[]>>();

function joinInFlight<T>(map: Map<string, Promise<T>>, meetingId: string, run: () => Promise<T>): Promise<T> {
  const existing = map.get(meetingId);
  if (existing) return existing;
  const started = run().finally(() => map.delete(meetingId));
  map.set(meetingId, started);
  return started;
}

/**
 * generateBrief, joined with any generation already in flight for this meeting.
 * When nothing is in flight it proceeds UNCONDITIONALLY — this is also the
 * explicit Regenerate path, so the skip conditions live ONLY in
 * ensurePostSessionGeneration below.
 */
export function generateBriefShared(meetingId: string): Promise<MeetingBrief | null> {
  return joinInFlight(inFlightBriefs, meetingId, () => generateBrief(meetingId));
}

/** generateActionItems, joined with any extraction already in flight for this
 *  meeting. Unconditional when idle, for the same reason as above. */
export function generateActionItemsShared(meetingId: string): Promise<ActionItem[]> {
  return joinInFlight(inFlightActions, meetingId, () => generateActionItems(meetingId));
}

/**
 * Generate the brief + action items for a meeting that just reached 'completed',
 * so the twin learns from every session instead of only the ones whose page the
 * user happened to open.
 *
 * Every guard is a SILENT log.debug skip: "no AI configured" and "empty
 * recording" are normal states, not errors, and AI-RESIL.1 reserves failure
 * cards for real failures the user actually asked for. Nothing here may surface
 * in the UI when it doesn't apply.
 */
export async function ensurePostSessionGeneration(meetingId: string): Promise<void> {
  const meeting = await getMeeting(meetingId);

  // (a) Mirrors the renderer's own guard (SessionWorkspace's autoGenerate
  //     effect): an empty recording must never produce a failure card. Also
  //     covers a meeting deleted between the status write and this read.
  if (!meeting || meeting.segments.length === 0) {
    log.debug(`Auto-generation skipped for meeting ${meetingId}: no transcript segments`);
    return;
  }

  // (b) Regeneration stays MANUAL. Deliberately includes a failure card — per
  //     AI-RESIL.1 a failed brief is retried by the user's Regenerate button, it
  //     is never auto-retried in a loop.
  if (meeting.brief) {
    log.debug(`Auto-generation skipped for meeting ${meetingId}: a brief already exists`);
    return;
  }

  // (c) Availability check before any work: users with no AI configured get no
  //     cards today because they never click Generate, and auto-firing must
  //     preserve that. So a missing model is a silent skip here, NOT the "No AI
  //     provider available" throw generateBrief would raise.
  if (!(await resolveTaskModel('summarization'))) {
    log.debug(`Auto-generation skipped for meeting ${meetingId}: no model resolves for summarization`);
    return;
  }

  log.info(`Meeting ${meetingId} completed — generating brief and action items`);
  const brief = await generateBriefShared(meetingId);

  // Parity with the renderer flow, minus the failure case. A null brief means
  // the meeting was deleted mid-generation (MEET-DEL.1); a failure card means
  // generation failed or came back empty (AI-RESIL.1) — and AI-CTX.1(e) makes a
  // failed generation abort the WHOLE run, never a partial one. Extracting
  // action items from failure text would be garbage the twin already refuses to
  // learn from (the brief dispatched with dispatch:false).
  if (!brief || isFailedBriefText(brief.summary)) {
    log.debug(`Auto action items skipped for meeting ${meetingId}: the brief did not generate successfully`);
    return;
  }

  await generateActionItemsShared(meetingId);
}

// Self-register on module import. Only pushes a function reference — no DB/AI
// work at import time — and ES-module caching guarantees exactly ONE
// registration no matter how many importers, the same reasoning entityFactService
// documents for its post-session hook. Boot-reached via ipc/meeting-intelligence.ts,
// which the IPC registry already imports for the meetings:* channels. This
// direction is the only possible one: meetingService cannot import this module
// (this module imports IT), which is precisely why the seam is a registry.
registerMeetingCompletedHook(ensurePostSessionGeneration);
