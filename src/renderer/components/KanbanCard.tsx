// === FILE PURPOSE ===
// KanbanCard — renders a single card in a Kanban column.
// Shows priority border, priority badge, label dots, due date badge, and hover actions.
// Supports inline title editing and delete with confirmation.

// === DEPENDENCIES ===
// react, lucide-react (Pencil, Trash2, Clock), shared types (Card, UpdateCardInput),
// @atlaskit/pragmatic-drag-and-drop (draggable, dropTargetForElements),
// @atlaskit/pragmatic-drag-and-drop-hitbox (attachClosestEdge, extractClosestEdge)

import { memo, useState, useRef, useEffect } from 'react';
import { Pencil, Trash2, Clock } from 'lucide-react';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { attachClosestEdge, extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import type { Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import type { Card, UpdateCardInput } from '../../shared/types';
import { getDueDateBadge } from '../utils/date-utils';

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

const KanbanCard = memo(function KanbanCard({ card, onUpdate, onDelete, onClick }: KanbanCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [justDropped, setJustDropped] = useState(false);
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null);
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

  // Clear drop-bounce animation after it completes
  useEffect(() => {
    if (!justDropped) return;
    const timer = setTimeout(() => setJustDropped(false), 300);
    return () => clearTimeout(timer);
  }, [justDropped]);

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
      onDrop: () => {
        setIsDragging(false);
        setJustDropped(true);
      },
    });
  }, [card.id, card.columnId, card.position]);

  // Set up drop target behavior — allows cards to be dropped on this card
  // to reorder within the same column or insert at a specific position cross-column
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    return dropTargetForElements({
      element: el,
      canDrop: ({ source }) =>
        source.data.type === 'card' && source.data.cardId !== card.id,
      getData: ({ input, element }) => {
        const data: Record<string, unknown> = {
          type: 'card',
          cardId: card.id,
          columnId: card.columnId,
          position: card.position,
        };
        return attachClosestEdge(data, {
          input,
          element,
          allowedEdges: ['top', 'bottom'],
        });
      },
      onDragEnter: ({ self }) => {
        setClosestEdge(extractClosestEdge(self.data));
      },
      onDrag: ({ self }) => {
        setClosestEdge(extractClosestEdge(self.data));
      },
      onDragLeave: () => setClosestEdge(null),
      onDrop: () => setClosestEdge(null),
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
      className={`group relative bg-surface-800 rounded-md p-3 border-l-2 cursor-pointer hover:bg-surface-700/50 transition-colors ${priority.border}`}
      style={
        isDragging
          ? { animation: 'card-grab 200ms ease-out forwards' }
          : justDropped
            ? { animation: 'card-drop 300ms ease-out' }
            : undefined
      }
    >
      {/* Drop edge indicators */}
      {closestEdge === 'top' && (
        <div className="absolute -top-0.5 left-0 right-0 h-0.5 bg-blue-500 rounded-full" />
      )}
      {closestEdge === 'bottom' && (
        <div className="absolute -bottom-0.5 left-0 right-0 h-0.5 bg-blue-500 rounded-full" />
      )}

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
        {/* Label dots + due date badge */}
        <div className="flex items-center gap-1.5">
          {card.labels?.map(label => (
            <span
              key={label.id}
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: label.color }}
              title={label.name}
            />
          ))}
          {card.dueDate && (
            <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${getDueDateBadge(card.dueDate).classes}`}>
              <Clock size={10} />
              {getDueDateBadge(card.dueDate).label}
            </span>
          )}
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
});

export default KanbanCard;
