// === FILE PURPOSE ===
// Slide-in reader panel for viewing full article content within the Intel Feed.
// Displays article HTML from Readability.js with a sticky header, AI summary,
// and an action toolbar for saving ideas, starting projects, or discussing with AI.

import { useEffect } from 'react';
import {
  ArrowLeft,
  Star,
  ExternalLink,
  Lightbulb,
  FolderKanban,
  Brain,
} from 'lucide-react';
import type { IntelItem, ArticleContent } from '../../shared/types';

const CATEGORY_COLORS: Record<string, string> = {
  'Model Releases': 'text-blue-400 bg-blue-400/10 border-blue-400/20',
  'Research & Papers': 'text-purple-400 bg-purple-400/10 border-purple-400/20',
  'Developer Tools': 'text-green-400 bg-green-400/10 border-green-400/20',
  'Policy & Regulation': 'text-amber-400 bg-amber-400/10 border-amber-400/20',
  'Industry News': 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20',
  'Startups & Funding': 'text-pink-400 bg-pink-400/10 border-pink-400/20',
  'Open Source': 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  'Tutorials & Guides': 'text-orange-400 bg-orange-400/10 border-orange-400/20',
  'Other': 'text-gray-400 bg-gray-400/10 border-gray-400/20',
};

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

const readerStyles = `
  .intel-reader-content h1 { font-size: 1.5rem; font-weight: 700; margin: 1.5rem 0 0.75rem; color: var(--color-text-primary); }
  .intel-reader-content h2 { font-size: 1.25rem; font-weight: 600; margin: 1.25rem 0 0.5rem; color: var(--color-text-primary); }
  .intel-reader-content h3 { font-size: 1.1rem; font-weight: 600; margin: 1rem 0 0.5rem; color: var(--color-text-primary); }
  .intel-reader-content p { margin: 0.75rem 0; line-height: 1.8; }
  .intel-reader-content a { color: var(--color-accent); text-decoration: underline; }
  .intel-reader-content a:hover { opacity: 0.8; }
  .intel-reader-content ul, .intel-reader-content ol { padding-left: 1.5rem; margin: 0.75rem 0; }
  .intel-reader-content li { margin: 0.35rem 0; line-height: 1.7; }
  .intel-reader-content blockquote { border-left: 3px solid var(--color-accent); padding-left: 1rem; margin: 1rem 0; opacity: 0.85; font-style: italic; }
  .intel-reader-content img { max-width: 100%; height: auto; border-radius: 0.5rem; margin: 1rem 0; }
  .intel-reader-content pre { background: var(--color-surface-elevated); padding: 1rem; border-radius: 0.5rem; overflow-x: auto; margin: 1rem 0; font-size: 0.85rem; }
  .intel-reader-content code { background: var(--color-surface-elevated); padding: 0.15rem 0.35rem; border-radius: 0.25rem; font-size: 0.9em; }
  .intel-reader-content figure { margin: 1rem 0; }
  .intel-reader-content figcaption { text-align: center; font-size: 0.8rem; color: var(--color-text-muted); margin-top: 0.5rem; }
  .intel-reader-content table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
  .intel-reader-content th, .intel-reader-content td { border: 1px solid var(--color-border); padding: 0.5rem; text-align: left; }

  @keyframes slideInRight {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
  }
  .animate-slide-in-right {
    animation: slideInRight 0.2s ease-out;
  }
`;

interface IntelArticleReaderProps {
  item: IntelItem;
  content: ArticleContent | null;
  loading: boolean;
  onClose: () => void;
  onSaveAsIdea: (item: IntelItem) => void;
  onStartProject: (item: IntelItem) => void;
  onDiscuss: (item: IntelItem) => void;
  onToggleBookmark: (id: string) => void;
}

const actionBtnClass =
  'cursor-pointer flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-accent)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] transition-colors';

export default function IntelArticleReader({
  item,
  content,
  loading,
  onClose,
  onSaveAsIdea,
  onStartProject,
  onDiscuss,
  onToggleBookmark,
}: IntelArticleReaderProps) {
  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const categoryStyle = item.category
    ? CATEGORY_COLORS[item.category] || CATEGORY_COLORS['Other']
    : null;

  return (
    <>
      <style>{readerStyles}</style>
      <div className="fixed inset-0 z-50 flex">
        {/* Overlay */}
        <div
          className="flex-1 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        />

        {/* Reader Panel */}
        <div className="w-full max-w-2xl bg-[var(--color-chrome)] border-l border-[var(--color-border)] flex flex-col animate-slide-in-right">
          {/* Sticky Header */}
          <div className="shrink-0 bg-[var(--color-chrome)] border-b border-[var(--color-border)] px-6 py-4 flex items-center gap-3">
            <button
              onClick={onClose}
              className="cursor-pointer shrink-0 p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-accent-subtle)] transition-colors"
              title="Back"
            >
              <ArrowLeft size={18} />
            </button>
            <h2 className="flex-1 font-hud text-sm text-[var(--color-text-primary)] line-clamp-1">
              {item.title}
            </h2>
            <button
              onClick={() => onToggleBookmark(item.id)}
              className={`cursor-pointer shrink-0 p-1.5 rounded-lg transition-colors ${
                item.isBookmarked
                  ? 'text-amber-400 hover:text-amber-300'
                  : 'text-[var(--color-text-muted)] hover:text-amber-400'
              }`}
              title={item.isBookmarked ? 'Remove bookmark' : 'Bookmark'}
            >
              <Star size={16} fill={item.isBookmarked ? 'currentColor' : 'none'} />
            </button>
            <button
              onClick={() => window.electronAPI.openExternal(item.url)}
              className="cursor-pointer shrink-0 p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
              title="Open in browser"
            >
              <ExternalLink size={16} />
            </button>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto px-6 py-6">
            {/* Metadata */}
            <div className="flex items-center flex-wrap gap-2 text-xs text-[var(--color-text-muted)] mb-4">
              {categoryStyle && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${categoryStyle}`}>
                  {item.category}
                </span>
              )}
              <span className="text-[var(--color-accent-dim)]">{item.sourceName}</span>
              <span className="opacity-40">|</span>
              <span>{relativeTime(item.publishedAt)}</span>
              {content?.byline && (
                <>
                  <span className="opacity-40">|</span>
                  <span>{content.byline}</span>
                </>
              )}
              {content && content.length > 0 && (
                <>
                  <span className="opacity-40">|</span>
                  <span>{Math.ceil(content.length / 200)} min read</span>
                </>
              )}
            </div>

            {/* AI Summary box */}
            {item.summary && (
              <div className="mb-6 p-4 rounded-xl border-l-2 border-l-[var(--color-accent)] bg-[var(--color-accent-subtle)]">
                <div className="text-[10px] uppercase tracking-wider text-[var(--color-accent)] font-data mb-1">
                  AI Summary
                </div>
                <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                  {item.summary}
                </p>
              </div>
            )}

            {/* Loading skeleton */}
            {loading && (
              <div className="space-y-4">
                {[...Array(8)].map((_, i) => (
                  <div
                    key={i}
                    className="h-4 bg-[var(--color-border)] rounded animate-pulse"
                    style={{ width: `${60 + Math.random() * 40}%` }}
                  />
                ))}
              </div>
            )}

            {/* Article content */}
            {!loading && content && content.length > 0 && (
              <div
                className="intel-reader-content text-sm text-[var(--color-text-secondary)] leading-relaxed"
                dangerouslySetInnerHTML={{ __html: content.content }}
              />
            )}

            {/* Fallback when content could not be loaded */}
            {!loading && content && content.length === 0 && (
              <div className="mt-4 p-4 rounded-xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] text-center">
                <p className="text-sm text-[var(--color-text-muted)] mb-3">
                  Could not load full article content.
                </p>
                <button
                  onClick={() => window.electronAPI.openExternal(item.url)}
                  className="cursor-pointer text-sm text-[var(--color-accent)] hover:underline"
                >
                  Open in Browser
                </button>
              </div>
            )}
          </div>

          {/* Sticky Action Toolbar */}
          <div className="shrink-0 bg-[var(--color-chrome)] border-t border-[var(--color-border)] px-6 py-3 flex flex-wrap gap-2">
            <button
              onClick={() => { onSaveAsIdea(item); onClose(); }}
              className={actionBtnClass}
            >
              <Lightbulb size={14} /> Save as Idea
            </button>
            <button
              onClick={() => { onStartProject(item); onClose(); }}
              className={actionBtnClass}
            >
              <FolderKanban size={14} /> Start Project
            </button>
            <button
              onClick={() => { onDiscuss(item); onClose(); }}
              className={actionBtnClass}
            >
              <Brain size={14} /> Discuss with AI
            </button>
            <button
              onClick={() => window.electronAPI.openExternal(item.url)}
              className={`${actionBtnClass} ml-auto`}
            >
              <ExternalLink size={14} /> Open in Browser
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
