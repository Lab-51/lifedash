// === FILE PURPOSE ===
// Board view page — displays the Kanban board for a project.
// Renders columns with cards, supports adding/deleting columns and cards.
// Supports drag-and-drop of cards between columns via pragmatic-drag-and-drop.

// === DEPENDENCIES ===
// react (useEffect, useState, useRef, useCallback), react-router-dom (useParams, Link),
// lucide-react (ArrowLeft, Plus, X), boardStore, LoadingSpinner, KanbanCard,
// @atlaskit/pragmatic-drag-and-drop (dropTargetForElements, monitorForElements)

import { useParams, Link } from 'react-router-dom';
import { useEffect, useState, useRef, useCallback } from 'react';
import { ArrowLeft, Plus, X } from 'lucide-react';
import {
  dropTargetForElements,
  monitorForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { useBoardStore, getCardsByColumn } from '../stores/boardStore';
import LoadingSpinner from '../components/LoadingSpinner';
import KanbanCard from '../components/KanbanCard';
import type { Card, Column, UpdateCardInput } from '../../shared/types';

// === BoardColumn — renders a single column with drop target behavior ===

interface BoardColumnProps {
  column: Column;
  columnCards: Card[];
  isDragOver: boolean;
  onDragOverChange: (isOver: boolean) => void;
  addCard: (columnId: string, title: string) => Promise<void>;
  updateCard: (id: string, data: UpdateCardInput) => Promise<void>;
  deleteCard: (id: string) => Promise<void>;
  deleteColumn: (id: string) => Promise<void>;
}

function BoardColumn({
  column,
  columnCards,
  isDragOver,
  onDragOverChange,
  addCard,
  updateCard,
  deleteCard,
  deleteColumn,
}: BoardColumnProps) {
  const columnRef = useRef<HTMLDivElement>(null);
  const cardInputRef = useRef<HTMLInputElement>(null);
  const [addingCard, setAddingCard] = useState(false);
  const [newCardTitle, setNewCardTitle] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // Drop target setup
  useEffect(() => {
    const el = columnRef.current;
    if (!el) return;

    return dropTargetForElements({
      element: el,
      getData: () => ({ columnId: column.id }),
      canDrop: ({ source }) => source.data.type === 'card',
      getIsSticky: () => true,
      onDragEnter: () => onDragOverChange(true),
      onDragLeave: () => onDragOverChange(false),
      onDrop: () => onDragOverChange(false),
    });
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
      className={`w-72 shrink-0 flex flex-col bg-surface-800/50 rounded-lg transition-all ${
        isDragOver ? 'ring-2 ring-primary-500/50 ring-inset' : ''
      }`}
    >
      {/* Column header */}
      <div className="group px-3 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
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
}

// === BoardPage — main board layout with drag monitor ===

function BoardPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const {
    project, columns, cards, loading, error,
    loadBoard, addColumn, deleteColumn, addCard, updateCard, deleteCard, moveCard,
  } = useBoardStore();

  // Local UI state for add-column form
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);

  const columnInputRef = useRef<HTMLInputElement>(null);

  // Load board data on mount
  useEffect(() => {
    if (projectId) {
      loadBoard(projectId);
    }
  }, [projectId, loadBoard]);

  // Focus column input when adding
  useEffect(() => {
    if (addingColumn && columnInputRef.current) {
      columnInputRef.current.focus();
    }
  }, [addingColumn]);

  // Board-level drag monitor — handles card moves on drop
  useEffect(() => {
    return monitorForElements({
      canMonitor: ({ source }) => source.data.type === 'card',
      onDrop: ({ source, location }) => {
        const dropTargets = location.current.dropTargets;
        if (dropTargets.length === 0) return;

        const targetColumnId = dropTargets[0].data.columnId as string;
        const cardId = source.data.cardId as string;
        const sourceColumnId = source.data.sourceColumnId as string;

        if (!targetColumnId || !cardId) return;

        // Don't move if dropped back in the same column
        if (sourceColumnId === targetColumnId) return;

        // Calculate position: append to end of target column
        const targetCards = getCardsByColumn(cards, targetColumnId);
        const newPosition = targetCards.length;

        moveCard(cardId, targetColumnId, newPosition);
        setDragOverColumnId(null);
      },
    });
  }, [cards, moveCard]);

  // Stable callback for drag-over state changes
  const handleDragOverChange = useCallback(
    (columnId: string, isOver: boolean) => {
      setDragOverColumnId(isOver ? columnId : null);
    },
    [],
  );

  // --- Column form handlers ---

  const handleAddColumn = async () => {
    const name = newColumnName.trim();
    if (!name) return;
    await addColumn(name);
    setNewColumnName('');
    setAddingColumn(false);
  };

  const handleColumnKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddColumn();
    } else if (e.key === 'Escape') {
      setNewColumnName('');
      setAddingColumn(false);
    }
  };

  // --- Loading state ---
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <LoadingSpinner size="lg" label="Loading board..." />
      </div>
    );
  }

  // --- Error state ---
  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <p className="text-red-400 text-sm">{error}</p>
        <button
          onClick={() => projectId && loadBoard(projectId)}
          className="bg-primary-600 hover:bg-primary-500 text-white px-4 py-2 rounded-lg text-sm transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  // --- Main board layout ---
  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 pt-6 pb-4 shrink-0">
        <Link
          to="/"
          className="text-surface-400 hover:text-surface-200 transition-colors"
        >
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-2xl font-bold text-surface-100">
          {project?.name ?? 'Board'}
        </h1>
      </div>

      {/* Column container */}
      <div className="flex-1 flex gap-4 overflow-x-auto px-6 pb-6">
        {/* Columns */}
        {columns.map(column => (
          <BoardColumn
            key={column.id}
            column={column}
            columnCards={getCardsByColumn(cards, column.id)}
            isDragOver={dragOverColumnId === column.id}
            onDragOverChange={(isOver) => handleDragOverChange(column.id, isOver)}
            addCard={addCard}
            updateCard={updateCard}
            deleteCard={deleteCard}
            deleteColumn={deleteColumn}
          />
        ))}

        {/* Add column placeholder */}
        {addingColumn ? (
          <div className="w-72 shrink-0 bg-surface-800/50 rounded-lg p-3">
            <input
              ref={columnInputRef}
              type="text"
              value={newColumnName}
              onChange={e => setNewColumnName(e.target.value)}
              onKeyDown={handleColumnKeyDown}
              placeholder="Column name..."
              className="bg-surface-900 border border-surface-700 rounded-lg px-3 py-2 text-sm text-surface-100 placeholder:text-surface-500 focus:outline-none focus:border-primary-500 w-full mb-2"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleAddColumn}
                className="bg-primary-600 hover:bg-primary-500 text-white text-xs px-3 py-1.5 rounded-md transition-colors"
              >
                Add Column
              </button>
              <button
                onClick={() => {
                  setNewColumnName('');
                  setAddingColumn(false);
                }}
                className="text-surface-500 hover:text-surface-300 text-xs transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAddingColumn(true)}
            className="w-72 shrink-0 border-2 border-dashed border-surface-700 rounded-lg flex items-center justify-center gap-2 text-surface-500 hover:text-surface-300 hover:border-surface-600 transition-colors min-h-[80px]"
          >
            <Plus size={16} />
            <span className="text-sm">Add Column</span>
          </button>
        )}
      </div>
    </div>
  );
}

export default BoardPage;
