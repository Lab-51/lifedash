// === FILE PURPOSE ===
// Horizontal tab bar for switching between intelligence feeds.
// Shows "All" tab (always first), user-created feed tabs, and a "+" button
// to create new feeds. Supports inline rename, right-click context menu,
// and delete with confirmation.

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Globe, Plus, Pencil, Trash2 } from 'lucide-react';
import { useIntelFeedStore } from '../stores/intelFeedStore';
import { ConfirmDialog } from './ConfirmDialog';
import type { IntelFeed } from '../../shared/types';

// ---- Context Menu ----

interface ContextMenuState {
  feedId: string;
  x: number;
  y: number;
}

function TabContextMenu({
  x,
  y,
  onRename,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[140px] py-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-chrome)] shadow-xl"
      style={{ left: x, top: y }}
    >
      <button
        onClick={() => {
          onRename();
          onClose();
        }}
        className="cursor-pointer w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-subtle)] hover:text-[var(--color-text-primary)] transition-colors"
      >
        <Pencil size={12} />
        Rename
      </button>
      <button
        onClick={() => {
          onDelete();
          onClose();
        }}
        className="cursor-pointer w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
      >
        <Trash2 size={12} />
        Delete
      </button>
    </div>
  );
}

// ---- Create Feed Popover ----

function CreateFeedPopover({
  anchorRef,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const createFeed = useIntelFeedStore((s) => s.createFeed);
  const setActiveFeed = useIntelFeedStore((s) => s.setActiveFeed);

  // Position from anchor button's bounding rect
  useEffect(() => {
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 6, left: Math.max(8, rect.right - 256) });
    }
    inputRef.current?.focus();
  }, [anchorRef]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose, anchorRef]);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const newFeed = await createFeed({ name: trimmed, emoji: emoji.trim() || undefined });
    setActiveFeed(newFeed.id);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCreate();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!pos) return null;

  return createPortal(
    <div
      ref={popoverRef}
      className="fixed z-50 w-64 p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-chrome)] shadow-2xl"
      style={{ top: pos.top, left: pos.left }}
    >
      <div className="flex items-center gap-2 mb-2">
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Feed name..."
          className="flex-1 px-2.5 py-1.5 text-xs rounded-lg border border-[var(--color-border)] bg-transparent text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-border-accent)] transition-colors"
        />
        <input
          type="text"
          value={emoji}
          onChange={(e) => setEmoji(e.target.value.slice(0, 2))}
          onKeyDown={handleKeyDown}
          placeholder="icon"
          className="w-10 px-1.5 py-1.5 text-xs text-center rounded-lg border border-[var(--color-border)] bg-transparent text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-border-accent)] transition-colors"
        />
      </div>
      <div className="flex justify-end gap-1.5">
        <button
          onClick={onClose}
          className="cursor-pointer px-2.5 py-1 text-[11px] rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleCreate}
          disabled={!name.trim()}
          className="cursor-pointer px-2.5 py-1 text-[11px] rounded-lg bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Create
        </button>
      </div>
    </div>,
    document.body,
  );
}

// ---- Main Component ----

export default function IntelFeedTabs() {
  const feeds = useIntelFeedStore((s) => s.feeds);
  const activeFeedId = useIntelFeedStore((s) => s.activeFeedId);
  const setActiveFeed = useIntelFeedStore((s) => s.setActiveFeed);
  const updateFeed = useIntelFeedStore((s) => s.updateFeed);
  const deleteFeed = useIntelFeedStore((s) => s.deleteFeed);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<IntelFeed | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const renameInputRef = useRef<HTMLInputElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  // Focus rename input when entering rename mode
  useEffect(() => {
    if (renamingId) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingId]);

  const handleContextMenu = useCallback((e: React.MouseEvent, feedId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ feedId, x: e.clientX, y: e.clientY });
  }, []);

  const startRename = useCallback(
    (feedId: string) => {
      const feed = feeds.find((f) => f.id === feedId);
      if (!feed) return;
      setRenamingId(feedId);
      setRenameValue(feed.name);
    },
    [feeds],
  );

  const commitRename = useCallback(async () => {
    if (!renamingId) return;
    const trimmed = renameValue.trim();
    if (trimmed) {
      await updateFeed(renamingId, { name: trimmed });
    }
    setRenamingId(null);
    setRenameValue('');
  }, [renamingId, renameValue, updateFeed]);

  const cancelRename = useCallback(() => {
    setRenamingId(null);
    setRenameValue('');
  }, []);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitRename();
      } else if (e.key === 'Escape') {
        cancelRename();
      }
    },
    [commitRename, cancelRename],
  );

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    await deleteFeed(deleteTarget.id);
    setDeleteTarget(null);
  }, [deleteTarget, deleteFeed]);

  const isActive = (feedId: string | null) => activeFeedId === feedId;

  const tabBase =
    'relative cursor-pointer shrink-0 flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg transition-all duration-150';
  const tabActive =
    'bg-white/10 text-[var(--color-accent)] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[var(--color-accent)] after:rounded-full';
  const tabInactive = 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-white/5';

  return (
    <>
      <div className="flex items-center border-b border-[var(--color-border)] overflow-x-auto scrollbar-none">
        {/* "All" tab — always first */}
        <button
          onClick={() => setActiveFeed(null)}
          className={`${tabBase} ${isActive(null) ? tabActive : tabInactive}`}
        >
          <Globe size={13} />
          <span>All</span>
        </button>

        {/* User-created feed tabs */}
        {feeds.map((feed) => (
          <button
            key={feed.id}
            onClick={() => setActiveFeed(feed.id)}
            onContextMenu={(e) => handleContextMenu(e, feed.id)}
            className={`${tabBase} ${isActive(feed.id) ? tabActive : tabInactive} group`}
          >
            {renamingId === feed.id ? (
              <input
                ref={renameInputRef}
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={handleRenameKeyDown}
                onBlur={commitRename}
                onClick={(e) => e.stopPropagation()}
                className="w-24 bg-transparent border-b border-[var(--color-border-accent)] text-xs text-[var(--color-text-primary)] outline-none"
              />
            ) : (
              <>
                <span className="text-sm leading-none">{feed.emoji || '\uD83D\uDCF0'}</span>
                <span className="max-w-[150px] truncate">{feed.name}</span>
              </>
            )}
          </button>
        ))}

        {/* "+" Create feed button */}
        <button
          ref={addButtonRef}
          onClick={() => setShowCreate((v) => !v)}
          className="cursor-pointer shrink-0 flex items-center justify-center w-8 h-8 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] transition-colors ml-1"
          title="Create feed"
        >
          <Plus size={15} />
        </button>
      </div>

      {/* Create feed popover (portaled to body) */}
      {showCreate && <CreateFeedPopover anchorRef={addButtonRef} onClose={() => setShowCreate(false)} />}

      {/* Context menu */}
      {contextMenu && (
        <TabContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onRename={() => startRename(contextMenu.feedId)}
          onDelete={() => {
            const feed = feeds.find((f) => f.id === contextMenu.feedId);
            if (feed) setDeleteTarget(feed);
          }}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Feed"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? Articles won't be deleted, but they will no longer be grouped under this feed.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
