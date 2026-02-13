// === FILE PURPOSE ===
// Meeting intelligence service — AI-powered brief generation, action item extraction,
// and action item lifecycle management (approve/dismiss/convert to card).
//
// === DEPENDENCIES ===
// drizzle-orm, ai-provider.ts (generate), meetingService.ts (getMeeting), DB schema
//
// === LIMITATIONS ===
// - Prompt templates are hardcoded (no user customization yet)
// - No streaming support for AI generation (uses full generateText)
//
// === VERIFICATION STATUS ===
// - generate() API: verified from ai-provider.ts source
// - DB schema: verified from meetings.ts and cards.ts
// - Shared types: verified from types.ts

import { eq, desc, asc, count } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { meetingBriefs, actionItems, cards } from '../db/schema';
import { generate, resolveTaskModel } from './ai-provider';
import { getMeeting } from './meetingService';
import type {
  MeetingBrief,
  ActionItem,
  ActionItemStatus,
} from '../../shared/types';

// ---------------------------------------------------------------------------
// Prompt Templates
// ---------------------------------------------------------------------------

const SUMMARIZATION_SYSTEM_PROMPT = `You are a meeting summarization assistant. Given a meeting transcript, produce a structured summary.

Format your response as:

## Key Points
- [Main discussion points as bullet items]

## Decisions Made
- [Any decisions that were reached]

## Follow-ups
- [Items that need follow-up action]

Be concise. Focus on substance, not filler. If the transcript is short or unclear, summarize what's available.`;

const ACTION_EXTRACTION_SYSTEM_PROMPT = `You are a meeting action item extractor. Given a meeting transcript, identify concrete action items — tasks, assignments, and follow-ups that someone needs to do.

Respond ONLY with a JSON array of objects, each with a 'description' field:
[
  { "description": "Schedule follow-up meeting with design team" },
  { "description": "Update the Q4 budget spreadsheet with new numbers" }
]

Rules:
- Each action item should be a specific, actionable task
- Start each description with a verb (Schedule, Update, Review, Create, Send, etc.)
- If no clear action items exist, return an empty array: []
- Do NOT include general observations or discussion summaries
- Maximum 10 action items`;

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
// Exported Functions
// ---------------------------------------------------------------------------

/**
 * Generate an AI-powered meeting brief (structured summary) from the transcript.
 * Stores the result in `meeting_briefs` and returns the mapped object.
 */
export async function generateBrief(meetingId: string): Promise<MeetingBrief> {
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
  if (!provider) throw new Error('No AI provider available for summarization');

  // Generate summary
  const result = await generate({
    providerId: provider.providerId,
    providerName: provider.providerName,
    apiKeyEncrypted: provider.apiKeyEncrypted,
    baseUrl: provider.baseUrl,
    model: provider.model,
    taskType: 'summarization',
    prompt: `Meeting: ${meeting.title}\n\nTranscript:\n${transcript}`,
    system: SUMMARIZATION_SYSTEM_PROMPT,
    temperature: provider.temperature,
    maxTokens: provider.maxTokens,
  });

  // Store in DB
  const db = getDb();
  const [row] = await db
    .insert(meetingBriefs)
    .values({
      meetingId,
      summary: result.text,
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

  // Generate action items
  const result = await generate({
    providerId: provider.providerId,
    providerName: provider.providerName,
    apiKeyEncrypted: provider.apiKeyEncrypted,
    baseUrl: provider.baseUrl,
    model: provider.model,
    taskType: 'summarization',
    prompt: `Meeting: ${meeting.title}\n\nTranscript:\n${transcript}`,
    system: ACTION_EXTRACTION_SYSTEM_PROMPT,
    temperature: provider.temperature,
    maxTokens: provider.maxTokens,
  });

  // Parse AI response — try JSON first, fall back to bullet extraction
  let descriptions: string[] = [];

  try {
    const parsed = JSON.parse(result.text);
    if (Array.isArray(parsed)) {
      descriptions = parsed
        .filter((item: unknown) => {
          const obj = item as Record<string, unknown>;
          return obj.description && typeof obj.description === 'string';
        })
        .map((item: unknown) => (item as Record<string, string>).description);
    }
  } catch {
    // Fallback: extract from bullet/numbered lines
    descriptions = result.text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^[-*]|\d+[.)]/.test(line))
      .map((line) => line.replace(/^[-*]\s*|\d+[.)]\s*/, '').trim())
      .filter((line) => line.length > 0);
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
export async function updateActionItemStatus(
  id: string,
  status: ActionItemStatus,
): Promise<ActionItem> {
  const db = getDb();
  const [row] = await db
    .update(actionItems)
    .set({ status })
    .where(eq(actionItems.id, id))
    .returning();

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
  const [item] = await db
    .select()
    .from(actionItems)
    .where(eq(actionItems.id, actionItemId));

  if (!item) throw new Error(`Action item not found: ${actionItemId}`);

  // Count existing cards in target column for position
  const [{ value: cardCount }] = await db
    .select({ value: count() })
    .from(cards)
    .where(eq(cards.columnId, columnId));

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
