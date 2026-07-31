// === FILE PURPOSE ===
// Zustand store for Intelligence Feed state and actions.
// Manages intel items, sources, date filtering, and fetch operations.
//
// === DEPENDENCIES ===
// zustand, shared types, window.electronAPI

import { create } from 'zustand';
import { toast } from '../hooks/useToast';
import type {
  IntelItem,
  IntelSource,
  IntelBrief,
  IntelBriefType,
  IntelDateFilter,
  IntelChatMessage,
  IntelFeed,
  AddManualItemInput,
  CreateIntelSourceInput,
  UpdateIntelSourceInput,
  CreateIntelFeedInput,
  UpdateIntelFeedInput,
  ArticleContent,
} from '../../shared/types';

type ViewMode = 'feed' | 'bookmarks';

// Cooldown for fetchAll — prevents re-fetching RSS on every tab switch
const FETCH_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

interface IntelFeedStore {
  // State
  items: IntelItem[];
  briefItems: IntelItem[];
  sources: IntelSource[];
  feeds: IntelFeed[];
  activeFeedId: string | null;
  dateFilter: IntelDateFilter;
  loading: boolean;
  fetching: boolean;
  error: string | null;
  brief: IntelBrief | null;
  briefLoading: boolean;
  briefType: IntelBriefType;
  briefHistory: IntelBrief[];
  pinnedBriefs: IntelBrief[];
  categoryFilter: string | null;
  searchQuery: string;
  sourceFilter: string | null;
  bookmarkFilter: boolean;
  viewMode: ViewMode;
  sortMode: 'top' | 'recent';
  bookmarkCount: number;
  readerItem: IntelItem | null;
  readerContent: ArticleContent | null;
  readerLoading: boolean;
  briefChatMessages: IntelChatMessage[];
  briefChatSending: boolean;
  trendingTopics: { topic: string; count: number }[];
  lastFetchedAt: number;

  // Actions
  loadItems: () => Promise<void>;
  loadBriefItems: () => Promise<void>;
  loadSources: () => Promise<void>;
  loadBookmarkCount: () => Promise<void>;
  loadTrending: () => Promise<void>;
  loadPinnedBriefs: () => Promise<void>;
  setViewMode: (mode: ViewMode) => void;
  setDateFilter: (filter: IntelDateFilter) => void;
  setSearchQuery: (query: string) => void;
  setSourceFilter: (sourceId: string | null) => void;
  setBookmarkFilter: (enabled: boolean) => void;
  clearAllFilters: () => void;
  fetchAll: (force?: boolean) => Promise<{ newItems: number }>;
  markRead: (id: string) => Promise<void>;
  toggleBookmark: (id: string) => Promise<void>;
  addManualItem: (input: AddManualItemInput) => Promise<IntelItem>;
  createSource: (input: CreateIntelSourceInput) => Promise<IntelSource>;
  updateSource: (id: string, input: UpdateIntelSourceInput) => Promise<void>;
  deleteSource: (id: string) => Promise<void>;
  seedDefaults: () => Promise<void>;
  loadBrief: () => Promise<void>;
  loadBriefHistory: () => Promise<void>;
  generateBrief: () => Promise<void>;
  setBriefType: (type: IntelBriefType) => void;
  toggleBriefPin: (id: string) => Promise<void>;
  loadSpecificBrief: (brief: IntelBrief) => void;
  setCategoryFilter: (category: string | null) => void;
  setSortMode: (mode: 'top' | 'recent') => void;
  summarizeItem: (id: string) => Promise<void>;
  openReader: (item: IntelItem) => Promise<void>;
  closeReader: () => void;
  sendBriefChatMessage: (content: string) => Promise<void>;
  clearBriefChat: () => void;

  // Feed actions
  loadFeeds: () => Promise<void>;
  setActiveFeed: (feedId: string | null) => void;
  createFeed: (input: CreateIntelFeedInput) => Promise<IntelFeed>;
  updateFeed: (id: string, input: UpdateIntelFeedInput) => Promise<void>;
  deleteFeed: (id: string) => Promise<void>;
  setFeedSources: (feedId: string, sourceIds: string[]) => Promise<void>;
  getFeedSourceIds: (feedId: string) => Promise<string[]>;
  reorderFeeds: (feedIds: string[]) => Promise<void>;
}

export const useIntelFeedStore = create<IntelFeedStore>((set, get) => ({
  items: [],
  briefItems: [],
  sources: [],
  feeds: [],
  activeFeedId: null,
  dateFilter: 'week',
  loading: false,
  fetching: false,
  error: null,
  brief: null,
  briefLoading: false,
  briefType: 'daily',
  briefHistory: [],
  pinnedBriefs: [],
  categoryFilter: null,
  searchQuery: '',
  sourceFilter: null,
  bookmarkFilter: false,
  viewMode: 'feed',
  sortMode: 'top',
  bookmarkCount: 0,
  readerItem: null,
  readerContent: null,
  readerLoading: false,
  briefChatMessages: [],
  briefChatSending: false,
  trendingTopics: [],
  lastFetchedAt: 0,

  loadItems: async () => {
    const prevCount = get().items.length;
    set({ loading: true, error: null });
    try {
      const { dateFilter, searchQuery, sourceFilter, bookmarkFilter, activeFeedId } = get();
      const extra =
        searchQuery || sourceFilter || bookmarkFilter
          ? {
              searchQuery: searchQuery || undefined,
              sourceFilter: sourceFilter || undefined,
              bookmarkFilter: bookmarkFilter || undefined,
            }
          : undefined;
      let items = await window.electronAPI.getIntelItems(dateFilter, extra);

      // Client-side filtering: when a feed is active, only show items from that feed's sources
      if (activeFeedId) {
        try {
          const feedSourceIds = await window.electronAPI.getIntelFeedSources(activeFeedId);
          items = items.filter((item) => feedSourceIds.includes(item.sourceId));
        } catch {
          // If fetching feed sources fails, show all items as fallback
        }
      }

      set({ items, loading: false });
      // Load bookmark count alongside items (non-blocking)
      get().loadBookmarkCount();

      // Auto-recovery: if we went from having items to empty with no filters,
      // articles may have been lost — trigger a background RSS re-fetch
      const hasFilters = !!(searchQuery || sourceFilter || bookmarkFilter);
      if (items.length === 0 && prevCount > 0 && !hasFilters && !activeFeedId) {
        setTimeout(() => get().fetchAll(true), 500);
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load intel items',
        loading: false,
      });
    }
  },

  loadBriefItems: async () => {
    try {
      let briefItems = await window.electronAPI.getIntelItems('week');

      // Client-side filtering: when a feed is active, only show items from that feed's sources
      const { activeFeedId } = get();
      if (activeFeedId) {
        try {
          const feedSourceIds = await window.electronAPI.getIntelFeedSources(activeFeedId);
          briefItems = briefItems.filter((item) => feedSourceIds.includes(item.sourceId));
        } catch {
          // Fallback: show all items
        }
      }

      set({ briefItems });
    } catch {
      // Non-critical — brief title matching will degrade gracefully
    }
  },

  loadBookmarkCount: async () => {
    try {
      const bookmarkCount = await window.electronAPI.getIntelBookmarkCount();
      set({ bookmarkCount });
    } catch {
      // Non-critical — silently ignore
    }
  },

  loadTrending: async () => {
    try {
      const trendingTopics = await window.electronAPI.getIntelTrendingTopics();
      set({ trendingTopics });
    } catch {
      // Non-critical — silently ignore
    }
  },

  loadPinnedBriefs: async () => {
    try {
      const pinnedBriefs = await window.electronAPI.intelGetPinnedBriefs();
      set({ pinnedBriefs });
    } catch {
      // Non-critical — silently ignore
    }
  },

  setViewMode: (mode: ViewMode) => {
    if (mode === 'bookmarks') {
      set({ viewMode: mode, bookmarkFilter: true });
      get().loadItems();
    } else {
      set({ viewMode: mode, bookmarkFilter: false });
      get().loadItems();
    }
  },

  loadSources: async () => {
    try {
      const sources = await window.electronAPI.getIntelSources();
      set({ sources });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load intel sources',
      });
    }
  },

  setDateFilter: (filter: IntelDateFilter) => {
    set({ dateFilter: filter });
    get().loadItems();
  },

  setSearchQuery: (query: string) => {
    set({ searchQuery: query });
    get().loadItems();
  },

  setSourceFilter: (sourceId: string | null) => {
    set({ sourceFilter: sourceId });
    get().loadItems();
  },

  setBookmarkFilter: (enabled: boolean) => {
    set({ bookmarkFilter: enabled });
    get().loadItems();
  },

  clearAllFilters: () => {
    set({ searchQuery: '', sourceFilter: null, bookmarkFilter: false, categoryFilter: null, viewMode: 'feed' });
    get().loadItems();
  },

  fetchAll: async (force?: boolean) => {
    // Skip if already fetching (race-condition guard) or within cooldown period
    if (get().fetching) return { newItems: 0 };
    if (!force && Date.now() - get().lastFetchedAt < FETCH_COOLDOWN_MS) {
      return { newItems: 0 };
    }

    // Set lastFetchedAt immediately (before the async call) so concurrent
    // calls triggered within the same tick also hit the cooldown check.
    set({ fetching: true, error: null, lastFetchedAt: Date.now() });
    try {
      const result = await window.electronAPI.fetchAllIntelSources();
      await get().loadItems();
      await get().loadSources();
      set({ fetching: false });
      return result;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch intel sources',
        fetching: false,
      });
      return { newItems: 0 };
    }
  },

  markRead: async (id: string) => {
    // Optimistic update
    set({
      items: get().items.map((item) => (item.id === id ? { ...item, isRead: true } : item)),
    });
    try {
      await window.electronAPI.markIntelItemRead(id);
    } catch (error) {
      // Revert on failure
      await get().loadItems();
      set({
        error: error instanceof Error ? error.message : 'Failed to mark item as read',
      });
    }
  },

  toggleBookmark: async (id: string) => {
    // The article may not be in `items`: the reader can be opened from the brief panel
    // or a saved-brief modal (those link `briefItems`, an unfiltered 'week' list), and
    // in the Saved view `items` only holds bookmarked articles. Resolving from `items`
    // alone made the reader's bookmark button a silent no-op.
    const { items, briefItems, readerItem, bookmarkCount } = get();
    const item =
      items.find((i) => i.id === id) ??
      (readerItem?.id === id ? readerItem : undefined) ??
      briefItems.find((i) => i.id === id);
    if (!item) return;

    const newBookmarked = !item.isBookmarked;

    /** Apply a bookmark value across every collection that can render this article. */
    const applyBookmark = (value: boolean) => {
      const current = get();
      set({
        items: current.items.map((i) => (i.id === id ? { ...i, isBookmarked: value } : i)),
        briefItems: current.briefItems.map((i) => (i.id === id ? { ...i, isBookmarked: value } : i)),
        ...(current.readerItem?.id === id ? { readerItem: { ...current.readerItem, isBookmarked: value } } : {}),
      });
    };

    // Optimistic update — items list + brief lists + reader panel + bookmark count
    applyBookmark(newBookmarked);
    set({ bookmarkCount: Math.max(0, bookmarkCount + (newBookmarked ? 1 : -1)) });

    try {
      const updated = await window.electronAPI.toggleIntelItemBookmark(id);
      if (!updated) {
        // Service returns null when the row is gone (source deleted / removed by sync).
        // Nothing was persisted — undo the optimistic flip instead of leaving a
        // bookmark on screen that does not exist in the DB.
        applyBookmark(!newBookmarked);
        set({ bookmarkCount });
        await get().loadBookmarkCount();
        set({ error: 'That article is no longer available.' });
        return;
      }
      // Reconcile count from DB after successful persist
      void get().loadBookmarkCount();
    } catch (error) {
      // Revert on failure (loadItems clears `error`, so it is set last)
      applyBookmark(!newBookmarked);
      set({ bookmarkCount });
      await get().loadItems();
      await get().loadBookmarkCount();
      set({
        error: error instanceof Error ? error.message : 'Failed to toggle bookmark',
      });
    }
  },

  addManualItem: async (input: AddManualItemInput) => {
    const item = await window.electronAPI.addManualIntelItem(input);
    set({ items: [item, ...get().items] });
    return item;
  },

  createSource: async (input: CreateIntelSourceInput) => {
    const source = await window.electronAPI.createIntelSource(input);
    set({ sources: [...get().sources, source] });
    return source;
  },

  updateSource: async (id: string, input: UpdateIntelSourceInput) => {
    const updated = await window.electronAPI.updateIntelSource(id, input);
    set({
      sources: get().sources.map((s) => (s.id === id ? updated : s)),
    });
  },

  deleteSource: async (id: string) => {
    try {
      await window.electronAPI.deleteIntelSource(id);
    } catch (error) {
      // Surface instead of rejecting: callers await this from click handlers with no
      // catch, so a rejection became an unhandled promise rejection and the user saw
      // nothing at all. The source stays listed and the caller's reload restores truth.
      // Toast as well as `error` — callers reload right after, and loadItems() clears `error`.
      const message = error instanceof Error ? error.message : 'Failed to delete source';
      set({ error: message });
      toast(message, 'error');
      return;
    }

    // Deleting a source cascade-deletes its articles in the DB — drop them from every
    // client-side collection (and the reader, which would otherwise point at a row that
    // no longer exists) and release a source filter that can no longer match anything.
    const { sourceFilter, readerItem } = get();
    set({
      sources: get().sources.filter((s) => s.id !== id),
      items: get().items.filter((i) => i.sourceId !== id),
      briefItems: get().briefItems.filter((i) => i.sourceId !== id),
      ...(sourceFilter === id ? { sourceFilter: null } : {}),
      ...(readerItem?.sourceId === id ? { readerItem: null, readerContent: null, readerLoading: false } : {}),
    });
    void get().loadBookmarkCount();
  },

  seedDefaults: async () => {
    try {
      await window.electronAPI.seedIntelDefaults();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to seed default sources',
      });
    }
  },

  loadBrief: async () => {
    try {
      const { briefType, activeFeedId } = get();
      const brief = await window.electronAPI.intelGetLatestBrief(briefType, activeFeedId ?? undefined);
      set({ brief });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load brief',
      });
    }
  },

  loadBriefHistory: async () => {
    try {
      const { briefType, activeFeedId } = get();
      const briefHistory = await window.electronAPI.intelGetBriefHistory(briefType, activeFeedId ?? undefined);
      set({ briefHistory });
    } catch {
      // Non-critical — silently ignore
    }
  },

  generateBrief: async () => {
    set({ briefLoading: true, error: null });
    try {
      const { briefType, activeFeedId } = get();
      const brief = await window.electronAPI.intelGenerateBrief(briefType, activeFeedId ?? undefined);
      // Reload items since categories may have been updated
      await get().loadItems();
      set({ brief, briefLoading: false });
      get().loadBriefHistory();
    } catch (error) {
      set({
        briefLoading: false,
        error: error instanceof Error ? error.message : 'Failed to generate brief',
      });
    }
  },

  setBriefType: (type: IntelBriefType) => {
    set({ briefType: type, briefChatMessages: [], briefChatSending: false });
    get().loadBrief();
    get().loadBriefHistory();
  },

  toggleBriefPin: async (id: string) => {
    const { brief, briefHistory } = get();
    // Optimistic update on current brief
    if (brief?.id === id) {
      set({ brief: { ...brief, isPinned: !brief.isPinned } });
    }
    // Optimistic update on history list
    set({
      briefHistory: briefHistory.map((b) => (b.id === id ? { ...b, isPinned: !b.isPinned } : b)),
    });
    try {
      await window.electronAPI.intelToggleBriefPin(id);
      // The Saved badge is bookmarkCount + pinnedBriefs.length — refresh it here or
      // pinning from the feed view leaves the badge stale until the view is switched.
      void get().loadPinnedBriefs();
    } catch {
      // Revert on failure
      await get().loadBriefHistory();
      await get().loadBrief();
    }
  },

  loadSpecificBrief: (brief: IntelBrief) => {
    set({ brief, briefChatMessages: [], briefChatSending: false });
  },

  setCategoryFilter: (category: string | null) => {
    set({ categoryFilter: category });
  },

  setSortMode: (mode: 'top' | 'recent') => {
    set({ sortMode: mode });
  },

  summarizeItem: async (id: string) => {
    try {
      const updated = await window.electronAPI.intelSummarizeItem(id);
      set({
        items: get().items.map((item) => (item.id === id ? updated : item)),
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to summarize item',
      });
    }
  },

  openReader: async (item: IntelItem) => {
    set({ readerItem: item, readerLoading: true, readerContent: null });

    // Mark as read
    if (!item.isRead) {
      get().markRead(item.id);
    }

    try {
      const content = await window.electronAPI.intelFetchArticleContent(item.id);
      set({ readerContent: content, readerLoading: false });
    } catch {
      // Fallback: use description as content
      set({
        readerContent: {
          title: item.title,
          content: item.description || '',
          textContent: item.description || '',
          excerpt: (item.description || '').slice(0, 200),
          byline: item.author,
          siteName: item.sourceName,
          length: (item.description || '').split(/\s+/).filter(Boolean).length,
        },
        readerLoading: false,
      });
    }
  },

  closeReader: () => {
    set({ readerItem: null, readerContent: null, readerLoading: false });
  },

  sendBriefChatMessage: async (content: string) => {
    const brief = get().brief;
    if (!brief) return;

    const userMessage: IntelChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    };

    set({
      briefChatMessages: [...get().briefChatMessages, userMessage],
      briefChatSending: true,
    });

    try {
      const apiMessages = [...get().briefChatMessages].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const response = await window.electronAPI.intelBriefChat(brief.content, apiMessages);

      const assistantMessage: IntelChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: response,
        timestamp: new Date().toISOString(),
      };

      set({
        briefChatMessages: [...get().briefChatMessages, assistantMessage],
        briefChatSending: false,
      });
    } catch (error) {
      const errorMessage: IntelChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Failed to get response. Check your AI provider settings.'}`,
        timestamp: new Date().toISOString(),
      };
      set({
        briefChatMessages: [...get().briefChatMessages, errorMessage],
        briefChatSending: false,
      });
    }
  },

  clearBriefChat: () => {
    set({ briefChatMessages: [], briefChatSending: false });
  },

  // Feed actions
  loadFeeds: async () => {
    try {
      const feeds = await window.electronAPI.getIntelFeeds();
      set({ feeds });
    } catch {
      // Non-critical — silently ignore
    }
  },

  setActiveFeed: (feedId: string | null) => {
    set({ activeFeedId: feedId });
    // Reload items + brief for the new feed scope
    get().loadItems();
    get().loadBrief();
    get().loadBriefHistory();
    get().loadBriefItems();
  },

  createFeed: async (input: CreateIntelFeedInput) => {
    const feed = await window.electronAPI.createIntelFeed(input);
    await get().loadFeeds();
    return feed;
  },

  updateFeed: async (id: string, input: UpdateIntelFeedInput) => {
    await window.electronAPI.updateIntelFeed(id, input);
    await get().loadFeeds();
  },

  deleteFeed: async (id: string) => {
    await window.electronAPI.deleteIntelFeed(id);
    // If the deleted feed was active, reset to "All"
    if (get().activeFeedId === id) {
      set({ activeFeedId: null });
      get().loadItems();
      get().loadBrief();
      get().loadBriefHistory();
      get().loadBriefItems();
    }
    await get().loadFeeds();
  },

  setFeedSources: async (feedId: string, sourceIds: string[]) => {
    await window.electronAPI.setIntelFeedSources(feedId, sourceIds);
  },

  getFeedSourceIds: async (feedId: string) => {
    return window.electronAPI.getIntelFeedSources(feedId);
  },

  reorderFeeds: async (feedIds: string[]) => {
    await window.electronAPI.reorderIntelFeeds(feedIds);
    await get().loadFeeds();
  },
}));
