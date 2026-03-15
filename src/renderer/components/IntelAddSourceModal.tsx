// === FILE PURPOSE ===
// Modal dialog for adding a new RSS feed source to the Intelligence Feed.
// Validates URL input, creates the source via the store, and triggers a fetch.

import { useState, useRef, useEffect } from 'react';
import { X, Loader2, Rss } from 'lucide-react';
import FocusTrap from './FocusTrap';
import { useIntelFeedStore } from '../stores/intelFeedStore';

interface IntelAddSourceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function IntelAddSourceModal({ isOpen, onClose }: IntelAddSourceModalProps) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const urlInputRef = useRef<HTMLInputElement>(null);

  const createSource = useIntelFeedStore(s => s.createSource);
  const fetchAll = useIntelFeedStore(s => s.fetchAll);
  const loadSources = useIntelFeedStore(s => s.loadSources);

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
      setName('');
      setError(null);
      setSubmitting(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl || submitting) return;

    // Basic URL validation
    try {
      new URL(trimmedUrl);
    } catch {
      setError('Please enter a valid URL.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await createSource({
        url: trimmedUrl,
        name: name.trim() || trimmedUrl,
        type: 'rss',
      });
      // Fetch articles from the new source
      fetchAll();
      await loadSources();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add source. Check the URL and try again.');
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Skip Escape deactivation when typing in inputs
  const escapeDeactivates = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT') return false;
    return true;
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-[2px]" onClick={onClose}>
      <FocusTrap active={isOpen} onDeactivate={onClose} clickOutsideDeactivates={false} escapeDeactivates={escapeDeactivates}>
        <div
          className="bg-[var(--color-chrome)] border border-[var(--color-border)] rounded-xl shadow-2xl w-full max-w-md mx-4"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-5 pb-3">
            <div className="flex items-center gap-2">
              <Rss size={16} className="text-[var(--color-accent)]" />
              <h2 className="font-hud text-sm tracking-wide text-[var(--color-text-primary)]">
                Add RSS Feed
              </h2>
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
                Feed URL
              </label>
              <input
                ref={urlInputRef}
                type="url"
                value={url}
                onChange={e => setUrl(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="https://example.com/feed.xml"
                className="w-full text-sm bg-surface-50/50 dark:bg-surface-950/30 border border-[var(--color-border)] hover:border-[var(--color-border-accent)] rounded-lg px-3 py-2 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)] focus:ring-1 focus:ring-[var(--color-accent-dim)]/50 transition-colors"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="font-hud text-[0.625rem] text-[var(--color-accent-dim)] tracking-widest uppercase">
                Name (optional)
              </label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Source name"
                className="w-full text-sm bg-surface-50/50 dark:bg-surface-950/30 border border-[var(--color-border)] hover:border-[var(--color-border-accent)] rounded-lg px-3 py-2 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)] focus:ring-1 focus:ring-[var(--color-accent-dim)]/50 transition-colors"
              />
            </div>

            {/* Error */}
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
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Rss size={14} />}
              Add Source
            </button>
          </div>
        </div>
      </FocusTrap>
    </div>
  );
}
