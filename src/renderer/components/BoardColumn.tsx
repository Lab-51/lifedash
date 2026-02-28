// === FILE PURPOSE ===
// BoardColumn — renders a single Kanban column with drop target, card list, and add-card form.
// Supports drag-and-drop for both cards (into column) and column reordering.

// === DEPENDENCIES ===
// react, lucide-react, @atlaskit/pragmatic-drag-and-drop, @atlaskit/pragmatic-drag-and-drop-hitbox,
// KanbanCard, shared types

import { memo, useRef, useState, useEffect, useCallback } from 'react';
import { Plus, X, GripVertical, ChevronDown } from 'lucide-react';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { attachClosestEdge, extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import type { Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import KanbanCard from './KanbanCard';
import type { Card, Column, UpdateCardInput, CardPriority } from '../../shared/types';
import type { CardTemplate } from '../../shared/types/cards';
import { toast } from '../hooks/useToast';
import { BUILTIN_TEMPLATES, type BuiltinTemplate } from '../constants/card-templates';

interface BoardColumnProps {
  column: Column;
  columnCards: Card[];
  totalCardCount?: number;
  isDragOver: boolean;
  onDragOverChange: (isOver: boolean) => void;
  projectId?: string;
  addCard: (columnId: string, title: string, priority?: CardPriority) => Promise<Card>;
  updateCard: (id: string, data: UpdateCardInput) => Promise<void>;
  deleteCard: (id: string) => Promise<void>;
  deleteColumn: (id: string) => Promise<void>;
  renameColumn: (id: string, name: string) => Promise<void>;
  onCardClick: (cardId: string) => void;
  justDroppedCardId: string | null;
  blockedCardIds?: Set<string>;
  dependencyCountMap?: Map<string, number>;
}

const BoardColumn = memo(function BoardColumn({
  column,
  columnCards,
  totalCardCount,
  isDragOver,
  onDragOverChange,
  projectId,
  addCard,
  updateCard,
  deleteCard,
  deleteColumn,
  renameColumn,
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
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameName, setRenameName] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Template state for card creation
  const [showCreateTemplateDropdown, setShowCreateTemplateDropdown] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<BuiltinTemplate | CardTemplate | null>(null);
  const [dbTemplates, setDbTemplates] = useState<CardTemplate[]>([]);
  const [hasTemplates, setHasTemplates] = useState<boolean | null>(null);
  const createTemplateDropdownRef = useRef<HTMLDivElement>(null);

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

  // Focus the rename input when entering rename mode
  useEffect(() => {
    if (isRenaming) renameInputRef.current?.focus();
  }, [isRenaming]);

  // Check if any templates exist (to show/hide "From template" link)
  useEffect(() => {
    if (!addingCard) return;
    (async () => {
      try {
        const templates = await window.electronAPI.getCardTemplates(projectId);
        setDbTemplates(templates);
        setHasTemplates(templates.length > 0 || BUILTIN_TEMPLATES.length > 0);
      } catch {
        setHasTemplates(BUILTIN_TEMPLATES.length > 0);
      }
    })();
  }, [addingCard, projectId]);

  // Close create-template dropdown on outside click
  useEffect(() => {
    if (!showCreateTemplateDropdown) return;
    const handleClick = (e: MouseEvent) => {
      if (createTemplateDropdownRef.current && !createTemplateDropdownRef.current.contains(e.target as Node)) {
        setShowCreateTemplateDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showCreateTemplateDropdown]);

  const handleRenameSave = useCallback(async () => {
    const trimmed = renameName.trim();
    if (trimmed && trimmed !== column.name) {
      await renameColumn(column.id, trimmed);
    }
    setIsRenaming(false);
  }, [renameName, column.name, column.id, renameColumn]);

  const handleAddCard = async () => {
    const title = newCardTitle.trim();
    if (!title) return;
    const priority = selectedTemplate?.priority;
    const newCard = await addCard(column.id, title, priority);
    // Apply template description if selected
    if (selectedTemplate && selectedTemplate.description) {
      try {
        await updateCard(newCard.id, { description: selectedTemplate.description });
      } catch {
        toast('Card created but template description failed to apply', 'error');
      }
    }
    setNewCardTitle('');
    setSelectedTemplate(null);
    setShowCreateTemplateDropdown(false);
    setAddingCard(false);
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
          {isRenaming ? (
            <input
              ref={renameInputRef}
              type="text"
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              onBlur={handleRenameSave}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameSave();
                else if (e.key === 'Escape') setIsRenaming(false);
              }}
              onClick={(e) => e.stopPropagation()}
              className="font-semibold text-sm text-surface-100 bg-surface-700 rounded px-1 -mx-1 w-full outline-none focus:ring-1 focus:ring-primary-500"
            />
          ) : (
            <span
              className="font-semibold text-sm text-surface-200 cursor-text"
              onDoubleClick={(e) => {
                e.stopPropagation();
                setIsRenaming(true);
                setRenameName(column.name);
              }}
            >
              {column.name}
            </span>
          )}
          <span className="text-xs text-surface-500 bg-surface-700 px-1.5 py-0.5 rounded">
            {totalCardCount != null && totalCardCount !== columnCards.length
              ? `${columnCards.length} of ${totalCardCount}`
              : columnCards.length}
          </span>
        </div>

        {/* Delete button */}
        {deleteConfirm ? (
          <button
            onClick={handleDeleteColumn}
            className="text-xs text-red-400 hover:text-red-300 transition-colors"
          >
            {columnCards.length > 0 ? `Delete column + ${columnCards.length} cards?` : 'Delete column?'}
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

            {/* Template selector for card creation */}
            {hasTemplates && (
              <div className="relative" ref={createTemplateDropdownRef}>
                <button
                  className="text-xs text-surface-400 hover:text-surface-300 mt-0.5 inline-flex items-center gap-1"
                  onClick={() => setShowCreateTemplateDropdown(!showCreateTemplateDropdown)}
                >
                  From template <ChevronDown size={10} />
                </button>

                {showCreateTemplateDropdown && (
                  <div className="absolute bottom-full left-0 mb-1 bg-surface-800 border border-surface-700 rounded-lg shadow-lg py-1 min-w-[200px] z-40 max-h-48 overflow-y-auto">
                    {dbTemplates.length > 0 && (
                      <>
                        <div className="px-3 py-1 text-xs text-surface-500 uppercase tracking-wide">
                          Your Templates
                        </div>
                        {dbTemplates.map(t => (
                          <button
                            key={t.id}
                            onClick={() => { setSelectedTemplate(t); setShowCreateTemplateDropdown(false); }}
                            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-surface-200 hover:bg-surface-700 transition-colors text-left"
                          >
                            <span className="truncate">{t.name}</span>
                          </button>
                        ))}
                        <div className="border-t border-surface-700 my-1" />
                      </>
                    )}
                    {dbTemplates.length > 0 && (
                      <div className="px-3 py-1 text-xs text-surface-500 uppercase tracking-wide">
                        Built-in
                      </div>
                    )}
                    {BUILTIN_TEMPLATES.map(t => (
                      <button
                        key={t.id}
                        onClick={() => { setSelectedTemplate(t); setShowCreateTemplateDropdown(false); }}
                        className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-surface-200 hover:bg-surface-700 transition-colors text-left"
                      >
                        <span>{t.icon}</span>
                        {t.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Selected template badge */}
            {selectedTemplate && (
              <div className="flex items-center gap-1 text-xs text-blue-400 mt-0.5">
                <span>Using: {selectedTemplate.name}</span>
                <button
                  onClick={() => setSelectedTemplate(null)}
                  className="text-surface-500 hover:text-surface-300"
                >
                  <X size={10} />
                </button>
              </div>
            )}

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
                  setSelectedTemplate(null);
                  setShowCreateTemplateDropdown(false);
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
