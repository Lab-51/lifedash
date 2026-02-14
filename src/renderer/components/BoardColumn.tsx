// === FILE PURPOSE ===
// BoardColumn — renders a single Kanban column with drop target, card list, and add-card form.
// Supports drag-and-drop for both cards (into column) and column reordering.

// === DEPENDENCIES ===
// react, lucide-react, @atlaskit/pragmatic-drag-and-drop, @atlaskit/pragmatic-drag-and-drop-hitbox,
// KanbanCard, shared types

import { memo, useRef, useState, useEffect } from 'react';
import { Plus, X, GripVertical } from 'lucide-react';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { attachClosestEdge, extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import type { Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import KanbanCard from './KanbanCard';
import type { Card, Column, UpdateCardInput } from '../../shared/types';

interface BoardColumnProps {
  column: Column;
  columnCards: Card[];
  isDragOver: boolean;
  onDragOverChange: (isOver: boolean) => void;
  addCard: (columnId: string, title: string) => Promise<void>;
  updateCard: (id: string, data: UpdateCardInput) => Promise<void>;
  deleteCard: (id: string) => Promise<void>;
  deleteColumn: (id: string) => Promise<void>;
  onCardClick: (cardId: string) => void;
  justDroppedCardId: string | null;
  blockedCardIds?: Set<string>;
  dependencyCountMap?: Map<string, number>;
}

const BoardColumn = memo(function BoardColumn({
  column,
  columnCards,
  isDragOver,
  onDragOverChange,
  addCard,
  updateCard,
  deleteCard,
  deleteColumn,
  onCardClick,
  justDroppedCardId,
  blockedCardIds,
  dependencyCountMap,
}: BoardColumnProps) {
  const columnRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const cardInputRef = useRef<HTMLInputElement>(null);
  const [addingCard, setAddingCard] = useState(false);
  const [newCardTitle, setNewCardTitle] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [closestColumnEdge, setClosestColumnEdge] = useState<Edge | null>(null);

  // Combined drag-and-drop setup: card drop target + column drop target + column draggable
  useEffect(() => {
    const el = columnRef.current;
    const handleEl = headerRef.current;
    if (!el || !handleEl) return;

    // Combined drop target — accepts both card drops and column reorder drops.
    // Two separate dropTargetForElements on the same element conflict, so we merge them.
    const cleanupDrop = dropTargetForElements({
      element: el,
      canDrop: ({ source }) => {
        if (source.data.type === 'card') return true;
        if (source.data.type === 'column') return source.data.columnId !== column.id;
        return false;
      },
      getData: ({ input, element, source }) => {
        if (source.data.type === 'column') {
          return attachClosestEdge(
            { type: 'column', columnId: column.id },
            { input, element, allowedEdges: ['left', 'right'] },
          );
        }
        return { columnId: column.id };
      },
      getIsSticky: () => true,
      onDragEnter: ({ source, self }) => {
        if (source.data.type === 'card') onDragOverChange(true);
        else if (source.data.type === 'column') setClosestColumnEdge(extractClosestEdge(self.data));
      },
      onDrag: ({ source, self }) => {
        if (source.data.type === 'column') setClosestColumnEdge(extractClosestEdge(self.data));
      },
      onDragLeave: ({ source }) => {
        if (source.data.type === 'card') onDragOverChange(false);
        else if (source.data.type === 'column') setClosestColumnEdge(null);
      },
      onDrop: ({ source }) => {
        if (source.data.type === 'card') onDragOverChange(false);
        else if (source.data.type === 'column') setClosestColumnEdge(null);
      },
    });

    // Make column draggable (header is the drag handle)
    const cleanupDraggable = draggable({
      element: el,
      dragHandle: handleEl,
      getInitialData: () => ({
        type: 'column',
        columnId: column.id,
      }),
      onDragStart: () => setIsDragging(true),
      onDrop: () => setIsDragging(false),
    });

    return () => {
      cleanupDrop();
      cleanupDraggable();
    };
  }, [column.id, onDragOverChange]);

  // Focus card input when adding
  useEffect(() => {
    if (addingCard && cardInputRef.current) {
      cardInputRef.current.focus();
    }
  }, [addingCard]);

  // Auto-dismiss delete confirmation after 2 seconds
  useEffect(() => {
    if (!deleteConfirm) return;
    const timer = setTimeout(() => setDeleteConfirm(false), 2000);
    return () => clearTimeout(timer);
  }, [deleteConfirm]);

  const handleAddCard = async () => {
    const title = newCardTitle.trim();
    if (!title) return;
    await addCard(column.id, title);
    setNewCardTitle('');
    // Keep form open for rapid entry
  };

  const handleCardKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddCard();
    } else if (e.key === 'Escape') {
      setNewCardTitle('');
      setAddingCard(false);
    }
  };

  const handleDeleteColumn = async () => {
    if (deleteConfirm) {
      await deleteColumn(column.id);
    } else {
      setDeleteConfirm(true);
    }
  };

  return (
    <div
      ref={columnRef}
      className={`w-72 shrink-0 flex flex-col bg-surface-800/50 rounded-lg transition-all relative ${
        isDragOver ? 'ring-2 ring-primary-500/50 ring-inset' : ''
      } ${isDragging ? 'opacity-40' : ''}`}
    >
      {/* Column reorder edge indicators */}
      {closestColumnEdge === 'left' && (
        <div className="absolute -left-0.5 top-0 bottom-0 w-0.5 bg-blue-500 rounded-full z-10" />
      )}
      {closestColumnEdge === 'right' && (
        <div className="absolute -right-0.5 top-0 bottom-0 w-0.5 bg-blue-500 rounded-full z-10" />
      )}

      {/* Column header (drag handle) */}
      <div ref={headerRef} className="group px-3 py-3 flex items-center justify-between cursor-grab active:cursor-grabbing">
        <div className="flex items-center gap-2">
          <GripVertical size={14} className="text-surface-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          <span className="font-semibold text-sm text-surface-200">
            {column.name}
          </span>
          <span className="text-xs text-surface-500 bg-surface-700 px-1.5 py-0.5 rounded">
            {columnCards.length}
          </span>
        </div>

        {/* Delete button */}
        {deleteConfirm ? (
          <button
            onClick={handleDeleteColumn}
            className="text-xs text-red-400 hover:text-red-300 transition-colors"
          >
            Delete?
          </button>
        ) : (
          <button
            onClick={handleDeleteColumn}
            className="opacity-0 group-hover:opacity-100 text-surface-500 hover:text-surface-300 transition-all"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Card list */}
      <div className="flex-1 px-2 pb-2 overflow-y-auto flex flex-col gap-2">
        {columnCards.map(card => (
          <KanbanCard
            key={card.id}
            card={card}
            onUpdate={updateCard}
            onDelete={deleteCard}
            onClick={() => onCardClick(card.id)}
            justDropped={card.id === justDroppedCardId}
            isBlocked={blockedCardIds?.has(card.id)}
            dependencyCount={dependencyCountMap?.get(card.id) ?? 0}
          />
        ))}
      </div>

      {/* Add card form */}
      <div className="px-2 pb-2">
        {addingCard ? (
          <div className="flex flex-col gap-2">
            <input
              ref={cardInputRef}
              type="text"
              value={newCardTitle}
              onChange={e => setNewCardTitle(e.target.value)}
              onKeyDown={handleCardKeyDown}
              placeholder="Card title..."
              className="bg-surface-900 border border-surface-700 rounded-lg px-3 py-2 text-sm text-surface-100 placeholder:text-surface-500 focus:outline-none focus:border-primary-500 w-full"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleAddCard()}
                className="bg-primary-600 hover:bg-primary-500 text-white text-xs px-3 py-1.5 rounded-md transition-colors"
              >
                Add
              </button>
              <button
                onClick={() => {
                  setNewCardTitle('');
                  setAddingCard(false);
                }}
                className="text-surface-500 hover:text-surface-300 text-xs transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAddingCard(true)}
            className="flex items-center gap-1 text-surface-500 hover:text-surface-300 text-xs w-full px-1 py-1.5 rounded transition-colors"
          >
            <Plus size={14} />
            <span>Add card</span>
          </button>
        )}
      </div>
    </div>
  );
});

export default BoardColumn;
