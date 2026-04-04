// === FILE PURPOSE ===
// Intelligence Feed main view — magazine-style layout with a hero card
// for the top-relevance article and a responsive grid for remaining items,
// grouped by date with relevance-based sorting within each group.

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Newspaper, Loader2, Plus, SlidersHorizontal, Search, Bookmark, Brain, X } from 'lucide-react';
import FeatureTip from './FeatureTip';
import HudBackground from './HudBackground';
import EmptyFeatureState from './EmptyFeatureState';
import IntelItemCard from './IntelItemCard';
import IntelHeroCard from './IntelHeroCard';
import IntelBriefPanel from './IntelBriefPanel';
import IntelSourceManager from './IntelSourceManager';
import IntelAddArticleModal from './IntelAddArticleModal';
import IntelArticleReader from './IntelArticleReader';
import SavedBriefModal from './SavedBriefModal';
import IntelFeedTabs from './IntelFeedTabs';
import { useIntelFeedStore } from '../stores/intelFeedStore';
import { useProjectStore } from '../stores/projectStore';
import { useIdeaStore } from '../stores/ideaStore';
import { useBrainstormStore } from '../stores/brainstormStore';
import { toast } from '../hooks/useToast';
import type { IntelItem, IntelBrief, IntelDateFilter } from '../../shared/types';

const DATE_FILTER_TABS: { label: string; value: IntelDateFilter }[] = [
  { label: 'Today', value: 'today' },
  { label: 'This Week', value: 'week' },
  { label: 'All', value: 'all' },
];

/** Group items by date header: "Today", "Yesterday", or formatted date. */
function groupItemsByDate(
  items: IntelItem[],
  sortMode: 'top' | 'recent' = 'top',
): { label: string; items: IntelItem[] }[] {
  const now = new Date();
  const todayStr = now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toDateString();

  const groups = new Map<string, { label: string; items: IntelItem[] }>();

  for (const item of items) {
    const d = new Date(item.publishedAt);
    const ds = d.toDateString();
    let label: string;

    if (ds === todayStr) {
      label = 'Today';
    } else if (ds === yesterdayStr) {
      label = 'Yesterday';
    } else {
      label = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    }

    const key = ds;
    if (!groups.has(key)) {
      groups.set(key, { label, items: [] });
    }
    groups.get(key)!.items.push(item);
  }

  // Sort groups by date (newest first)
  const result = Array.from(groups.values());
  result.sort((a, b) => {
    const dateA = new Date(a.items[0].publishedAt).getTime();
    const dateB = new Date(b.items[0].publishedAt).getTime();
    return dateB - dateA;
  });

  // Sort items within each group based on sort mode
  for (const group of result) {
    if (sortMode === 'top') {
      group.items.sort((a, b) => {
        const scoreA = a.relevanceScore ?? 0;
        const scoreB = b.relevanceScore ?? 0;
        if (scoreA !== scoreB) return scoreB - scoreA;
        return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
      });
    } else {
      group.items.sort((a, b) => {
        return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
      });
    }
  }

  return result;
}

/** Format a brief date for display in saved brief cards. */
function formatBriefDate(date: string, type: 'daily' | 'weekly'): string {
  if (type === 'weekly') {
    const [year, week] = date.split('-W');
    return `Week ${parseInt(week)}, ${year}`;
  }
  return new Date(date + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

/** Format a relative time string from an ISO date. */
function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Saved Briefs section shown in the bookmarks view. */
function SavedBriefsSection({
  pinnedBriefs,
  onClickBrief,
  onUnpin,
}: {
  pinnedBriefs: IntelBrief[];
  onClickBrief: (brief: IntelBrief) => void;
  onUnpin: (id: string) => void;
}) {
  if (pinnedBriefs.length === 0) return null;

  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-4">
        <Brain size={16} className="text-[var(--color-accent)]" />
        <h2 className="font-hud text-sm text-[var(--color-accent)] uppercase tracking-wider">Saved Briefs</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {pinnedBriefs.map((brief) => (
          <button
            key={brief.id}
            type="button"
            onClick={() => onClickBrief(brief)}
            className="cursor-pointer hud-panel rounded-xl p-4 text-left hover:border-[var(--color-border-accent)] transition-all group"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="px-2 py-0.5 text-[10px] rounded-full font-semibold uppercase tracking-wider bg-[var(--color-accent-muted)] text-[var(--color-accent)] border border-[var(--color-border-accent)]">
                {brief.type === 'weekly' ? 'Weekly' : 'Daily'}
              </span>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onUnpin(brief.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation();
                    onUnpin(brief.id);
                  }
                }}
                className="p-1 rounded-lg text-[var(--color-accent)] hover:bg-[var(--color-accent-muted)] transition-colors opacity-60 group-hover:opacity-100"
                title="Unpin brief"
              >
                <Bookmark size={14} className="fill-current" />
              </span>
            </div>
            <p className="text-sm font-medium text-[var(--color-text-primary)] mb-1">
              {formatBriefDate(brief.date, brief.type)}
            </p>
            <p className="text-xs text-[var(--color-text-muted)]">
              {brief.articleCount} article{brief.articleCount !== 1 ? 's' : ''} &middot; Generated{' '}
              {formatRelativeTime(brief.generatedAt)}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function IntelFeedModern() {
  const navigate = useNavigate();
  const [showSourceManager, setShowSourceManager] = useState(false);
  const [showAddArticle, setShowAddArticle] = useState(false);
  const items = useIntelFeedStore((s) => s.items);
  const sources = useIntelFeedStore((s) => s.sources);
  const feeds = useIntelFeedStore((s) => s.feeds);
  const activeFeedId = useIntelFeedStore((s) => s.activeFeedId);
  const dateFilter = useIntelFeedStore((s) => s.dateFilter);
  const loading = useIntelFeedStore((s) => s.loading);
  const fetching = useIntelFeedStore((s) => s.fetching);
  const error = useIntelFeedStore((s) => s.error);
  const loadItems = useIntelFeedStore((s) => s.loadItems);
  const loadSources = useIntelFeedStore((s) => s.loadSources);
  const setDateFilter = useIntelFeedStore((s) => s.setDateFilter);
  const fetchAll = useIntelFeedStore((s) => s.fetchAll);
  const seedDefaults = useIntelFeedStore((s) => s.seedDefaults);
  const markRead = useIntelFeedStore((s) => s.markRead);
  const toggleBookmark = useIntelFeedStore((s) => s.toggleBookmark);
  const brief = useIntelFeedStore((s) => s.brief);
  const briefLoading = useIntelFeedStore((s) => s.briefLoading);
  const briefType = useIntelFeedStore((s) => s.briefType);
  const categoryFilter = useIntelFeedStore((s) => s.categoryFilter);
  const generateBrief = useIntelFeedStore((s) => s.generateBrief);
  const setBriefType = useIntelFeedStore((s) => s.setBriefType);
  const setCategoryFilter = useIntelFeedStore((s) => s.setCategoryFilter);
  const summarizeItem = useIntelFeedStore((s) => s.summarizeItem);
  const readerItem = useIntelFeedStore((s) => s.readerItem);
  const readerContent = useIntelFeedStore((s) => s.readerContent);
  const readerLoading = useIntelFeedStore((s) => s.readerLoading);
  const openReader = useIntelFeedStore((s) => s.openReader);
  const closeReader = useIntelFeedStore((s) => s.closeReader);
  const briefChatMessages = useIntelFeedStore((s) => s.briefChatMessages);
  const briefChatSending = useIntelFeedStore((s) => s.briefChatSending);
  const sendBriefChatMessage = useIntelFeedStore((s) => s.sendBriefChatMessage);
  const clearBriefChat = useIntelFeedStore((s) => s.clearBriefChat);
  const searchQuery = useIntelFeedStore((s) => s.searchQuery);
  const sourceFilter = useIntelFeedStore((s) => s.sourceFilter);
  const bookmarkFilter = useIntelFeedStore((s) => s.bookmarkFilter);
  const viewMode = useIntelFeedStore((s) => s.viewMode);
  const bookmarkCount = useIntelFeedStore((s) => s.bookmarkCount);
  const setSearchQuery = useIntelFeedStore((s) => s.setSearchQuery);
  const setSourceFilter = useIntelFeedStore((s) => s.setSourceFilter);
  const setBookmarkFilter = useIntelFeedStore((s) => s.setBookmarkFilter);
  const setViewMode = useIntelFeedStore((s) => s.setViewMode);
  const clearAllFilters = useIntelFeedStore((s) => s.clearAllFilters);
  const loadTrending = useIntelFeedStore((s) => s.loadTrending);
  const briefItems = useIntelFeedStore((s) => s.briefItems);
  const loadBriefItems = useIntelFeedStore((s) => s.loadBriefItems);
  const briefHistory = useIntelFeedStore((s) => s.briefHistory);
  const toggleBriefPin = useIntelFeedStore((s) => s.toggleBriefPin);
  const loadSpecificBrief = useIntelFeedStore((s) => s.loadSpecificBrief);
  const pinnedBriefs = useIntelFeedStore((s) => s.pinnedBriefs);
  const loadPinnedBriefs = useIntelFeedStore((s) => s.loadPinnedBriefs);
  const sortMode = useIntelFeedStore((s) => s.sortMode);
  const setSortMode = useIntelFeedStore((s) => s.setSortMode);

  // Active feed name for display
  const activeFeedName = activeFeedId ? (feeds.find((f) => f.id === activeFeedId)?.name ?? null) : null;
  const activeFeed = activeFeedId ? feeds.find((f) => f.id === activeFeedId) : null;

  // Local search input + debounce
  const [searchInput, setSearchInput] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Saved brief modal overlay
  const [savedBriefModal, setSavedBriefModal] = useState<IntelBrief | null>(null);

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInput(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setSearchQuery(value);
      }, 300);
    },
    [setSearchQuery],
  );

  const hasActiveFilters = searchQuery !== '' || sourceFilter !== null || (bookmarkFilter && viewMode !== 'bookmarks');

  // --- Action handlers for article cards ---

  const handleSaveAsIdea = async (item: IntelItem) => {
    try {
      const description = [item.summary || item.description || '', '', `Source: ${item.url}`]
        .filter(Boolean)
        .join('\n');

      const idea = await useIdeaStore.getState().createIdea({
        title: item.title,
        description,
        tags: item.category ? [item.category, 'intel-feed'] : ['intel-feed'],
      });
      toast('Idea saved', 'success');
      navigate(`/ideas?openIdea=${idea.id}`);
    } catch (err) {
      toast(`Failed to save idea: ${err}`, 'error');
    }
  };

  const handleStartProject = async (item: IntelItem) => {
    try {
      const description = [
        `Inspired by: ${item.title}`,
        '',
        item.summary || item.description || '',
        '',
        `Source: ${item.url}`,
      ]
        .filter(Boolean)
        .join('\n');

      const project = await useProjectStore.getState().createProject({
        name: item.title.slice(0, 100),
        description,
      });
      toast('Project created', 'success');
      navigate(`/projects/${project.id}`);
    } catch (err) {
      toast(`Failed to create project: ${err}`, 'error');
    }
  };

  const handleDiscuss = async (item: IntelItem) => {
    try {
      const session = await useBrainstormStore.getState().createSession({
        title: `Discuss: ${item.title}`.slice(0, 200),
      });

      const contextMessage = [
        `I'd like to discuss this article:`,
        '',
        `**${item.title}**`,
        `Source: ${item.sourceName} (${item.url})`,
        '',
        item.summary || item.description || 'No description available.',
        '',
        'What are the key implications of this? What opportunities or risks should I be thinking about?',
      ].join('\n');

      useBrainstormStore.getState().setDraftInput(contextMessage);

      toast('Brainstorm started', 'success');
      navigate(`/brainstorm?openSession=${session.id}`);
    } catch (err) {
      toast(`Failed to start discussion: ${err}`, 'error');
    }
  };

  // Load data on mount
  useEffect(() => {
    let cancelled = false;

    async function init() {
      await loadItems();
      await loadSources();
      loadTrending();
      loadBriefItems();
      loadPinnedBriefs();
      useIntelFeedStore.getState().loadFeeds();

      if (cancelled) return;

      const currentSources = useIntelFeedStore.getState().sources;
      if (currentSources.length === 0) {
        await seedDefaults();
        await fetchAll();
      } else {
        // Non-blocking background fetch
        fetchAll();
      }

      // Load existing brief and history
      await useIntelFeedStore.getState().loadBrief();
      useIntelFeedStore.getState().loadBriefHistory();

      if (cancelled) return;

      // Auto-generate brief if none exists and enough articles
      const currentBrief = useIntelFeedStore.getState().brief;
      const currentItems = useIntelFeedStore.getState().items;
      if (!currentBrief && currentItems.length >= 3) {
        // Non-blocking
        useIntelFeedStore.getState().generateBrief();
      }
    }

    init();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load pinned briefs when switching to bookmarks view
  useEffect(() => {
    if (viewMode === 'bookmarks') {
      loadPinnedBriefs();
    }
  }, [viewMode, loadPinnedBriefs]);

  // Compute categories from items
  const categories = useMemo(() => {
    const cats = new Map<string, number>();
    for (const item of items) {
      if (item.category) {
        cats.set(item.category, (cats.get(item.category) || 0) + 1);
      }
    }
    return Array.from(cats.entries()).sort((a, b) => b[1] - a[1]);
  }, [items]);

  // Filter items by category (client-side)
  const filteredItems = useMemo(() => {
    if (!categoryFilter) return items;
    return items.filter((i) => i.category === categoryFilter);
  }, [items, categoryFilter]);

  // Sort items based on sort mode: 'top' = relevance then date, 'recent' = date only
  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      if (sortMode === 'top') {
        const scoreA = a.relevanceScore ?? 0;
        const scoreB = b.relevanceScore ?? 0;
        if (scoreA !== scoreB) return scoreB - scoreA;
      }
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    });
  }, [filteredItems, sortMode]);

  const heroItem = sortedItems.length > 0 ? sortedItems[0] : null;
  const gridItems = sortedItems.slice(1);

  const groupedGridItems = useMemo(() => groupItemsByDate(gridItems, sortMode), [gridItems, sortMode]);

  /** Handle clicking a saved brief card — open in modal overlay. */
  const handleSavedBriefClick = useCallback(
    (clickedBrief: IntelBrief) => {
      loadSpecificBrief(clickedBrief);
      setSavedBriefModal(clickedBrief);
    },
    [loadSpecificBrief],
  );

  /** Handle unpinning a brief from the saved section. */
  const handleUnpinBrief = useCallback(
    async (id: string) => {
      await toggleBriefPin(id);
      await loadPinnedBriefs();
    },
    [toggleBriefPin, loadPinnedBriefs],
  );

  if (loading && items.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-[var(--color-accent)]" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-surface-50/50 dark:bg-surface-950 relative">
      <HudBackground />

      {/* Feed tab bar */}
      <div className="px-8 pt-4 shrink-0">
        <IntelFeedTabs />
      </div>

      {/* Header */}
      <div className="p-8 pb-4 shrink-0">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
          <div>
            <div className="flex items-center gap-4 mb-1">
              <span
                className="font-data text-[0.6875rem] tracking-[0.3em] text-[var(--color-accent)] text-glow"
                aria-hidden="true"
              >
                SYS.INTEL
              </span>
              <div className="h-px w-16 bg-gradient-to-l from-transparent to-[var(--color-accent)] opacity-40" />
            </div>
            <h1 className="font-hud text-2xl text-[var(--color-accent)] text-glow">Intelligence Feed</h1>
            <p className="text-[var(--color-text-secondary)] text-sm mt-1">
              Stay informed with curated news from your sources.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start md:self-auto">
            <FeatureTip.Button id="intel-feed" />
            <button
              onClick={() => setShowAddArticle(true)}
              className="cursor-pointer shrink-0 rounded-xl px-4 py-2.5 font-medium text-sm flex items-center gap-2 border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-accent)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-accent-subtle)] transition-colors"
            >
              <Plus size={16} />
              Add Article
            </button>
            <button
              onClick={() => setShowSourceManager(true)}
              className="cursor-pointer shrink-0 rounded-xl px-4 py-2.5 font-medium text-sm flex items-center gap-2 border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-accent)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-accent-subtle)] transition-colors"
            >
              <SlidersHorizontal size={16} />
              Sources ({sources.length})
            </button>
            <button
              onClick={() => fetchAll(true)}
              disabled={fetching}
              className="cursor-pointer btn-primary shrink-0 rounded-xl px-5 py-2.5 font-medium text-sm flex items-center gap-2 disabled:opacity-50"
            >
              <RefreshCw size={16} className={fetching ? 'animate-spin' : ''} />
              {fetching ? 'Fetching...' : 'Refresh'}
            </button>
          </div>
        </div>

        <FeatureTip id="intel-feed" title="How article ranking works">
          Articles are scored by AI when fetched. Use <strong>Top</strong> sort to see the most significant stories
          first. Add specific interests in{' '}
          <button
            onClick={() => navigate('/settings?tab=intel')}
            className="cursor-pointer text-[var(--color-accent)] hover:underline"
          >
            Settings &rarr; Intel Feed
          </button>{' '}
          to personalize scores — specific topics like &quot;AI agents&quot; or &quot;local LLMs&quot; work better than
          broad terms. Project names are included automatically.
        </FeatureTip>

        {/* View toggle: Feed / Saved */}
        <div className="flex items-center gap-3 mt-3 mb-1">
          <div className="flex rounded-lg border border-[var(--color-border)] overflow-hidden">
            <button
              onClick={() => setViewMode('feed')}
              className={`cursor-pointer px-4 py-1.5 text-xs font-medium transition-all whitespace-nowrap flex items-center gap-1.5 ${
                viewMode === 'feed'
                  ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)] border-[var(--color-border-accent)]'
                  : 'bg-[var(--color-chrome)] text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-subtle)]'
              }`}
            >
              <Newspaper size={13} />
              Feed
            </button>
            <button
              onClick={() => setViewMode('bookmarks')}
              className={`cursor-pointer px-4 py-1.5 text-xs font-medium transition-all whitespace-nowrap flex items-center gap-1.5 ${
                viewMode === 'bookmarks'
                  ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)] border-[var(--color-border-accent)]'
                  : 'bg-[var(--color-chrome)] text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-subtle)]'
              }`}
            >
              <Bookmark size={13} className={viewMode === 'bookmarks' ? 'fill-current' : ''} />
              Saved
              {bookmarkCount + pinnedBriefs.length > 0 && (
                <span
                  className={`ml-0.5 px-1.5 py-px text-[10px] rounded-full font-semibold leading-tight ${
                    viewMode === 'bookmarks'
                      ? 'bg-[var(--color-accent)] text-white'
                      : 'bg-[var(--color-border)] text-[var(--color-text-muted)]'
                  }`}
                >
                  {bookmarkCount + pinnedBriefs.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Filters row: date tabs + article count + category pills */}
        <div className="flex items-center gap-3 flex-wrap mt-2">
          <div className="flex rounded-lg border border-[var(--color-border)] overflow-hidden">
            {DATE_FILTER_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setDateFilter(tab.value)}
                className={`cursor-pointer px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap ${
                  dateFilter === tab.value
                    ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)] border-[var(--color-border-accent)]'
                    : 'bg-[var(--color-chrome)] text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-subtle)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <span className="text-xs font-data text-[var(--color-text-muted)]">
            {filteredItems.length} article{filteredItems.length !== 1 ? 's' : ''}
          </span>

          {/* Sort toggle: Top / Recent */}
          <div className="flex rounded-lg border border-[var(--color-border)] overflow-hidden">
            <button
              onClick={() => setSortMode('top')}
              className={`cursor-pointer px-3 py-1 text-[11px] font-medium transition-all whitespace-nowrap ${
                sortMode === 'top'
                  ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)] border-[var(--color-border-accent)]'
                  : 'bg-[var(--color-chrome)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              Top
            </button>
            <button
              onClick={() => setSortMode('recent')}
              className={`cursor-pointer px-3 py-1 text-[11px] font-medium transition-all whitespace-nowrap ${
                sortMode === 'recent'
                  ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)] border-[var(--color-border-accent)]'
                  : 'bg-[var(--color-chrome)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              Recent
            </button>
          </div>

          {/* Category pills inline */}
          {categories.length > 0 && (
            <>
              <div className="h-4 w-px bg-[var(--color-border)]" />
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setCategoryFilter(null)}
                  className={`cursor-pointer px-2.5 py-0.5 text-[11px] rounded-full border transition-colors ${
                    !categoryFilter
                      ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)] border-[var(--color-border-accent)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
                  }`}
                >
                  All
                </button>
                {categories.map(([cat, count]) => (
                  <button
                    key={cat}
                    onClick={() => setCategoryFilter(cat)}
                    className={`cursor-pointer px-2.5 py-0.5 text-[11px] rounded-full border transition-colors ${
                      categoryFilter === cat
                        ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)] border-[var(--color-border-accent)]'
                        : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
                    }`}
                  >
                    {cat} ({count})
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Search & Filter Bar */}
        <div className="flex items-center gap-2 flex-wrap mt-3">
          {/* Search input */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none"
            />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search articles..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-chrome)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-border-accent)] transition-colors"
            />
          </div>

          {/* Source dropdown */}
          <select
            value={sourceFilter ?? ''}
            onChange={(e) => setSourceFilter(e.target.value || null)}
            aria-label="Filter by source"
            className="cursor-pointer px-3 py-1.5 text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-chrome)] text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-border-accent)] transition-colors"
          >
            <option value="">All Sources</option>
            {sources
              .filter((s) => s.type !== 'manual')
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>

          {/* Bookmark toggle — hidden in bookmarks view since the view toggle handles it */}
          {viewMode !== 'bookmarks' && (
            <button
              onClick={() => setBookmarkFilter(!bookmarkFilter)}
              className={`cursor-pointer flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                bookmarkFilter
                  ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)] border-[var(--color-border-accent)]'
                  : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:border-[var(--color-border-accent)]'
              }`}
            >
              <Bookmark size={13} className={bookmarkFilter ? 'fill-current' : ''} />
              Bookmarked
            </button>
          )}

          {/* Clear filters */}
          {hasActiveFilters && (
            <button
              onClick={() => {
                setSearchInput('');
                clearAllFilters();
              }}
              className="cursor-pointer flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-red-400 hover:border-red-400/40 transition-colors"
            >
              <X size={13} />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="px-8 mb-4">
          <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        </div>
      )}

      {/* Feed Content */}
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        {/* Brief Panel — only in feed view */}
        {viewMode === 'feed' && (
          <IntelBriefPanel
            brief={brief}
            briefType={briefType}
            loading={briefLoading}
            onGenerate={generateBrief}
            onSetType={setBriefType}
            chatMessages={briefChatMessages}
            chatSending={briefChatSending}
            onSendChat={sendBriefChatMessage}
            onClearChat={clearBriefChat}
            items={briefItems}
            onOpenArticle={openReader}
            briefHistory={briefHistory}
            onTogglePin={toggleBriefPin}
            onLoadBrief={loadSpecificBrief}
            feedName={activeFeedName}
          />
        )}

        {/* Saved Briefs — shown at top of bookmarks view when pinned briefs exist */}
        {viewMode === 'bookmarks' && pinnedBriefs.length > 0 && (
          <SavedBriefsSection
            pinnedBriefs={pinnedBriefs}
            onClickBrief={handleSavedBriefClick}
            onUnpin={handleUnpinBrief}
          />
        )}

        {viewMode === 'bookmarks' && items.length === 0 ? (
          pinnedBriefs.length === 0 ? (
            /* Bookmarks empty state — no articles and no pinned briefs */
            <div className="mt-12 flex flex-col items-center justify-center text-center">
              <div className="w-14 h-14 rounded-2xl bg-[var(--color-accent-muted)] flex items-center justify-center mb-4">
                <Bookmark size={28} className="text-[var(--color-accent)]" />
              </div>
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">No saved articles yet</h2>
              <p className="text-sm text-[var(--color-text-secondary)] max-w-sm">
                Bookmark articles from the feed to save them here for later reading.
              </p>
              <button
                onClick={() => setViewMode('feed')}
                className="cursor-pointer mt-4 px-4 py-2 text-sm font-medium rounded-lg bg-[var(--color-accent-muted)] text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] transition-colors"
              >
                Browse Feed
              </button>
            </div>
          ) : (
            /* Has pinned briefs above but no bookmarked articles */
            <div className="py-8 flex flex-col items-center text-center">
              <p className="text-sm text-[var(--color-text-muted)]">No bookmarked articles yet</p>
              <p className="text-xs text-[var(--color-text-muted)] opacity-60 mt-1">
                Bookmark articles from the feed to save them here for later reading.
              </p>
            </div>
          )
        ) : activeFeedId && items.length === 0 && activeFeed?.sourceCount === 0 && viewMode !== 'bookmarks' ? (
          /* Feed-specific empty state: no sources assigned */
          <div className="mt-12 flex flex-col items-center justify-center text-center">
            <div className="w-14 h-14 rounded-2xl bg-[var(--color-accent-muted)] flex items-center justify-center mb-4">
              <SlidersHorizontal size={28} className="text-[var(--color-accent)]" />
            </div>
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">No sources assigned</h2>
            <p className="text-sm text-[var(--color-text-secondary)] max-w-sm">
              No sources assigned to this feed. Open the source manager to add some.
            </p>
            <button
              onClick={() => setShowSourceManager(true)}
              className="cursor-pointer mt-4 px-5 py-2.5 text-sm font-medium rounded-lg bg-[var(--color-accent-muted)] text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] transition-colors flex items-center gap-2"
            >
              <SlidersHorizontal size={16} />
              Manage Sources
            </button>
          </div>
        ) : items.length === 0 && viewMode !== 'bookmarks' ? (
          <div className="mt-12">
            <EmptyFeatureState
              icon={Newspaper}
              title="No articles yet"
              description="Add RSS sources or fetch the latest news to get started."
              benefits={[
                'Stay updated on AI developments',
                'Curate your own news sources',
                'Browse articles right from your dashboard',
              ]}
              ctaLabel="Fetch Latest News"
              ctaAction={() => fetchAll()}
            />
          </div>
        ) : items.length > 0 ? (
          <div className="space-y-6">
            {/* Hero Card — only in feed view */}
            {viewMode === 'feed' && heroItem && (
              <IntelHeroCard
                item={heroItem}
                onMarkRead={markRead}
                onToggleBookmark={toggleBookmark}
                onSummarize={summarizeItem}
                onSaveAsIdea={handleSaveAsIdea}
                onStartProject={handleStartProject}
                onDiscuss={handleDiscuss}
                onOpenReader={openReader}
              />
            )}

            {/* Grid of articles, grouped by date */}
            {(viewMode === 'bookmarks' ? groupItemsByDate(sortedItems, sortMode) : groupedGridItems).map((group) => (
              <div key={group.label}>
                {/* Date Header */}
                <div className="flex items-center gap-3 mb-3">
                  <h2 className="font-hud text-xs tracking-[0.2em] text-[var(--color-accent-dim)] uppercase whitespace-nowrap">
                    {group.label}
                  </h2>
                  <div className="h-px flex-1 bg-[var(--color-border)] opacity-40" />
                </div>

                {/* Responsive Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {group.items.map((item) => (
                    <IntelItemCard
                      key={item.id}
                      item={item}
                      variant="grid"
                      onMarkRead={markRead}
                      onToggleBookmark={toggleBookmark}
                      onSummarize={summarizeItem}
                      onSaveAsIdea={handleSaveAsIdea}
                      onStartProject={handleStartProject}
                      onDiscuss={handleDiscuss}
                      onOpenReader={openReader}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* Source Manager Panel */}
      <IntelSourceManager isOpen={showSourceManager} onClose={() => setShowSourceManager(false)} />

      {/* Add Article Modal */}
      <IntelAddArticleModal isOpen={showAddArticle} onClose={() => setShowAddArticle(false)} />

      {/* Article Reader */}
      {readerItem && (
        <IntelArticleReader
          item={readerItem}
          content={readerContent}
          loading={readerLoading}
          onClose={closeReader}
          onSaveAsIdea={handleSaveAsIdea}
          onStartProject={handleStartProject}
          onDiscuss={handleDiscuss}
          onToggleBookmark={toggleBookmark}
        />
      )}

      {/* Saved Brief Modal */}
      {savedBriefModal && (
        <SavedBriefModal
          brief={savedBriefModal}
          onClose={() => setSavedBriefModal(null)}
          onUnpin={async (id) => {
            await handleUnpinBrief(id);
            setSavedBriefModal(null);
          }}
          items={briefItems.length > 0 ? briefItems : items}
          onOpenArticle={openReader}
          chatMessages={briefChatMessages}
          chatSending={briefChatSending}
          onSendChat={sendBriefChatMessage}
          onClearChat={clearBriefChat}
        />
      )}
    </div>
  );
}
