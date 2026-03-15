// === FILE PURPOSE ===
// Intel Feed service — data access layer for intel sources and items.
// Handles source CRUD, RSS fetching, manual item addition, and default seeding.

// === DEPENDENCIES ===
// drizzle-orm, rss-parser, ../db/connection, ../db/schema (intelSources, intelItems)

import { eq, desc, count, gte, and } from 'drizzle-orm';
import RSSParser from 'rss-parser';
import { getDb } from '../db/connection';
import { intelSources, intelItems } from '../db/schema';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import type {
  IntelSource,
  IntelItem,
  ArticleContent,
  CreateIntelSourceInput,
  UpdateIntelSourceInput,
  AddManualItemInput,
  IntelDateFilter,
} from '../../shared/types';
import { createLogger } from './logger';

const log = createLogger('IntelFeedService');

// Debounce map for fetchArticleContent — prevents rapid duplicate fetches
const recentFetches = new Map<string, number>();
const FETCH_DEBOUNCE_MS = 2000;

/** Escape user-generated text for safe insertion into HTML strings. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ---------------------------------------------------------------------------
// RSS Parser instance (reused across fetches)
// ---------------------------------------------------------------------------

const RSS_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const rssParser = new RSSParser({
  timeout: 10_000,
  headers: {
    'User-Agent': RSS_USER_AGENT,
    Accept: 'application/rss+xml, application/xml, text/xml, */*',
  },
});

/** Fetch RSS feed with Electron's net module (uses Chromium networking stack, better header support). */
async function fetchFeedWithBrowserUA(url: string): Promise<RSSParser.Output<Record<string, unknown>>> {
  // Use Electron's net.fetch when available (respects custom headers better than Node fetch)
  let fetchFn: typeof globalThis.fetch = globalThis.fetch;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { net } = require('electron');
    if (net?.fetch) fetchFn = net.fetch;
  } catch {
    /* not in Electron context, use global fetch */
  }

  const response = await fetchFn(url, {
    headers: {
      'User-Agent': RSS_USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  if (!response.ok) {
    throw new Error(`Status code ${response.status}`);
  }
  const xml = await response.text();
  return rssParser.parseString(xml);
}

/** Fetch a Reddit subreddit as a feed using Reddit's JSON API (more reliable than RSS). */
async function fetchRedditFeed(
  url: string,
): Promise<{ title: string; link: string; description: string; author: string; publishedAt: Date }[]> {
  // Convert any Reddit URL to JSON API: /r/ClaudeAI/.rss or /r/ClaudeAI/ → /r/ClaudeAI.json
  const jsonUrl = url.replace(/\/?\.rss\/?$/, '').replace(/\/+$/, '') + '.json';

  let fetchFn: typeof globalThis.fetch = globalThis.fetch;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { net } = require('electron');
    if (net?.fetch) fetchFn = net.fetch;
  } catch {
    /* fallback */
  }

  const response = await fetchFn(jsonUrl, {
    headers: {
      'User-Agent': RSS_USER_AGENT,
      Accept: 'application/json',
    },
  });
  if (!response.ok) throw new Error(`Status code ${response.status}`);

  const data = (await response.json()) as { data?: { children?: Array<{ data: Record<string, unknown> }> } };
  const posts = data?.data?.children ?? [];

  return posts.map((post) => {
    const d = post.data;
    return {
      title: String(d.title ?? 'Untitled'),
      link: `https://www.reddit.com${d.permalink ?? ''}`,
      description: String(d.selftext ?? d.url ?? '').slice(0, 2000),
      author: String(d.author ?? ''),
      publishedAt: new Date(((d.created_utc as number) ?? 0) * 1000),
    };
  });
}

/** Check if a URL is a Reddit feed (with or without .rss suffix). */
function isRedditFeed(url: string): boolean {
  return /reddit\.com\/r\//i.test(url);
}

/** Render a Reddit comment tree into HTML (recursive, max depth). */
function renderRedditComments(
  children: Array<{ kind: string; data: Record<string, unknown> }>,
  depth = 0,
  maxDepth = 4,
): string {
  if (depth > maxDepth || !children?.length) return '';

  let html = '';
  for (const child of children) {
    if (child.kind !== 't1') continue; // t1 = comment
    const d = child.data;
    const author = String(d.author ?? '[deleted]');
    const body = String(d.body ?? '');
    const score = Number(d.score ?? 0);
    const scoreLabel = score >= 0 ? `+${score}` : `${score}`;

    if (!body || author === 'AutoModerator') continue;

    const indent = depth * 16;
    html += `<div style="margin-left:${indent}px; padding: 10px 0; border-top: 1px solid rgba(255,255,255,0.06);">`;
    html += `<div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">`;
    html += `<strong style="color:var(--color-accent-dim); font-size:0.8rem;">u/${escapeHtml(author)}</strong>`;
    html += `<span style="color:var(--color-text-muted); font-size:0.7rem;">${scoreLabel} points</span>`;
    html += `</div>`;
    html += `<div style="font-size:0.875rem; line-height:1.6; color:var(--color-text-secondary);">${escapeHtml(body).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</div>`;
    html += `</div>`;

    // Recurse into replies
    const replies = d.replies as
      | { data?: { children?: Array<{ kind: string; data: Record<string, unknown> }> } }
      | undefined;
    if (replies?.data?.children) {
      html += renderRedditComments(replies.data.children, depth + 1, maxDepth);
    }
  }
  return html;
}

/** Fetch a Reddit post's content and top comments via JSON API. */
async function fetchRedditPostWithComments(
  postUrl: string,
  fallbackDescription: string,
): Promise<Omit<ArticleContent, 'title' | 'byline' | 'siteName'>> {
  try {
    // Convert post URL to JSON: https://www.reddit.com/r/X/comments/Y/title/ → .json
    const jsonUrl = postUrl.replace(/\/?$/, '.json');

    let fetchFn: typeof globalThis.fetch = globalThis.fetch;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { net } = require('electron');
      if (net?.fetch) fetchFn = net.fetch;
    } catch {
      /* fallback */
    }

    const response = await fetchFn(jsonUrl, {
      headers: {
        'User-Agent': RSS_USER_AGENT,
        Accept: 'application/json',
      },
    });

    if (!response.ok) throw new Error(`Status ${response.status}`);

    const data = (await response.json()) as Array<{
      data?: { children?: Array<{ kind: string; data: Record<string, unknown> }> };
    }>;

    // data[0] = post, data[1] = comments
    const postData = data?.[0]?.data?.children?.[0]?.data;
    const selftext = postData ? String(postData.selftext ?? '') : fallbackDescription;
    const commentChildren = data?.[1]?.data?.children ?? [];

    // Build HTML: post content + comments section
    let html = '';

    // Post content
    if (selftext) {
      html += `<div style="margin-bottom:24px;">${escapeHtml(selftext).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</div>`;
    }

    // If the post is a link post (not self post), show the linked URL
    const postUrlField = postData ? String(postData.url ?? '') : '';
    if (postUrlField && !postUrlField.includes('reddit.com/r/')) {
      html += `<div style="margin-bottom:24px; padding:12px; border:1px solid var(--color-border); border-radius:8px;">`;
      html += `<span style="font-size:0.75rem; color:var(--color-text-muted); text-transform:uppercase; letter-spacing:0.05em;">Linked article</span><br>`;
      html += `<a href="${escapeHtml(postUrlField)}" style="color:var(--color-accent); word-break:break-all;">${escapeHtml(postUrlField)}</a>`;
      html += `</div>`;
    }

    // Comments section
    const topComments = commentChildren.filter((c) => c.kind === 't1').slice(0, 15);
    if (topComments.length > 0) {
      html += `<div style="margin-top:24px; padding-top:16px; border-top:2px solid var(--color-border);">`;
      html += `<h3 style="font-size:0.875rem; font-weight:600; color:var(--color-accent); margin-bottom:12px; text-transform:uppercase; letter-spacing:0.1em;">Top Comments (${topComments.length})</h3>`;
      html += renderRedditComments(topComments, 0, 3);
      html += `</div>`;
    }

    const textContent =
      selftext +
      '\n\n' +
      commentChildren
        .filter((c) => c.kind === 't1')
        .slice(0, 10)
        .map((c) => `u/${c.data.author}: ${c.data.body}`)
        .join('\n\n');

    return {
      content: html,
      textContent,
      excerpt: selftext.slice(0, 200),
      length: textContent.split(/\s+/).length,
    };
  } catch (err) {
    log.warn(`Failed to fetch Reddit comments for ${postUrl}: ${err}`);
    // Fallback: just the description without comments
    return {
      content: `<p>${escapeHtml(fallbackDescription).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`,
      textContent: fallbackDescription,
      excerpt: fallbackDescription.slice(0, 200),
      length: fallbackDescription.split(/\s+/).length,
    };
  }
}

/** Safely coerce any RSS field to a string (fields can be objects at runtime). */
function safeString(val: unknown, maxLen = 500): string | null {
  if (val == null) return null;
  if (typeof val === 'string') return val.slice(0, maxLen);
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    // Common patterns: { name: "..." }, { _: "..." }, { text: "..." }
    for (const key of ['name', '_', 'text', 'value', '$t']) {
      if (typeof obj[key] === 'string') return (obj[key] as string).slice(0, maxLen);
    }
    try {
      return JSON.stringify(val).slice(0, maxLen);
    } catch {
      /* fall through */
    }
  }
  try {
    return String(val).slice(0, maxLen);
  } catch {
    return null;
  }
}

/** Safely extract author string from RSS item (can be string or object at runtime). */
function extractAuthor(item: RSSParser.Item): string | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (item as any).creator ?? (item as any).author;
  return safeString(raw, 200);
}

// ---------------------------------------------------------------------------
// Favicon Helper
// ---------------------------------------------------------------------------

/** Derive a favicon URL from a feed/site URL using Google's favicon service. */
function faviconUrl(feedUrl: string): string {
  try {
    const domain = new URL(feedUrl).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Row Mappers
// ---------------------------------------------------------------------------

/** Map a DB source row + item count to the shared IntelSource type */
function toIntelSource(row: typeof intelSources.$inferSelect, itemCount: number): IntelSource {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    type: row.type,
    enabled: row.enabled,
    iconUrl: row.iconUrl || faviconUrl(row.url),
    lastFetchedAt: row.lastFetchedAt?.toISOString() ?? null,
    itemCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Map a DB item row + source name + source icon to the shared IntelItem type */
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
// Source CRUD
// ---------------------------------------------------------------------------

/** Get all sources with their item counts, ordered by creation date. */
export async function getSources(): Promise<IntelSource[]> {
  const db = getDb();
  const rows = await db.select().from(intelSources).orderBy(desc(intelSources.createdAt));

  // Get item counts per source
  const countRows = await db
    .select({
      sourceId: intelItems.sourceId,
      count: count(),
    })
    .from(intelItems)
    .groupBy(intelItems.sourceId);

  const countMap = new Map(countRows.map((r) => [r.sourceId, r.count]));

  return rows.map((row) => toIntelSource(row, countMap.get(row.id) ?? 0));
}

/** Get a single source by ID with item count. Returns null if not found. */
export async function getSource(id: string): Promise<IntelSource | null> {
  const db = getDb();
  const [row] = await db.select().from(intelSources).where(eq(intelSources.id, id));
  if (!row) return null;

  const [countRow] = await db.select({ value: count() }).from(intelItems).where(eq(intelItems.sourceId, id));

  return toIntelSource(row, countRow?.value ?? 0);
}

/** Create a new intel source. */
export async function createSource(data: CreateIntelSourceInput): Promise<IntelSource> {
  const db = getDb();
  const [row] = await db
    .insert(intelSources)
    .values({
      name: data.name,
      url: data.url,
      type: data.type ?? 'rss',
    })
    .returning();

  return toIntelSource(row, 0);
}

/** Update an intel source. Only provided fields are changed. */
export async function updateSource(id: string, data: UpdateIntelSourceInput): Promise<IntelSource> {
  const db = getDb();

  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };
  if (data.name !== undefined) updateData.name = data.name;
  if (data.enabled !== undefined) updateData.enabled = data.enabled;

  const [row] = await db.update(intelSources).set(updateData).where(eq(intelSources.id, id)).returning();

  if (!row) throw new Error(`Intel source not found: ${id}`);

  const [countRow] = await db.select({ value: count() }).from(intelItems).where(eq(intelItems.sourceId, id));

  return toIntelSource(row, countRow?.value ?? 0);
}

/** Delete an intel source by ID. Cascade deletes its items. */
export async function deleteSource(id: string): Promise<void> {
  const db = getDb();
  await db.delete(intelSources).where(eq(intelSources.id, id));
}

// ---------------------------------------------------------------------------
// Item Queries
// ---------------------------------------------------------------------------

/** Get items filtered by date, joined with source name, ordered by publishedAt DESC. */
export async function getItems(filter: IntelDateFilter): Promise<IntelItem[]> {
  const db = getDb();

  let dateCondition;
  if (filter === 'today') {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    dateCondition = gte(intelItems.publishedAt, startOfDay);
  } else if (filter === 'week') {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    dateCondition = gte(intelItems.publishedAt, weekAgo);
  }

  // Build query — join with sources to get source name + icon
  const query = db
    .select({
      item: intelItems,
      sourceName: intelSources.name,
      sourceIconUrl: intelSources.iconUrl,
      sourceUrl: intelSources.url,
    })
    .from(intelItems)
    .innerJoin(intelSources, eq(intelItems.sourceId, intelSources.id))
    .orderBy(desc(intelItems.publishedAt));

  // Only show items from enabled sources
  const enabledCondition = eq(intelSources.enabled, true);

  let rows;
  if (dateCondition) {
    rows = await query.where(and(dateCondition, enabledCondition));
  } else {
    // 'all' — no date filter, limit 200
    rows = await query.where(enabledCondition).limit(200);
  }

  return rows.map((r) => toIntelItem(r.item, r.sourceName, r.sourceIconUrl || faviconUrl(r.sourceUrl)));
}

/** Mark an item as read. */
export async function markRead(id: string): Promise<void> {
  const db = getDb();
  await db.update(intelItems).set({ isRead: true }).where(eq(intelItems.id, id));
}

/** Toggle bookmark on an item. Returns the updated item. */
export async function toggleBookmark(id: string): Promise<IntelItem> {
  const db = getDb();

  // Get current state
  const [current] = await db.select().from(intelItems).where(eq(intelItems.id, id));
  if (!current) throw new Error(`Intel item not found: ${id}`);

  const [updated] = await db
    .update(intelItems)
    .set({ isBookmarked: !current.isBookmarked })
    .where(eq(intelItems.id, id))
    .returning();

  // Get source name
  const [source] = await db
    .select({ name: intelSources.name })
    .from(intelSources)
    .where(eq(intelSources.id, updated.sourceId));

  return toIntelItem(updated, source?.name ?? 'Unknown');
}

// ---------------------------------------------------------------------------
// RSS Fetching
// ---------------------------------------------------------------------------

/** Fetch all enabled RSS sources and insert new items. Returns count of new items. */
export async function fetchAllSources(): Promise<{ newItems: number }> {
  const db = getDb();
  const sources = await db.select().from(intelSources).where(eq(intelSources.enabled, true));

  let totalNew = 0;

  for (const source of sources) {
    if (source.type !== 'rss') continue;

    try {
      let sourceNew = 0;

      if (isRedditFeed(source.url)) {
        // Reddit: use JSON API (their RSS/Atom feed has broken XML)
        const posts = await fetchRedditFeed(source.url);
        for (const post of posts) {
          const [existing] = await db
            .select({ id: intelItems.id })
            .from(intelItems)
            .where(eq(intelItems.url, post.link));
          if (existing) continue;

          await db.insert(intelItems).values({
            sourceId: source.id,
            title: post.title.slice(0, 500),
            description: post.description || null,
            url: post.link.slice(0, 2000),
            imageUrl: null,
            author: post.author.slice(0, 200) || null,
            publishedAt: post.publishedAt,
          });
          sourceNew++;
        }
      } else {
        // Standard RSS/Atom feed
        const feed = await fetchFeedWithBrowserUA(source.url);

        for (const item of feed.items) {
          if (!item.link) continue;

          const [existing] = await db
            .select({ id: intelItems.id })
            .from(intelItems)
            .where(eq(intelItems.url, item.link));
          if (existing) continue;

          const publishedAt = item.pubDate ? new Date(item.pubDate) : new Date();

          await db.insert(intelItems).values({
            sourceId: source.id,
            title: safeString(item.title, 500) ?? 'Untitled',
            description: safeString(item.contentSnippet ?? item.content, 5000),
            url: item.link.slice(0, 2000),
            imageUrl: safeString(item.enclosure?.url, 2000),
            author: extractAuthor(item),
            publishedAt,
          });
          sourceNew++;
        }
      }

      // Update lastFetchedAt
      await db
        .update(intelSources)
        .set({ lastFetchedAt: new Date(), updatedAt: new Date() })
        .where(eq(intelSources.id, source.id));

      totalNew += sourceNew;
      log.info(`Fetched ${sourceNew} new items from "${source.name}"`);
    } catch (err) {
      log.warn(`Failed to fetch source "${source.name}" (${source.url}): ${err}`);
      // Continue to next source — one failure doesn't block others
    }
  }

  return { newItems: totalNew };
}

// ---------------------------------------------------------------------------
// Manual Items
// ---------------------------------------------------------------------------

/** Add a manual item (user-provided URL). Creates a 'manual' source if needed. */
export async function addManualItem(input: AddManualItemInput): Promise<IntelItem> {
  const db = getDb();

  // Find or create the manual source
  let [manualSource] = await db.select().from(intelSources).where(eq(intelSources.type, 'manual'));

  if (!manualSource) {
    [manualSource] = await db
      .insert(intelSources)
      .values({
        name: 'Saved Links',
        url: 'manual://',
        type: 'manual',
        enabled: false, // manual sources are not fetched
      })
      .returning();
  }

  const [row] = await db
    .insert(intelItems)
    .values({
      sourceId: manualSource.id,
      title: (input.title ?? input.url).slice(0, 500),
      description: input.description ?? null,
      url: input.url.slice(0, 2000),
      publishedAt: new Date(),
      isBookmarked: true, // manual items are bookmarked by default
    })
    .returning();

  return toIntelItem(row, manualSource.name);
}

// ---------------------------------------------------------------------------
// Article Content Extraction
// ---------------------------------------------------------------------------

/**
 * Fetch and extract the full article content for an intel item using Readability.
 * Returns cached content if already fetched, falls back to description on failure.
 * This function never throws — it always returns a valid ArticleContent object.
 */
export async function fetchArticleContent(itemId: string): Promise<ArticleContent> {
  // Debounce: if same item was fetched within 2s, only return DB-cached content
  const now = Date.now();
  const lastFetch = recentFetches.get(itemId);
  const isDebounced = lastFetch != null && now - lastFetch < FETCH_DEBOUNCE_MS;
  recentFetches.set(itemId, now);

  // Periodically clean old entries (keep map bounded)
  if (recentFetches.size > 200) {
    for (const [key, ts] of recentFetches) {
      if (now - ts > FETCH_DEBOUNCE_MS * 5) recentFetches.delete(key);
    }
  }

  const db = getDb();

  // Get item with source
  const [row] = await db
    .select({
      item: intelItems,
      sourceName: intelSources.name,
    })
    .from(intelItems)
    .innerJoin(intelSources, eq(intelItems.sourceId, intelSources.id))
    .where(eq(intelItems.id, itemId));

  if (!row) {
    return {
      title: 'Not Found',
      content: '',
      textContent: '',
      excerpt: '',
      byline: null,
      siteName: null,
      length: 0,
    };
  }

  // If already cached, return from cache
  if (row.item.fullContent) {
    return {
      title: row.item.title,
      content: row.item.fullContent,
      textContent: row.item.fullContent,
      excerpt: row.item.fullContent.slice(0, 200),
      byline: row.item.author,
      siteName: row.sourceName,
      length: row.item.fullContent.split(/\s+/).length,
    };
  }

  // Fallback content
  const fallback: ArticleContent = {
    title: row.item.title,
    content: row.item.description || '',
    textContent: row.item.description || '',
    excerpt: (row.item.description || '').slice(0, 200),
    byline: row.item.author,
    siteName: row.sourceName,
    length: 0,
  };

  // If debounced and no cached content, return fallback without fetching
  if (isDebounced) {
    log.debug(`Debounced duplicate fetch for item ${itemId}`);
    return fallback;
  }

  try {
    // Reddit posts: fetch via JSON API to get selftext + comments.
    if (/reddit\.com\//i.test(row.item.url)) {
      const redditContent = await fetchRedditPostWithComments(row.item.url, row.item.description || '');
      // Cache it
      await db.update(intelItems).set({ fullContent: redditContent.textContent }).where(eq(intelItems.id, itemId));
      return {
        ...redditContent,
        title: row.item.title,
        byline: row.item.author,
        siteName: 'Reddit',
      };
    }

    // Fetch the article HTML
    const response = await fetch(row.item.url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      log.warn(`Failed to fetch article (${response.status}): ${row.item.url}`);
      return fallback;
    }

    const html = await response.text();

    // Parse with linkedom + Readability
    const { document } = parseHTML(html);
    const reader = new Readability(document as unknown as Document);
    const article = reader.parse();

    if (!article) {
      log.warn(`Readability could not parse: ${row.item.url}`);
      return fallback;
    }

    // Cache the content in DB
    await db.update(intelItems).set({ fullContent: article.content }).where(eq(intelItems.id, itemId));

    const textContent = article.textContent ?? '';

    return {
      title: article.title || row.item.title,
      content: article.content ?? '',
      textContent,
      excerpt: article.excerpt || textContent.slice(0, 200),
      byline: article.byline ?? null,
      siteName: article.siteName ?? null,
      length: article.length ?? 0,
    };
  } catch (err) {
    log.warn(`Error extracting article content for ${row.item.url}: ${err}`);
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Default Sources Seeding
// ---------------------------------------------------------------------------

const DEFAULT_SOURCES = [
  { name: 'Anthropic Blog', url: 'https://www.anthropic.com/rss.xml' },
  { name: 'OpenAI Blog', url: 'https://openai.com/blog/rss.xml' },
  { name: 'TechCrunch AI', url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
  { name: 'The Verge AI', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
  { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/technology-lab' },
  { name: 'Hacker News', url: 'https://hnrss.org/frontpage' },
  { name: 'MIT Tech Review', url: 'https://www.technologyreview.com/feed/' },
  { name: 'Google AI Blog', url: 'https://blog.google/technology/ai/rss/' },
];

/** Seed default RSS sources if the intel_sources table is empty. */
export async function seedDefaultSources(): Promise<void> {
  const db = getDb();

  const [{ value: sourceCount }] = await db.select({ value: count() }).from(intelSources);

  if (sourceCount > 0) {
    log.info('Intel sources already exist, skipping seed');
    return;
  }

  log.info('Seeding default intel sources...');

  for (const source of DEFAULT_SOURCES) {
    try {
      await db.insert(intelSources).values({
        name: source.name,
        url: source.url,
        type: 'rss',
      });
    } catch (err) {
      log.warn(`Failed to seed source "${source.name}": ${err}`);
    }
  }

  log.info(`Seeded ${DEFAULT_SOURCES.length} default intel sources`);
}
