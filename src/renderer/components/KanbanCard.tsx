// === FILE PURPOSE ===
// KanbanCard — renders a single card in a Kanban column.
// Shows priority border, priority badge, label dots, and hover actions.
// Supports inline title editing and delete with confirmation.

// === DEPENDENCIES ===
// react, lucide-react (Pencil, Trash2), shared types (Card, UpdateCardInput),
// @atlaskit/pragmatic-drag-and-drop (draggable)

import { useState, useRef, useEffect } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import type { Card, UpdateCardInput } from '../../shared/types';

interface KanbanCardProps {
  card: Card;
  onUpdate: (id: string, data: UpdateCardInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClick?: () => void;
}

const PRIORITY_CONFIG = {
  low:    { border: 'border-l-emerald-500', badge: 'bg-emerald-500/20 text-emerald-400', label: 'LOW' },
  medium: { border: 'border-l-blue-500',    badge: 'bg-blue-500/20 text-blue-400',       label: 'MED' },
  high:   { border: 'border-l-amber-500',   badge: 'bg-amber-500/20 text-amber-400',     label: 'HIGH' },
  urgent: { border: 'border-l-red-500',     badge: 'bg-red-500/20 text-red-400',         label: 'URG' },
} as const;

function KanbanCard({ card, onUpdate, onDelete, onClick }: KanbanCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(card.title);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);

  const priority = PRIORITY_CONFIG[card.priority] ?? PRIORITY_CONFIG.medium;

  // Auto-focus input when entering edit mode
  useEffect(() => {
    if (isEditing && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [isEditing]);

  // Auto-dismiss delete confirmation after 2 seconds
  useEffect(() => {
    if (!confirmingDelete) return;
    const timer = setTimeout(() => setConfirmingDelete(false), 2000);
    return () => clearTimeout(timer);
  }, [confirmingDelete]);

  // Set up drag behavior
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    return draggable({
      element: el,
      getInitialData: () => ({
        type: 'card',
        cardId: card.id,
        sourceColumnId: card.columnId,
        sourcePosition: card.position,
      }),
      onDragStart: () => setIsDragging(true),
      onDrop: () => setIsDragging(false),
    });
  }, [card.id, card.columnId, card.position]);

  const startEditing = () => {
    setEditTitle(card.title);
    setIsEditing(true);
  };

  const saveEdit = async () => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== card.title) {
      await onUpdate(card.id, { title: trimmed });
    }
    setIsEditing(false);
  };

  const cancelEdit = () => {
    setEditTitle(card.title);
    setIsEditing(false);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      saveEdit();
    } else if (e.key === 'Escape') {
      cancelEdit();
    }
  };

  const handleDeleteClick = () => {
    if (confirmingDelete) {
      onDelete(card.id);
    } else {
      setConfirmingDelete(true);
    }
  };

  return (
    <div
      ref={cardRef}
      onClick={onClick}
      className={`group bg-surface-800 rounded-md p-3 border-l-2 cursor-pointer hover:bg-surface-700/50 transition-colors ${priority.border} ${isDragging ? 'opacity-40' : ''}`}
    >
      {/* Top row: title area + priority badge */}
      <div className="flex items-start justify-between gap-2">
        {/* Title or edit input */}
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <input
              ref={editInputRef}
              type="text"
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              onKeyDown={handleEditKeyDown}
              onBlur={saveEdit}
              onClick={e => e.stopPropagation()}
              className="bg-surface-900 border border-surface-700 rounded px-2 py-1 text-sm text-surface-100 focus:outline-none focus:border-primary-500 w-full"
            />
          ) : (
            <p
              className="text-sm text-surface-100 line-clamp-2"
              onDoubleClick={startEditing}
            >
              {card.title}
            </p>
          )}
        </div>

        {/* Priority badge */}
        <span
          className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded ${priority.badge}`}
        >
          {priority.label}
        </span>
      </div>

      {/* Bottom row: labels + actions */}
      <div className="flex items-center justify-between mt-2">
        {/* Label dots */}
        <div className="flex items-center gap-1">
          {card.labels?.map(label => (
            <span
              key={label.id}
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: label.color }}
              title={label.name}
            />
          ))}
        </div>

        {/* Hover-reveal actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {!isEditing && (
            <button
              onClick={e => { e.stopPropagation(); startEditing(); }}
              className="text-surface-500 hover:text-surface-300 p-0.5 transition-colors"
              title="Edit title"
            >
              <Pencil size={12} />
            </button>
          )}

          {confirmingDelete ? (
            <button
              onClick={e => { e.stopPropagation(); handleDeleteClick(); }}
              className="text-red-400 hover:text-red-300 text-[10px] font-medium transition-colors"
            >
              Delete?
            </button>
          ) : (
            <button
              onClick={e => { e.stopPropagation(); handleDeleteClick(); }}
              className="text-surface-500 hover:text-red-400 p-0.5 transition-colors"
              title="Delete card"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default KanbanCard;
