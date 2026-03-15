// === FILE PURPOSE ===
// Intel brief service — AI-powered daily/weekly brief generation,
// auto-categorization of intel items, and on-demand article summarization.
//
// === DEPENDENCIES ===
// drizzle-orm, ai-provider.ts (generate, resolveTaskModel), DB schema
//
// === VERIFICATION STATUS ===
// - generate() API: verified from ai-provider.ts source
// - resolveTaskModel() API: verified from ai-provider.ts source
// - DB schema: verified from intel-feed.ts

import { eq, desc, gte, and } from 'drizzle-orm';
import { getDb } from '../db/connection';
import { intelBriefs, intelItems, intelSources } from '../db/schema';
import { generate, resolveTaskModel } from './ai-provider';
import { createLogger } from './logger';
import type { IntelBrief, IntelBriefType, IntelItem } from '../../shared/types';

const log = createLogger('IntelBriefService');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get ISO week string for a date, e.g. "2026-W11" */
function getISOWeek(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Row Mappers
// ---------------------------------------------------------------------------

function toIntelBrief(row: typeof intelBriefs.$inferSelect): IntelBrief {
  return {
    id: row.id,
    type: row.type,
    date: row.date,
    content: row.content,
    articleCount: row.articleCount,
    generatedAt: row.generatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function toIntelItem(
  row: typeof intelItems.$inferSelect,
  sourceName: string,
  sourceIconUrl?: string | null,
): IntelItem {
  return {
    id: row.id,
    sourceId: row.sourceId,
    sourceName,
    sourceIconUrl: sourceIconUrl ?? null,
    title: row.title,
    description: row.description,
    url: row.url,
    imageUrl: row.imageUrl,
    author: row.author,
    publishedAt: row.publishedAt.toISOString(),
    fetchedAt: row.fetchedAt.toISOString(),
    isRead: row.isRead,
    isBookmarked: row.isBookmarked,
    category: row.category ?? null,
    summary: row.summary ?? null,
    relevanceScore: row.relevanceScore ?? null,
    fullContent: row.fullContent ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Prompt Templates
// ---------------------------------------------------------------------------

const DAILY_SYSTEM_PROMPT = `You are an AI news intelligence analyst. Given a list of articles, produce two things:

1. A DAILY BRIEF in markdown format:
   - Opening paragraph: 2-3 sentences summarizing today's most important developments
   - Sections grouped by theme (use ## headers like "## Model Releases", "## Developer Tools")
   - Under each section: bullet points with article title, source name, and a one-line "why this matters"
   - Highlight the top 5-7 most significant stories
   - Keep it concise and professional

2. CATEGORY ASSIGNMENTS as a JSON block at the very end, wrapped in triple backticks:
   \`\`\`json
   {"categories": {"<article_url>": "<category>", ...}}
   \`\`\`
   Assign each article one of these categories: Model Releases, Research & Papers, Developer Tools, Policy & Regulation, Industry News, Startups & Funding, Open Source, Tutorials & Guides, Other

3. RELEVANCE SCORES as an additional JSON block after the categories block:
   \`\`\`json
   {"relevance": {"<article_url>": <score_1_to_10>, ...}}
   \`\`\`
   Score each article 1-10 based on significance and impact:
   - 9-10: Major breakthrough, industry-changing
   - 7-8: Important development, worth highlighting
   - 5-6: Interesting but routine
   - 3-4: Niche or minor
   - 1-2: Low relevance`;

const WEEKLY_SYSTEM_PROMPT = `You are an AI news intelligence analyst. Given articles from the past week, produce two things:

1. A WEEKLY ROUNDUP in markdown format:
   - Opening paragraph: 3-4 sentences summarizing the week's biggest themes
   - Sections grouped by major themes (use ## headers)
   - Under each section: narrative paragraphs highlighting key developments, not just bullet lists
   - Call out the single most significant story of the week
   - Keep it concise and professional

2. CATEGORY ASSIGNMENTS as a JSON block at the very end, wrapped in triple backticks:
   \`\`\`json
   {"categories": {"<article_url>": "<category>", ...}}
   \`\`\`
   Categories: Model Releases, Research & Papers, Developer Tools, Policy & Regulation, Industry News, Startups & Funding, Open Source, Tutorials & Guides, Other

3. RELEVANCE SCORES as an additional JSON block after the categories block:
   \`\`\`json
   {"relevance": {"<article_url>": <score_1_to_10>, ...}}
   \`\`\`
   Score each article 1-10 based on significance and impact:
   - 9-10: Major breakthrough, industry-changing
   - 7-8: Important development, worth highlighting
   - 5-6: Interesting but routine
   - 3-4: Niche or minor
   - 1-2: Low relevance`;

const SUMMARIZE_SYSTEM_PROMPT = 'You are a concise news summarizer. Produce a 1-2 sentence summary that captures the key point and significance of the article.';

// ---------------------------------------------------------------------------
// Exported Functions
// ---------------------------------------------------------------------------

/**
 * Generate an AI-powered daily or weekly brief from recent intel items.
 * Also auto-categorizes articles based on the AI response.
 * Returns null if fewer than 3 items are available for the period.
 */
export async function generateBrief(type: IntelBriefType): Promise<IntelBrief | null> {
  const db = getDb();

  // Compute date key
  const now = new Date();
  const dateKey = type === 'daily'
    ? now.toISOString().slice(0, 10)
    : getISOWeek(now);

  // Delete existing brief for this type+date (regenerate)
  await db.delete(intelBriefs).where(
    and(eq(intelBriefs.type, type), eq(intelBriefs.date, dateKey)),
  );

  // Get items for the period
  let sinceDate: Date;
  let itemLimit: number;
  if (type === 'daily') {
    sinceDate = new Date(now);
    sinceDate.setHours(0, 0, 0, 0);
    itemLimit = 50;
  } else {
    sinceDate = new Date(now);
    sinceDate.setDate(sinceDate.getDate() - 7);
    itemLimit = 100;
  }

  const articleRows = await db
    .select({
      item: intelItems,
      sourceName: intelSources.name,
    })
    .from(intelItems)
    .innerJoin(intelSources, eq(intelItems.sourceId, intelSources.id))
    .where(gte(intelItems.publishedAt, sinceDate))
    .orderBy(desc(intelItems.publishedAt))
    .limit(itemLimit);

  if (articleRows.length < 3) {
    log.info(`Not enough articles for ${type} brief (${articleRows.length} found, need 3+)`);
    return null;
  }

  // Build articles list for the prompt
  const articlesList = articleRows
    .map((r, i) => {
      const desc = r.item.description
        ? r.item.description.slice(0, 200)
        : 'No description available';
      return `${i + 1}. [${r.item.title}] (Source: ${r.sourceName}, URL: ${r.item.url})\n   Description: ${desc}`;
    })
    .join('\n');

  const userPrompt = `Articles:\n${articlesList}`;

  // Resolve AI provider
  const provider = await resolveTaskModel('summarization');
  if (!provider) {
    throw new Error('No AI provider configured. Add one in Settings > AI Providers.');
  }

  const systemPrompt = type === 'daily' ? DAILY_SYSTEM_PROMPT : WEEKLY_SYSTEM_PROMPT;

  // Generate brief
  const result = await generate({
    providerId: provider.providerId,
    providerName: provider.providerName,
    apiKeyEncrypted: provider.apiKeyEncrypted,
    baseUrl: provider.baseUrl,
    model: provider.model,
    taskType: 'summarization',
    prompt: userPrompt,
    system: systemPrompt,
    temperature: provider.temperature ?? 0.3,
    maxTokens: provider.maxTokens ?? 2000,
  });

  // Parse response: extract brief content, categories, and relevance scores
  // The AI returns markdown content followed by JSON blocks for categories and relevance
  const jsonBlocks: string[] = [];
  const jsonBlockRegex = /```json\s*\n?([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = jsonBlockRegex.exec(result.text)) !== null) {
    jsonBlocks.push(match[1]);
  }

  // Brief content is everything before the first json block
  const firstJsonIndex = result.text.indexOf('```json');
  const briefContent = firstJsonIndex >= 0 ? result.text.slice(0, firstJsonIndex).trim() : result.text.trim();

  // Parse categories and relevance scores from JSON blocks
  let categories: Record<string, string> = {};
  let relevanceScores: Record<string, number> = {};

  for (const block of jsonBlocks) {
    try {
      const parsed = JSON.parse(block);
      if (parsed.categories && typeof parsed.categories === 'object') {
        categories = parsed.categories;
      }
      if (parsed.relevance && typeof parsed.relevance === 'object') {
        relevanceScores = parsed.relevance;
      }
    } catch {
      // Skip malformed blocks
    }
  }

  // Store the brief
  const [briefRow] = await db.insert(intelBriefs).values({
    type,
    date: dateKey,
    content: briefContent.trim(),
    articleCount: articleRows.length,
  }).returning();

  // Update article categories (best-effort)
  if (Object.keys(categories).length > 0) {
    for (const [url, category] of Object.entries(categories)) {
      try {
        await db.update(intelItems)
          .set({ category: String(category) })
          .where(eq(intelItems.url, url));
      } catch (err) {
        log.warn(`Failed to update category for URL ${url}:`, err);
      }
    }
  }

  // Update relevance scores (best-effort)
  if (Object.keys(relevanceScores).length > 0) {
    for (const [url, score] of Object.entries(relevanceScores)) {
      try {
        const numScore = Math.max(1, Math.min(10, Math.round(Number(score))));
        await db.update(intelItems)
          .set({ relevanceScore: numScore })
          .where(eq(intelItems.url, url));
      } catch (err) {
        log.warn(`Failed to update relevance score for URL ${url}:`, err);
      }
    }
  }

  log.info(`Generated ${type} brief for ${dateKey} (${articleRows.length} articles)`);
  return toIntelBrief(briefRow);
}

/**
 * Generate a 1-2 sentence AI summary for a single intel item.
 * Returns the item as-is if it already has a summary.
 */
export async function summarizeArticle(itemId: string): Promise<IntelItem> {
  const db = getDb();

  // Get item with source name
  const [row] = await db
    .select({
      item: intelItems,
      sourceName: intelSources.name,
    })
    .from(intelItems)
    .innerJoin(intelSources, eq(intelItems.sourceId, intelSources.id))
    .where(eq(intelItems.id, itemId));

  if (!row) throw new Error(`Intel item not found: ${itemId}`);

  // If already summarized, return as-is
  if (row.item.summary) {
    return toIntelItem(row.item, row.sourceName);
  }

  // Resolve provider
  const provider = await resolveTaskModel('summarization');
  if (!provider) {
    throw new Error('No AI provider configured. Add one in Settings > AI Providers.');
  }

  const result = await generate({
    providerId: provider.providerId,
    providerName: provider.providerName,
    apiKeyEncrypted: provider.apiKeyEncrypted,
    baseUrl: provider.baseUrl,
    model: provider.model,
    taskType: 'summarization',
    prompt: `Summarize this article in 1-2 concise sentences:\n\nTitle: ${row.item.title}\nSource: ${row.sourceName}\nDescription: ${row.item.description || 'No description available'}`,
    system: SUMMARIZE_SYSTEM_PROMPT,
    temperature: 0.2,
    maxTokens: 200,
  });

  // Update item summary
  const [updated] = await db
    .update(intelItems)
    .set({ summary: result.text })
    .where(eq(intelItems.id, itemId))
    .returning();

  return toIntelItem(updated, row.sourceName);
}

/**
 * Chat about a brief — send a message in the context of the current brief
 * and return the AI response.
 */
export async function chatAboutBrief(
  briefContent: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
): Promise<string> {
  const provider = await resolveTaskModel('summarization');
  if (!provider) {
    throw new Error('No AI provider configured. Add one in Settings > AI Providers.');
  }

  const systemPrompt = `You are an AI intelligence analyst assistant. The user is reading their daily/weekly intelligence brief about AI and technology news. Help them understand the implications, find connections, suggest actions, and discuss the articles.

Here is the intelligence brief they are reading:

---
${briefContent}
---

Be concise, insightful, and actionable. When discussing specific articles, reference them by name. If the user asks about implications for their work, suggest concrete next steps.`;

  const lastUserMessage = messages[messages.length - 1];

  // Build a conversation history string for context
  const historyContext = messages.slice(0, -1).map(m =>
    `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`,
  ).join('\n\n');

  const userPrompt = historyContext
    ? `Previous conversation:\n${historyContext}\n\nUser: ${lastUserMessage.content}`
    : lastUserMessage.content;

  const result = await generate({
    providerId: provider.providerId,
    providerName: provider.providerName,
    apiKeyEncrypted: provider.apiKeyEncrypted,
    baseUrl: provider.baseUrl,
    model: provider.model,
    taskType: 'summarization',
    prompt: userPrompt,
    system: systemPrompt,
    temperature: provider.temperature ?? 0.5,
    maxTokens: provider.maxTokens ?? 1000,
  });

  return result.text;
}

/**
 * Get a brief by type and date key.
 */
export async function getBrief(type: IntelBriefType, date: string): Promise<IntelBrief | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(intelBriefs)
    .where(and(eq(intelBriefs.type, type), eq(intelBriefs.date, date)));

  return row ? toIntelBrief(row) : null;
}

/**
 * Get the most recent brief for a given type.
 */
export async function getLatestBrief(type: IntelBriefType): Promise<IntelBrief | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(intelBriefs)
    .where(eq(intelBriefs.type, type))
    .orderBy(desc(intelBriefs.generatedAt))
    .limit(1);

  return row ? toIntelBrief(row) : null;
}
