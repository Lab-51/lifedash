// === FILE PURPOSE ===
// Idea repository CRUD service — data access layer for ideas and idea tags.
// Handles idea lifecycle including conversion to projects and board cards.

// === DEPENDENCIES ===
// drizzle-orm, ../db/connection, ../db/schema (ideas, ideaTags, projects, cards)

// === LIMITATIONS ===
// - No pagination on list queries yet.
// - No full-text search (planned for later).

// === VERIFICATION STATUS ===
// - DB schema: verified from schema/ideas.ts (ideas + idea_tags tables)
// - Card creation pattern: verified from meetingIntelligenceService.ts convertActionToCard
// - Project creation pattern: verified from schema/projects.ts

import { eq, desc, count, inArray } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { ideas, ideaTags, projects, cards } from '../db/schema';
import { generate, resolveTaskModel } from './ai-provider';
import type {
  Idea,
  IdeaAnalysis,
  EffortLevel,
  ImpactLevel,
  CreateIdeaInput,
  UpdateIdeaInput,
  ConvertIdeaToProjectResult,
  ConvertIdeaToCardResult,
} from '../../shared/types';

// ---------------------------------------------------------------------------
// Row Mapper
// ---------------------------------------------------------------------------

/** Map a DB idea row + tags array to the shared Idea type (timestamps -> ISO strings) */
function toIdea(row: typeof ideas.$inferSelect, tags: string[]): Idea {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    status: row.status,
    effort: row.effort,
    impact: row.impact,
    tags,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Tag Helpers
// ---------------------------------------------------------------------------

/**
 * Bulk-load tags for a set of idea IDs.
 * Returns a Map of ideaId -> tag strings.
 */
async function loadTagsForIdeas(ideaIds: string[]): Promise<Map<string, string[]>> {
  const tagMap = new Map<string, string[]>();
  if (ideaIds.length === 0) return tagMap;

  const db = getDb();
  const tagRows = await db
    .select()
    .from(ideaTags)
    .where(inArray(ideaTags.ideaId, ideaIds));

  for (const row of tagRows) {
    const existing = tagMap.get(row.ideaId) ?? [];
    existing.push(row.tag);
    tagMap.set(row.ideaId, existing);
  }

  return tagMap;
}

/**
 * Replace all tags for an idea (delete all + re-insert).
 */
async function replaceTags(ideaId: string, tags: string[]): Promise<void> {
  const db = getDb();

  // Delete existing tags
  await db.delete(ideaTags).where(eq(ideaTags.ideaId, ideaId));

  // Insert new tags (if any)
  if (tags.length > 0) {
    await db.insert(ideaTags).values(
      tags.map((tag) => ({ ideaId, tag })),
    );
  }
}

// ---------------------------------------------------------------------------
// Exported Functions
// ---------------------------------------------------------------------------

/** Get all ideas ordered by creation date (newest first), with tags. */
export async function getIdeas(): Promise<Idea[]> {
  const db = getDb();
  const rows = await db.select().from(ideas).orderBy(desc(ideas.createdAt));

  const ideaIds = rows.map((r) => r.id);
  const tagMap = await loadTagsForIdeas(ideaIds);

  return rows.map((row) => toIdea(row, tagMap.get(row.id) ?? []));
}

/** Get a single idea by ID with tags. Returns null if not found. */
export async function getIdea(id: string): Promise<Idea | null> {
  const db = getDb();
  const [row] = await db.select().from(ideas).where(eq(ideas.id, id));
  if (!row) return null;

  const tagMap = await loadTagsForIdeas([id]);
  return toIdea(row, tagMap.get(id) ?? []);
}

/** Create a new idea with optional tags. */
export async function createIdea(data: CreateIdeaInput): Promise<Idea> {
  const db = getDb();

  const [row] = await db
    .insert(ideas)
    .values({
      title: data.title,
      description: data.description ?? null,
      projectId: data.projectId ?? null,
      status: 'new',
    })
    .returning();

  const tags = data.tags ?? [];
  if (tags.length > 0) {
    await replaceTags(row.id, tags);
  }

  return toIdea(row, tags);
}

/** Update an idea. Only provided fields are changed. */
export async function updateIdea(id: string, data: UpdateIdeaInput): Promise<Idea> {
  const db = getDb();

  // Build dynamic update object — only set fields that were provided
  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };
  if (data.title !== undefined) updateData.title = data.title;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.projectId !== undefined) updateData.projectId = data.projectId;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.effort !== undefined) updateData.effort = data.effort;
  if (data.impact !== undefined) updateData.impact = data.impact;

  const [row] = await db
    .update(ideas)
    .set(updateData)
    .where(eq(ideas.id, id))
    .returning();

  if (!row) throw new Error(`Idea not found: ${id}`);

  // Replace tags if explicitly provided (even if empty array = clear all tags)
  if (data.tags !== undefined) {
    await replaceTags(id, data.tags);
  }

  // Reload tags to return accurate state
  const tagMap = await loadTagsForIdeas([id]);
  return toIdea(row, tagMap.get(id) ?? []);
}

/** Delete an idea by ID. Cascade deletes its tags. */
export async function deleteIdea(id: string): Promise<void> {
  const db = getDb();
  await db.delete(ideas).where(eq(ideas.id, id));
}

/**
 * Convert an idea into a new project.
 * Creates a project from the idea's title/description, links the idea to it,
 * and sets the idea status to 'active'.
 */
export async function convertIdeaToProject(id: string): Promise<ConvertIdeaToProjectResult> {
  const idea = await getIdea(id);
  if (!idea) throw new Error(`Idea not found: ${id}`);

  const db = getDb();

  // Create a new project from the idea
  const [project] = await db
    .insert(projects)
    .values({
      name: idea.title.slice(0, 100),
      description: idea.description,
    })
    .returning();

  // Update the idea to link to the new project and mark as active
  const [updatedRow] = await db
    .update(ideas)
    .set({
      projectId: project.id,
      status: 'active',
      updatedAt: new Date(),
    })
    .where(eq(ideas.id, id))
    .returning();

  const tagMap = await loadTagsForIdeas([id]);

  return {
    idea: toIdea(updatedRow, tagMap.get(id) ?? []),
    projectId: project.id,
  };
}

/**
 * Convert an idea into a board card in the specified column.
 * Creates the card at the end of the column and sets the idea status to 'active'.
 */
export async function convertIdeaToCard(
  ideaId: string,
  columnId: string,
): Promise<ConvertIdeaToCardResult> {
  const idea = await getIdea(ideaId);
  if (!idea) throw new Error(`Idea not found: ${ideaId}`);

  const db = getDb();

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
      title: idea.title.slice(0, 100),
      description: idea.description,
      priority: 'medium',
      position: cardCount,
    })
    .returning();

  // Update idea status
  const [updatedRow] = await db
    .update(ideas)
    .set({
      status: 'active',
      updatedAt: new Date(),
    })
    .where(eq(ideas.id, ideaId))
    .returning();

  const tagMap = await loadTagsForIdeas([ideaId]);

  return {
    idea: toIdea(updatedRow, tagMap.get(ideaId) ?? []),
    cardId: card.id,
  };
}

// ---------------------------------------------------------------------------
// AI Idea Analysis
// ---------------------------------------------------------------------------

const IDEA_ANALYSIS_SYSTEM_PROMPT = `You are an idea analysis assistant. Given an idea with its title, description, and tags, analyze it and provide structured feedback.

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "suggestedEffort": "<one of: trivial, small, medium, large, epic>",
  "suggestedImpact": "<one of: minimal, low, medium, high, critical>",
  "feasibilityNotes": "<1-3 sentences about technical feasibility, risks, and prerequisites>",
  "rationale": "<1-3 sentences explaining why you chose these effort/impact levels>"
}

Effort levels:
- trivial: less than a day, straightforward
- small: 1-3 days, well-understood
- medium: 1-2 weeks, some unknowns
- large: 2-4 weeks, significant complexity
- epic: 1+ months, major undertaking

Impact levels:
- minimal: nice-to-have, few users affected
- low: minor improvement, limited scope
- medium: noticeable improvement, moderate reach
- high: significant value, many users affected
- critical: essential, business-critical`;

const VALID_EFFORTS: EffortLevel[] = ['trivial', 'small', 'medium', 'large', 'epic'];
const VALID_IMPACTS: ImpactLevel[] = ['minimal', 'low', 'medium', 'high', 'critical'];

/**
 * Analyze an idea using AI to suggest effort, impact, feasibility, and rationale.
 * Uses the 'idea_analysis' task type to resolve the configured AI provider.
 */
export async function analyzeIdea(ideaId: string): Promise<IdeaAnalysis> {
  const db = getDb();

  // Load idea
  const [ideaRow] = await db.select().from(ideas).where(eq(ideas.id, ideaId));
  if (!ideaRow) throw new Error(`Idea not found: ${ideaId}`);

  // Load tags
  const tagRows = await db
    .select({ tag: ideaTags.tag })
    .from(ideaTags)
    .where(eq(ideaTags.ideaId, ideaId));
  const tags = tagRows.map((r) => r.tag);

  // Resolve AI provider
  const provider = await resolveTaskModel('idea_analysis');
  if (!provider) {
    throw new Error('No AI provider configured. Go to Settings to add one.');
  }

  // Build prompt
  let prompt = `Idea: ${ideaRow.title}`;
  if (ideaRow.description) prompt += `\nDescription: ${ideaRow.description}`;
  if (tags.length > 0) prompt += `\nTags: ${tags.join(', ')}`;
  if (ideaRow.effort) prompt += `\nCurrent effort estimate: ${ideaRow.effort}`;
  if (ideaRow.impact) prompt += `\nCurrent impact estimate: ${ideaRow.impact}`;

  // Generate analysis
  const result = await generate({
    providerId: provider.providerId,
    providerName: provider.providerName,
    apiKeyEncrypted: provider.apiKeyEncrypted,
    baseUrl: provider.baseUrl,
    model: provider.model,
    taskType: 'idea_analysis',
    prompt,
    system: IDEA_ANALYSIS_SYSTEM_PROMPT,
    temperature: provider.temperature ?? 0.3,
    maxTokens: provider.maxTokens ?? 1024,
  });

  // Parse JSON response with fallback
  return parseAnalysisResponse(result.text);
}

function parseAnalysisResponse(text: string): IdeaAnalysis {
  // Try direct JSON parse
  try {
    const parsed = JSON.parse(text);
    return validateAnalysis(parsed);
  } catch {
    // Try extracting JSON from response text
  }

  // Regex fallback: find JSON object in text
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      return validateAnalysis(parsed);
    } catch {
      // Fall through to defaults
    }
  }

  // Default fallback — return sensible defaults with raw text as rationale
  return {
    suggestedEffort: 'medium',
    suggestedImpact: 'medium',
    feasibilityNotes: 'Unable to parse structured analysis.',
    rationale: text.slice(0, 500),
  };
}

function validateAnalysis(parsed: Record<string, unknown>): IdeaAnalysis {
  return {
    suggestedEffort: VALID_EFFORTS.includes(parsed.suggestedEffort as EffortLevel)
      ? (parsed.suggestedEffort as EffortLevel)
      : 'medium',
    suggestedImpact: VALID_IMPACTS.includes(parsed.suggestedImpact as ImpactLevel)
      ? (parsed.suggestedImpact as ImpactLevel)
      : 'medium',
    feasibilityNotes:
      typeof parsed.feasibilityNotes === 'string'
        ? parsed.feasibilityNotes
        : 'No feasibility notes provided.',
    rationale:
      typeof parsed.rationale === 'string'
        ? parsed.rationale
        : 'No rationale provided.',
  };
}
