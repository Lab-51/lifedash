// === FILE PURPOSE ===
// Source management panel for the Intelligence Feed. Displays all feed sources
// with toggle controls, delete actions, and an "Add RSS Feed" button.
// Renders as a slide-out overlay panel from the right side.

import { useState, useEffect, useCallback } from 'react';
import { X, Trash2, Rss, Plus, Loader2 } from 'lucide-react';
import { ConfirmDialog } from './ConfirmDialog';
import IntelAddSourceModal from './IntelAddSourceModal';
import { useIntelFeedStore } from '../stores/intelFeedStore';
import type { IntelSource } from '../../shared/types';

interface IntelSourceManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function IntelSourceManager({ isOpen, onClose }: IntelSourceManagerProps) {
  const sources = useIntelFeedStore((s) => s.sources);
  const loadSources = useIntelFeedStore((s) => s.loadSources);
  const loadItems = useIntelFeedStore((s) => s.loadItems);
  const updateSource = useIntelFeedStore((s) => s.updateSource);
  const deleteSource = useIntelFeedStore((s) => s.deleteSource);

  const [showAddSource, setShowAddSource] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteSource, setConfirmDeleteSource] = useState<IntelSource | null>(null);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());

  // Reload sources when panel opens
  useEffect(() => {
    if (isOpen) {
      loadSources();
    }
  }, [isOpen, loadSources]);

  // Escape key closes panel
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, handleEscape]);

  if (!isOpen) return null;

  const handleToggle = async (source: IntelSource) => {
    setTogglingIds((prev) => new Set(prev).add(source.id));
    try {
      await updateSource(source.id, { enabled: !source.enabled });
      await loadSources();
      await loadItems();
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(source.id);
        return next;
      });
    }
  };

  const handleDeleteConfirm = async () => {
    if (!confirmDeleteSource) return;
    const id = confirmDeleteSource.id;
    setDeletingId(id);
    setConfirmDeleteSource(null);
    try {
      await deleteSource(id);
      await loadItems();
      await loadSources();
    } finally {
      setDeletingId(null);
    }
  };

  const rssSources = sources.filter((s) => s.type === 'rss');
  const manualSources = sources.filter((s) => s.type === 'manual');

  return (
    <>
      {/* Overlay backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-[var(--color-chrome)] border-l border-[var(--color-border)] shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3 shrink-0">
          <div className="flex items-center gap-2">
            <div className="node-point-sm" />
            <h2 className="font-hud text-sm tracking-wide text-[var(--color-text-primary)]">Manage Sources</h2>
            <span className="text-xs font-data text-[var(--color-text-muted)] ml-1">({sources.length})</span>
          </div>
          <button
            onClick={onClose}
            className="cursor-pointer text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] p-1.5 rounded-lg hover:bg-[var(--color-accent-subtle)] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="ruled-line-accent mx-6" />

        {/* Action buttons */}
        <div className="flex items-center gap-2 px-6 py-3 shrink-0">
          <button
            onClick={() => setShowAddSource(true)}
            className="cursor-pointer btn-primary flex-1 rounded-lg px-4 py-2 text-sm font-medium flex items-center justify-center gap-2"
          >
            <Rss size={14} />
            Add RSS Feed
          </button>
        </div>

        {/* Source list */}
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {sources.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Rss size={32} className="text-[var(--color-text-muted)] mb-3 opacity-40" />
              <p className="text-sm text-[var(--color-text-secondary)]">No sources added yet.</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                Add an RSS feed to start receiving articles.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {/* RSS sources */}
              {rssSources.length > 0 && (
                <>
                  <div className="flex items-center gap-2 mt-2 mb-2">
                    <span className="font-hud text-[0.625rem] text-[var(--color-accent-dim)] tracking-widest uppercase">
                      RSS Feeds
                    </span>
                    <div className="h-px flex-1 bg-[var(--color-border)] opacity-40" />
                  </div>
                  {rssSources.map((source) => (
                    <SourceRow
                      key={source.id}
                      source={source}
                      toggling={togglingIds.has(source.id)}
                      deleting={deletingId === source.id}
                      onToggle={() => handleToggle(source)}
                      onDelete={() => setConfirmDeleteSource(source)}
                    />
                  ))}
                </>
              )}

              {/* Manual sources */}
              {manualSources.length > 0 && (
                <>
                  <div className="flex items-center gap-2 mt-4 mb-2">
                    <span className="font-hud text-[0.625rem] text-[var(--color-accent-dim)] tracking-widest uppercase">
                      Manual
                    </span>
                    <div className="h-px flex-1 bg-[var(--color-border)] opacity-40" />
                  </div>
                  {manualSources.map((source) => (
                    <SourceRow
                      key={source.id}
                      source={source}
                      toggling={togglingIds.has(source.id)}
                      deleting={deletingId === source.id}
                      onToggle={() => handleToggle(source)}
                      onDelete={() => setConfirmDeleteSource(source)}
                    />
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Add Source modal (managed internally) */}
      <IntelAddSourceModal isOpen={showAddSource} onClose={() => setShowAddSource(false)} />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!confirmDeleteSource}
        title="Delete Source"
        message={`Remove "${confirmDeleteSource?.name}" and all its articles? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setConfirmDeleteSource(null)}
      />
    </>
  );
}

// === Source Row Component ===

interface SourceRowProps {
  source: IntelSource;
  toggling: boolean;
  deleting: boolean;
  onToggle: () => void;
  onDelete: () => void;
}

function SourceRow({ source, toggling, deleting, onToggle, onDelete }: SourceRowProps) {
  return (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
        source.enabled
          ? 'border-[var(--color-border)] bg-[var(--color-surface-elevated)]/50'
          : 'border-[var(--color-border)] bg-[var(--color-chrome)] opacity-60'
      }`}
    >
      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">{source.name}</span>
          <span
            className={`text-[0.625rem] font-data tracking-wider uppercase px-1.5 py-0.5 rounded ${
              source.type === 'rss'
                ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20'
                : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
            }`}
          >
            {source.type}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
          <span>
            {source.itemCount} article{source.itemCount !== 1 ? 's' : ''}
          </span>
          <span className="truncate max-w-[200px]" title={source.url}>
            {source.url}
          </span>
        </div>
      </div>

      {/* Toggle */}
      <button
        onClick={onToggle}
        disabled={toggling}
        className="cursor-pointer shrink-0 relative"
        title={source.enabled ? 'Disable source' : 'Enable source'}
      >
        <div
          className={`w-9 h-5 rounded-full transition-colors ${
            source.enabled ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]'
          }`}
        >
          <div
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
              source.enabled ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </div>
      </button>

      {/* Delete */}
      <button
        onClick={onDelete}
        disabled={deleting}
        className="cursor-pointer shrink-0 p-1.5 text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-40"
        title="Delete source"
      >
        {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
      </button>
    </div>
  );
}
