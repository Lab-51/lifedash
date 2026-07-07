// === FILE PURPOSE ===
// Meeting agent service — the in-meeting "Live Assistant" (LIVE.1 Phase A;
// board tools + captureNote added LIVE.2 Task 3; createProject added LIVE.3
// Task 5). Exposes createMeetingAgentTools(meetingId): tools that let a local
// model read the live transcript, search it, fetch meeting context, capture
// cards, work the meeting's linked project board directly, file ratified notes,
// and create+link a new project for an unlinked meeting — modeled on
// cardAgentService.createCardAgentTools.
//
// === DEPENDENCIES ===
// ai (tool), zod, drizzle-orm, meetingService (getMeeting/getTranscripts/updateMeeting),
// projectService (createProjectRecord — shared project-creation path),
// meetingIntelligenceService (fetchPriorBriefs), inbox/unassigned/autoPush rails,
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
// - captureNote writes to live_suggestions directly via getDb()/drizzle instead
//   of going through liveSuggestionService: liveSuggestionService imports
//   createLiveAssistantCard FROM this file, so this file must never import
//   liveSuggestionService back (would create a cycle — see meetingIntelligenceService.ts's
//   own live_suggestions helpers for the same pattern).

import { tool } from 'ai';
import { z } from 'zod';
import { eq, asc, count } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { cards, projects, meetingAgentThreads, meetingAgentMessages, liveSuggestions } from '../db/schema';
import { getMeeting, getTranscripts, updateMeeting } from './meetingService';
import { createProjectRecord } from './projectService';
import { fetchPriorBriefs } from './meetingIntelligenceService';
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
import type { MeetingAgentMessage, MeetingAgentThread, ToolCallRecord, ToolResultRecord } from '../../shared/types';

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
        "Get this meeting's title, project, elapsed time, and recent briefs from the same project for continuity.",
      inputSchema: z.object({}),
      execute: async () => {
        const db = getDb();
        const meeting = await getMeeting(meetingId);
        if (!meeting) return { error: 'Meeting not found' };

        let project: string | null = null;
        if (meeting.projectId) {
          const [proj] = await db
            .select({ name: projects.name })
            .from(projects)
            .where(eq(projects.id, meeting.projectId));
          project = proj?.name ?? null;
        }

        const started = new Date(meeting.startedAt).getTime();
        const end = meeting.endedAt ? new Date(meeting.endedAt).getTime() : Date.now();
        const elapsedMinutes = Math.max(0, Math.round((end - started) / 60_000));

        // Prior-brief continuity (fetchPriorBriefs skips the system Unassigned project).
        const priorBriefs = meeting.projectId
          ? await fetchPriorBriefs(meeting.projectId, meetingId, CONTEXT_BRIEF_LIMIT)
          : [];

        return { title: meeting.title, project, elapsedMinutes, priorBriefs };
      },
    }),

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
// Thread + Message Persistence (one thread per meeting)
// ---------------------------------------------------------------------------

/** Fetch the meeting's single thread, if one has been created yet. */
export async function getThreadForMeeting(meetingId: string): Promise<MeetingAgentThread | null> {
  const db = getDb();
  const [row] = await db.select().from(meetingAgentThreads).where(eq(meetingAgentThreads.meetingId, meetingId));
  return row ? toThread(row) : null;
}

/** Get the meeting's thread, creating it on first use. Unique index on meetingId keeps it one-per-meeting. */
export async function getOrCreateThread(meetingId: string): Promise<MeetingAgentThread> {
  const existing = await getThreadForMeeting(meetingId);
  if (existing) return existing;

  const db = getDb();
  const [row] = await db.insert(meetingAgentThreads).values({ meetingId }).returning();
  return toThread(row);
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
