// === FILE PURPOSE ===
// Individual news card for the Intelligence Feed.
// Supports two variants: 'list' (horizontal, original) and 'grid' (vertical, compact).
// Shows article title, source, relative time, description, image thumbnail,
// bookmark toggle, and read/unread indicator.

import { useState } from 'react';
import { Star, Loader2 } from 'lucide-react';
import type { IntelItem } from '../../shared/types';
import IntelActionMenu from './IntelActionMenu';

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

/** Format a date string into a human-readable relative time. */
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

interface IntelItemCardProps {
  item: IntelItem;
  variant?: 'list' | 'grid';
  onMarkRead: (id: string) => void;
  onToggleBookmark: (id: string) => void;
  onSummarize?: (id: string) => Promise<void>;
  onSaveAsIdea?: (item: IntelItem) => void;
  onStartProject?: (item: IntelItem) => void;
  onDiscuss?: (item: IntelItem) => void;
  onOpenReader?: (item: IntelItem) => void;
}

export default function IntelItemCard({
  item,
  variant = 'list',
  onMarkRead,
  onToggleBookmark,
  onSummarize,
  onSaveAsIdea,
  onStartProject,
  onDiscuss,
  onOpenReader,
}: IntelItemCardProps) {
  const [summarizing, setSummarizing] = useState(false);
  const isGrid = variant === 'grid';

  const handleCardClick = () => {
    if (!item.isRead) {
      onMarkRead(item.id);
    }
    if (onOpenReader) {
      onOpenReader(item);
    } else if (item.url) {
      window.electronAPI.openExternal(item.url);
    }
  };

  const handleBookmarkClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleBookmark(item.id);
  };

  // --- Grid variant ---
  if (isGrid) {
    return (
      <div
        onClick={handleCardClick}
        className={`group hud-panel p-3 hover:shadow-lg hover:!border-[var(--color-border-accent)] transition-all cursor-pointer flex flex-col ${
          item.isRead ? 'opacity-70' : ''
        }`}
      >
        {/* Top image */}
        {item.imageUrl && (
          <div
            className="w-full h-[140px] -mt-3 -mx-3 mb-3 rounded-t-lg overflow-hidden border-b border-[var(--color-border)] bg-[var(--color-chrome)]"
            style={{ width: 'calc(100% + 1.5rem)' }}
          >
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

        {/* Category badge */}
        {item.category && (
          <div className="mb-1.5">
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded border ${CATEGORY_COLORS[item.category] || CATEGORY_COLORS['Other']}`}
            >
              {item.category}
            </span>
          </div>
        )}

        {/* Title */}
        <h3
          className={`text-sm font-bold leading-snug group-hover:text-[var(--color-accent)] transition-colors line-clamp-2 mb-1 ${
            item.isRead ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-primary)]'
          }`}
        >
          {!item.isRead && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] mr-1.5 align-middle" />
          )}
          {item.title}
        </h3>

        {/* Source + time (compact) */}
        <div className="flex items-center gap-1.5 text-[0.6875rem] font-data text-[var(--color-text-muted)] mb-1.5">
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
        </div>

        {/* Description (compact) */}
        {item.description && (
          <p className="text-xs text-[var(--color-text-muted)] line-clamp-2 leading-relaxed">{item.description}</p>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom row: action menu + bookmark */}
        <div className="flex items-center justify-end gap-0.5 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
          {(onSaveAsIdea || onStartProject || onDiscuss) && (
            <IntelActionMenu
              item={item}
              onSaveAsIdea={onSaveAsIdea || (() => {})}
              onStartProject={onStartProject || (() => {})}
              onDiscuss={onDiscuss || (() => {})}
            />
          )}
          <button
            onClick={handleBookmarkClick}
            title={item.isBookmarked ? 'Remove bookmark' : 'Bookmark'}
            className={`cursor-pointer shrink-0 p-1 rounded transition-all ${
              item.isBookmarked
                ? 'text-amber-400 hover:text-amber-300 !opacity-100'
                : 'text-[var(--color-text-muted)] hover:text-amber-400'
            }`}
          >
            <Star size={14} fill={item.isBookmarked ? 'currentColor' : 'none'} />
          </button>
        </div>
      </div>
    );
  }

  // --- List variant (original) ---
  return (
    <div
      onClick={handleCardClick}
      className={`group hud-panel p-4 hover:shadow-lg hover:!border-[var(--color-border-accent)] transition-all cursor-pointer flex gap-4 ${
        item.isRead ? 'opacity-70' : ''
      }`}
    >
      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-1">
          <h3
            className={`text-sm font-bold leading-snug group-hover:text-[var(--color-accent)] transition-colors line-clamp-2 ${
              item.isRead ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-primary)]'
            }`}
          >
            {/* Unread dot */}
            {!item.isRead && (
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] mr-2 align-middle" />
            )}
            {item.title}
          </h3>

          <div className="flex items-center gap-0.5 shrink-0">
            {(onSaveAsIdea || onStartProject || onDiscuss) && (
              <IntelActionMenu
                item={item}
                onSaveAsIdea={onSaveAsIdea || (() => {})}
                onStartProject={onStartProject || (() => {})}
                onDiscuss={onDiscuss || (() => {})}
              />
            )}

            <button
              onClick={handleBookmarkClick}
              title={item.isBookmarked ? 'Remove bookmark' : 'Bookmark'}
              className={`cursor-pointer shrink-0 p-1 rounded transition-all ${
                item.isBookmarked
                  ? 'text-amber-400 hover:text-amber-300'
                  : 'text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 hover:text-amber-400'
              }`}
            >
              <Star size={14} fill={item.isBookmarked ? 'currentColor' : 'none'} />
            </button>
          </div>
        </div>

        {/* Source + time + category */}
        <div className="flex items-center gap-1.5 text-[0.6875rem] font-data text-[var(--color-text-muted)] mb-1.5">
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
          {item.category && (
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded border ${CATEGORY_COLORS[item.category] || CATEGORY_COLORS['Other']}`}
            >
              {item.category}
            </span>
          )}
        </div>

        {/* Description */}
        {item.description && (
          <p className="text-xs text-[var(--color-text-muted)] line-clamp-2 leading-relaxed">{item.description}</p>
        )}

        {/* AI Summary */}
        {item.summary && (
          <p className="text-xs italic text-[var(--color-accent-dim)] mt-1 line-clamp-2">AI Summary: {item.summary}</p>
        )}

        {/* Summarize button */}
        {!item.summary && onSummarize && (
          <button
            onClick={async (e) => {
              e.stopPropagation();
              setSummarizing(true);
              try {
                await onSummarize(item.id);
              } finally {
                setSummarizing(false);
              }
            }}
            disabled={summarizing}
            className="cursor-pointer mt-1 flex items-center gap-1 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
          >
            {summarizing ? (
              <>
                <Loader2 size={10} className="animate-spin" />
                Summarizing...
              </>
            ) : (
              'Summarize'
            )}
          </button>
        )}
      </div>

      {/* Thumbnail */}
      {item.imageUrl && (
        <div className="shrink-0 w-20 h-20 rounded-lg overflow-hidden border border-[var(--color-border)] bg-[var(--color-chrome)]">
          <img
            src={item.imageUrl}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        </div>
      )}
    </div>
  );
}
