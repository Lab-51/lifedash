// === FILE PURPOSE ===
// Modal dialog for manually adding a single article by URL to the Intelligence Feed.
// Accepts URL (required), optional title, and optional description.

import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Loader2, Plus } from 'lucide-react';
import { useIntelFeedStore } from '../stores/intelFeedStore';

interface IntelAddArticleModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function IntelAddArticleModal({ isOpen, onClose }: IntelAddArticleModalProps) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const urlInputRef = useRef<HTMLInputElement>(null);

  const addManualItem = useIntelFeedStore((s) => s.addManualItem);
  const loadItems = useIntelFeedStore((s) => s.loadItems);

  // Auto-focus URL input on open
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => urlInputRef.current?.focus(), 80);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Reset form state when modal opens
  useEffect(() => {
    if (isOpen) {
      setUrl('');
      setTitle('');
      setDescription('');
      setError(null);
      setSubmitting(false);
    }
  }, [isOpen]);

  // Escape key closes modal
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

  // All hooks above — early return below
  if (!isOpen) return null;

  const handleSubmit = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl || submitting) return;

    try {
      new URL(trimmedUrl);
    } catch {
      setError('Please enter a valid URL.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await addManualItem({
        url: trimmedUrl,
        title: title.trim() || undefined,
        description: description.trim() || undefined,
      });
      await loadItems();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add article. Check the URL and try again.');
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[var(--color-chrome)] border border-[var(--color-border)] rounded-xl shadow-2xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <div className="flex items-center gap-2">
            <Plus size={16} className="text-[var(--color-accent)]" />
            <h2 className="font-hud text-sm tracking-wide text-[var(--color-text-primary)]">Add Article</h2>
          </div>
          <button
            onClick={onClose}
            className="cursor-pointer text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] p-1.5 rounded-lg hover:bg-[var(--color-accent-subtle)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="ruled-line-accent mx-6" />

        {/* Form */}
        <div className="px-6 py-4 space-y-4">
          <div className="flex flex-col gap-1.5">
            <label className="font-hud text-[0.625rem] text-[var(--color-accent-dim)] tracking-widest uppercase">
              Article URL
            </label>
            <input
              ref={urlInputRef}
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="https://example.com/article"
              className="w-full text-sm bg-surface-50/50 dark:bg-surface-950/30 border border-[var(--color-border)] hover:border-[var(--color-border-accent)] rounded-lg px-3 py-2 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)] focus:ring-1 focus:ring-[var(--color-accent-dim)]/50 transition-colors"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-hud text-[0.625rem] text-[var(--color-accent-dim)] tracking-widest uppercase">
              Title (optional)
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Article title"
              className="w-full text-sm bg-surface-50/50 dark:bg-surface-950/30 border border-[var(--color-border)] hover:border-[var(--color-border-accent)] rounded-lg px-3 py-2 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)] focus:ring-1 focus:ring-[var(--color-accent-dim)]/50 transition-colors"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-hud text-[0.625rem] text-[var(--color-accent-dim)] tracking-widest uppercase">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description"
              rows={3}
              className="w-full text-sm bg-surface-50/50 dark:bg-surface-950/30 border border-[var(--color-border)] hover:border-[var(--color-border-accent)] rounded-lg px-3 py-2 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] resize-none focus:outline-none focus:border-[var(--color-accent-dim)] focus:ring-1 focus:ring-[var(--color-accent-dim)]/50 transition-colors"
            />
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 pb-5 pt-1">
          <button
            onClick={onClose}
            className="cursor-pointer px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-subtle)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!url.trim() || submitting}
            className="cursor-pointer btn-primary px-5 py-2 text-sm rounded-lg font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Add Article
          </button>
        </div>
      </div>
    </div>
  );
}
