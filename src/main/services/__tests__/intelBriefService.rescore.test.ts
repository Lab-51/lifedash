// === FILE PURPOSE ===
// rescoreRecentUnscored against a real migrated PGlite database: only recent,
// still-unscored intel items are re-sent for scoring (scored and week-old items
// are left alone), and an UNFENCED two-block reply — the shape the old lazy
// regex could never parse — is written back as relevance + category. The model
// call is mocked; the query, scoreArticles' parsing and the DB writes are real.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { intelItems, intelSources } from '../../db/schema';

vi.mock('../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
const holder = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof drizzle> }));
vi.mock('../../db/connection', () => ({ getDb: () => holder.db }));
vi.mock('../ai-provider', () => ({ resolveTaskModel: vi.fn(), generate: vi.fn() }));

import { rescoreRecentUnscored } from '../intelBriefService';
import { resolveTaskModel, generate } from '../ai-provider';

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_UNSCORED = 'https://news.example/recent-unscored';
const RECENT_SCORED = 'https://news.example/recent-scored';
const OLD_UNSCORED = 'https://news.example/old-unscored';

beforeAll(async () => {
  const pg = new PGlite({ extensions: { vector } });
  holder.db = drizzle(pg, { schema });
  await migrate(holder.db as never, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
});

beforeEach(async () => {
  vi.clearAllMocks();
  await holder.db.delete(intelItems);
  await holder.db.delete(intelSources);
  vi.mocked(resolveTaskModel).mockResolvedValue({
    providerId: 'p1',
    providerName: 'openai',
    apiKeyEncrypted: null,
    baseUrl: null,
    model: 'gpt-5-mini',
  } as never);
});

async function seed(items: { url: string; fetchedAt: Date; relevanceScore?: number }[]): Promise<void> {
  const [source] = await holder.db
    .insert(intelSources)
    .values({ name: 'Example News', url: 'https://news.example/feed' })
    .returning();
  await holder.db.insert(intelItems).values(
    items.map((item) => ({
      sourceId: source.id,
      title: `Title for ${item.url}`,
      url: item.url,
      publishedAt: item.fetchedAt,
      fetchedAt: item.fetchedAt,
      relevanceScore: item.relevanceScore ?? null,
    })),
  );
}

async function itemByUrl(url: string) {
  const [row] = await holder.db.select().from(intelItems).where(eq(intelItems.url, url));
  return row;
}

describe('rescoreRecentUnscored', () => {
  it('re-scores only recent unscored items and writes an unfenced two-block reply back', async () => {
    await seed([
      { url: RECENT_UNSCORED, fetchedAt: new Date() },
      { url: RECENT_SCORED, fetchedAt: new Date(), relevanceScore: 5 },
      { url: OLD_UNSCORED, fetchedAt: new Date(Date.now() - 10 * DAY_MS) },
    ]);
    vi.mocked(generate).mockResolvedValue({
      text: `{"categories": {"${RECENT_UNSCORED}": "Open Source"}}\n{"relevance": {"${RECENT_UNSCORED}": 8}}`,
    } as never);

    await rescoreRecentUnscored();

    expect(generate).toHaveBeenCalledTimes(1);
    const prompt = vi.mocked(generate).mock.calls[0][0].prompt;
    expect(prompt).toContain(RECENT_UNSCORED);
    expect(prompt).not.toContain(RECENT_SCORED);
    expect(prompt).not.toContain(OLD_UNSCORED);

    const rescored = await itemByUrl(RECENT_UNSCORED);
    expect(rescored.relevanceScore).toBe(8);
    expect(rescored.category).toBe('Open Source');
    expect((await itemByUrl(OLD_UNSCORED)).relevanceScore).toBeNull();
  });

  it('makes no model call when nothing recent is unscored', async () => {
    await seed([
      { url: RECENT_SCORED, fetchedAt: new Date(), relevanceScore: 5 },
      { url: OLD_UNSCORED, fetchedAt: new Date(Date.now() - 10 * DAY_MS) },
    ]);

    await rescoreRecentUnscored();

    expect(generate).not.toHaveBeenCalled();
  });
});
