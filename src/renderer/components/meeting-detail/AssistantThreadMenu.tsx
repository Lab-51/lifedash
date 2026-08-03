// === FILE PURPOSE ===
// Thread controls for the meeting assistant: start a new conversation (archiving
// the current one), permanently clear the current one, and open an archived one
// read-only. The chat was a single per-meeting thread that only ever grew, with
// no way to reset it or keep separate lines of questioning apart.
//
// === DEPENDENCIES ===
// React, lucide-react (Plus / History / Trash2 — the glyphs this codebase already
// uses for add, history and destructive delete), ConfirmDialog, electronAPI
// meeting-agent thread bridge.
//
// === CONTRACT NOTES ===
// - CLEAR is destructive and irreversible, so it goes through ConfirmDialog.
//   NEW CHAT is not destructive (the old thread is archived, not deleted) and so
//   is deliberately one click with no confirmation.
// - The assistant conversation is NOT a source for briefs, cards, embeddings or
//   twin facts (verified: meeting_agent_messages is read only by
//   meetingAgentService; the embeddings enum has no message type; twin fact
//   extraction reads the brief + accepted suggestions). Clearing therefore
//   cannot erase anything the app learned — the confirm copy says so plainly
//   rather than implying broader consequences.

import { useCallback, useEffect, useRef, useState } from 'react';
import { History, Plus, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../ConfirmDialog';
import type { MeetingAgentThreadSummary } from '../../../shared/types';

interface AssistantThreadMenuProps {
  meetingId: string;
  /** True while a reply streams — thread switching mid-stream would strand it. */
  busy: boolean;
  hasMessages: boolean;
  /** Current thread was emptied or replaced; reload from main. */
  onReset: () => void;
  /** Open an archived thread read-only, or null to return to the current one. */
  onOpenArchived: (thread: MeetingAgentThreadSummary | null) => void;
  /** Id of the archived thread being viewed, if any. */
  viewingArchivedId: string | null;
}

const ACTION_BUTTON =
  'flex items-center gap-1 text-[0.6875rem] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] disabled:opacity-40 disabled:hover:text-[var(--color-text-muted)] transition-colors';

export default function AssistantThreadMenu({
  meetingId,
  busy,
  hasMessages,
  onReset,
  onOpenArchived,
  viewingArchivedId,
}: AssistantThreadMenuProps) {
  const [threads, setThreads] = useState<MeetingAgentThreadSummary[]>([]);
  const [showArchive, setShowArchive] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [working, setWorking] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const refreshThreads = useCallback(async () => {
    try {
      setThreads(await window.electronAPI.meetingAgentListThreads(meetingId));
    } catch {
      setThreads([]); // Archive is a convenience; never block the chat on it.
    }
  }, [meetingId]);

  // Close the archive popover on an outside click — it overlays the transcript.
  useEffect(() => {
    if (!showArchive) return;
    const onDown = (e: MouseEvent) => {
      if (!popoverRef.current?.contains(e.target as Node)) setShowArchive(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [showArchive]);

  const archived = threads.filter((t) => t.archivedAt);

  const handleNewChat = async () => {
    setWorking(true);
    try {
      await window.electronAPI.meetingAgentNewThread(meetingId);
      onOpenArchived(null);
      onReset();
      await refreshThreads();
    } finally {
      setWorking(false);
    }
  };

  const handleClear = async () => {
    setConfirmClear(false);
    setWorking(true);
    try {
      await window.electronAPI.meetingAgentClear(meetingId);
      onOpenArchived(null);
      onReset();
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <button onClick={() => void handleNewChat()} disabled={busy || working} className={ACTION_BUTTON}>
        <Plus size={12} aria-hidden="true" />
        New chat
      </button>

      <div className="relative" ref={popoverRef}>
        <button
          onClick={() => {
            setShowArchive((v) => !v);
            if (!showArchive) void refreshThreads();
          }}
          disabled={busy || working}
          aria-expanded={showArchive}
          className={ACTION_BUTTON}
        >
          <History size={12} aria-hidden="true" />
          Archive
        </button>

        {showArchive && (
          <div className="absolute right-0 top-full mt-1 z-30 w-64 max-h-64 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-chrome)] shadow-lg py-1">
            {viewingArchivedId && (
              <button
                onClick={() => {
                  onOpenArchived(null);
                  setShowArchive(false);
                }}
                className="w-full text-left px-3 py-1.5 text-[0.6875rem] text-[var(--color-accent)] hover:bg-[var(--color-surface-hover)]"
              >
                ← Back to current chat
              </button>
            )}
            {archived.length === 0 ? (
              <p className="px-3 py-2 text-[0.6875rem] text-[var(--color-text-muted)] break-words">
                No earlier conversations yet. “New chat” keeps the current one here.
              </p>
            ) : (
              archived.map((thread) => (
                <button
                  key={thread.id}
                  onClick={() => {
                    onOpenArchived(thread);
                    setShowArchive(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 hover:bg-[var(--color-surface-hover)] overflow-hidden ${
                    thread.id === viewingArchivedId ? 'bg-[var(--color-surface-hover)]' : ''
                  }`}
                >
                  <span className="block text-[0.6875rem] text-[var(--color-text-primary)] break-words">
                    {thread.preview ?? 'Empty conversation'}
                  </span>
                  <span className="block text-[0.625rem] text-[var(--color-text-muted)]">
                    {new Date(thread.archivedAt ?? thread.createdAt).toLocaleString()} · {thread.messageCount} message
                    {thread.messageCount === 1 ? '' : 's'}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <button
        onClick={() => setConfirmClear(true)}
        disabled={busy || working || !hasMessages || !!viewingArchivedId}
        className={ACTION_BUTTON}
      >
        <Trash2 size={12} aria-hidden="true" />
        Clear
      </button>

      <ConfirmDialog
        open={confirmClear}
        title="Clear this conversation?"
        message="Every message in the current chat is deleted permanently — this cannot be undone. The transcript, brief, cards and anything the Twin has learned are untouched: the assistant chat is never a source for them. To keep this conversation instead, use “New chat”."
        confirmLabel="Clear"
        variant="danger"
        onConfirm={() => void handleClear()}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}
