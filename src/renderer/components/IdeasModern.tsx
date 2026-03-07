// === FILE PURPOSE ===
// Ideas page — Modern Design
// Displays the idea repository with a fresh, modern grid layout and enhanced visuals.

import { useState, useEffect, lazy, Suspense } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Lightbulb, Plus, Search, X, Zap, Target, Loader2, Tag, ArrowRight, ArrowDownWideNarrow } from 'lucide-react';
import EmptyFeatureState from './EmptyFeatureState';
import { useIdeaStore } from '../stores/ideaStore';
import HudSelect from '../components/HudSelect';
import type { IdeaStatus } from '../../shared/types';

import HudBackground from './HudBackground';

const IdeaDetailModal = lazy(() => import('../components/IdeaDetailModal'));

const FILTER_TABS: { label: string; value: IdeaStatus | 'all' }[] = [
    { label: 'All', value: 'all' },
    { label: 'New', value: 'new' },
    { label: 'Exploring', value: 'exploring' },
    { label: 'Active', value: 'active' },
    { label: 'Archived', value: 'archived' },
];

const STATUS_COLORS_MODERN: Record<IdeaStatus, string> = {
    new: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-900',
    exploring: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-900',
    active: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900',
    archived: 'bg-surface-200/50 text-surface-600 dark:text-surface-400 border-surface-200 dark:border-surface-800',
};

export default function IdeasModern() {
    const navigate = useNavigate();
    const ideas = useIdeaStore(s => s.ideas);
    const loading = useIdeaStore(s => s.loading);
    const error = useIdeaStore(s => s.error);
    const loadIdeas = useIdeaStore(s => s.loadIdeas);
    const [filter, setFilter] = useState<IdeaStatus | 'all'>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'title'>('newest');
    const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [searchParams, setSearchParams] = useSearchParams();

    // Open idea from URL search param (e.g. ?openIdea=<id> from dashboard deep-link)
    useEffect(() => {
        const openIdeaId = searchParams.get('openIdea');
        if (openIdeaId && !loading && ideas.length > 0) {
            setSelectedIdeaId(openIdeaId);
            searchParams.delete('openIdea');
            setSearchParams(searchParams, { replace: true });
        }
    }, [searchParams, setSearchParams, loading, ideas.length]);

    // Handle ?action=create — open create modal directly
    useEffect(() => {
        if (searchParams.get('action') === 'create') {
            searchParams.delete('action');
            setSearchParams(searchParams, { replace: true });
            setShowCreateModal(true);
        }
    }, [searchParams, setSearchParams]);

    // Load ideas on mount
    useEffect(() => {
        loadIdeas();
    }, [loadIdeas]);

    // Filter ideas by status and search query
    const filteredIdeas = ideas.filter(idea => {
        if (filter !== 'all' && idea.status !== filter) return false;
        if (searchQuery.trim()) {
            const query = searchQuery.trim().toLowerCase();
            const matchesTitle = idea.title.toLowerCase().includes(query);
            const matchesTags = idea.tags.some(t => t.includes(query));
            if (!matchesTitle && !matchesTags) return false;
        }
        return true;
    });

    // Sort filtered ideas
    const sortedIdeas = [...filteredIdeas].sort((a, b) => {
        if (sortBy === 'newest') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        if (sortBy === 'oldest') return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        return a.title.localeCompare(b.title);
    });

    if (loading && ideas.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <Loader2 size={32} className="animate-spin text-[var(--color-accent)]" />
            </div>
        );
    }

    // Whether any modal is open
    const isModalOpen = showCreateModal || selectedIdeaId !== null;

    return (
        <div className="h-full flex flex-col bg-surface-50/50 dark:bg-surface-950 relative">
            <HudBackground />
            {/* HUD Header */}
            <div className="p-8 pb-4 shrink-0">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
                    <div>
                        <div className="flex items-center gap-4 mb-1">
                            <span className="font-data text-[0.6875rem] tracking-[0.3em] text-[var(--color-accent)] text-glow">SYS.IDEAS</span>
                            <div className="h-px w-16 bg-gradient-to-l from-transparent to-[var(--color-accent)] opacity-40" />
                        </div>
                        <h1 className="font-hud text-2xl text-[var(--color-accent)] text-glow">Ideas</h1>
                        <p className="text-[var(--color-text-secondary)] text-sm mt-1">Capture, refine, and track your flashes of brilliance.</p>
                    </div>
                    <button
                        onClick={() => setShowCreateModal(true)}
                        className="btn-primary shrink-0 rounded-xl px-5 py-2.5 font-medium text-sm flex items-center gap-2 self-start md:self-auto"
                    >
                        <Plus size={16} />
                        Add Idea
                    </button>
                </div>

                <div className="mb-6" />
                {/* Filters & Search Toolbar */}
                <div className="flex hud-panel p-1.5 rounded-xl items-center gap-2 mb-2">

                    <div className="flex rounded-lg border border-[var(--color-border)] overflow-hidden">
                        {FILTER_TABS.map((tab) => (
                            <button
                                key={tab.value}
                                onClick={() => setFilter(tab.value)}
                                className={`px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap ${filter === tab.value
                                        ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)] border-[var(--color-border-accent)]'
                                        : 'bg-[var(--color-chrome)] text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-subtle)]'
                                    }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    <div className="h-6 w-px bg-[var(--color-border)] mx-1" />

                    <div className="relative flex-1">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                        <input
                            type="text"
                            placeholder="Search ideas..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="w-full pl-8 pr-8 py-1.5 text-sm bg-transparent border-none focus:ring-0 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)]"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
                            >
                                <X size={12} />
                            </button>
                        )}
                    </div>

                    <div className="h-6 w-px bg-[var(--color-border)] mx-1" />

                    <div className="w-28">
                        <HudSelect
                            value={sortBy}
                            onChange={(v) => setSortBy(v as typeof sortBy)}
                            options={[
                                { value: 'newest', label: 'Newest' },
                                { value: 'oldest', label: 'Oldest' },
                                { value: 'title', label: 'A-Z' },
                            ]}
                            icon={ArrowDownWideNarrow}
                            compact
                        />
                    </div>
                </div>
            </div>

            {error && (
                <div className="px-8 mb-4">
                    <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm">
                        {error}
                    </div>
                </div>
            )}

            {/* Grid Content */}
            <div className="flex-1 overflow-y-auto px-8 pb-8">
                {sortedIdeas.length === 0 ? (
                    (searchQuery || filter !== 'all') ? (
                        <div className="mt-12 flex flex-col items-center justify-center text-center">
                            <div className="w-20 h-20 bg-[var(--color-accent-subtle)] rounded-full flex items-center justify-center mb-6 border border-[var(--color-border-accent)]">
                                <Lightbulb size={32} className="text-[var(--color-accent-dim)]" />
                            </div>
                            <h3 className="text-xl font-medium text-[var(--color-text-primary)] mb-2">
                                {searchQuery ? 'No matching ideas found' : `No ${filter} ideas found`}
                            </h3>
                            <p className="text-[var(--color-text-secondary)] max-w-xs mx-auto">
                                {searchQuery ? 'Try adjusting your search terms.' : 'Try a different filter to see more ideas.'}
                            </p>
                        </div>
                    ) : (
                        <div className="mt-12">
                            <EmptyFeatureState
                                icon={Lightbulb}
                                title="Capture every spark"
                                description="Jot down ideas as they come — tag them, rate them, and turn the best ones into real projects."
                                benefits={['Quick capture — never lose an idea', 'AI helps assess feasibility', 'Convert ideas to project cards']}
                                ctaLabel="Add Your First Idea"
                                ctaAction={() => setShowCreateModal(true)}
                            />
                        </div>
                    )
                ) : (
                    <div className="columns-1 md:columns-2 xl:columns-3 gap-6 space-y-6">
                        {sortedIdeas.map(idea => (
                            <div
                                key={idea.id}
                                onClick={() => setSelectedIdeaId(idea.id)}
                                className="break-inside-avoid group hud-panel clip-corner-cut-sm p-5 hover:shadow-lg hover:!border-[var(--color-border-accent)] transition-all cursor-pointer flex flex-col items-start"
                            >
                                <div className="flex justify-between items-start w-full gap-4 mb-2">
                                    <h3 className="text-base font-bold text-[var(--color-text-primary)] leading-snug group-hover:text-[var(--color-accent)] transition-colors">
                                        {idea.title}
                                    </h3>
                                    <button className="opacity-0 group-hover:opacity-100 text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-opacity">
                                        <ArrowRight size={16} />
                                    </button>
                                </div>

                                {idea.description && (
                                    <p className="text-sm text-surface-500 line-clamp-3 mb-4">
                                        {idea.description}
                                    </p>
                                )}

                                <div className="w-full mt-2 flex flex-wrap items-center gap-2">
                                    <span className={`text-[0.625rem] font-bold uppercase tracking-wider px-2 py-1 rounded-md border ${STATUS_COLORS_MODERN[idea.status]}`}>
                                        {idea.status}
                                    </span>

                                    {idea.tags.map(tag => (
                                        <span key={tag} className="flex items-center gap-1 text-[0.625rem] font-medium text-[var(--color-accent-dim)] bg-[var(--color-accent-subtle)] border border-[var(--color-border-accent)] px-2 py-1 rounded-md">
                                            <Tag size={10} /> {tag}
                                        </span>
                                    ))}
                                </div>

                                {(idea.effort || idea.impact) && (
                                    <div className="w-full pt-3 mt-3 border-t border-surface-100 dark:border-surface-800 flex items-center gap-4">
                                        {idea.effort && (
                                            <div className="flex items-center gap-1.5 text-xs text-surface-500" title="Effort">
                                                <Zap size={12} className="text-amber-500" />
                                                <span>{idea.effort}</span>
                                            </div>
                                        )}
                                        {idea.impact && (
                                            <div className="flex items-center gap-1.5 text-xs text-surface-500" title="Impact">
                                                <Target size={12} className="text-[var(--color-accent)]" />
                                                <span>{idea.impact}</span>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <Suspense fallback={null}>
                {isModalOpen && (
                    <IdeaDetailModal
                        ideaId={showCreateModal ? null : selectedIdeaId}
                        onClose={() => {
                            setSelectedIdeaId(null);
                            setShowCreateModal(false);
                            loadIdeas();
                        }}
                        onNavigate={(path) => navigate(path)}
                    />
                )}
            </Suspense>
        </div>
    );
}
