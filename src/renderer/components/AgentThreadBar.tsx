// === FILE PURPOSE ===
// Shared thread selector bar for agent panels (card + project).
// Collapsed: single row showing current thread title with expand/new buttons.
// Expanded: dropdown overlay listing all threads with select/delete actions.

import { useState, useRef, useEffect, useCallback } from 'react';
import { Plus, ChevronDown, ChevronUp, Trash2, MessageSquare } from 'lucide-react';

export interface AgentThreadBarProps {
  threads: Array<{ id: string; title: string; createdAt: string; messageCount?: number }>;
  activeThreadId: string | null;
  onSelect: (threadId: string) => void;
  onNew: () => void;
  onDelete: (threadId: string) => void;
  loading: boolean;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export default function AgentThreadBar({
  threads,
  activeThreadId,
  onSelect,
  onNew,
  onDelete,
  loading,
}: AgentThreadBarProps) {
  const [expanded, setExpanded] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!expanded) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [expanded]);

  const handleSelect = useCallback((threadId: string) => {
    onSelect(threadId);
    setExpanded(false);
  }, [onSelect]);

  const handleDelete = useCallback((e: React.MouseEvent, threadId: string) => {
    e.stopPropagation();
    if (window.confirm('Delete this conversation? This cannot be undone.')) {
      onDelete(threadId);
    }
  }, [onDelete]);

  // Don't render if no threads and no active conversation
  if (threads.length === 0 && activeThreadId === null) return null;

  const activeThread = threads.find(t => t.id === activeThreadId);
  const displayTitle = activeThread?.title ?? 'New conversation';

  return (
    <div ref={wrapperRef} className="relative shrink-0">
      {/* Collapsed bar */}
      <div className="flex items-center h-8 px-3 bg-[var(--color-chrome)] border-b border-[var(--color-border)]">
        <span className="flex-1 text-xs font-data text-[var(--color-text-secondary)] truncate">
          {loading ? 'Loading...' : displayTitle}
        </span>
        <div className="flex items-center gap-0.5 shrink-0 ml-2">
          <button
            onClick={onNew}
            className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-accent)] rounded transition-colors"
            title="New conversation"
          >
            <Plus size={14} />
          </button>
          <button
            onClick={() => setExpanded(prev => !prev)}
            className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-accent)] rounded transition-colors"
            title={expanded ? 'Collapse' : 'Show conversations'}
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* Expanded dropdown */}
      {expanded && (
        <div className="absolute left-0 right-0 top-8 z-10 bg-[var(--color-chrome)] border border-[var(--color-border)] border-t-0 rounded-b-lg shadow-lg max-h-[200px] overflow-y-auto">
          {threads.length === 0 ? (
            <div className="px-3 py-3 text-xs text-[var(--color-text-muted)] font-data text-center">
              No conversations yet
            </div>
          ) : (
            threads.map(thread => {
              const isActive = thread.id === activeThreadId;
              return (
                <div
                  key={thread.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelect(thread.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleSelect(thread.id); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors cursor-pointer group/thread ${
                    isActive
                      ? 'bg-[var(--color-accent-muted)] border-l-2 border-l-[var(--color-accent)]'
                      : 'hover:bg-[var(--color-surface-hover)] border-l-2 border-l-transparent'
                  }`}
                >
                  <span className="flex-1 text-xs font-data text-[var(--color-text-secondary)] truncate">
                    {thread.title}
                  </span>

                  {/* Message count badge */}
                  {(thread.messageCount ?? 0) > 0 && (
                    <span className="flex items-center gap-0.5 text-[0.625rem] text-[var(--color-text-muted)] bg-[var(--color-accent-subtle)] rounded-full px-1.5 py-0.5 shrink-0">
                      <MessageSquare size={9} />
                      {thread.messageCount}
                    </span>
                  )}

                  {/* Relative time */}
                  <span className="text-[0.625rem] text-[var(--color-text-muted)] shrink-0 whitespace-nowrap">
                    {relativeTime(thread.createdAt)}
                  </span>

                  {/* Delete button — hover only */}
                  <button
                    onClick={(e) => handleDelete(e, thread.id)}
                    className="p-0.5 text-[var(--color-text-muted)] hover:text-red-500 opacity-0 group-hover/thread:opacity-100 transition-opacity shrink-0"
                    title="Delete conversation"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
