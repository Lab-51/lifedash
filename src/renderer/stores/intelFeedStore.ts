// === FILE PURPOSE ===
// Zustand store for Intelligence Feed state and actions.
// Manages intel items, sources, date filtering, and fetch operations.
//
// === DEPENDENCIES ===
// zustand, shared types, window.electronAPI

import { create } from 'zustand';
import type {
  IntelItem,
  IntelSource,
  IntelBrief,
  IntelBriefType,
  IntelDateFilter,
  AddManualItemInput,
  CreateIntelSourceInput,
  UpdateIntelSourceInput,
  ArticleContent,
} from '../../shared/types';

interface IntelFeedStore {
  // State
  items: IntelItem[];
  sources: IntelSource[];
  dateFilter: IntelDateFilter;
  loading: boolean;
  fetching: boolean;
  error: string | null;
  brief: IntelBrief | null;
  briefLoading: boolean;
  briefType: IntelBriefType;
  categoryFilter: string | null;
  readerItem: IntelItem | null;
  readerContent: ArticleContent | null;
  readerLoading: boolean;

  // Actions
  loadItems: () => Promise<void>;
  loadSources: () => Promise<void>;
  setDateFilter: (filter: IntelDateFilter) => void;
  fetchAll: () => Promise<{ newItems: number }>;
  markRead: (id: string) => Promise<void>;
  toggleBookmark: (id: string) => Promise<void>;
  addManualItem: (input: AddManualItemInput) => Promise<IntelItem>;
  createSource: (input: CreateIntelSourceInput) => Promise<IntelSource>;
  updateSource: (id: string, input: UpdateIntelSourceInput) => Promise<void>;
  deleteSource: (id: string) => Promise<void>;
  seedDefaults: () => Promise<void>;
  loadBrief: () => Promise<void>;
  generateBrief: () => Promise<void>;
  setBriefType: (type: IntelBriefType) => void;
  setCategoryFilter: (category: string | null) => void;
  summarizeItem: (id: string) => Promise<void>;
  openReader: (item: IntelItem) => Promise<void>;
  closeReader: () => void;
}

export const useIntelFeedStore = create<IntelFeedStore>((set, get) => ({
  items: [],
  sources: [],
  dateFilter: 'all',
  loading: false,
  fetching: false,
  error: null,
  brief: null,
  briefLoading: false,
  briefType: 'daily',
  categoryFilter: null,
  readerItem: null,
  readerContent: null,
  readerLoading: false,

  loadItems: async () => {
    set({ loading: true, error: null });
    try {
      const items = await window.electronAPI.getIntelItems(get().dateFilter);
      set({ items, loading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load intel items',
        loading: false,
      });
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

  fetchAll: async () => {
    set({ fetching: true, error: null });
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
      items: get().items.map(item =>
        item.id === id ? { ...item, isRead: true } : item,
      ),
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
    const item = get().items.find(i => i.id === id);
    if (!item) return;
    // Optimistic update
    set({
      items: get().items.map(i =>
        i.id === id ? { ...i, isBookmarked: !i.isBookmarked } : i,
      ),
    });
    try {
      await window.electronAPI.toggleIntelItemBookmark(id);
    } catch (error) {
      // Revert on failure
      await get().loadItems();
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
      sources: get().sources.map(s => (s.id === id ? updated : s)),
    });
  },

  deleteSource: async (id: string) => {
    await window.electronAPI.deleteIntelSource(id);
    set({
      sources: get().sources.filter(s => s.id !== id),
    });
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
      const brief = await window.electronAPI.intelGetLatestBrief(get().briefType);
      set({ brief });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load brief',
      });
    }
  },

  generateBrief: async () => {
    set({ briefLoading: true, error: null });
    try {
      const brief = await window.electronAPI.intelGenerateBrief(get().briefType);
      // Reload items since categories may have been updated
      await get().loadItems();
      set({ brief, briefLoading: false });
    } catch (error) {
      set({
        briefLoading: false,
        error: error instanceof Error ? error.message : 'Failed to generate brief',
      });
    }
  },

  setBriefType: (type: IntelBriefType) => {
    set({ briefType: type });
    get().loadBrief();
  },

  setCategoryFilter: (category: string | null) => {
    set({ categoryFilter: category });
  },

  summarizeItem: async (id: string) => {
    try {
      const updated = await window.electronAPI.intelSummarizeItem(id);
      set({
        items: get().items.map(item => (item.id === id ? updated : item)),
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
          length: 0,
        },
        readerLoading: false,
      });
    }
  },

  closeReader: () => {
    set({ readerItem: null, readerContent: null, readerLoading: false });
  },
}));
