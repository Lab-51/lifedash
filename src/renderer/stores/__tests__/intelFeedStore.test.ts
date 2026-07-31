import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IntelItem } from '../../../shared/types';

// Mock electronAPI on globalThis, then alias window = globalThis so store code
// that reads window.electronAPI works without replacing the entire window object.
vi.stubGlobal('electronAPI', {
  getIntelItems: vi.fn().mockResolvedValue([]),
  getIntelSources: vi.fn().mockResolvedValue([]),
  fetchAllIntelSources: vi.fn().mockResolvedValue({ newItems: 0 }),
  markIntelItemRead: vi.fn().mockResolvedValue(undefined),
  // Main returns the updated row (or null when the item is gone) — see intelFeedService.toggleBookmark
  toggleIntelItemBookmark: vi.fn().mockImplementation((id: string) => Promise.resolve({ id, isBookmarked: true })),
  getIntelBookmarkCount: vi.fn().mockResolvedValue(0),
  addManualIntelItem: vi.fn().mockImplementation((input: any) => Promise.resolve({ id: 'i-new', ...input })),
  createIntelSource: vi.fn().mockImplementation((input: any) => Promise.resolve({ id: 's-new', ...input })),
  updateIntelSource: vi.fn().mockImplementation((id: string, input: any) => Promise.resolve({ id, ...input })),
  deleteIntelSource: vi.fn().mockResolvedValue(undefined),
  seedIntelDefaults: vi.fn().mockResolvedValue(undefined),
  intelGetLatestBrief: vi.fn().mockResolvedValue(null),
  intelGenerateBrief: vi.fn().mockResolvedValue({ id: 'b1', content: 'brief' }),
  intelSummarizeItem: vi.fn().mockImplementation((id: string) => Promise.resolve({ id, summary: 'summarized' })),
  intelFetchArticleContent: vi.fn().mockResolvedValue({
    title: 'Article',
    content: '<p>content</p>',
    textContent: 'content',
    excerpt: 'content',
    byline: null,
    siteName: null,
    length: 100,
  }),
  intelBriefChat: vi.fn().mockResolvedValue('AI response'),
  intelToggleBriefPin: vi.fn().mockImplementation((id: string) => Promise.resolve({ id, isPinned: true })),
  intelGetPinnedBriefs: vi.fn().mockResolvedValue([]),
  intelGetBriefHistory: vi.fn().mockResolvedValue([]),
});
vi.stubGlobal('window', globalThis);

// Must import after stubGlobal
const { useIntelFeedStore } = await import('../intelFeedStore');

function makeItem(overrides: Partial<IntelItem> = {}): IntelItem {
  return {
    id: 'i1',
    sourceId: 's1',
    sourceName: 'Test Source',
    title: 'Test Item',
    url: 'https://example.com',
    description: 'A test intel item',
    author: null,
    category: null,
    publishedAt: '2026-01-01T00:00:00Z',
    fetchedAt: '2026-01-01T00:00:00Z',
    isRead: false,
    isBookmarked: false,
    summary: null,
    ...overrides,
  } as IntelItem;
}

const initialState = {
  items: [],
  sources: [],
  dateFilter: 'today' as const,
  loading: false,
  fetching: false,
  error: null,
  brief: null,
  briefLoading: false,
  briefType: 'daily' as const,
  categoryFilter: null,
  readerItem: null,
  readerContent: null,
  readerLoading: false,
  briefChatMessages: [],
  briefChatSending: false,
};

describe('intelFeedStore', () => {
  beforeEach(() => {
    useIntelFeedStore.setState(initialState);
    vi.clearAllMocks();
  });

  it('has correct initial state', () => {
    const state = useIntelFeedStore.getState();
    expect(state.items).toEqual([]);
    expect(state.sources).toEqual([]);
    expect(state.dateFilter).toBe('today');
    expect(state.loading).toBe(false);
    expect(state.fetching).toBe(false);
    expect(state.error).toBeNull();
    expect(state.brief).toBeNull();
    expect(state.briefLoading).toBe(false);
    expect(state.briefType).toBe('daily');
    expect(state.categoryFilter).toBeNull();
    expect(state.readerItem).toBeNull();
    expect(state.readerContent).toBeNull();
    expect(state.readerLoading).toBe(false);
    expect(state.briefChatMessages).toEqual([]);
    expect(state.briefChatSending).toBe(false);
  });

  it('openReader sets readerItem, readerLoading, and fetches content', async () => {
    const item = makeItem({ id: 'i1', isRead: false });

    await useIntelFeedStore.getState().openReader(item);

    const state = useIntelFeedStore.getState();
    expect(state.readerItem).toEqual(item);
    expect(state.readerLoading).toBe(false);
    expect(state.readerContent).not.toBeNull();
    expect(state.readerContent!.title).toBe('Article');
    // Should have called markRead since item was unread
    expect(window.electronAPI.markIntelItemRead).toHaveBeenCalledWith('i1');
  });

  it('closeReader clears readerItem, readerContent, and readerLoading', async () => {
    // Set up reader state
    useIntelFeedStore.setState({
      readerItem: makeItem(),
      readerContent: {
        title: 'x',
        content: 'y',
        textContent: 'y',
        excerpt: 'y',
        byline: null,
        siteName: null,
        length: 1,
      } as any,
      readerLoading: true,
    });

    useIntelFeedStore.getState().closeReader();

    const state = useIntelFeedStore.getState();
    expect(state.readerItem).toBeNull();
    expect(state.readerContent).toBeNull();
    expect(state.readerLoading).toBe(false);
  });

  it('setCategoryFilter updates the category filter', () => {
    useIntelFeedStore.getState().setCategoryFilter('tech');
    expect(useIntelFeedStore.getState().categoryFilter).toBe('tech');

    useIntelFeedStore.getState().setCategoryFilter(null);
    expect(useIntelFeedStore.getState().categoryFilter).toBeNull();
  });

  it('loadItems fetches items and sets loading states', async () => {
    const mockItems = [makeItem({ id: 'i1' }), makeItem({ id: 'i2' })];
    vi.mocked(window.electronAPI.getIntelItems).mockResolvedValueOnce(mockItems);

    await useIntelFeedStore.getState().loadItems();

    const state = useIntelFeedStore.getState();
    expect(state.items).toEqual(mockItems);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(window.electronAPI.getIntelItems).toHaveBeenCalledWith('today', undefined);
  });

  it('loadItems sets error on failure', async () => {
    vi.mocked(window.electronAPI.getIntelItems).mockRejectedValueOnce(new Error('Network fail'));

    await useIntelFeedStore.getState().loadItems();

    const state = useIntelFeedStore.getState();
    expect(state.error).toBe('Network fail');
    expect(state.loading).toBe(false);
  });

  it('markRead optimistically updates item isRead to true', async () => {
    useIntelFeedStore.setState({
      items: [makeItem({ id: 'i1', isRead: false }), makeItem({ id: 'i2', isRead: false })],
    });

    await useIntelFeedStore.getState().markRead('i1');

    const item = useIntelFeedStore.getState().items.find((i) => i.id === 'i1');
    expect(item!.isRead).toBe(true);
    // Other item unchanged
    const other = useIntelFeedStore.getState().items.find((i) => i.id === 'i2');
    expect(other!.isRead).toBe(false);
  });

  it('toggleBookmark optimistically toggles bookmark state', async () => {
    useIntelFeedStore.setState({
      items: [makeItem({ id: 'i1', isBookmarked: false })],
    });

    // Start the toggle but check optimistic state before awaiting
    const promise = useIntelFeedStore.getState().toggleBookmark('i1');
    const item = useIntelFeedStore.getState().items.find((i) => i.id === 'i1');
    expect(item!.isBookmarked).toBe(true);
    await promise;
  });

  it('setBriefType updates type and clears chat messages', () => {
    useIntelFeedStore.setState({
      briefChatMessages: [{ id: 'm1', role: 'user', content: 'hello', timestamp: '' }] as any,
      briefChatSending: true,
    });

    useIntelFeedStore.getState().setBriefType('weekly');

    const state = useIntelFeedStore.getState();
    expect(state.briefType).toBe('weekly');
    expect(state.briefChatMessages).toEqual([]);
    expect(state.briefChatSending).toBe(false);
  });

  it('clearBriefChat resets messages and sending flag', () => {
    useIntelFeedStore.setState({
      briefChatMessages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: '' }] as any,
      briefChatSending: true,
    });

    useIntelFeedStore.getState().clearBriefChat();

    expect(useIntelFeedStore.getState().briefChatMessages).toEqual([]);
    expect(useIntelFeedStore.getState().briefChatSending).toBe(false);
  });

  it('deleteSource removes source from list', async () => {
    useIntelFeedStore.setState({
      sources: [
        { id: 's1', name: 'Source A' },
        { id: 's2', name: 'Source B' },
      ] as any,
    });

    await useIntelFeedStore.getState().deleteSource('s1');

    const sources = useIntelFeedStore.getState().sources;
    expect(sources).toHaveLength(1);
    expect(sources[0].id).toBe('s2');
  });

  // -------------------------------------------------------------------------
  // INTEL-FIX.1 — bookmark & source-deletion flows
  // -------------------------------------------------------------------------

  describe('INTEL-FIX.1 — bookmark flow', () => {
    beforeEach(() => {
      useIntelFeedStore.setState({ briefItems: [], bookmarkCount: 0, sourceFilter: null, error: null });
    });

    it('bookmarks an article that is open in the reader but absent from items', async () => {
      // Reader opened from the brief panel / saved-brief modal: the article lives in
      // briefItems (unfiltered 'week' list), not in the date/bookmark-filtered items list.
      const article = makeItem({ id: 'i-brief', isBookmarked: false });
      useIntelFeedStore.setState({ items: [], briefItems: [article], readerItem: article, bookmarkCount: 2 });
      vi.mocked(window.electronAPI.getIntelBookmarkCount).mockResolvedValue(3);

      await useIntelFeedStore.getState().toggleBookmark('i-brief');

      expect(window.electronAPI.toggleIntelItemBookmark).toHaveBeenCalledWith('i-brief');
      const state = useIntelFeedStore.getState();
      expect(state.readerItem!.isBookmarked).toBe(true);
      // briefItems must be updated too, or reopening from the brief shows a stale star
      expect(state.briefItems[0].isBookmarked).toBe(true);
      expect(state.error).toBeNull();
    });

    it('keeps items, briefItems and readerItem in sync for the same article', async () => {
      const article = makeItem({ id: 'i1', isBookmarked: false });
      useIntelFeedStore.setState({
        items: [article, makeItem({ id: 'i2' })],
        briefItems: [article],
        readerItem: article,
        bookmarkCount: 0,
      });

      await useIntelFeedStore.getState().toggleBookmark('i1');

      const state = useIntelFeedStore.getState();
      expect(state.items.find((i) => i.id === 'i1')!.isBookmarked).toBe(true);
      expect(state.briefItems[0].isBookmarked).toBe(true);
      expect(state.readerItem!.isBookmarked).toBe(true);
      expect(state.items.find((i) => i.id === 'i2')!.isBookmarked).toBe(false);
    });

    it('rolls back when the item no longer exists (service resolves null)', async () => {
      vi.mocked(window.electronAPI.toggleIntelItemBookmark).mockResolvedValueOnce(null);
      vi.mocked(window.electronAPI.getIntelBookmarkCount).mockResolvedValue(4);
      const article = makeItem({ id: 'i1', isBookmarked: false });
      useIntelFeedStore.setState({ items: [article], readerItem: article, bookmarkCount: 4 });

      await useIntelFeedStore.getState().toggleBookmark('i1');

      const state = useIntelFeedStore.getState();
      expect(state.items[0].isBookmarked).toBe(false);
      expect(state.readerItem!.isBookmarked).toBe(false);
      expect(state.bookmarkCount).toBe(4);
      expect(state.error).toBe('That article is no longer available.');
    });

    it('reverts the optimistic count and flag when the IPC rejects', async () => {
      vi.mocked(window.electronAPI.toggleIntelItemBookmark).mockRejectedValueOnce(new Error('IPC down'));
      vi.mocked(window.electronAPI.getIntelItems).mockResolvedValueOnce([makeItem({ id: 'i1', isBookmarked: false })]);
      vi.mocked(window.electronAPI.getIntelBookmarkCount).mockResolvedValue(1);
      useIntelFeedStore.setState({
        items: [makeItem({ id: 'i1', isBookmarked: false })],
        readerItem: makeItem({ id: 'i1', isBookmarked: false }),
        bookmarkCount: 1,
      });

      await useIntelFeedStore.getState().toggleBookmark('i1');

      const state = useIntelFeedStore.getState();
      expect(state.items[0].isBookmarked).toBe(false);
      expect(state.readerItem!.isBookmarked).toBe(false);
      expect(state.bookmarkCount).toBe(1);
      expect(state.error).toBe('IPC down');
    });

    it('refreshes pinned briefs after a pin toggle so the Saved badge is not stale', async () => {
      // Saved badge = bookmarkCount + pinnedBriefs.length
      const pinned = [{ id: 'b1', isPinned: true }] as any;
      vi.mocked(window.electronAPI.intelGetPinnedBriefs).mockResolvedValueOnce(pinned);
      useIntelFeedStore.setState({
        brief: { id: 'b1', isPinned: false } as any,
        briefHistory: [],
        pinnedBriefs: [],
      });

      await useIntelFeedStore.getState().toggleBriefPin('b1');
      // loadPinnedBriefs is fired without awaiting — let the microtask queue drain
      await Promise.resolve();
      await Promise.resolve();

      expect(window.electronAPI.intelGetPinnedBriefs).toHaveBeenCalled();
      expect(useIntelFeedStore.getState().pinnedBriefs).toEqual(pinned);
    });

    it('never drives the bookmark count below zero', async () => {
      useIntelFeedStore.setState({ items: [makeItem({ id: 'i1', isBookmarked: true })], bookmarkCount: 0 });

      const promise = useIntelFeedStore.getState().toggleBookmark('i1');
      expect(useIntelFeedStore.getState().bookmarkCount).toBe(0);
      await promise;
    });
  });

  describe('INTEL-FIX.1 — source deletion flow', () => {
    beforeEach(() => {
      useIntelFeedStore.setState({ briefItems: [], bookmarkCount: 0, sourceFilter: null, error: null });
    });

    it('drops the deleted source articles and releases a filter pointing at it', async () => {
      useIntelFeedStore.setState({
        sources: [
          { id: 's1', name: 'Source A' },
          { id: 's2', name: 'Source B' },
        ] as any,
        items: [makeItem({ id: 'i1', sourceId: 's1' }), makeItem({ id: 'i2', sourceId: 's2' })],
        briefItems: [makeItem({ id: 'i1', sourceId: 's1' })],
        sourceFilter: 's1',
      });

      await useIntelFeedStore.getState().deleteSource('s1');

      const state = useIntelFeedStore.getState();
      expect(state.sources.map((s) => s.id)).toEqual(['s2']);
      expect(state.items.map((i) => i.id)).toEqual(['i2']);
      expect(state.briefItems).toEqual([]);
      // A filter on a deleted source can never match again — it would strand the feed empty
      expect(state.sourceFilter).toBeNull();
    });

    it('closes the reader when the open article belonged to the deleted source', async () => {
      useIntelFeedStore.setState({
        sources: [{ id: 's1', name: 'Source A' }] as any,
        items: [makeItem({ id: 'i1', sourceId: 's1' })],
        readerItem: makeItem({ id: 'i1', sourceId: 's1' }),
        readerContent: { title: 'x', content: 'y' } as any,
      });

      await useIntelFeedStore.getState().deleteSource('s1');

      const state = useIntelFeedStore.getState();
      expect(state.readerItem).toBeNull();
      expect(state.readerContent).toBeNull();
    });

    it('leaves an unrelated open article in the reader', async () => {
      useIntelFeedStore.setState({
        sources: [
          { id: 's1', name: 'A' },
          { id: 's2', name: 'B' },
        ] as any,
        items: [makeItem({ id: 'i2', sourceId: 's2' })],
        readerItem: makeItem({ id: 'i2', sourceId: 's2' }),
      });

      await useIntelFeedStore.getState().deleteSource('s1');

      expect(useIntelFeedStore.getState().readerItem!.id).toBe('i2');
    });

    it('surfaces a delete failure instead of rejecting (no unhandled rejection)', async () => {
      vi.mocked(window.electronAPI.deleteIntelSource).mockRejectedValueOnce(new Error('DB locked'));
      useIntelFeedStore.setState({
        sources: [{ id: 's1', name: 'Source A' }] as any,
        items: [makeItem({ id: 'i1', sourceId: 's1' })],
      });

      await expect(useIntelFeedStore.getState().deleteSource('s1')).resolves.toBeUndefined();

      const state = useIntelFeedStore.getState();
      expect(state.error).toBe('DB locked');
      // Nothing removed — the source is still there
      expect(state.sources).toHaveLength(1);
      expect(state.items).toHaveLength(1);
    });
  });

  it('openReader uses description as fallback when article fetch fails', async () => {
    vi.mocked(window.electronAPI.intelFetchArticleContent).mockRejectedValueOnce(new Error('fetch failed'));

    const item = makeItem({
      id: 'i1',
      title: 'Fallback Title',
      description: 'Fallback desc',
      author: 'Author',
      sourceName: 'Source',
    });
    await useIntelFeedStore.getState().openReader(item);

    const state = useIntelFeedStore.getState();
    expect(state.readerContent).not.toBeNull();
    expect(state.readerContent!.title).toBe('Fallback Title');
    expect(state.readerContent!.content).toBe('Fallback desc');
    expect(state.readerContent!.byline).toBe('Author');
    expect(state.readerLoading).toBe(false);
  });
});
