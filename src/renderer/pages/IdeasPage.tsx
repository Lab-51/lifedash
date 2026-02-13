// === FILE PURPOSE ===
// Ideas page — displays the idea repository with quick-add form, status filter
// tabs, search, and idea cards in a grid layout. Entry point for idea management.
//
// === DEPENDENCIES ===
// react (useEffect, useState), react-router-dom (useNavigate),
// lucide-react icons, ideaStore, shared types

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lightbulb, Plus, Search, X, Zap, Target, Loader2 } from 'lucide-react';
import { useIdeaStore } from '../stores/ideaStore';
import type { IdeaStatus } from '../../shared/types';

import IdeaDetailModal from '../components/IdeaDetailModal';

const FILTER_TABS: { label: string; value: IdeaStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'New', value: 'new' },
  { label: 'Exploring', value: 'exploring' },
  { label: 'Active', value: 'active' },
  { label: 'Archived', value: 'archived' },
];

const STATUS_COLORS: Record<IdeaStatus, string> = {
  new: 'bg-blue-500/20 text-blue-400',
  exploring: 'bg-amber-500/20 text-amber-400',
  active: 'bg-emerald-500/20 text-emerald-400',
  archived: 'bg-surface-600/50 text-surface-400',
};

function IdeasPage() {
  const navigate = useNavigate();
  const { ideas, loading, error, loadIdeas, createIdea } = useIdeaStore();
  const [filter, setFilter] = useState<IdeaStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(null);

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

  // Full-page loading state when no ideas have been loaded yet
  if (loading && ideas.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-surface-100">Ideas</h1>
        <p className="mt-1 text-surface-400">
          Capture and organize your ideas in one place.
        </p>
      </div>

      {/* Quick-add form */}
      <form onSubmit={handleQuickAdd} className="flex items-center gap-2 mb-6">
        <input
          type="text"
          placeholder="What's your idea?"
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          className="bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-surface-200 placeholder:text-surface-500 focus:outline-none focus:border-primary-500 flex-1"
        />
        <button
          type="submit"
          disabled={newTitle.trim() === '' || creating}
          className="bg-primary-600 hover:bg-primary-500 text-white text-sm font-medium rounded-lg px-4 py-2 flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {creating ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Plus size={14} />
          )}
          Add Idea
        </button>
      </form>

      {/* Error state */}
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Filter tabs + Search */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-1">
          {FILTER_TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => setFilter(tab.value)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                filter === tab.value
                  ? 'bg-surface-700 text-surface-100'
                  : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Search input */}
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-500" />
          <input
            type="text"
            placeholder="Search ideas..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="bg-surface-800 border border-surface-700 rounded-lg pl-8 pr-8 py-1.5 text-sm text-surface-200 placeholder:text-surface-500 focus:outline-none focus:border-primary-500 w-48"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-surface-500 hover:text-surface-300"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Result count when searching */}
      {searchQuery.trim() && filteredIdeas.length > 0 && (
        <p className="text-xs text-surface-500 mb-2">
          {filteredIdeas.length} result{filteredIdeas.length !== 1 ? 's' : ''}
        </p>
      )}

      {/* Idea cards grid or empty state */}
      {filteredIdeas.length === 0 ? (
        <div className="mt-12 flex flex-col items-center justify-center text-surface-500">
          {searchQuery.trim() ? (
            <>
              <Search size={48} className="mb-4 text-surface-600" />
              <p className="text-lg">No matching ideas</p>
              <p className="text-sm text-surface-500 mt-1">
                Try a different search term
              </p>
            </>
          ) : filter !== 'all' ? (
            <>
              <Lightbulb size={48} className="mb-4 text-surface-600" />
              <p className="text-lg">No {filter} ideas</p>
              <p className="text-sm text-surface-500 mt-1">
                Try a different filter
              </p>
            </>
          ) : (
            <>
              <Lightbulb size={48} className="mb-4 text-surface-600" />
              <p className="text-lg">No ideas yet</p>
              <p className="text-sm text-surface-500 mt-1">
                Add your first idea above
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredIdeas.map(idea => (
            <div
              key={idea.id}
              onClick={() => setSelectedIdeaId(idea.id)}
              className="bg-surface-800 border border-surface-700 rounded-xl p-4 cursor-pointer hover:border-surface-600 transition-colors"
            >
              {/* Title */}
              <h3 className="text-sm font-medium text-surface-100 line-clamp-2">
                {idea.title}
              </h3>

              {/* Description preview */}
              {idea.description && (
                <p className="text-xs text-surface-400 line-clamp-2 mt-1">
                  {idea.description}
                </p>
              )}

              {/* Tags */}
              {idea.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {idea.tags.map(tag => (
                    <span
                      key={tag}
                      className="bg-surface-700 text-surface-300 text-xs px-2 py-0.5 rounded-full"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Bottom row: status + effort + impact */}
              <div className="flex items-center gap-2 mt-3">
                <span
                  className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[idea.status]}`}
                >
                  {idea.status.charAt(0).toUpperCase() + idea.status.slice(1)}
                </span>

                {idea.effort && (
                  <span className="flex items-center gap-0.5 text-xs text-surface-500">
                    <Zap size={10} />
                    {idea.effort}
                  </span>
                )}

                {idea.impact && (
                  <span className="flex items-center gap-0.5 text-xs text-surface-500">
                    <Target size={10} />
                    {idea.impact}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedIdeaId && (
        <IdeaDetailModal
          ideaId={selectedIdeaId}
          onClose={() => { setSelectedIdeaId(null); loadIdeas(); }}
          onNavigate={(path) => navigate(path)}
        />
      )}
    </div>
  );
}

export default IdeasPage;
