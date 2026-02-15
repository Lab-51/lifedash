// === FILE PURPOSE ===
// Board view page — displays the Kanban board for a project.
// Renders columns with cards, supports adding/deleting columns and cards.
// Supports drag-and-drop of cards between columns and column reordering via pragmatic-drag-and-drop.

// === DEPENDENCIES ===
// react (useEffect, useState, useRef, useCallback), react-router-dom (useParams, Link),
// lucide-react (ArrowLeft, Plus, X, Search, ChevronDown), boardStore, LoadingSpinner,
// BoardColumn, CardDetailModal,
// @atlaskit/pragmatic-drag-and-drop (monitorForElements), closest-edge

import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useEffect, useState, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import { ArrowLeft, Plus, X, Search, ChevronDown, Download } from 'lucide-react';
import {
  monitorForElements,
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { useBoardStore, getCardsByColumn } from '../stores/boardStore';
import LoadingSpinner from '../components/LoadingSpinner';
const CardDetailModal = lazy(() => import('../components/CardDetailModal'));
import BoardColumn from '../components/BoardColumn';
import type { CardPriority, Column, Card, Label } from '../../shared/types';

// === CSV Export utility ===

function exportBoardAsCsv(columns: Column[], cards: Card[], labels: Label[]) {
  const headers = ['Column', 'Title', 'Description', 'Priority', 'Due Date', 'Labels', 'Created', 'Updated'];
  const rows = cards.map(card => {
    const col = columns.find(c => c.id === card.columnId);
    const cardLabels = card.labels?.map(l => l.name).join('; ') ?? '';
    const desc = card.description?.replace(/<[^>]*>/g, '').replace(/"/g, '""').trim() ?? '';
    return [
      col?.name ?? '',
      card.title.replace(/"/g, '""'),
      desc,
      card.priority,
      card.dueDate ?? '',
      cardLabels,
      new Date(card.createdAt).toLocaleDateString(),
      new Date(card.updatedAt).toLocaleDateString(),
    ].map(v => `"${v}"`).join(',');
  });
  const csv = [headers.join(','), ...rows].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `board-export-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// === BoardPage — main board layout with drag monitor ===

function BoardPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const project = useBoardStore(s => s.project);
  const columns = useBoardStore(s => s.columns);
  const cards = useBoardStore(s => s.cards);
  const labels = useBoardStore(s => s.labels);
  const relationships = useBoardStore(s => s.relationships);
  const loading = useBoardStore(s => s.loading);
  const error = useBoardStore(s => s.error);
  const loadBoard = useBoardStore(s => s.loadBoard);
  const addColumn = useBoardStore(s => s.addColumn);
  const deleteColumn = useBoardStore(s => s.deleteColumn);
  const addCard = useBoardStore(s => s.addCard);
  const updateCard = useBoardStore(s => s.updateCard);
  const deleteCard = useBoardStore(s => s.deleteCard);
  const moveCard = useBoardStore(s => s.moveCard);
  const updateColumn = useBoardStore(s => s.updateColumn);
  const reorderColumns = useBoardStore(s => s.reorderColumns);

  // Local UI state for add-column form
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);
  const [justDroppedCardId, setJustDroppedCardId] = useState<string | null>(null);

  const columnInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const selectedCard = selectedCardId
    ? cards.find(c => c.id === selectedCardId) ?? null
    : null;

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<CardPriority[]>([]);
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  const [showPriorityDropdown, setShowPriorityDropdown] = useState(false);
  const [showLabelDropdown, setShowLabelDropdown] = useState(false);
  const priorityDropdownRef = useRef<HTMLDivElement>(null);
  const labelDropdownRef = useRef<HTMLDivElement>(null);

  const hasActiveFilters = searchQuery !== '' || priorityFilter.length > 0 || labelFilter.length > 0;

  // A card is "blocked" if:
  // - It is the TARGET of a 'blocks' relationship (someone blocks it)
  // - It is the SOURCE of a 'depends_on' relationship (it depends on something)
  const blockedCardIds = useMemo(() => {
    const blocked = new Set<string>();
    for (const rel of relationships) {
      if (rel.type === 'blocks') {
        blocked.add(rel.targetCardId);
      } else if (rel.type === 'depends_on') {
        blocked.add(rel.sourceCardId);
      }
    }
    return blocked;
  }, [relationships]);

  // Count relationships per card
  const dependencyCountMap = useMemo(() => {
    const counts = new Map<string, number>();
    for (const rel of relationships) {
      counts.set(rel.sourceCardId, (counts.get(rel.sourceCardId) ?? 0) + 1);
      counts.set(rel.targetCardId, (counts.get(rel.targetCardId) ?? 0) + 1);
    }
    return counts;
  }, [relationships]);

  // Compute filtered cards
  const filteredCards = cards.filter(card => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesTitle = card.title.toLowerCase().includes(query);
      const matchesDesc = card.description?.toLowerCase().includes(query) ?? false;
      if (!matchesTitle && !matchesDesc) return false;
    }
    if (priorityFilter.length > 0 && !priorityFilter.includes(card.priority)) {
      return false;
    }
    if (labelFilter.length > 0) {
      const cardLabelIds = card.labels?.map(l => l.id) ?? [];
      if (!labelFilter.some(id => cardLabelIds.includes(id))) return false;
    }
    return true;
  });

  const clearFilters = () => {
    setSearchQuery('');
    setPriorityFilter([]);
    setLabelFilter([]);
  };

  const togglePriorityFilter = (p: CardPriority) => {
    setPriorityFilter(prev =>
      prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
    );
  };

  const toggleLabelFilter = (id: string) => {
    setLabelFilter(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  // Load board data on mount
  useEffect(() => {
    if (projectId) {
      loadBoard(projectId);
    }
  }, [projectId, loadBoard]);

  // Open card from URL search param (e.g. ?openCard=<id> from command palette)
  useEffect(() => {
    const openCardId = searchParams.get('openCard');
    if (openCardId && !loading && cards.length > 0) {
      setSelectedCardId(openCardId);
      // Clean up the URL param so it doesn't re-open on re-render
      searchParams.delete('openCard');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, loading, cards.length]);

  // Focus column input when adding
  useEffect(() => {
    if (addingColumn && columnInputRef.current) {
      columnInputRef.current.focus();
    }
  }, [addingColumn]);

  // Clear drop animation after it completes
  useEffect(() => {
    if (!justDroppedCardId) return;
    const timer = setTimeout(() => setJustDroppedCardId(null), 300);
    return () => clearTimeout(timer);
  }, [justDroppedCardId]);

  // Close filter dropdowns on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (priorityDropdownRef.current && !priorityDropdownRef.current.contains(e.target as Node)) {
        setShowPriorityDropdown(false);
      }
      if (labelDropdownRef.current && !labelDropdownRef.current.contains(e.target as Node)) {
        setShowLabelDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Global keyboard shortcuts: "/" to focus search, Escape to close dropdowns
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setShowPriorityDropdown(false);
        setShowLabelDropdown(false);
        searchInputRef.current?.blur();
      }
    };
    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // Board-level drag monitor — handles card moves (cross-column and within-column reorder)
  useEffect(() => {
    return monitorForElements({
      canMonitor: ({ source }) => source.data.type === 'card',
      onDrop: ({ source, location }) => {
        const dropTargets = location.current.dropTargets;
        if (dropTargets.length === 0) return;

        const cardId = source.data.cardId as string;
        const sourceColumnId = source.data.sourceColumnId as string;
        const sourcePosition = source.data.sourcePosition as number;

        if (!cardId) return;

        // Check if we dropped on a card target (reorder) or just a column target (append)
        const cardTarget = dropTargets.find(t => t.data.type === 'card');
        const columnTarget = dropTargets.find(t => t.data.columnId && t.data.type !== 'card');

        if (cardTarget) {
          // Dropped on a specific card — insert above or below it
          const targetColumnId = cardTarget.data.columnId as string;
          const targetPosition = cardTarget.data.position as number;
          const edge = extractClosestEdge(cardTarget.data);

          let newPosition: number;
          if (sourceColumnId === targetColumnId) {
            // Same-column reorder
            if (edge === 'top') {
              newPosition = sourcePosition < targetPosition
                ? targetPosition - 1
                : targetPosition;
            } else {
              newPosition = sourcePosition < targetPosition
                ? targetPosition
                : targetPosition + 1;
            }
            // No-op if position did not change
            if (newPosition === sourcePosition) return;
          } else {
            // Cross-column: insert at target position edge
            newPosition = edge === 'top' ? targetPosition : targetPosition + 1;
          }

          moveCard(cardId, targetColumnId, newPosition);
        } else if (columnTarget) {
          // Dropped on empty area of column — append to end
          const targetColumnId = columnTarget.data.columnId as string;
          if (sourceColumnId === targetColumnId) return; // No-op for same column empty area
          const targetCards = getCardsByColumn(cards, targetColumnId);
          moveCard(cardId, targetColumnId, targetCards.length);
        }

        setDragOverColumnId(null);

        // Track dropped card for bounce-settle animation
        if (cardId) {
          setJustDroppedCardId(cardId);
        }
      },
    });
  }, [cards, moveCard]);

  // Board-level drag monitor — handles column reordering
  useEffect(() => {
    return monitorForElements({
      canMonitor: ({ source }) => source.data.type === 'column',
      onDrop: ({ source, location }) => {
        const dropTargets = location.current.dropTargets;
        if (dropTargets.length === 0) return;

        const sourceColumnId = source.data.columnId as string;
        const columnTarget = dropTargets.find(t => t.data.type === 'column');
        if (!columnTarget) return;

        const targetColumnId = columnTarget.data.columnId as string;
        if (sourceColumnId === targetColumnId) return;

        const edge = extractClosestEdge(columnTarget.data);

        // Calculate new column order
        const currentOrder = columns.map(c => c.id);
        const sourceIndex = currentOrder.indexOf(sourceColumnId);
        currentOrder.splice(sourceIndex, 1);

        const newTargetIndex = currentOrder.indexOf(targetColumnId);
        const insertIndex = edge === 'left' ? newTargetIndex : newTargetIndex + 1;
        currentOrder.splice(insertIndex, 0, sourceColumnId);

        reorderColumns(currentOrder);
      },
    });
  }, [columns, reorderColumns]);

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
      <div className="px-6 pt-6 pb-4 shrink-0 space-y-3">
        <div className="flex items-center gap-3">
          <Link
            to="/projects"
            className="text-surface-400 hover:text-surface-200 transition-colors"
          >
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-2xl font-bold text-surface-100 flex-1">
            {project?.name ?? 'Board'}
          </h1>

          {/* Search input */}
          <div className="relative flex-shrink-0">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-500" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search cards..."
              className="bg-surface-800 border border-surface-700 rounded-lg pl-8 pr-8 py-1.5 text-sm text-surface-100 placeholder:text-surface-500 focus:outline-none focus:border-primary-500 w-48"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-surface-500 hover:text-surface-300"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Priority filter */}
          <div className="relative" ref={priorityDropdownRef}>
            <button
              onClick={() => { setShowPriorityDropdown(!showPriorityDropdown); setShowLabelDropdown(false); }}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                priorityFilter.length > 0
                  ? 'border-primary-500/50 text-primary-400 bg-primary-500/10'
                  : 'border-surface-700 text-surface-400 hover:text-surface-200 bg-surface-800'
              }`}
            >
              Priority
              {priorityFilter.length > 0 && (
                <span className="bg-primary-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px]">
                  {priorityFilter.length}
                </span>
              )}
              <ChevronDown size={12} />
            </button>

            {showPriorityDropdown && (
              <div className="absolute top-full right-0 mt-1 bg-surface-800 border border-surface-700 rounded-lg shadow-lg p-2 min-w-[160px] z-40">
                {([
                  { value: 'low' as CardPriority, label: 'Low', dot: 'bg-emerald-500' },
                  { value: 'medium' as CardPriority, label: 'Medium', dot: 'bg-blue-500' },
                  { value: 'high' as CardPriority, label: 'High', dot: 'bg-amber-500' },
                  { value: 'urgent' as CardPriority, label: 'Urgent', dot: 'bg-red-500' },
                ]).map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => togglePriorityFilter(opt.value)}
                    className="flex items-center gap-2 w-full px-2 py-1.5 rounded text-xs text-surface-200 hover:bg-surface-700 transition-colors"
                  >
                    <span className={`w-2 h-2 rounded-full ${opt.dot}`} />
                    <span className="flex-1 text-left">{opt.label}</span>
                    {priorityFilter.includes(opt.value) && (
                      <span className="text-primary-400 text-[10px] font-bold">&#x2713;</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Label filter */}
          <div className="relative" ref={labelDropdownRef}>
            <button
              onClick={() => { setShowLabelDropdown(!showLabelDropdown); setShowPriorityDropdown(false); }}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                labelFilter.length > 0
                  ? 'border-primary-500/50 text-primary-400 bg-primary-500/10'
                  : 'border-surface-700 text-surface-400 hover:text-surface-200 bg-surface-800'
              }`}
            >
              Labels
              {labelFilter.length > 0 && (
                <span className="bg-primary-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px]">
                  {labelFilter.length}
                </span>
              )}
              <ChevronDown size={12} />
            </button>

            {showLabelDropdown && (
              <div className="absolute top-full right-0 mt-1 bg-surface-800 border border-surface-700 rounded-lg shadow-lg p-2 min-w-[160px] z-40">
                {labels.length === 0 ? (
                  <p className="text-xs text-surface-500 px-2 py-1">No labels</p>
                ) : (
                  labels.map(label => (
                    <button
                      key={label.id}
                      onClick={() => toggleLabelFilter(label.id)}
                      className="flex items-center gap-2 w-full px-2 py-1.5 rounded text-xs text-surface-200 hover:bg-surface-700 transition-colors"
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: label.color }}
                      />
                      <span className="flex-1 text-left">{label.name}</span>
                      {labelFilter.includes(label.id) && (
                        <span className="text-primary-400 text-[10px] font-bold">&#x2713;</span>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Export CSV */}
          <button
            onClick={() => exportBoardAsCsv(columns, cards, labels)}
            className="flex items-center gap-1.5 text-xs text-surface-400 hover:text-surface-200 px-2 py-1 rounded hover:bg-surface-700"
            title="Export board as CSV"
          >
            <Download size={14} />
            Export CSV
          </button>
        </div>

        {/* Active filter indicator */}
        {hasActiveFilters && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-surface-500">
              Showing {filteredCards.length} of {cards.length} cards
            </span>
            <button
              onClick={clearFilters}
              className="text-xs text-primary-400 hover:text-primary-300 transition-colors"
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      {/* Empty filter state */}
      {hasActiveFilters && filteredCards.length === 0 && (
        <div className="text-center py-12">
          <p className="text-surface-400 text-sm">No cards match your filters.</p>
          <button onClick={clearFilters} className="text-xs text-primary-400 hover:text-primary-300 mt-2">
            Clear filters
          </button>
        </div>
      )}

      {/* Column container */}
      <div className="flex-1 flex gap-4 overflow-x-auto px-6 pb-6">
        {/* Columns */}
        {columns.map(column => (
          <BoardColumn
            key={column.id}
            column={column}
            columnCards={getCardsByColumn(filteredCards, column.id)}
            isDragOver={dragOverColumnId === column.id}
            onDragOverChange={(isOver) => handleDragOverChange(column.id, isOver)}
            addCard={addCard}
            updateCard={updateCard}
            deleteCard={deleteCard}
            deleteColumn={deleteColumn}
            renameColumn={(id, name) => updateColumn(id, { name })}
            onCardClick={(cardId) => setSelectedCardId(cardId)}
            justDroppedCardId={justDroppedCardId}
            blockedCardIds={blockedCardIds}
            dependencyCountMap={dependencyCountMap}
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

      {/* Card detail modal */}
      <Suspense fallback={null}>
        {selectedCard && (
          <CardDetailModal
            card={selectedCard}
            onUpdate={updateCard}
            onClose={() => setSelectedCardId(null)}
          />
        )}
      </Suspense>
    </div>
  );
}

export default BoardPage;
