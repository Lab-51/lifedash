// === FILE PURPOSE ===
// Ideas page — Modern Design
// Displays the idea repository with a fresh, modern grid layout and enhanced visuals.

import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Lightbulb, Plus, Search, X, Zap, Target, Loader2, Sparkles, Tag, ArrowRight } from 'lucide-react';
import { useIdeaStore } from '../stores/ideaStore';
import type { IdeaStatus } from '../../shared/types';

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
    const createIdea = useIdeaStore(s => s.createIdea);
    const [filter, setFilter] = useState<IdeaStatus | 'all'>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'title'>('newest');
    const [newTitle, setNewTitle] = useState('');
    const [creating, setCreating] = useState(false);
    const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(null);
    const [searchParams, setSearchParams] = useSearchParams();
    const quickAddInputRef = useRef<HTMLInputElement>(null);

    // Open idea from URL search param (e.g. ?openIdea=<id> from dashboard deep-link)
    useEffect(() => {
        const openIdeaId = searchParams.get('openIdea');
        if (openIdeaId && !loading && ideas.length > 0) {
            setSelectedIdeaId(openIdeaId);
            searchParams.delete('openIdea');
            setSearchParams(searchParams, { replace: true });
        }
    }, [searchParams, setSearchParams, loading, ideas.length]);

    // Handle ?action=create — auto-focus the quick-add input
    useEffect(() => {
        if (searchParams.get('action') === 'create') {
            searchParams.delete('action');
            setSearchParams(searchParams, { replace: true });
            // Focus with a short delay to ensure the input is rendered
            setTimeout(() => quickAddInputRef.current?.focus(), 50);
        }
    }, [searchParams, setSearchParams]);

    // Load ideas on mount
    useEffect(() => {
        loadIdeas();
    }, [loadIdeas]);

    // Quick-add submit handler
    const handleQuickAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (newTitle.trim() === '' || creating) return;
        setCreating(true);
        try {
            await createIdea({ title: newTitle.trim() });
            setNewTitle('');
        } finally {
            setCreating(false);
        }
    };

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
                <Loader2 size={32} className="animate-spin text-primary-500" />
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-surface-50/50 dark:bg-surface-950">
            {/* HUD Header */}
            <div className="p-8 pb-4 shrink-0">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
                    <div>
                        <div className="flex items-center gap-4 mb-1">
                            <div className="h-px w-16 bg-gradient-to-r from-transparent to-[var(--color-accent)] opacity-40" />
                            <span className="font-data text-[11px] tracking-[0.3em] text-[var(--color-accent)] text-glow">SYS.IDEAS</span>
                            <div className="h-px w-16 bg-gradient-to-l from-transparent to-[var(--color-accent)] opacity-40" />
                        </div>
                        <h1 className="font-hud text-2xl text-[var(--color-accent)] text-glow">Ideas</h1>
                        <p className="text-[var(--color-text-secondary)] text-sm mt-1">Capture, refine, and track your flashes of brilliance.</p>
                    </div>
                </div>
                <div className="ruled-line-accent mb-6" />

                {/* Quick Add Bar - Floating Style */}
                <div className="mb-8">
                    <form onSubmit={handleQuickAdd} className="relative group">
                        <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                            <Sparkles size={18} className="text-primary-500" />
                        </div>
                        <input
                            ref={quickAddInputRef}
                            type="text"
                            placeholder="Capture a new idea..."
                            value={newTitle}
                            onChange={e => setNewTitle(e.target.value)}
                            className="w-full hud-panel rounded-2xl pl-12 pr-32 py-4 text-lg text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:!border-[var(--color-accent)] transition-all"
                        />
                        <button
                            type="submit"
                            disabled={newTitle.trim() === '' || creating}
                            className="absolute right-2 top-2 bottom-2 btn-primary clip-corner-cut-sm px-4 font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                            <span className="hidden sm:inline">Add Idea</span>
                        </button>
                    </form>
                </div>

                {/* Filters & Search Toolbar */}
                <div className="flex hud-panel p-1.5 rounded-xl items-center gap-2 mb-2">

                    <div className="flex p-1 bg-surface-100 dark:bg-surface-800 rounded-lg overflow-x-auto no-scrollbar">
                        {FILTER_TABS.map((tab) => (
                            <button
                                key={tab.value}
                                onClick={() => setFilter(tab.value)}
                                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap ${filter === tab.value
                                        ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-surface-100 shadow-sm'
                                        : 'text-surface-500 hover:text-surface-700 dark:hover:text-surface-300'
                                    }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    <div className="h-6 w-px bg-surface-200 dark:bg-surface-700 mx-1" />

                    <div className="relative flex-1">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-400" />
                        <input
                            type="text"
                            placeholder="Search ideas..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="w-full pl-8 pr-8 py-1.5 text-sm bg-transparent border-none focus:ring-0 text-surface-900 dark:text-surface-100 placeholder-surface-400"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-600"
                            >
                                <X size={12} />
                            </button>
                        )}
                    </div>

                    <div className="h-6 w-px bg-surface-200 dark:bg-surface-700 mx-1" />

                    <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                        className="bg-transparent text-xs font-medium text-surface-600 dark:text-surface-400 border-none focus:ring-0 cursor-pointer pr-8"
                    >
                        <option value="newest">Newest</option>
                        <option value="oldest">Oldest</option>
                        <option value="title">A-Z</option>
                    </select>
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
                    <div className="mt-12 flex flex-col items-center justify-center text-center">
                        <div className="w-20 h-20 bg-amber-50 dark:bg-amber-900/20 rounded-full flex items-center justify-center mb-6">
                            <Lightbulb size={32} className="text-amber-500" />
                        </div>
                        <h3 className="text-xl font-medium text-surface-900 dark:text-surface-100 mb-2">
                            {searchQuery ? 'No matching ideas found' : (filter !== 'all' ? `No ${filter} ideas found` : 'Your idea bank is empty')}
                        </h3>
                        <p className="text-surface-500 max-w-xs mx-auto">
                            {searchQuery ? 'Try adjusting your search terms.' : 'Great things start small. Capture any thought, no matter how wild.'}
                        </p>
                    </div>
                ) : (
                    <div className="columns-1 md:columns-2 xl:columns-3 gap-6 space-y-6">
                        {/* Masonry-like layout using columns */}
                        {sortedIdeas.map(idea => (
                            <div
                                key={idea.id}
                                onClick={() => setSelectedIdeaId(idea.id)}
                                className="break-inside-avoid group hud-panel clip-corner-cut-sm corner-brackets p-5 hover:shadow-lg hover:!border-[var(--color-border-accent)] transition-all cursor-pointer flex flex-col items-start"
                            >
                                <div className="flex justify-between items-start w-full gap-4 mb-2">
                                    <h3 className="text-base font-bold text-[var(--color-text-primary)] leading-snug group-hover:text-[var(--color-accent)] transition-colors">
                                        {idea.title}
                                    </h3>
                                    <button className="opacity-0 group-hover:opacity-100 text-surface-400 hover:text-primary-500 transition-opacity">
                                        <ArrowRight size={16} />
                                    </button>
                                </div>

                                {idea.description && (
                                    <p className="text-sm text-surface-500 line-clamp-3 mb-4">
                                        {idea.description}
                                    </p>
                                )}

                                <div className="w-full mt-2 flex flex-wrap items-center gap-2">
                                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border ${STATUS_COLORS_MODERN[idea.status]}`}>
                                        {idea.status}
                                    </span>

                                    {idea.tags.map(tag => (
                                        <span key={tag} className="flex items-center gap-1 text-[10px] font-medium text-[var(--color-accent-dim)] bg-[var(--color-accent-subtle)] border border-[var(--color-border-accent)] px-2 py-1 rounded-md">
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
                                                <Target size={12} className="text-primary-500" />
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
                {selectedIdeaId && (
                    <IdeaDetailModal
                        ideaId={selectedIdeaId}
                        onClose={() => { setSelectedIdeaId(null); loadIdeas(); }}
                        onNavigate={(path) => navigate(path)}
                    />
                )}
            </Suspense>
        </div>
    );
}
