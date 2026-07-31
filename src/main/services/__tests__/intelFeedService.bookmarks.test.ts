// === FILE PURPOSE ===
// Query-shape tests for the intel feed read/write paths behind the Saved (bookmark)
// view and the "Add Article" flow (INTEL-FIX.1).
//
// Seeding approach: like every other service test in this repo (see
// calendarAssociationService.test.ts / brainTreeService.test.ts) we mock getDb with a
// chainable double instead of spinning up PGlite. intelFeedService builds its queries
// with the drizzle query builder, so the double captures the composed WHERE condition
// and we assert on the drizzle SQL tree — that is where the defects lived:
//   - getBookmarkCount() counted rows the Saved list can never return (disabled sources)
//   - getItems({ bookmarkFilter }) aged saved articles out of the list after 7 days
//   - addManualItem() created the 'Saved Links' source disabled, so every manually
//     added article was invisible in a feed that inner-joins on enabled sources

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eq, and, gte } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports
// ---------------------------------------------------------------------------

vi.mock('../../db/connection', () => ({ getDb: vi.fn() }));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { getItems, getBookmarkCount, addManualItem } from '../intelFeedService';
import { getDb } from '../../db/connection';
import { intelItems, intelSources } from '../../db/schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * True iff `node` (a drizzle SQL condition tree) references `column`.
 * Walks queryChunks recursively — eq()/gte() put the Column instance itself in the
 * chunk list, and and() nests the operand SQL objects.
 */
function referencesColumn(node: unknown, column: unknown): boolean {
  if (node === column) return true;
  if (Array.isArray(node)) return node.some((child) => referencesColumn(child, column));
  if (!node || typeof node !== 'object') return false;
  const chunks = (node as { queryChunks?: unknown }).queryChunks;
  return Array.isArray(chunks) && chunks.some((child) => referencesColumn(child, column));
}

/** Chainable double for getItems: select().from().innerJoin().orderBy().where()[.limit()] */
function mockDbForGetItems() {
  const captured: { where?: unknown } = {};
  const rows: unknown[] = [];
  const result = {
    limit: vi.fn().mockResolvedValue(rows),
    then: (resolve: (v: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  const where = vi.fn((condition: unknown) => {
    captured.where = condition;
    return result;
  });
  const orderBy = vi.fn(() => ({ where }));
  const innerJoin = vi.fn(() => ({ orderBy }));
  const from = vi.fn(() => ({ innerJoin }));
  vi.mocked(getDb).mockReturnValue({ select: vi.fn(() => ({ from })) } as never);
  return captured;
}

/** Chainable double for getBookmarkCount: select().from()[.innerJoin()].where() */
function mockDbForBookmarkCount(value = 0) {
  const captured: { where?: unknown; joined: boolean } = { joined: false };
  const where = vi.fn((condition: unknown) => {
    captured.where = condition;
    return Promise.resolve([{ value }]);
  });
  const innerJoin = vi.fn(() => {
    captured.joined = true;
    return { where };
  });
  const from = vi.fn(() => ({ innerJoin, where }));
  vi.mocked(getDb).mockReturnValue({ select: vi.fn(() => ({ from })) } as never);
  return captured;
}

interface ManualSourceRow {
  id: string;
  name: string;
  enabled: boolean;
}

/** Chainable double for addManualItem: select/insert/update against sources + items. */
function mockDbForAddManualItem(existingManualSource: ManualSourceRow | null) {
  const inserts: { table: unknown; values: Record<string, unknown> }[] = [];
  const updates: { table: unknown; values: Record<string, unknown> }[] = [];

  const itemRow = {
    id: 'item-1',
    sourceId: existingManualSource?.id ?? 'manual-src',
    title: 'T',
    description: null,
    url: 'https://example.com/a',
    imageUrl: null,
    author: null,
    publishedAt: new Date(),
    fetchedAt: new Date(),
    isRead: false,
    isBookmarked: true,
    category: null,
    summary: null,
    relevanceScore: null,
    fullContent: null,
    alternateUrls: null,
    createdAt: new Date(),
  };

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(existingManualSource ? [existingManualSource] : []),
      })),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: Record<string, unknown>) => {
        inserts.push({ table, values });
        return {
          returning: vi
            .fn()
            .mockResolvedValue([table === intelSources ? { id: 'manual-src', name: 'Saved Links' } : itemRow]),
        };
      }),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((values: Record<string, unknown>) => {
        updates.push({ table, values });
        return {
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([{ ...(existingManualSource ?? {}), ...values, name: 'Saved Links' }]),
          })),
        };
      }),
    })),
  };
  vi.mocked(getDb).mockReturnValue(db as never);
  return { inserts, updates };
}

// ---------------------------------------------------------------------------
// Sanity-check the condition walker before relying on it
// ---------------------------------------------------------------------------

describe('referencesColumn helper sanity check', () => {
  it('finds a column inside a simple and nested condition, and misses absent ones', () => {
    const simple = eq(intelItems.isBookmarked, true);
    expect(referencesColumn(simple, intelItems.isBookmarked)).toBe(true);
    expect(referencesColumn(simple, intelSources.enabled)).toBe(false);

    const nested = and(eq(intelItems.isBookmarked, true), eq(intelSources.enabled, true));
    expect(referencesColumn(nested, intelSources.enabled)).toBe(true);
    expect(referencesColumn(nested, intelItems.publishedAt)).toBe(false);

    const withDate = and(gte(intelItems.publishedAt, new Date()), eq(intelSources.enabled, true));
    expect(referencesColumn(withDate, intelItems.publishedAt)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getItems — date window', () => {
  beforeEach(() => vi.clearAllMocks());

  it('applies the date window for the normal feed view', async () => {
    const captured = mockDbForGetItems();

    await getItems('week');

    expect(referencesColumn(captured.where, intelItems.publishedAt)).toBe(true);
    expect(referencesColumn(captured.where, intelSources.enabled)).toBe(true);
  });

  it('drops the date window for the Saved view so bookmarks do not age out', async () => {
    const captured = mockDbForGetItems();

    await getItems('week', { bookmarkFilter: true });

    expect(referencesColumn(captured.where, intelItems.publishedAt)).toBe(false);
    expect(referencesColumn(captured.where, intelItems.isBookmarked)).toBe(true);
    // Still scoped to enabled sources — same scope the badge counts
    expect(referencesColumn(captured.where, intelSources.enabled)).toBe(true);
  });

  it('drops the date window for the Saved view under the "today" filter too', async () => {
    const captured = mockDbForGetItems();

    await getItems('today', { bookmarkFilter: true });

    expect(referencesColumn(captured.where, intelItems.publishedAt)).toBe(false);
  });

  it('still honours search and source filters in the Saved view', async () => {
    const captured = mockDbForGetItems();

    await getItems('week', { bookmarkFilter: true, sourceFilter: 'src-1' });

    expect(referencesColumn(captured.where, intelItems.sourceId)).toBe(true);
  });
});

describe('getBookmarkCount — scope', () => {
  beforeEach(() => vi.clearAllMocks());

  it('counts only bookmarks from enabled sources (matches what the Saved list can show)', async () => {
    const captured = mockDbForBookmarkCount(3);

    const result = await getBookmarkCount();

    expect(result).toBe(3);
    expect(captured.joined).toBe(true);
    expect(referencesColumn(captured.where, intelItems.isBookmarked)).toBe(true);
    expect(referencesColumn(captured.where, intelSources.enabled)).toBe(true);
  });

  it('returns 0 when the count row is missing', async () => {
    const where = vi.fn().mockResolvedValue([]);
    const innerJoin = vi.fn(() => ({ where }));
    const from = vi.fn(() => ({ innerJoin, where }));
    vi.mocked(getDb).mockReturnValue({ select: vi.fn(() => ({ from })) } as never);

    expect(await getBookmarkCount()).toBe(0);
  });
});

describe('addManualItem — manual source visibility', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates the manual source enabled so added articles are visible', async () => {
    const { inserts } = mockDbForAddManualItem(null);

    await addManualItem({ url: 'https://example.com/a' });

    const sourceInsert = inserts.find((i) => i.table === intelSources);
    expect(sourceInsert).toBeDefined();
    expect(sourceInsert!.values.type).toBe('manual');
    expect(sourceInsert!.values.enabled).toBe(true);
  });

  it('re-enables a disabled manual source (self-heal for pre-fix databases)', async () => {
    const { updates, inserts } = mockDbForAddManualItem({ id: 'manual-src', name: 'Saved Links', enabled: false });

    await addManualItem({ url: 'https://example.com/a' });

    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe(intelSources);
    expect(updates[0].values.enabled).toBe(true);
    // No duplicate source created
    expect(inserts.filter((i) => i.table === intelSources)).toHaveLength(0);
  });

  it('leaves an already-enabled manual source untouched', async () => {
    const { updates } = mockDbForAddManualItem({ id: 'manual-src', name: 'Saved Links', enabled: true });

    await addManualItem({ url: 'https://example.com/a' });

    expect(updates).toHaveLength(0);
  });

  it('still bookmarks manual items on insert', async () => {
    const { inserts } = mockDbForAddManualItem({ id: 'manual-src', name: 'Saved Links', enabled: true });

    await addManualItem({ url: 'https://example.com/a' });

    const itemInsert = inserts.find((i) => i.table === intelItems);
    expect(itemInsert!.values.isBookmarked).toBe(true);
  });
});
