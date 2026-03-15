// === FILE PURPOSE ===
// Slide-in reader panel for viewing full article content within the Intel Feed.
// Displays article HTML from Readability.js with a sticky header, AI summary,
// and an action toolbar for saving ideas, starting projects, or discussing with AI.

import { useMemo, useEffect } from 'react';
import DOMPurify from 'dompurify';
import { ArrowLeft, Star, ExternalLink, Lightbulb, FolderKanban, Brain, Clock } from 'lucide-react';
import type { IntelItem, ArticleContent } from '../../shared/types';

/** Sanitize untrusted HTML for safe rendering via dangerouslySetInnerHTML. */
function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: [
      'p',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'a',
      'img',
      'ul',
      'ol',
      'li',
      'blockquote',
      'pre',
      'code',
      'em',
      'strong',
      'b',
      'i',
      'br',
      'hr',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'figure',
      'figcaption',
      'span',
      'div',
      'sup',
      'sub',
      'dl',
      'dt',
      'dd',
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id', 'target', 'width', 'height', 'style'],
    ALLOW_DATA_ATTR: false,
    FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover'],
  });
}

const CATEGORY_COLORS: Record<string, string> = {
  'Model Releases': 'text-blue-400 bg-blue-400/10 border-blue-400/20',
  'Research & Papers': 'text-purple-400 bg-purple-400/10 border-purple-400/20',
  'Developer Tools': 'text-green-400 bg-green-400/10 border-green-400/20',
  'Policy & Regulation': 'text-amber-400 bg-amber-400/10 border-amber-400/20',
  'Industry News': 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20',
  'Startups & Funding': 'text-pink-400 bg-pink-400/10 border-pink-400/20',
  'Open Source': 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  'Tutorials & Guides': 'text-orange-400 bg-orange-400/10 border-orange-400/20',
  Other: 'text-gray-400 bg-gray-400/10 border-gray-400/20',
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

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// Reader-mode typography styles — optimized for comfortable reading
const readerStyles = `
  .intel-reader-content {
    font-size: 1rem;
    line-height: 1.9;
    color: var(--color-text-secondary);
  }

  .intel-reader-content h1 {
    font-size: 1.6rem;
    font-weight: 700;
    margin: 2rem 0 1rem;
    color: var(--color-text-primary);
    line-height: 1.3;
  }
  .intel-reader-content h2 {
    font-size: 1.35rem;
    font-weight: 600;
    margin: 1.75rem 0 0.75rem;
    color: var(--color-text-primary);
    line-height: 1.35;
  }
  .intel-reader-content h3 {
    font-size: 1.15rem;
    font-weight: 600;
    margin: 1.5rem 0 0.5rem;
    color: var(--color-text-primary);
    line-height: 1.4;
  }

  .intel-reader-content p {
    margin: 1rem 0;
    line-height: 1.9;
  }

  .intel-reader-content a {
    color: var(--color-accent);
    text-decoration: underline;
    text-underline-offset: 3px;
    text-decoration-thickness: 1px;
    transition: opacity 0.15s;
  }
  .intel-reader-content a:hover { opacity: 0.75; }

  .intel-reader-content ul,
  .intel-reader-content ol {
    padding-left: 1.75rem;
    margin: 1rem 0;
  }
  .intel-reader-content li {
    margin: 0.5rem 0;
    line-height: 1.8;
  }
  .intel-reader-content li::marker {
    color: var(--color-accent-dim);
  }

  .intel-reader-content blockquote {
    border-left: 3px solid var(--color-accent);
    padding: 0.75rem 1.25rem;
    margin: 1.25rem 0;
    background: var(--color-accent-subtle);
    border-radius: 0 8px 8px 0;
    font-style: italic;
    color: var(--color-text-secondary);
  }

  .intel-reader-content img {
    max-width: 100%;
    height: auto;
    border-radius: 10px;
    margin: 1.5rem 0;
    border: 1px solid var(--color-border);
  }

  .intel-reader-content pre {
    background: var(--color-surface-elevated);
    padding: 1.25rem;
    border-radius: 10px;
    overflow-x: auto;
    margin: 1.25rem 0;
    font-size: 0.875rem;
    line-height: 1.6;
    border: 1px solid var(--color-border);
  }
  .intel-reader-content code {
    background: var(--color-surface-elevated);
    padding: 0.2rem 0.45rem;
    border-radius: 4px;
    font-size: 0.875em;
    border: 1px solid var(--color-border);
  }
  .intel-reader-content pre code {
    background: none;
    padding: 0;
    border: none;
    border-radius: 0;
    font-size: inherit;
  }

  .intel-reader-content figure {
    margin: 1.5rem 0;
  }
  .intel-reader-content figcaption {
    text-align: center;
    font-size: 0.85rem;
    color: var(--color-text-muted);
    margin-top: 0.5rem;
    font-style: italic;
  }

  .intel-reader-content table {
    width: 100%;
    border-collapse: collapse;
    margin: 1.25rem 0;
    font-size: 0.9rem;
  }
  .intel-reader-content th {
    border: 1px solid var(--color-border);
    padding: 0.65rem 0.75rem;
    text-align: left;
    background: var(--color-surface-elevated);
    color: var(--color-text-primary);
    font-weight: 600;
  }
  .intel-reader-content td {
    border: 1px solid var(--color-border);
    padding: 0.65rem 0.75rem;
    text-align: left;
  }

  .intel-reader-content hr {
    border: none;
    border-top: 1px solid var(--color-border);
    margin: 2rem 0;
  }

  .intel-reader-content strong {
    color: var(--color-text-primary);
    font-weight: 600;
  }

  .intel-reader-content em {
    color: var(--color-text-secondary);
  }

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
  'cursor-pointer flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-accent)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] transition-colors';

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

  const categoryStyle = item.category ? CATEGORY_COLORS[item.category] || CATEGORY_COLORS['Other'] : null;

  const readingTime = content && content.length > 0 ? Math.max(1, Math.ceil(content.length / 200)) : null;

  // Sanitize article HTML once when content changes
  const sanitizedContent = useMemo(() => (content?.content ? sanitizeHtml(content.content) : ''), [content]);

  return (
    <>
      <style>{readerStyles}</style>
      <div className="fixed inset-0 z-50 flex">
        {/* Overlay */}
        <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={onClose} />

        {/* Reader Panel */}
        <div className="w-full max-w-[720px] bg-[var(--color-chrome)] border-l border-[var(--color-border)] flex flex-col animate-slide-in-right">
          {/* Sticky Header */}
          <div className="shrink-0 bg-[var(--color-chrome)] border-b border-[var(--color-border)] px-6 py-3 flex items-center gap-3">
            <button
              onClick={onClose}
              className="cursor-pointer shrink-0 p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-accent-subtle)] transition-colors"
              title="Back"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="flex-1 min-w-0">
              <span className="text-xs font-data text-[var(--color-accent-dim)] truncate block">{item.sourceName}</span>
            </div>
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
          <div className="flex-1 overflow-y-auto">
            {/* Article header area */}
            <div className="px-8 pt-8 pb-4">
              {/* Category + reading time */}
              <div className="flex items-center gap-2 mb-4">
                {categoryStyle && (
                  <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${categoryStyle}`}>
                    {item.category}
                  </span>
                )}
                {readingTime && (
                  <span className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
                    <Clock size={12} />
                    {readingTime} min read
                  </span>
                )}
              </div>

              {/* Title */}
              <h1 className="text-2xl font-bold text-[var(--color-text-primary)] leading-tight mb-4">{item.title}</h1>

              {/* Author + date + source */}
              <div className="flex items-center gap-3 text-sm text-[var(--color-text-muted)] mb-6">
                {item.sourceIconUrl && <img src={item.sourceIconUrl} alt="" className="w-5 h-5 rounded-sm" />}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[var(--color-text-secondary)] font-medium">{item.sourceName}</span>
                  {content?.byline && (
                    <>
                      <span className="opacity-30">·</span>
                      <span>{content.byline}</span>
                    </>
                  )}
                  <span className="opacity-30">·</span>
                  <span>{formatDate(item.publishedAt)}</span>
                  <span className="opacity-30">·</span>
                  <span>{relativeTime(item.publishedAt)}</span>
                </div>
              </div>

              {/* Divider */}
              <div className="h-px bg-gradient-to-r from-[var(--color-accent)] via-[var(--color-border)] to-transparent opacity-40 mb-6" />

              {/* AI Summary box */}
              {item.summary && (
                <div className="mb-8 p-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-accent-subtle)]/50 relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-1 h-full bg-[var(--color-accent)]" />
                  <div className="text-[11px] uppercase tracking-widest text-[var(--color-accent)] font-data mb-2 pl-3">
                    AI Summary
                  </div>
                  <p className="text-[0.95rem] text-[var(--color-text-secondary)] leading-relaxed pl-3">
                    {item.summary}
                  </p>
                </div>
              )}
            </div>

            {/* Article body */}
            <div className="px-8 pb-10">
              {/* Loading skeleton */}
              {loading && (
                <div className="space-y-5">
                  {[90, 70, 85, 55, 95, 60].map((w, i) => (
                    <div key={i} className="space-y-2">
                      <div
                        className="h-4 bg-[var(--color-border)] rounded-full animate-pulse"
                        style={{ width: `${w}%` }}
                      />
                      <div
                        className="h-4 bg-[var(--color-border)] rounded-full animate-pulse"
                        style={{ width: `${w - 20}%` }}
                      />
                      {i % 2 === 0 && (
                        <div
                          className="h-4 bg-[var(--color-border)] rounded-full animate-pulse"
                          style={{ width: `${w - 40}%` }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Article content */}
              {!loading && content && content.length > 0 && (
                <div className="intel-reader-content" dangerouslySetInnerHTML={{ __html: sanitizedContent }} />
              )}

              {/* Fallback when content could not be loaded */}
              {!loading && content && content.length === 0 && (
                <div className="mt-4 p-6 rounded-xl bg-[var(--color-surface-elevated)] border border-[var(--color-border)] text-center">
                  <p className="text-sm text-[var(--color-text-muted)] mb-4">Could not load full article content.</p>
                  <button
                    onClick={() => window.electronAPI.openExternal(item.url)}
                    className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-[var(--color-border-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent-muted)] transition-colors"
                  >
                    <ExternalLink size={14} />
                    Open in Browser
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Sticky Action Toolbar */}
          <div className="shrink-0 bg-[var(--color-chrome)] border-t border-[var(--color-border)] px-6 py-3 flex flex-wrap gap-2">
            <button
              onClick={() => {
                onSaveAsIdea(item);
                onClose();
              }}
              className={actionBtnClass}
            >
              <Lightbulb size={15} /> Save as Idea
            </button>
            <button
              onClick={() => {
                onStartProject(item);
                onClose();
              }}
              className={actionBtnClass}
            >
              <FolderKanban size={15} /> Start Project
            </button>
            <button
              onClick={() => {
                onDiscuss(item);
                onClose();
              }}
              className={actionBtnClass}
            >
              <Brain size={15} /> Discuss with AI
            </button>
            <button onClick={() => window.electronAPI.openExternal(item.url)} className={`${actionBtnClass} ml-auto`}>
              <ExternalLink size={15} /> Open in Browser
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
