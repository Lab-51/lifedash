// === FILE PURPOSE ===
// Large featured "hero" card for the top-relevance article in the Intel Feed.
// Displays prominently above the grid with visible action buttons and extra detail.

import { Star, Lightbulb, FolderKanban, Brain, BookOpen } from 'lucide-react';
import type { IntelItem } from '../../shared/types';

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

interface IntelHeroCardProps {
  item: IntelItem;
  onMarkRead: (id: string) => void;
  onToggleBookmark: (id: string) => void;
  onSummarize?: (id: string) => Promise<void>;
  onSaveAsIdea?: (item: IntelItem) => void;
  onStartProject?: (item: IntelItem) => void;
  onDiscuss?: (item: IntelItem) => void;
  onOpenReader?: (item: IntelItem) => void;
}

export default function IntelHeroCard({
  item,
  onMarkRead,
  onToggleBookmark,
  onSaveAsIdea,
  onStartProject,
  onDiscuss,
  onOpenReader,
}: IntelHeroCardProps) {
  const handleCardClick = () => {
    if (!item.isRead) onMarkRead(item.id);
    if (onOpenReader) {
      onOpenReader(item);
    } else if (item.url) {
      window.electronAPI.openExternal(item.url);
    }
  };

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const categoryStyle = item.category ? CATEGORY_COLORS[item.category] || CATEGORY_COLORS['Other'] : null;

  return (
    <div
      onClick={handleCardClick}
      className="group hud-panel p-6 border-l-2 border-l-[var(--color-accent)] hover:shadow-lg hover:!border-[var(--color-border-accent)] hover:border-l-[var(--color-accent)] transition-all cursor-pointer flex flex-col md:flex-row gap-5"
    >
      {/* Image */}
      {item.imageUrl && (
        <div className="shrink-0 w-full md:w-[200px] h-[160px] md:h-auto md:min-h-[180px] rounded-lg md:rounded-l-lg md:rounded-r-none overflow-hidden border border-[var(--color-border)] bg-[var(--color-chrome)]">
          <img
            src={item.imageUrl}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).parentElement!.style.display = 'none';
            }}
          />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top row: badge + category */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] font-data tracking-[0.15em] uppercase text-[var(--color-accent)] bg-[var(--color-accent-muted)] px-2 py-0.5 rounded">
            Top Story
          </span>
          {categoryStyle && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${categoryStyle}`}>{item.category}</span>
          )}
        </div>

        {/* Title */}
        <h2 className="text-xl font-bold leading-snug text-[var(--color-text-primary)] group-hover:text-[var(--color-accent)] transition-colors mb-1.5">
          {!item.isRead && (
            <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-accent)] mr-2 align-middle" />
          )}
          {item.title}
        </h2>

        {/* Meta */}
        <div className="flex items-center gap-1.5 text-[0.6875rem] font-data text-[var(--color-text-muted)] mb-2">
          {item.sourceIconUrl && (
            <img
              src={item.sourceIconUrl}
              alt=""
              className="w-4 h-4 rounded-sm shrink-0"
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          )}
          <span className="text-[var(--color-accent-dim)]">{item.sourceName}</span>
          <span className="opacity-40">|</span>
          <span>{relativeTime(item.publishedAt)}</span>
          {item.author && (
            <>
              <span className="opacity-40">|</span>
              <span>{item.author}</span>
            </>
          )}
        </div>

        {/* Description */}
        {item.description && (
          <p className="text-sm text-[var(--color-text-secondary)] line-clamp-4 leading-relaxed mb-2">
            {item.description}
          </p>
        )}

        {/* AI Summary */}
        {item.summary && (
          <p className="text-xs italic text-[var(--color-accent-dim)] line-clamp-3 mb-3">AI Summary: {item.summary}</p>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Action buttons */}
        <div className="flex items-center flex-wrap gap-2 mt-2">
          {onSaveAsIdea && (
            <button
              onClick={(e) => {
                stop(e);
                onSaveAsIdea(item);
              }}
              className="cursor-pointer flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-accent)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] transition-colors"
            >
              <Lightbulb size={13} />
              Save as Idea
            </button>
          )}
          {onStartProject && (
            <button
              onClick={(e) => {
                stop(e);
                onStartProject(item);
              }}
              className="cursor-pointer flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-accent)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] transition-colors"
            >
              <FolderKanban size={13} />
              Start Project
            </button>
          )}
          {onDiscuss && (
            <button
              onClick={(e) => {
                stop(e);
                onDiscuss(item);
              }}
              className="cursor-pointer flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-accent)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] transition-colors"
            >
              <Brain size={13} />
              Discuss
            </button>
          )}
          <button
            onClick={(e) => {
              stop(e);
              if (!item.isRead) onMarkRead(item.id);
              if (onOpenReader) {
                onOpenReader(item);
              } else if (item.url) {
                window.electronAPI.openExternal(item.url);
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-accent)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] transition-colors"
          >
            <BookOpen size={13} />
            Read Article
          </button>

          {/* Spacer to push bookmark right */}
          <div className="flex-1" />

          <button
            onClick={(e) => {
              stop(e);
              onToggleBookmark(item.id);
            }}
            title={item.isBookmarked ? 'Remove bookmark' : 'Bookmark'}
            className={`cursor-pointer p-1.5 rounded-full transition-all ${
              item.isBookmarked
                ? 'text-amber-400 hover:text-amber-300'
                : 'text-[var(--color-text-muted)] hover:text-amber-400'
            }`}
          >
            <Star size={16} fill={item.isBookmarked ? 'currentColor' : 'none'} />
          </button>
        </div>
      </div>
    </div>
  );
}
