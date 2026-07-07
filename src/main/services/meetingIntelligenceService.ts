// === FILE PURPOSE ===
// Meeting intelligence service — AI-powered brief generation, action item extraction,
// and action item lifecycle management (approve/dismiss/convert to card).
//
// === DEPENDENCIES ===
// drizzle-orm, ai-provider.ts (generate), meetingService.ts (getMeeting), DB schema,
// twinProfileService (buildProfileContext — V3.3 Task 2 profile injection, see
// injectTwinProfileContext below)
//
// === LIMITATIONS ===
// - Prompt templates are hardcoded (no user customization yet)
// - No streaming support for AI generation (uses full generateText)
//
// === VERIFICATION STATUS ===
// - generate() API: verified from ai-provider.ts source
// - DB schema: verified from meetings.ts and cards.ts
// - Shared types: verified from types.ts

import { eq, desc, asc, count, and, ne, isNotNull, inArray } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { meetingBriefs, actionItems, cards, meetings, projects, liveSuggestions } from '../db/schema';
import { generate, resolveTaskModel } from './ai-provider';
import { getMeeting, updateMeeting } from './meetingService';
import { createLogger } from './logger';
import { autoPushActionItems, readAutoPushSetting } from './autoPushService';
import { ensureUnassignedProject } from './unassignedProjectService';
import { detectProjectFromTranscript } from './projectDetectionService';
import { buildProfileContext } from './twinProfileService';
import type { MeetingBrief, ActionItem, ActionItemStatus, MeetingTemplateType } from '../../shared/types';
import { MEETING_TEMPLATES } from '../../shared/types';
import { parseActionItems } from '../../shared/utils/action-item-parser';

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
 * Run project auto-detect for a meeting that does not yet have a projectId,
 * then assign the resolved project (or the system Unassigned project for
 * low-confidence cases) via updateMeeting. Returns the resolved projectId.
 *
 * Returns null only if no projects are available AND the Unassigned project
 * cannot be created — that's never expected in practice but handled gracefully.
 */
async function runProjectDetection(meetingId: string, transcript: string): Promise<string | null> {
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

  const detection = await detectProjectFromTranscript({
    transcript,
    projects: candidates,
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
 */
export async function generateBrief(meetingId: string): Promise<MeetingBrief> {
  const meeting = await getMeeting(meetingId);
  if (!meeting) throw new Error(`Meeting not found: ${meetingId}`);
  if (!meeting.segments || meeting.segments.length === 0) {
    throw new Error(`Meeting ${meetingId} has no transcript segments`);
  }

  // Format transcript with timestamps
  const transcript = formatTranscript(meeting.segments);

  // 1. Project auto-detect — only when projectId is not already set.
  //    detection happens BEFORE brief generation so threading uses the resolved id.
  let resolvedProjectId = meeting.projectId;
  if (!resolvedProjectId) {
    try {
      // Use the raw transcript text (no timestamps) for classification
      const classifierTranscript = meeting.segments
        .slice()
        .sort((a, b) => a.startTime - b.startTime)
        .map((s) => s.content)
        .join(' ');
      resolvedProjectId = await runProjectDetection(meetingId, classifierTranscript);
    } catch (err) {
      // Detection should never block brief generation
      log.error('Project detection failed for meeting', meetingId, ':', err);
    }
  }

  // Resolve AI provider
  const provider = await resolveTaskModel('summarization');
  if (!provider) throw new Error('No AI provider available for summarization');

  // Build user prompt — optionally include pre-meeting prep for undiscussed item flagging
  let userPrompt = `Meeting: ${meeting.title}\n\nTranscript:\n${transcript}`;

  const prepBriefing = meeting.prepBriefing;
  if (prepBriefing && prepBriefing.trim()) {
    userPrompt += `\n\n## Pre-Meeting Prep Reference\nThe following prep briefing was generated before this meeting:\n---\n${prepBriefing}\n---\n\nIMPORTANT: After generating the summary, add a section:\n## Items Not Discussed\nList any topics from the prep briefing that were NOT covered in this meeting.\nIf all prep items were addressed, write "All prep items were discussed."`;
  }

  // 2. Brief threading — fetch prior briefs from this project (skipped for Unassigned)
  if (resolvedProjectId) {
    try {
      const priors = await fetchPriorBriefs(resolvedProjectId, meetingId, THREADING_BRIEF_LIMIT);
      if (priors.length > 0) {
        const trimmed = trimBriefsToBudget(priors, userPrompt.length);
        if (trimmed.length > 0) {
          const preamble = buildThreadingPreamble(trimmed);
          userPrompt = `${preamble}\n${userPrompt}`;
          log.info(
            `Threaded ${trimmed.length} prior brief(s) into prompt for meeting ${meetingId} (${priors.length - trimmed.length} dropped for budget)`,
          );
        }
      }
    } catch (err) {
      // Threading is bonus context — never block brief generation on its failure
      log.error('Brief threading failed for meeting', meetingId, ':', err);
    }
  }

  // 3. Live-accepted context (LIVE.2) — decisions/questions the user confirmed
  //    during the meeting via the Live Assistant's proactive triage. Injected as
  //    established facts so the brief does not contradict them.
  userPrompt = await injectConfirmedLiveContext(meetingId, userPrompt);

  // Generate summary (template-aware + language-aware prompt)
  let systemPrompt = getSummarizationPrompt(meeting.template);
  const briefLangName = getLanguageName(meeting.transcriptionLanguage);
  if (briefLangName) {
    systemPrompt += `\n\nIMPORTANT: The meeting transcript is in ${briefLangName}. Write the entire summary in ${briefLangName}.`;
  }

  // 4. Digital-twin profile context (V3.3 Task 2) — who the user is, prepended
  //    to the system prompt so the brief reads like it knows the professional.
  systemPrompt = await injectTwinProfileContext(systemPrompt);

  let summaryText: string;
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
    summaryText = result.text;
  } catch (err) {
    log.error('Brief generation failed:', err);
    summaryText = 'AI brief generation failed. The transcript is available for manual review.';
  }

  // Store in DB
  const db = getDb();
  const [row] = await db
    .insert(meetingBriefs)
    .values({
      meetingId,
      summary: summaryText,
    })
    .returning();

  return toBrief(row);
}

/**
 * Extract action items from a meeting transcript using AI.
 * Parses the AI response as JSON (with a bullet-point fallback),
 * inserts each item into `action_items`, and returns the mapped array.
 */
export async function generateActionItems(meetingId: string): Promise<ActionItem[]> {
  const meeting = await getMeeting(meetingId);
  if (!meeting) throw new Error(`Meeting not found: ${meetingId}`);
  if (!meeting.segments || meeting.segments.length === 0) {
    throw new Error(`Meeting ${meetingId} has no transcript segments`);
  }

  // Format transcript with timestamps
  const transcript = meeting.segments
    .sort((a, b) => a.startTime - b.startTime)
    .map((segment) => {
      const minutes = Math.floor(segment.startTime / 60000);
      const seconds = Math.floor((segment.startTime % 60000) / 1000);
      const timestamp = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
      return `[${timestamp}] ${segment.content}`;
    })
    .join('\n');

  // Resolve AI provider
  const provider = await resolveTaskModel('summarization');
  if (!provider) throw new Error('No AI provider available for action extraction');

  // Generate action items (template-aware + language-aware prompt)
  let actionSystemPrompt = getActionExtractionPrompt(meeting.template);
  const actionLangName = getLanguageName(meeting.transcriptionLanguage);
  if (actionLangName) {
    actionSystemPrompt += `\n\nIMPORTANT: The meeting transcript is in ${actionLangName}. Write action item descriptions in ${actionLangName}.`;
  }

  // LIVE.2 anti-duplication: suppress action items already accepted live during
  // the meeting so MEET-INTEL.1's auto-push never creates a duplicate card.
  try {
    const acceptedTitles = await getAcceptedLiveActionItemTitles(meetingId);
    actionSystemPrompt += buildSuppressionInstruction(acceptedTitles);
  } catch (err) {
    // Suppression is a safety net, not core extraction — never block on its failure
    log.error('Live-suggestion suppression lookup failed for meeting', meetingId, ':', err);
  }

  // Digital-twin profile context (V3.3 Task 2) — who the user is, prepended to
  // the system prompt so extracted action items read like they know the professional.
  actionSystemPrompt = await injectTwinProfileContext(actionSystemPrompt);

  let descriptions: string[];
  try {
    const result = await generate({
      providerId: provider.providerId,
      providerName: provider.providerName,
      apiKeyEncrypted: provider.apiKeyEncrypted,
      baseUrl: provider.baseUrl,
      model: provider.model,
      taskType: 'summarization',
      prompt: `Meeting: ${meeting.title}\n\nTranscript:\n${transcript}`,
      system: actionSystemPrompt,
      temperature: provider.temperature,
      maxTokens: provider.maxTokens,
    });
    descriptions = parseActionItems(result.text);
  } catch (err) {
    log.error('Action item extraction failed:', err);
    return [];
  }

  // Insert into DB
  const db = getDb();
  const items: ActionItem[] = [];

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
