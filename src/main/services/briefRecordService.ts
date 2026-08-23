// === FILE PURPOSE ===
// Shared read path for the three BRIEF-QUAL.2 Task 3 readers that need the
// STORED RECORD, not just the narrative summary — twinMemoryService (twin
// learning), entityFactService (entity fact mining) and meetingAgentService
// (the post-meeting assistant's grounding). BRIEF-QUAL.1's writer may judge a
// minor topic out of the narrative; these three readers need completeness, so
// each reads the brief FIRST and fills only whatever budget room is left with
// the record's rendered structure (briefRecordText.structureToText) — the
// brief's synthesis always survives; the notes never crowd it out, and never
// stand in for it.
//
// === DEPENDENCIES ===
// drizzle-orm, db/schema (meetingBriefs), the shared MeetingStructureSchema
// (zod — main-process only; never imported by renderer-bundled code).
//
// === LIMITATIONS ===
// - parseStructureValue DUPLICATES meetingIntelligenceService's private
//   parseBriefStructure byte-for-byte. That file is owned by a different task
//   this phase and frozen for this one — the duplicate is a deliberate,
//   recorded trade (see ISSUES.md), not an oversight. Do not de-duplicate
//   without re-reading both call sites first.

import { desc, eq } from 'drizzle-orm';
import type { getDb } from '../db/connection';
import { meetingBriefs } from '../db/schema';
import { MeetingStructureSchema, type MeetingStructure } from '../../shared/types/briefStructure';

type Db = ReturnType<typeof getDb>;

/** Marks a whole-line-truncated notes block so the reader knows more was cut —
 *  the cut itself only ever lands on a `\n`, never mid-sentence (SPEC §81's
 *  trimming discipline applied to the stored record). */
export const NOTES_TRUNCATION_MARKER = '[full notes truncated]';

/**
 * Validate a `meeting_briefs.structure` jsonb value. Mirrors
 * meetingIntelligenceService's private `parseBriefStructure` EXACTLY (see file
 * header) — null on anything falsy or failing validation, so a legacy brief, a
 * failure card (AI-RESIL.1), and a row written by an incompatible future
 * schemaVersion all resolve the same way: readers must already treat
 * `structure` as optional context, never as a precondition.
 */
export function parseStructureValue(value: unknown): MeetingStructure | null {
  if (!value) return null;
  const parsed = MeetingStructureSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * The meeting's newest brief, summary + structure read in ONE query — replaces
 * the near-identical private summary-only loader this shared version
 * supersedes in both twinMemoryService and entityFactService (same ordering:
 * newest `createdAt` wins). `{ summary: '', structure: null }` when the
 * meeting has no brief yet.
 */
export async function loadLatestBriefRecord(
  db: Db,
  meetingId: string,
): Promise<{ summary: string; structure: MeetingStructure | null }> {
  const [row] = await db
    .select({ summary: meetingBriefs.summary, structure: meetingBriefs.structure })
    .from(meetingBriefs)
    .where(eq(meetingBriefs.meetingId, meetingId))
    .orderBy(desc(meetingBriefs.createdAt))
    .limit(1);
  return { summary: row?.summary ?? '', structure: parseStructureValue(row?.structure) };
}

/**
 * Fit `notes` inside `budget` characters, cutting ONLY at a `\n` boundary —
 * never mid-sentence. Returns `notes` unchanged when it already fits inside
 * `budget`; the longest whole-line prefix plus `NOTES_TRUNCATION_MARKER` when
 * it needs cutting; `''` when `budget` cannot hold even one full line plus the
 * marker — the caller drops the block entirely in that case.
 */
export function fitNotesWithinBudget(notes: string, budget: number): string {
  if (notes.length <= budget) return notes;

  const markerBudget = budget - NOTES_TRUNCATION_MARKER.length - 1; // -1: the \n before the marker
  let cut = -1;
  for (let i = 0; i < notes.length && i <= markerBudget; i++) {
    if (notes[i] === '\n') cut = i;
  }
  return cut === -1 ? '' : `${notes.slice(0, cut)}\n${NOTES_TRUNCATION_MARKER}`;
}
