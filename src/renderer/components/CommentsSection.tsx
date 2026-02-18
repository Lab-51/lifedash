// === FILE PURPOSE ===
// Comments section UI for card detail view.
// Allows adding, editing, and deleting comments on a card.

// === DEPENDENCIES ===
// react, lucide-react, cardDetailStore (Zustand)

import { useState } from 'react';
import { MessageSquare, Pencil, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { useCardDetailStore } from '../stores/cardDetailStore';

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface CommentsSectionProps {
  cardId: string;
}

function CommentsSection({ cardId }: CommentsSectionProps) {
  const selectedCardComments = useCardDetailStore(s => s.selectedCardComments);
  const addComment = useCardDetailStore(s => s.addComment);
  const updateComment = useCardDetailStore(s => s.updateComment);
  const deleteComment = useCardDetailStore(s => s.deleteComment);

  const [newComment, setNewComment] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [expanded, setExpanded] = useState(false);

  // --- Add comment ---
  const handleAddComment = async () => {
    const trimmed = newComment.trim();
    if (!trimmed) return;
    await addComment({ cardId, content: trimmed });
    setNewComment('');
  };

  const handleAddKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleAddComment();
    }
  };

  // --- Edit comment ---
  const startEditing = (id: string, content: string) => {
    setEditingId(id);
    setEditContent(content);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditContent('');
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const trimmed = editContent.trim();
    if (!trimmed) return;
    await updateComment(editingId, trimmed);
    setEditingId(null);
    setEditContent('');
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      cancelEditing();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      saveEdit();
    }
  };

  // --- Delete comment ---
  const handleDelete = async (id: string) => {
    await deleteComment(id);
  };

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center gap-1.5 mb-3">
        <MessageSquare size={14} className="text-surface-400" />
        <span className="text-sm text-surface-400">Comments</span>
        {selectedCardComments.length > 0 && (
          <span className="bg-surface-800 text-surface-700 dark:text-surface-300 text-xs px-1.5 py-0.5 rounded-full ml-1.5">
            {selectedCardComments.length}
          </span>
        )}
      </div>

      {/* Add comment form */}
      <div className="mb-4">
        <textarea
          value={newComment}
          onChange={e => setNewComment(e.target.value)}
          onKeyDown={handleAddKeyDown}
          placeholder="Write a comment..."
          rows={3}
          className="bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg p-3 text-sm text-surface-100 placeholder:text-surface-500 resize-none w-full focus:outline-none focus:border-primary-500 transition-colors"
        />
        <div className="flex justify-end mt-2">
          <button
            onClick={handleAddComment}
            disabled={!newComment.trim()}
            className="bg-primary-600 hover:bg-primary-500 text-white text-sm px-3 py-1.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Add Comment
          </button>
        </div>
      </div>

      {/* Comments list */}
      {selectedCardComments.length === 0 ? (
        <p className="text-sm text-surface-500 italic">No comments yet</p>
      ) : (
        <div>
          <div className="space-y-2">
            {(expanded ? selectedCardComments : selectedCardComments.slice(0, 3)).map(comment => (
              <div
                key={comment.id}
                className="bg-surface-100/50 dark:bg-surface-800/50 rounded-lg px-3 py-2.5"
              >
                {editingId === comment.id ? (
                  /* Edit mode */
                  <div>
                    <textarea
                      value={editContent}
                      onChange={e => setEditContent(e.target.value)}
                      onKeyDown={handleEditKeyDown}
                      rows={3}
                      autoFocus
                      className="bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg p-3 text-sm text-surface-100 placeholder:text-surface-500 resize-none w-full focus:outline-none focus:border-primary-500 transition-colors"
                    />
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        onClick={saveEdit}
                        disabled={!editContent.trim()}
                        className="bg-primary-600 hover:bg-primary-500 text-white text-xs px-3 py-1.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        Save
                      </button>
                      <button
                        onClick={cancelEditing}
                        className="text-xs text-surface-400 hover:text-surface-800 dark:text-surface-200 px-2 py-1.5 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Display mode */
                  <div>
                    <p className="text-sm text-surface-800 dark:text-surface-200 whitespace-pre-wrap">
                      {comment.content}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-xs text-surface-500">
                        {timeAgo(comment.createdAt)}
                      </span>
                      <span className="text-xs text-surface-600">·</span>
                      <button
                        onClick={() => startEditing(comment.id, comment.content)}
                        className="inline-flex items-center gap-1 text-xs text-surface-500 hover:text-surface-700 dark:text-surface-300 transition-colors"
                      >
                        <Pencil size={12} />
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(comment.id)}
                        className="inline-flex items-center gap-1 text-xs text-surface-500 hover:text-surface-700 dark:text-surface-300 transition-colors"
                      >
                        <Trash2 size={12} />
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Expand/collapse toggle */}
          {selectedCardComments.length > 3 && (
            <button
              onClick={() => setExpanded(prev => !prev)}
              className="mt-2 flex items-center gap-1 text-xs text-surface-500 hover:text-surface-700 dark:text-surface-300 transition-colors"
            >
              {expanded ? (
                <>
                  <ChevronUp size={12} />
                  Show less
                </>
              ) : (
                <>
                  <ChevronDown size={12} />
                  Show all {selectedCardComments.length} comments
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default CommentsSection;
