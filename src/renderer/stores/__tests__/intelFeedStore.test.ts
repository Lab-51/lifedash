import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IntelItem } from '../../../shared/types';

// Mock window.electronAPI before importing the store (node env — no window exists)
vi.stubGlobal('window', {
  electronAPI: {
    getIntelItems: vi.fn().mockResolvedValue([]),
    getIntelSources: vi.fn().mockResolvedValue([]),
    fetchAllIntelSources: vi.fn().mockResolvedValue({ newItems: 0 }),
    markIntelItemRead: vi.fn().mockResolvedValue(undefined),
    toggleIntelItemBookmark: vi.fn().mockResolvedValue(undefined),
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
  },
});

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
