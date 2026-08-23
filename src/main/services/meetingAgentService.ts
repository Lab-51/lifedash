// === FILE PURPOSE ===
// Meeting agent service — the in-meeting "Live Assistant" (LIVE.1 Phase A;
// board tools + captureNote added LIVE.2 Task 3; createProject added LIVE.3
// Task 5). Exposes createMeetingAgentTools(meetingId): tools that let a local
// model read the live transcript, search it, fetch meeting context, capture
// cards, work the meeting's linked project board directly, file ratified notes,
// and create+link a new project for an unlinked meeting — modeled on
// cardAgentService.createCardAgentTools.
//
// === TWO MODES, ONE THREAD (BRAIN-UX.1 Task 5) ===
// The same per-meeting thread serves both phases; getMeetingAgentMode() decides
// which toolset a send uses from the meeting's status:
//   'live' (recording/processing/unknown) -> createMeetingAgentTools: the full
//     toolset above, unchanged.
//   'qa'   (completed)                    -> createMeetingQaTools: READ-ONLY
//     (transcript window, transcript search, meeting context + own brief) with
//     QA_SYSTEM_PROMPT. After the meeting the assistant informs but never acts,
//     so NO card/note/project/board-write tool may ever be added here — the live
//     toolset is built by spreading the Q&A toolset, so the read-only half can
//     never drift, and the Q&A half can never silently gain a side effect.
//
// === DEPENDENCIES ===
// ai (tool), zod, drizzle-orm, meetingService (getMeeting/getTranscripts/updateMeeting),
// projectService (createProjectRecord — shared project-creation path),
// meetingIntelligenceService (fetchPriorBriefs + getBrief — this meeting's OWN
//   brief, see the GROUNDING note below), inbox/unassigned/autoPush rails,
// projectAgentService (reused board-tool factories — see CIRCULAR IMPORT note
// below for why liveSuggestionService is NOT imported here),
// twinProfileService (buildProfileContext — V3.3 Task 2 profile injection into
// the Live Assistant's system prompt, see buildLiveAssistantSystemPrompt below).
//
// === LIMITATIONS ===
// - Rolling transcript window (not the whole meeting): a 2-hour local transcript
//   cannot fit a 14B model's usable context, so we cap by minutes + a hard char
//   budget and let searchTranscript reach older content on demand.
// - No embeddings / semantic search (that is Phase C).
// - Board tools degrade to a clear string (not a throw) when the meeting has no
//   linked project yet — see NO_PROJECT_MESSAGE below.
// - The transcript is NEVER injected into the system prompt (MEET-GROUND.1):
//   an hour of speech is already ~11k tokens against the local runtime's 16k
//   chat context, and a partial window would read as if it covered the whole
//   meeting. Only title/project/own-brief are injected; the transcript stays
//   reachable through getTranscriptWindow/searchTranscript.
// - captureNote writes to live_suggestions directly via getDb()/drizzle instead
//   of going through liveSuggestionService: liveSuggestionService imports
//   createLiveAssistantCard FROM this file, so this file must never import
//   liveSuggestionService back (would create a cycle — see meetingIntelligenceService.ts's
//   own live_suggestions helpers for the same pattern).

import { tool } from 'ai';
import { z } from 'zod';
import { eq, asc, desc, and, count, isNull, isNotNull } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { cards, meetings, projects, meetingAgentThreads, meetingAgentMessages, liveSuggestions } from '../db/schema';
import { getMeeting, getTranscripts, updateMeeting } from './meetingService';
import { createProjectRecord } from './projectService';
import { fetchPriorBriefs, getBrief } from './meetingIntelligenceService';
import { briefRecordText } from '../../shared/utils/briefRecordText';
import { ensureInboxColumn } from './inboxColumnService';
import { ensureUnassignedProject } from './unassignedProjectService';
import { resolvePrimaryBoardId } from './autoPushService';
import { notifyDataChanged } from './dataChangeNotifier';
import { buildProfileContext } from './twinProfileService';
import {
  createListBoardsTool,
  createListColumnCardsTool,
  createMoveCardTool,
  createGetProjectStatsTool,
  createSearchProjectCardsTool,
} from './projectAgentService';
import type {
  MeetingAgentMessage,
  MeetingAgentThread,
  MeetingAgentThreadSummary,
  ToolCallRecord,
  ToolResultRecord,
} from '../../shared/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default recent-transcript window when the model does not specify one. */
export const DEFAULT_WINDOW_MINUTES = 10;

/**
 * Hard char cap for a transcript window (~6k tokens at ~4 chars/token) so a 14B
 * local model's context never overflows. When exceeded we drop from the OLD end,
 * keeping the most recent speech. Char approximation avoids a tokenizer dep.
 */
export const TRANSCRIPT_WINDOW_CHAR_BUDGET = 24000;

/** Prior briefs from the same project to surface for continuity. */
const CONTEXT_BRIEF_LIMIT = 3;

/**
 * Returned by board tools instead of throwing when the meeting has no linked
 * project yet — the takeover UX means the assistant must degrade gracefully,
 * not crash the tool loop. Exported for tests.
 */
export const NO_PROJECT_MESSAGE = 'no project linked to this meeting yet — ask the user or use createCardInInbox';

// ---------------------------------------------------------------------------
// Post-meeting Q&A mode (BRAIN-UX.1 Task 5)
// ---------------------------------------------------------------------------

/** Which assistant mode a meeting's thread is in — see the TWO MODES note above. */
export type MeetingAgentMode = 'live' | 'qa';

/**
 * System prompt for the post-meeting Q&A mode. Counterpart of the live
 * SYSTEM_PROMPT in ipc/meeting-agent.ts — kept here next to the Q&A toolset it
 * describes, since prompt and toolset must change together.
 */
export const QA_SYSTEM_PROMPT = `## Your Role
You are the Meeting Assistant, answering questions about a meeting that has ALREADY ENDED.
This is the same conversation the user had with you during the meeting, continued afterwards.
You can only read and answer — you have no tools to create cards, notes, or projects now.

## Tool Use
- Use searchTranscript to find where something was discussed anywhere in the meeting — this
  is your main tool, since the meeting is over and the answer may be at any point in it.
- Use getTranscriptWindow to read the transcript around the END of the meeting (it returns
  the most recent minutes, which for a finished meeting means how it wrapped up).
- Use getMeetingContext for THIS meeting's own brief and its full notes (a summary of this
  meeting itself), plus its title, project and duration. It also returns briefs from OTHER
  meetings in the same project — treat those as background only, never as what happened in
  this meeting.
- Ground every answer in what the tools return — never invent meeting content.

## Answering
- Reference timestamps like [mm:ss] when you cite something that was said.
- If the transcript does not contain the answer, say so plainly instead of guessing — e.g.
  "that wasn't discussed in this meeting" — and offer what was said nearby if it helps.
- Keep answers concise and specific; expand only when the user asks for detail.`;

/**
 * Resolve the assistant mode for a meeting at send time. Only a COMPLETED
 * meeting switches to read-only Q&A; recording/processing (and an unknown id)
 * keep the live path exactly as it is today.
 *
 * Reads only the status column rather than reusing meetingService.getMeeting —
 * that loads the full transcript, brief, and action items, which would be a
 * heavy extra read on every single send.
 */
export async function getMeetingAgentMode(meetingId: string): Promise<MeetingAgentMode> {
  const db = getDb();
  const [row] = await db.select({ status: meetings.status }).from(meetings).where(eq(meetings.id, meetingId));
  return row?.status === 'completed' ? 'qa' : 'live';
}

// ---------------------------------------------------------------------------
// Digital Twin profile injection (V3.3 Task 2)
// ---------------------------------------------------------------------------

/**
 * Prepend the digital-twin profile context block (see twinProfileService) to
 * the Live Assistant's system prompt. Read fresh from the DB on every call —
 * no caching — so profile edits apply on the very next message without a
 * restart. Profile injection is an enhancement, never a failure source: if
 * buildProfileContext throws for any reason, `basePrompt` is returned
 * unchanged — byte-identical to today, exactly as when no profile has been
 * authored yet.
 */
export async function buildLiveAssistantSystemPrompt(basePrompt: string): Promise<string> {
  let profileBlock = '';
  try {
    profileBlock = await buildProfileContext('live_assistant');
  } catch {
    // profile injection is an enhancement, never a failure source — fall through with ''
  }
  return profileBlock ? `${profileBlock}\n\n${basePrompt}` : basePrompt;
}

// ---------------------------------------------------------------------------
// Meeting grounding (MEET-GROUND.1 Task 1)
//
// A completed meeting's own material used to be invisible to the assistant:
// fetchPriorBriefs deliberately EXCLUDES the current meeting, and the transcript
// only ever arrived through a tool the model was free not to call. A 4B local
// model duly answered "summarize this meeting" from the injected twin profile
// with zero tool calls. These helpers are the deterministic half of the fix —
// the same facts feed the getMeetingContext tool AND the Q&A system prompt, so
// the grounding material is present whatever the model decides to do.
// ---------------------------------------------------------------------------

/** Facts about THIS meeting, read once and shared by tool + prompt injection. */
export interface MeetingGroundingFacts {
  title: string;
  /** Linked project NAME (null when the meeting has no project). */
  project: string | null;
  /** Linked project id — needed to look up other meetings' briefs. */
  projectId: string | null;
  elapsedMinutes: number;
  /** THIS meeting's OWN brief summary (newest), or null if none generated yet. */
  brief: string | null;
}

/**
 * Char cap for the brief injected into the Q&A system prompt. Defensive: the
 * builtin runtime's chat context is 16k tokens and the brief is only one part
 * of the prompt, so an unusually long summary is truncated rather than allowed
 * to crowd out the conversation.
 */
export const MEETING_BRIEF_INJECTION_CHAR_CAP = 6000;

/** Appended when a brief is cut at the cap, so the model knows it is partial. */
export const BRIEF_TRUNCATION_MARKER = '[brief truncated]';

/**
 * Read this meeting's title, project and OWN brief in ONE place. `getBrief` is
 * reused from meetingIntelligenceService (newest brief for this meeting) — no
 * new query. Returns null when the meeting does not exist.
 */
export async function getMeetingGroundingFacts(meetingId: string): Promise<MeetingGroundingFacts | null> {
  const db = getDb();
  const meeting = await getMeeting(meetingId);
  if (!meeting) return null;

  let project: string | null = null;
  if (meeting.projectId) {
    const [proj] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, meeting.projectId));
    project = proj?.name ?? null;
  }

  const started = new Date(meeting.startedAt).getTime();
  const end = meeting.endedAt ? new Date(meeting.endedAt).getTime() : Date.now();
  const elapsedMinutes = Math.max(0, Math.round((end - started) / 60_000));

  // BRIEF-QUAL.2: brief-first, then the record's full notes when the brief
  // carries a structure — briefRecordText returns `summary` UNCHANGED when
  // structure is null, so this stays byte-identical to the pre-Task-3 read.
  const ownBrief = await getBrief(meetingId);
  const brief = ownBrief?.summary?.trim() ? briefRecordText(ownBrief.summary, ownBrief.structure) : null;

  return { title: meeting.title, project, projectId: meeting.projectId, elapsedMinutes, brief };
}

/**
 * The labeled block appended to the post-meeting Q&A system prompt. Returns
 * null when there is nothing to ground with — no such meeting, or no brief
 * generated yet — which the caller records so it can refuse honestly instead of
 * letting the model narrate this meeting from unrelated context.
 *
 * Never throws: grounding enriches the prompt, it is not a failure source. A
 * lookup that fails is treated exactly like "no brief yet".
 */
export async function buildMeetingGroundingBlock(meetingId: string): Promise<string | null> {
  let facts: MeetingGroundingFacts | null;
  try {
    facts = await getMeetingGroundingFacts(meetingId);
  } catch {
    return null;
  }
  if (!facts?.brief) return null;

  const brief =
    facts.brief.length > MEETING_BRIEF_INJECTION_CHAR_CAP
      ? `${facts.brief.slice(0, MEETING_BRIEF_INJECTION_CHAR_CAP)}\n${BRIEF_TRUNCATION_MARKER}`
      : facts.brief;

  return [
    '## This meeting (ground truth)',
    `Title: ${facts.title}`,
    ...(facts.project ? [`Project: ${facts.project}`] : []),
    'Brief:',
    brief,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Pure transcript helpers (exported for unit testing)
// ---------------------------------------------------------------------------

interface WindowSegment {
  content: string;
  startTime: number; // ms from recording start
  endTime: number;
  speaker?: string | null;
}

/** Format one segment as `[mm:ss] <Speaker: >content`. */
function formatSegmentLine(segment: WindowSegment): string {
  const totalSeconds = Math.floor(segment.startTime / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  const speaker = segment.speaker ? `${segment.speaker}: ` : '';
  return `[${mm}:${ss}] ${speaker}${segment.content}`;
}

/**
 * Build the recent-transcript window: keep segments within the last `minutes`
 * (relative to the latest segment), then enforce the char budget by dropping the
 * OLDEST lines first so the most recent speech is always retained.
 */
export function buildTranscriptWindow(
  segments: WindowSegment[],
  minutes: number,
  charBudget: number = TRANSCRIPT_WINDOW_CHAR_BUDGET,
): { text: string; keptSegments: number; truncated: boolean } {
  if (segments.length === 0) return { text: '', keptSegments: 0, truncated: false };

  // Reference "now" = the most recent moment we have transcript for.
  const referenceTime = Math.max(...segments.map((s) => s.endTime));
  const cutoff = referenceTime - minutes * 60_000;
  const windowed = segments.filter((s) => s.endTime >= cutoff);
  const lines = windowed.map(formatSegmentLine);

  // Keep newest-first under budget, then restore chronological order.
  const kept: string[] = [];
  let total = 0;
  let wasSliced = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    const sep = kept.length > 0 ? 1 : 0; // newline joiner
    if (total + sep + lines[i].length <= charBudget) {
      kept.unshift(lines[i]);
      total += sep + lines[i].length;
    } else if (kept.length === 0) {
      // A single most-recent segment already exceeds the budget — keep it sliced
      // so the model still sees the latest speech rather than nothing.
      kept.unshift(lines[i].slice(0, charBudget));
      wasSliced = true;
      break;
    } else {
      break;
    }
  }

  return {
    text: kept.join('\n'),
    keptSegments: kept.length,
    truncated: wasSliced || kept.length < windowed.length,
  };
}

/**
 * Case-insensitive substring search over segments (equivalent to ILIKE '%query%').
 * Each hit is returned with its ±1 neighbour segment for context; `match: true`
 * marks the direct hits (neighbours are `false`). Segments must be chronological.
 */
export function searchSegments(
  segments: WindowSegment[],
  query: string,
): {
  results: { timestamp: string; startTime: number; speaker: string | null; content: string; match: boolean }[];
  matchCount: number;
} {
  const q = query.trim().toLowerCase();
  if (!q) return { results: [], matchCount: 0 };

  const hits = new Set<number>();
  segments.forEach((s, i) => {
    if (s.content.toLowerCase().includes(q)) hits.add(i);
  });
  if (hits.size === 0) return { results: [], matchCount: 0 };

  const include = new Set<number>();
  for (const i of hits) {
    for (const j of [i - 1, i, i + 1]) {
      if (j >= 0 && j < segments.length) include.add(j);
    }
  }

  const results = [...include]
    .sort((a, b) => a - b)
    .map((i) => {
      const s = segments[i];
      return {
        timestamp: formatSegmentLine(s).slice(1, 6), // 'mm:ss'
        startTime: s.startTime,
        speaker: s.speaker ?? null,
        content: s.content,
        match: hits.has(i),
      };
    });

  return { results, matchCount: hits.size };
}

// ---------------------------------------------------------------------------
// Card creation (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Create a card in the meeting project's Inbox column, tagged with live-assistant
 * provenance. If the meeting has no project yet, route to the system Unassigned
 * project rather than failing — a tool call must never throw on missing project.
 */
export async function createLiveAssistantCard(
  meetingId: string,
  input: { title: string; description?: string },
): Promise<{
  success: boolean;
  cardId?: string;
  card?: { id: string; title: string; column: string };
  error?: string;
}> {
  try {
    const db = getDb();

    const meeting = await getMeeting(meetingId);
    if (!meeting) return { success: false, error: 'Meeting not found' };

    // No project yet → route to the system Unassigned project (never fail).
    let projectId = meeting.projectId;
    if (!projectId) {
      const unassigned = await ensureUnassignedProject(db);
      projectId = unassigned.id;
    }

    const boardId = await resolvePrimaryBoardId(db, projectId);
    const inbox = await ensureInboxColumn(db, boardId);

    const [{ value: cardCount }] = await db.select({ value: count() }).from(cards).where(eq(cards.columnId, inbox.id));

    const [card] = await db
      .insert(cards)
      .values({
        columnId: inbox.id,
        title: input.title,
        description: input.description ?? null,
        priority: 'medium',
        position: Number(cardCount),
        source: 'live-assistant',
        sourceMeetingId: meetingId,
      })
      .returning();

    // Single card-creation path for BOTH the live-suggestion accept rail and the
    // createCardInInbox tool — notify here once so neither double-emits.
    notifyDataChanged({ scope: 'cards', projectId });

    return {
      success: true,
      cardId: card.id,
      card: { id: card.id, title: card.title, column: inbox.name },
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to create card' };
  }
}

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

/**
 * A no-op stand-in for a project-scoped board tool when the meeting has no
 * linked project yet. Returns NO_PROJECT_MESSAGE instead of throwing so the
 * tool loop never crashes on a missing project — the model can still suggest
 * createCardInInbox (which itself falls back to the Unassigned project).
 */
function noProjectTool(description: string) {
  return tool({
    description,
    inputSchema: z.object({}),
    execute: async () => NO_PROJECT_MESSAGE,
  });
}

/**
 * The post-meeting Q&A toolset (BRAIN-UX.1 Task 5): every tool here is a pure
 * READ of this meeting — transcript window, transcript search, meeting context
 * + prior briefs. It is ALSO the read-only half of the live toolset (spread into
 * createMeetingAgentTools below), so the two can never drift apart.
 *
 * Never add a tool with a side effect to this function: a completed meeting's
 * assistant answers questions and takes no actions (see DECISIONS.md,
 * 2026-07-31 "post-meeting chat is Q&A-only").
 */
export function createMeetingQaTools(meetingId: string) {
  return {
    getTranscriptWindow: tool({
      description:
        "Get the most recent minutes of this meeting's live transcript (default 10). Use this to see what was just said before answering.",
      inputSchema: z.object({
        minutes: z
          .number()
          .optional()
          .default(DEFAULT_WINDOW_MINUTES)
          .describe('How many recent minutes of transcript to return'),
      }),
      execute: async ({ minutes }) => {
        const segments = await getTranscripts(meetingId);
        const window = buildTranscriptWindow(segments, minutes ?? DEFAULT_WINDOW_MINUTES);
        if (!window.text) return { text: '', note: 'No transcript captured yet.' };
        return window;
      },
    }),

    searchTranscript: tool({
      description:
        'Search the full meeting transcript for a keyword or phrase. Returns matching segments with one neighbouring segment on each side for context.',
      inputSchema: z.object({
        query: z.string().describe('Keyword or phrase to search for in the transcript'),
      }),
      execute: async ({ query }) => {
        const segments = await getTranscripts(meetingId);
        const { results, matchCount } = searchSegments(segments, query);
        if (matchCount === 0) return { results: [], matchCount: 0, note: `No transcript segments match "${query}".` };
        return { results, matchCount };
      },
    }),

    getMeetingContext: tool({
      description:
        "Get THIS meeting's own brief (a summary of this meeting itself), plus its title, project and elapsed time. `brief` is THIS meeting and is null until one has been generated; `priorBriefsFromOtherMeetings` are summaries of OTHER, earlier meetings in the same project — background continuity only, never report them as what happened in this meeting.",
      inputSchema: z.object({}),
      execute: async () => {
        const facts = await getMeetingGroundingFacts(meetingId);
        if (!facts) return { error: 'Meeting not found' };

        // Prior-brief continuity (fetchPriorBriefs skips the system Unassigned
        // project AND excludes this meeting — which is exactly why `brief` above
        // has to be fetched separately).
        const priorBriefsFromOtherMeetings = facts.projectId
          ? await fetchPriorBriefs(facts.projectId, meetingId, CONTEXT_BRIEF_LIMIT)
          : [];

        return {
          title: facts.title,
          project: facts.project,
          elapsedMinutes: facts.elapsedMinutes,
          brief: facts.brief,
          priorBriefsFromOtherMeetings,
        };
      },
    }),
  };
}

export async function createMeetingAgentTools(meetingId: string) {
  const meeting = await getMeeting(meetingId);
  const projectId = meeting?.projectId ?? null;

  // Board tools are borrowed from projectAgentService (not duplicated) and
  // scoped to the meeting's linked project; degrade to a clear message when
  // there is none yet (Unassigned/no-project meetings).
  const boardTools = projectId
    ? {
        listBoards: createListBoardsTool(projectId),
        listColumnCards: createListColumnCardsTool(),
        moveCard: createMoveCardTool(),
        getProjectStats: createGetProjectStatsTool(projectId),
        searchProjectCards: createSearchProjectCardsTool(projectId),
      }
    : {
        listBoards: noProjectTool("List boards in this meeting's linked project."),
        listColumnCards: noProjectTool("List cards in a column of this meeting's linked project."),
        moveCard: noProjectTool("Move a card between columns in this meeting's linked project."),
        getProjectStats: noProjectTool("Get aggregate statistics for this meeting's linked project."),
        searchProjectCards: noProjectTool("Search for cards in this meeting's linked project by title keyword."),
      };

  return {
    // Read-only half — shared verbatim with the post-meeting Q&A toolset.
    ...createMeetingQaTools(meetingId),

    createCardInInbox: tool({
      description:
        "Create a task card in the meeting project's Inbox to capture an action item or follow-up. Routes to Unassigned if the meeting has no project.",
      inputSchema: z.object({
        title: z.string().describe('Short, clear title for the card'),
        description: z.string().optional().describe('Optional 1-2 sentence detail — no task lists'),
      }),
      execute: async ({ title, description }) => createLiveAssistantCard(meetingId, { title, description }),
    }),

    captureNote: tool({
      description:
        'Capture a decision or open question the user explicitly states during the meeting (e.g. "let\'s go with X" or "we still need to figure out Y"). Recorded as already-confirmed (not a proposal) — only use this for something the user actually said, not a guess.',
      inputSchema: z.object({
        type: z.enum(['decision', 'question']).describe('Whether this is a decision that was made or an open question'),
        title: z.string().describe('Short, clear title for the note'),
        description: z.string().optional().describe('Optional 1-2 sentence detail'),
      }),
      execute: async ({ type, title, description }) => {
        // Writes live_suggestions directly (not via liveSuggestionService) to avoid
        // a circular import — see the CIRCULAR IMPORT note in the file header.
        const db = getDb();
        const [row] = await db
          .insert(liveSuggestions)
          .values({
            meetingId,
            type,
            title,
            description: description ?? null,
            status: 'accepted',
          })
          .returning();
        return { success: true, id: row.id, type: row.type, title: row.title };
      },
    }),

    createProject: tool({
      description:
        'Create a NEW project for this meeting and link the meeting to it. Use ONLY when the conversation is clearly about a distinct new initiative that is not yet tracked, the meeting has no linked project, and the user has agreed. Refuses (returns a message, never throws) if the meeting already has a linked project.',
      inputSchema: z.object({
        name: z.string().describe('Short project name (max ~5 words)'),
        description: z.string().optional().describe('Optional one-sentence scope for the project'),
      }),
      execute: async ({ name, description }) => {
        const db = getDb();
        const current = await getMeeting(meetingId);
        if (!current) return { success: false, error: 'Meeting not found' };
        // Guard against double-create within a multi-step response: re-check the
        // meeting's current link (the closure's projectId may be stale) and refuse
        // if it already has a project — createProject is only for unlinked meetings.
        if (current.projectId) {
          const [proj] = await db
            .select({ name: projects.name })
            .from(projects)
            .where(eq(projects.id, current.projectId));
          return `This meeting is already linked to the project "${proj?.name ?? 'unknown'}" — createProject is only for meetings with no linked project yet.`;
        }
        const project = await createProjectRecord(db, { name, description });
        await updateMeeting(meetingId, { projectId: project.id });
        return { success: true, projectId: project.id, name: project.name };
      },
    }),

    ...boardTools,
  };
}

// ---------------------------------------------------------------------------
// Row Mappers
// ---------------------------------------------------------------------------

function toThread(row: typeof meetingAgentThreads.$inferSelect): MeetingAgentThread {
  return {
    id: row.id,
    meetingId: row.meetingId,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toMessage(row: typeof meetingAgentMessages.$inferSelect): MeetingAgentMessage {
  return {
    id: row.id,
    threadId: row.threadId,
    role: row.role as MeetingAgentMessage['role'],
    content: row.content,
    toolCalls: row.toolCalls as ToolCallRecord[] | null,
    toolResults: row.toolResults as ToolResultRecord[] | null,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Thread + Message Persistence
//
// A meeting may now hold several threads: exactly one CURRENT (archivedAt null)
// plus any number archived by "New chat". Every read path below resolves the
// current one, so callers that only ever knew about "the" thread keep working.
// ---------------------------------------------------------------------------

/** The meeting's CURRENT (non-archived) thread, if one has been created yet.
 *  Newest-first guards the invariant: even if two un-archived rows ever existed,
 *  a deterministic single winner is returned rather than an arbitrary row. */
export async function getThreadForMeeting(meetingId: string): Promise<MeetingAgentThread | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(meetingAgentThreads)
    .where(and(eq(meetingAgentThreads.meetingId, meetingId), isNull(meetingAgentThreads.archivedAt)))
    .orderBy(desc(meetingAgentThreads.createdAt))
    .limit(1);
  return row ? toThread(row) : null;
}

/** Get the meeting's current thread, creating it on first use. */
export async function getOrCreateThread(meetingId: string): Promise<MeetingAgentThread> {
  const existing = await getThreadForMeeting(meetingId);
  if (existing) return existing;

  const db = getDb();
  const [row] = await db.insert(meetingAgentThreads).values({ meetingId }).returning();
  return toThread(row);
}

/**
 * Every thread for a meeting — current first, then most-recently archived —
 * each with its message count and the first user line, so the archive picker can
 * label a conversation by what it was about instead of by a uuid.
 *
 * Empty threads are included deliberately: only the CURRENT one can be empty
 * (startNewThread refuses to archive a blank), and hiding it would make the
 * picker disagree with what the user is looking at.
 */
export async function listThreadsWithCounts(meetingId: string): Promise<MeetingAgentThreadSummary[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(meetingAgentThreads)
    .where(eq(meetingAgentThreads.meetingId, meetingId))
    .orderBy(desc(meetingAgentThreads.createdAt));

  const summaries = await Promise.all(
    rows.map(async (row) => {
      const messages = await getThreadMessages(row.id);
      const firstUser = messages.find((m) => m.role === 'user' && m.content?.trim());
      return {
        ...toThread(row),
        messageCount: messages.length,
        preview: firstUser?.content?.trim().slice(0, 80) ?? null,
      };
    }),
  );
  // Current thread first; archived ones stay newest-first behind it.
  return summaries.sort((a, b) => Number(!!a.archivedAt) - Number(!!b.archivedAt));
}

/**
 * Start a fresh conversation, keeping the old one readable: archive the current
 * thread rather than deleting it. Returns the new (empty) current thread.
 *
 * Archiving with no thread yet, or with an empty one, is a no-op reuse — there
 * is nothing to preserve, and it would otherwise litter the archive with blanks.
 */
export async function startNewThread(meetingId: string): Promise<MeetingAgentThread> {
  const db = getDb();
  const current = await getThreadForMeeting(meetingId);
  if (!current) return getOrCreateThread(meetingId);

  const existingMessages = await getThreadMessages(current.id);
  if (existingMessages.length === 0) return current;

  await db.update(meetingAgentThreads).set({ archivedAt: new Date() }).where(eq(meetingAgentThreads.id, current.id));

  const [row] = await db.insert(meetingAgentThreads).values({ meetingId }).returning();
  return toThread(row);
}

/**
 * Permanently delete a thread's messages. Unlike "New chat" this keeps NO copy —
 * it is the explicit "clean this chat" action, so the UI must confirm first.
 *
 * Deletes messages by threadId only; the thread row itself survives so the open
 * chat keeps its identity and an in-flight stream cannot land on a missing FK.
 * Nothing here touches transcripts, briefs, cards or twin facts — the assistant
 * conversation is not a source for any of them.
 */
export async function clearThreadMessages(meetingId: string): Promise<void> {
  const thread = await getThreadForMeeting(meetingId);
  if (!thread) return;
  const db = getDb();
  await db.delete(meetingAgentMessages).where(eq(meetingAgentMessages.threadId, thread.id));
  await db.update(meetingAgentThreads).set({ updatedAt: new Date() }).where(eq(meetingAgentThreads.id, thread.id));
}

/** Delete one archived thread outright (its messages cascade). Refuses to touch
 *  the current thread — that is `clearThreadMessages`'s job, which keeps the row. */
export async function deleteArchivedThread(threadId: string): Promise<void> {
  const db = getDb();
  await db
    .delete(meetingAgentThreads)
    .where(and(eq(meetingAgentThreads.id, threadId), isNotNull(meetingAgentThreads.archivedAt)));
}

/** All messages for a thread, oldest first. */
export async function getThreadMessages(threadId: string): Promise<MeetingAgentMessage[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(meetingAgentMessages)
    .where(eq(meetingAgentMessages.threadId, threadId))
    .orderBy(asc(meetingAgentMessages.createdAt));
  return rows.map(toMessage);
}

/** Message history for a meeting's drawer — empty array if no thread exists yet (never fails). */
export async function getMessagesForMeeting(meetingId: string): Promise<MeetingAgentMessage[]> {
  const thread = await getThreadForMeeting(meetingId);
  if (!thread) return [];
  return getThreadMessages(thread.id);
}

export async function addMessage(
  threadId: string,
  role: MeetingAgentMessage['role'],
  content: string | null,
  toolCalls?: ToolCallRecord[],
  toolResults?: ToolResultRecord[],
): Promise<MeetingAgentMessage> {
  const db = getDb();
  const [row] = await db
    .insert(meetingAgentMessages)
    .values({
      threadId,
      role,
      content,
      toolCalls: toolCalls ?? null,
      toolResults: toolResults ?? null,
    })
    .returning();
  return toMessage(row);
}
