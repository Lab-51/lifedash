// === FILE PURPOSE ===
// Slide-in modal overlay for viewing a saved (pinned) intelligence brief.
// Mirrors the IntelArticleReader slide-in pattern with brief content + chat side-by-side.

import { useEffect, useMemo } from 'react';
import { ArrowLeft, Bookmark, Newspaper } from 'lucide-react';
import { renderBriefContent } from './IntelBriefPanel';
import IntelBriefChat from './IntelBriefChat';
import type { IntelBrief, IntelItem, IntelChatMessage } from '../../shared/types';

interface SavedBriefModalProps {
  brief: IntelBrief;
  onClose: () => void;
  onUnpin: (id: string) => void;
  items: IntelItem[];
  onOpenArticle: (item: IntelItem) => void;
  chatMessages: IntelChatMessage[];
  chatSending: boolean;
  onSendChat: (content: string) => void;
  onClearChat: () => void;
}

/** Format a brief date for the modal header. */
function formatBriefDate(brief: IntelBrief): string {
  if (brief.type === 'weekly') {
    const [year, week] = brief.date.split('-W');
    return `Week ${parseInt(week)}, ${year}`;
  }
  return new Date(brief.date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

/** Format relative time from an ISO string. */
function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function SavedBriefModal({
  brief,
  onClose,
  onUnpin,
  items,
  onOpenArticle,
  chatMessages,
  chatSending,
  onSendChat,
  onClearChat,
}: SavedBriefModalProps) {
  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Build title and URL maps for article linking in brief content
  const titleMap = useMemo(() => {
    const map = new Map<string, IntelItem>();
    for (const item of items) {
      map.set(item.title.toLowerCase().trim(), item);
    }
    return map;
  }, [items]);

  const urlMap = useMemo(() => {
    const map = new Map<string, IntelItem>();
    for (const item of items) {
      map.set(item.url, item);
    }
    return map;
  }, [items]);

  const typeLabel = brief.type === 'weekly' ? 'Weekly' : 'Daily';

  return (
    <>
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-slide-in-right {
          animation: slideInRight 0.2s ease-out;
        }
      `}</style>
      <div className="fixed inset-0 z-50 flex">
        {/* Backdrop */}
        <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={onClose} />

        {/* Slide-in panel */}
        <div className="w-full max-w-[900px] bg-[var(--color-chrome)] border-l border-[var(--color-border)] flex flex-col animate-slide-in-right">
          {/* Sticky header */}
          <div className="shrink-0 bg-[var(--color-chrome)] border-b border-[var(--color-border)] px-5 py-3 flex items-center gap-3">
            <button
              onClick={onClose}
              className="cursor-pointer shrink-0 p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-accent-subtle)] transition-colors"
              title="Close"
            >
              <ArrowLeft size={18} />
            </button>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 text-[10px] rounded-full font-semibold uppercase tracking-wider bg-[var(--color-accent-muted)] text-[var(--color-accent)] border border-[var(--color-border-accent)]">
                  {typeLabel}
                </span>
                <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                  {formatBriefDate(brief)}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <Newspaper size={11} className="text-[var(--color-text-muted)] shrink-0" />
                <span className="text-[11px] font-data text-[var(--color-text-muted)]">
                  {brief.articleCount} articles analyzed
                </span>
                <span className="text-[var(--color-text-muted)] text-[11px]">&middot;</span>
                <span className="text-[11px] font-data text-[var(--color-text-muted)]">
                  Generated {relativeTime(brief.generatedAt)}
                </span>
              </div>
            </div>

            {/* Unpin button */}
            <button
              onClick={() => onUnpin(brief.id)}
              className="cursor-pointer shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors text-xs font-medium"
              title="Unpin brief"
            >
              <Bookmark size={13} className="fill-current" />
              Saved
            </button>
          </div>

          {/* Body: two-column layout */}
          <div className="flex-1 flex min-h-0">
            {/* Brief content — left side */}
            <div className="flex-1 px-6 py-5 min-w-0 overflow-y-auto">
              {renderBriefContent(brief.content, titleMap, urlMap, onOpenArticle)}
            </div>

            {/* Divider */}
            <div className="w-px bg-[var(--color-border)]" />

            {/* Chat — right side */}
            <div className="w-[340px] shrink-0 flex flex-col min-h-0">
              <IntelBriefChat
                messages={chatMessages}
                sending={chatSending}
                hasBrief={true}
                onSend={onSendChat}
                onClear={onClearChat}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
