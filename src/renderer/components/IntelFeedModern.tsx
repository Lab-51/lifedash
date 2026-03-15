// === FILE PURPOSE ===
// Intelligence Feed main view — magazine-style layout with a hero card
// for the top-relevance article and a responsive grid for remaining items,
// grouped by date with relevance-based sorting within each group.

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Newspaper, Loader2, Plus, SlidersHorizontal } from 'lucide-react';
import HudBackground from './HudBackground';
import EmptyFeatureState from './EmptyFeatureState';
import IntelItemCard from './IntelItemCard';
import IntelHeroCard from './IntelHeroCard';
import IntelBriefPanel from './IntelBriefPanel';
import IntelSourceManager from './IntelSourceManager';
import IntelAddArticleModal from './IntelAddArticleModal';
import IntelArticleReader from './IntelArticleReader';
import { useIntelFeedStore } from '../stores/intelFeedStore';
import { useProjectStore } from '../stores/projectStore';
import { useIdeaStore } from '../stores/ideaStore';
import { useBrainstormStore } from '../stores/brainstormStore';
import { toast } from '../hooks/useToast';
import type { IntelItem, IntelDateFilter } from '../../shared/types';

const DATE_FILTER_TABS: { label: string; value: IntelDateFilter }[] = [
  { label: 'Today', value: 'today' },
  { label: 'This Week', value: 'week' },
  { label: 'All', value: 'all' },
];

/** Group items by date header: "Today", "Yesterday", or formatted date. */
function groupItemsByDate(items: IntelItem[]): { label: string; items: IntelItem[] }[] {
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

  // Sort groups by date (newest first), items within each group by relevance then date
  const result = Array.from(groups.values());
  result.sort((a, b) => {
    const dateA = new Date(a.items[0].publishedAt).getTime();
    const dateB = new Date(b.items[0].publishedAt).getTime();
    return dateB - dateA;
  });

  for (const group of result) {
    group.items.sort((a, b) => {
      const scoreA = a.relevanceScore ?? 0;
      const scoreB = b.relevanceScore ?? 0;
      if (scoreA !== scoreB) return scoreB - scoreA;
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    });
  }

  return result;
}

export default function IntelFeedModern() {
  const navigate = useNavigate();
  const [showSourceManager, setShowSourceManager] = useState(false);
  const [showAddArticle, setShowAddArticle] = useState(false);

  const items = useIntelFeedStore(s => s.items);
  const sources = useIntelFeedStore(s => s.sources);
  const dateFilter = useIntelFeedStore(s => s.dateFilter);
  const loading = useIntelFeedStore(s => s.loading);
  const fetching = useIntelFeedStore(s => s.fetching);
  const error = useIntelFeedStore(s => s.error);
  const loadItems = useIntelFeedStore(s => s.loadItems);
  const loadSources = useIntelFeedStore(s => s.loadSources);
  const setDateFilter = useIntelFeedStore(s => s.setDateFilter);
  const fetchAll = useIntelFeedStore(s => s.fetchAll);
  const seedDefaults = useIntelFeedStore(s => s.seedDefaults);
  const markRead = useIntelFeedStore(s => s.markRead);
  const toggleBookmark = useIntelFeedStore(s => s.toggleBookmark);
  const brief = useIntelFeedStore(s => s.brief);
  const briefLoading = useIntelFeedStore(s => s.briefLoading);
  const briefType = useIntelFeedStore(s => s.briefType);
  const categoryFilter = useIntelFeedStore(s => s.categoryFilter);
  const generateBrief = useIntelFeedStore(s => s.generateBrief);
  const setBriefType = useIntelFeedStore(s => s.setBriefType);
  const setCategoryFilter = useIntelFeedStore(s => s.setCategoryFilter);
  const summarizeItem = useIntelFeedStore(s => s.summarizeItem);
  const readerItem = useIntelFeedStore(s => s.readerItem);
  const readerContent = useIntelFeedStore(s => s.readerContent);
  const readerLoading = useIntelFeedStore(s => s.readerLoading);
  const openReader = useIntelFeedStore(s => s.openReader);
  const closeReader = useIntelFeedStore(s => s.closeReader);
  const briefChatMessages = useIntelFeedStore(s => s.briefChatMessages);
  const briefChatSending = useIntelFeedStore(s => s.briefChatSending);
  const sendBriefChatMessage = useIntelFeedStore(s => s.sendBriefChatMessage);
  const clearBriefChat = useIntelFeedStore(s => s.clearBriefChat);

  // --- Action handlers for article cards ---

  const handleSaveAsIdea = async (item: IntelItem) => {
    try {
      const description = [
        item.summary || item.description || '',
        '',
        `Source: ${item.url}`,
      ].filter(Boolean).join('\n');

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
      ].filter(Boolean).join('\n');

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

      if (cancelled) return;

      const currentSources = useIntelFeedStore.getState().sources;
      if (currentSources.length === 0) {
        await seedDefaults();
        await fetchAll();
      } else {
        // Non-blocking background fetch
        fetchAll();
      }

      // Load existing brief
      await useIntelFeedStore.getState().loadBrief();

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
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    return items.filter(i => i.category === categoryFilter);
  }, [items, categoryFilter]);

  // Sort by relevance, then by date
  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      const scoreA = a.relevanceScore ?? 0;
      const scoreB = b.relevanceScore ?? 0;
      if (scoreA !== scoreB) return scoreB - scoreA;
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    });
  }, [filteredItems]);

  const heroItem = sortedItems.length > 0 ? sortedItems[0] : null;
  const gridItems = sortedItems.slice(1);

  const groupedGridItems = useMemo(() => groupItemsByDate(gridItems), [gridItems]);

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

      {/* Header */}
      <div className="p-8 pb-4 shrink-0">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
          <div>
            <div className="flex items-center gap-4 mb-1">
              <span className="font-data text-[0.6875rem] tracking-[0.3em] text-[var(--color-accent)] text-glow">
                SYS.INTEL
              </span>
              <div className="h-px w-16 bg-gradient-to-l from-transparent to-[var(--color-accent)] opacity-40" />
            </div>
            <h1 className="font-hud text-2xl text-[var(--color-accent)] text-glow">
              Intelligence Feed
            </h1>
            <p className="text-[var(--color-text-secondary)] text-sm mt-1">
              Stay informed with curated news from your sources.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start md:self-auto">
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
              onClick={() => fetchAll()}
              disabled={fetching}
              className="cursor-pointer btn-primary shrink-0 rounded-xl px-5 py-2.5 font-medium text-sm flex items-center gap-2 disabled:opacity-50"
            >
              <RefreshCw size={16} className={fetching ? 'animate-spin' : ''} />
              {fetching ? 'Fetching...' : 'Refresh'}
            </button>
          </div>
        </div>

        <div className="mb-6" />

        {/* Date Filter Tabs */}
        <div className="flex hud-panel p-1.5 rounded-xl items-center gap-2 mb-2">
          <div className="flex rounded-lg border border-[var(--color-border)] overflow-hidden">
            {DATE_FILTER_TABS.map(tab => (
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

          <div className="h-6 w-px bg-[var(--color-border)] mx-1" />

          <span className="text-xs font-data text-[var(--color-text-muted)]">
            {filteredItems.length} article{filteredItems.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Category Filter Pills */}
        {categories.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            <button
              onClick={() => setCategoryFilter(null)}
              className={`cursor-pointer px-2.5 py-1 text-xs rounded-full border transition-colors ${
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
                className={`cursor-pointer px-2.5 py-1 text-xs rounded-full border transition-colors ${
                  categoryFilter === cat
                    ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)] border-[var(--color-border-accent)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
                }`}
              >
                {cat} ({count})
              </button>
            ))}
          </div>
        )}
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
        {/* Brief Panel */}
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
        />

        {items.length === 0 ? (
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
        ) : (
          <div className="space-y-6">
            {/* Hero Card */}
            {heroItem && (
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

            {/* Grid of remaining articles, grouped by date */}
            {groupedGridItems.map(group => (
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
                  {group.items.map(item => (
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
        )}
      </div>

      {/* Source Manager Panel */}
      <IntelSourceManager
        isOpen={showSourceManager}
        onClose={() => setShowSourceManager(false)}
      />

      {/* Add Article Modal */}
      <IntelAddArticleModal
        isOpen={showAddArticle}
        onClose={() => setShowAddArticle(false)}
      />

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
    </div>
  );
}
