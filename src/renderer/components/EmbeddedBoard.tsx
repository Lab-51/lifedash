// === FILE PURPOSE ===
// EmbeddedBoard — the interactive Kanban core (toolbar + columns + cards +
// drag-drop + quick-add + card detail modal), extracted from BoardPageModern so
// it can be mounted BOTH inside the full board page (BoardPageModern wraps it
// with page chrome + the AI agent) AND inside SessionWorkspace's Board tab.
//
// It owns the board controller (a SINGLE useBoardController instance — one drag
// monitor, one load effect) and accepts the project via prop, so no route param
// is required when embedded. Behaviour is identical to the original board body;
// KanbanCardModern's Reject/Keep menu is preserved (it renders through the
// unchanged BoardColumnModern).

import { Suspense, lazy, useState } from 'react';
import {
  ArrowLeft,
  Plus,
  X,
  Search,
  ChevronDown,
  SlidersHorizontal,
  Settings2,
  Pencil,
  Trash2,
  Check,
  ChevronsDownUp,
  ChevronsUpDown,
} from 'lucide-react';
import { useBoardController } from '../hooks/useBoardController';
import LoadingSpinner from './LoadingSpinner';
import BoardColumnModern from './BoardColumnModern';
import { ConfirmDialog } from './ConfirmDialog';
import type { CardPriority } from '../../shared/types';

const CardDetailModal = lazy(() => import('./CardDetailModal'));

const LABEL_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

interface EmbeddedBoardProps {
  /** Project whose board to render. Passed explicitly so this works outside the /projects/:projectId route. */
  projectId: string;
  /**
   * Whether this board is the foreground instance (default true). Route boards
   * pass `false` while the full-screen LiveModeOverlay covers them, so the covered
   * (invisible) board neither loads/stomps the shared store nor registers a second
   * document-scoped drag monitor. Re-activating reloads its own project.
   */
  active?: boolean;
  /**
   * Optional card-open override used by the LiveModeOverlay to open a card WITHOUT
   * touching the shared router URL (which belongs to the route beneath the overlay
   * portal). When provided, the controller opens `openCardId` once it's present in
   * the loaded board and calls `onConsumed()` instead of the ?openCard= param.
   * Omitted on the real routes (SessionWorkspace), which keep the URL param.
   */
  cardOpen?: { openCardId: string | null; onConsumed: () => void };
}

export default function EmbeddedBoard({ projectId, active = true, cardOpen }: EmbeddedBoardProps) {
  const {
    columns,
    cards: filteredCards,
    allCards,
    labels,
    loading,
    error,
    loadBoard,
    addColumn,
    deleteColumn,
    addCard,
    updateCard,
    deleteCard,
    updateColumn,
    addingColumn,
    setAddingColumn,
    newColumnName,
    setNewColumnName,
    dragOverColumnId,
    justDroppedCardId,
    selectedCard,
    setSelectedCardId,
    searchQuery,
    setSearchQuery,
    priorityFilter,
    togglePriorityFilter,
    labelFilter,
    toggleLabelFilter,
    showPriorityDropdown,
    setShowPriorityDropdown,
    showLabelDropdown,
    setShowLabelDropdown,
    clearFilters,
    hasActiveFilters,
    columnInputRef,
    searchInputRef,
    priorityDropdownRef,
    labelDropdownRef,
    createLabel,
    updateLabel,
    deleteLabel,
    labelUsageCounts,
    handleDragOverChange,
    blockedCardIds,
    dependencyCountMap,
    getCardsByColumn,
  } = useBoardController(projectId, active, cardOpen);

  // Collapsed columns state
  const [collapsedColumns, setCollapsedColumns] = useState<Set<string>>(new Set());
  const toggleColumnCollapse = (id: string) => {
    setCollapsedColumns((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const allColumnsCollapsed = columns.length > 0 && collapsedColumns.size === columns.length;
  const toggleCollapseAll = () => {
    if (allColumnsCollapsed) {
      setCollapsedColumns(new Set());
    } else {
      setCollapsedColumns(new Set(columns.map((c) => c.id)));
    }
  };

  // Label delete confirmation state
  const [deleteLabelConfirm, setDeleteLabelConfirm] = useState<{ id: string; count: number } | null>(null);

  // Label management state
  const [managingLabels, setManagingLabels] = useState(false);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [editLabelName, setEditLabelName] = useState('');
  const [editLabelColor, setEditLabelColor] = useState('');
  const [addingNewLabel, setAddingNewLabel] = useState(false);
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState(LABEL_COLORS[0]);

  const startEditLabel = (label: { id: string; name: string; color: string }) => {
    setEditingLabelId(label.id);
    setEditLabelName(label.name);
    setEditLabelColor(label.color);
  };

  const saveEditLabel = async () => {
    if (!editingLabelId || !editLabelName.trim()) return;
    await updateLabel(editingLabelId, { name: editLabelName.trim(), color: editLabelColor });
    setEditingLabelId(null);
  };

  const handleDeleteLabel = async (id: string) => {
    const count = labelUsageCounts.get(id) ?? 0;
    if (count > 0) {
      setDeleteLabelConfirm({ id, count });
      return;
    }
    await deleteLabel(id);
    if (labelFilter.includes(id)) toggleLabelFilter(id);
  };

  const confirmDeleteLabel = async () => {
    if (!deleteLabelConfirm) return;
    await deleteLabel(deleteLabelConfirm.id);
    if (labelFilter.includes(deleteLabelConfirm.id)) toggleLabelFilter(deleteLabelConfirm.id);
    setDeleteLabelConfirm(null);
  };

  const handleAddLabel = async () => {
    if (!newLabelName.trim()) return;
    await createLabel(newLabelName.trim(), newLabelColor);
    setNewLabelName('');
    setNewLabelColor(LABEL_COLORS[0]);
    setAddingNewLabel(false);
  };

  const handleColumnKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      void addColumn();
    } else if (e.key === 'Escape') {
      setNewColumnName('');
      setAddingColumn(false);
    }
  };

  return (
    <div data-testid="embedded-board" className="flex-1 flex flex-col min-w-0 overflow-hidden">
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <LoadingSpinner size="lg" label="Loading board..." />
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <p className="text-red-400 text-sm font-medium">{error}</p>
          <button
            onClick={() => projectId && loadBoard(projectId)}
            className="bg-primary-600 hover:bg-primary-500 text-white px-5 py-2.5 rounded-xl text-sm font-medium shadow-sm transition-all hover:scale-105 active:scale-95"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          {/* Toolbar */}
          <div className="flex items-center gap-3 px-8 pt-6 pb-4 shrink-0">
            {/* Search */}
            <div className="relative flex-1 max-w-sm group">
              <Search
                size={16}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] group-focus-within:text-[var(--color-accent)] transition-colors"
              />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search cards..."
                className="w-full bg-[var(--color-accent-subtle)] border border-[var(--color-border)] rounded-xl pl-10 pr-10 py-2.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-dim)] focus:border-[var(--color-accent-dim)] transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 p-0.5 rounded-full hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="w-px h-8 bg-[var(--color-border-accent)] mx-1" />

            {/* Filters */}
            <div className="relative" ref={priorityDropdownRef}>
              <button
                onClick={() => {
                  setShowPriorityDropdown(!showPriorityDropdown);
                  setShowLabelDropdown(false);
                }}
                className={`flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl border transition-all ${
                  priorityFilter.length > 0
                    ? 'border-[var(--color-accent-dim)] bg-[var(--color-accent-subtle)] text-[var(--color-accent)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-accent)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                <SlidersHorizontal size={16} />
                Priority
                {priorityFilter.length > 0 && (
                  <span className="bg-primary-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-[0.625rem] shadow-sm">
                    {priorityFilter.length}
                  </span>
                )}
                <ChevronDown size={14} className="opacity-50" />
              </button>

              {showPriorityDropdown && (
                <div className="absolute top-full left-0 mt-2 bg-white dark:bg-surface-900 border border-[var(--color-border)] rounded-2xl shadow-xl p-2 min-w-[200px] z-40 animate-in fade-in zoom-in-95 duration-200">
                  <div className="px-3 py-2 text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider">
                    Filter by Priority
                  </div>
                  {[
                    { value: 'low' as CardPriority, label: 'Low', dot: 'bg-emerald-500' },
                    { value: 'medium' as CardPriority, label: 'Medium', dot: 'bg-blue-500' },
                    { value: 'high' as CardPriority, label: 'High', dot: 'bg-amber-500' },
                    { value: 'urgent' as CardPriority, label: 'Urgent', dot: 'bg-red-500' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => togglePriorityFilter(opt.value)}
                      className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium text-[var(--color-text-secondary)] hover:bg-surface-100 dark:hover:bg-surface-800 hover:text-[var(--color-text-primary)] transition-colors group"
                    >
                      <span
                        className={`w-2.5 h-2.5 rounded-full ${opt.dot} ring-2 ring-white dark:ring-surface-900 shadow-sm`}
                      />
                      <span className="flex-1 text-left">{opt.label}</span>
                      {priorityFilter.includes(opt.value) && (
                        <span className="text-primary-600 dark:text-primary-400 font-bold bg-primary-50 dark:bg-primary-900/20 px-2 py-0.5 rounded text-xs">
                          Active
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="relative" ref={labelDropdownRef}>
              <button
                onClick={() => {
                  setShowLabelDropdown(!showLabelDropdown);
                  setShowPriorityDropdown(false);
                  if (showLabelDropdown) {
                    setManagingLabels(false);
                    setEditingLabelId(null);
                    setAddingNewLabel(false);
                  }
                }}
                className={`flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl border transition-all ${
                  labelFilter.length > 0
                    ? 'border-[var(--color-accent-dim)] bg-[var(--color-accent-subtle)] text-[var(--color-accent)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-accent)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                Labels
                {labelFilter.length > 0 && (
                  <span className="bg-primary-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-[0.625rem] shadow-sm">
                    {labelFilter.length}
                  </span>
                )}
                <ChevronDown size={14} className="opacity-50" />
              </button>

              {showLabelDropdown && (
                <div className="absolute top-full left-0 mt-2 bg-white dark:bg-surface-900 border border-[var(--color-border)] rounded-2xl shadow-xl p-2 min-w-[260px] z-40 animate-in fade-in zoom-in-95 duration-200">
                  {!managingLabels ? (
                    <>
                      {/* Filter Mode */}
                      <div className="px-3 py-2 text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider">
                        Filter by Label
                      </div>
                      {labels.length === 0 ? (
                        <p className="text-sm text-surface-500 px-4 py-3 italic">No labels yet</p>
                      ) : (
                        labels.map((label) => (
                          <button
                            key={label.id}
                            onClick={() => toggleLabelFilter(label.id)}
                            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium text-[var(--color-text-secondary)] hover:bg-surface-100 dark:hover:bg-surface-800 hover:text-[var(--color-text-primary)] transition-colors"
                          >
                            <span
                              className="w-3 h-3 rounded-full shrink-0 ring-2 ring-white dark:ring-surface-900 shadow-sm"
                              style={{ backgroundColor: label.color }}
                            />
                            <span className="flex-1 text-left">{label.name}</span>
                            {labelFilter.includes(label.id) && (
                              <span className="text-primary-600 dark:text-primary-400 font-bold bg-primary-50 dark:bg-primary-900/20 px-2 py-0.5 rounded text-xs">
                                Active
                              </span>
                            )}
                          </button>
                        ))
                      )}
                      <div className="h-px bg-surface-100 dark:bg-surface-700 my-1" />
                      <button
                        onClick={() => {
                          setManagingLabels(true);
                          setEditingLabelId(null);
                          setAddingNewLabel(false);
                        }}
                        className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl text-sm font-medium text-surface-500 hover:text-surface-700 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                      >
                        <Settings2 size={14} />
                        Manage Labels
                      </button>
                    </>
                  ) : (
                    <>
                      {/* Manage Mode */}
                      <div className="flex items-center gap-2 px-3 py-2">
                        <button
                          onClick={() => setManagingLabels(false)}
                          className="p-0.5 rounded text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 transition-colors"
                        >
                          <ArrowLeft size={14} />
                        </button>
                        <span className="text-xs font-semibold text-surface-400 uppercase tracking-wider">
                          Manage Labels
                        </span>
                      </div>
                      {labels.length === 0 ? (
                        <p className="text-sm text-surface-500 px-4 py-3 italic">No labels yet</p>
                      ) : (
                        labels.map((label) => {
                          const count = labelUsageCounts.get(label.id) ?? 0;
                          if (editingLabelId === label.id) {
                            return (
                              <div key={label.id} className="px-3 py-2 space-y-2">
                                <input
                                  type="text"
                                  value={editLabelName}
                                  onChange={(e) => setEditLabelName(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') void saveEditLabel();
                                    if (e.key === 'Escape') setEditingLabelId(null);
                                  }}
                                  autoFocus
                                  className="w-full bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-600 rounded-lg px-2.5 py-1.5 text-sm text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-1 focus:ring-primary-500"
                                />
                                <div className="flex items-center gap-1.5">
                                  {LABEL_COLORS.map((c) => (
                                    <button
                                      key={c}
                                      onClick={() => setEditLabelColor(c)}
                                      className={`w-5 h-5 rounded-full transition-all ${editLabelColor === c ? 'ring-2 ring-primary-500 scale-110' : 'hover:scale-110'}`}
                                      style={{ backgroundColor: c }}
                                    />
                                  ))}
                                  <div className="flex-1" />
                                  <button
                                    onClick={saveEditLabel}
                                    className="p-1 rounded text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
                                  >
                                    <Check size={14} />
                                  </button>
                                  <button
                                    onClick={() => setEditingLabelId(null)}
                                    className="p-1 rounded text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
                                  >
                                    <X size={14} />
                                  </button>
                                </div>
                              </div>
                            );
                          }
                          return (
                            <div
                              key={label.id}
                              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-sm hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors group"
                            >
                              <span
                                className="w-3 h-3 rounded-full shrink-0 ring-2 ring-white dark:ring-surface-900 shadow-sm"
                                style={{ backgroundColor: label.color }}
                              />
                              <span className="flex-1 text-left font-medium text-surface-700 dark:text-surface-200 truncate">
                                {label.name}
                              </span>
                              <span
                                className={`text-[0.625rem] font-medium px-1.5 py-0.5 rounded-full ${count === 0 ? 'text-surface-400 bg-surface-100 dark:bg-surface-700' : 'text-surface-500 bg-surface-100 dark:bg-surface-700'}`}
                              >
                                {count}
                              </span>
                              <button
                                onClick={() => startEditLabel(label)}
                                className="p-1 rounded text-surface-400 opacity-0 group-hover:opacity-100 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-all"
                              >
                                <Pencil size={12} />
                              </button>
                              <button
                                onClick={() => handleDeleteLabel(label.id)}
                                className="p-1 rounded text-surface-400 opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          );
                        })
                      )}
                      <div className="h-px bg-surface-100 dark:bg-surface-700 my-1" />
                      {addingNewLabel ? (
                        <div className="px-3 py-2 space-y-2">
                          <input
                            type="text"
                            value={newLabelName}
                            onChange={(e) => setNewLabelName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void handleAddLabel();
                              if (e.key === 'Escape') setAddingNewLabel(false);
                            }}
                            placeholder="Label name..."
                            autoFocus
                            className="w-full bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-600 rounded-lg px-2.5 py-1.5 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-1 focus:ring-primary-500"
                          />
                          <div className="flex items-center gap-1.5">
                            {LABEL_COLORS.map((c) => (
                              <button
                                key={c}
                                onClick={() => setNewLabelColor(c)}
                                className={`w-5 h-5 rounded-full transition-all ${newLabelColor === c ? 'ring-2 ring-primary-500 scale-110' : 'hover:scale-110'}`}
                                style={{ backgroundColor: c }}
                              />
                            ))}
                            <div className="flex-1" />
                            <button
                              onClick={handleAddLabel}
                              className="p-1 rounded text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
                            >
                              <Check size={14} />
                            </button>
                            <button
                              onClick={() => setAddingNewLabel(false)}
                              className="p-1 rounded text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setAddingNewLabel(true)}
                          className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl text-sm font-medium text-surface-500 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                        >
                          <Plus size={14} />
                          Add Label
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="px-4 py-2.5 text-sm font-medium text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors"
              >
                Clear
              </button>
            )}

            {columns.length > 0 && (
              <>
                <div className="w-px h-8 bg-[var(--color-border-accent)] mx-1" />
                <button
                  onClick={toggleCollapseAll}
                  className="flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-accent)] hover:text-[var(--color-text-primary)] transition-all"
                  title={allColumnsCollapsed ? 'Expand all columns' : 'Collapse all columns'}
                >
                  {allColumnsCollapsed ? <ChevronsUpDown size={16} /> : <ChevronsDownUp size={16} />}
                  {allColumnsCollapsed ? 'Expand All' : 'Collapse All'}
                </button>
              </>
            )}
          </div>

          {/* Board columns area */}
          <div className="flex-1 flex items-start gap-6 overflow-x-auto px-8 pb-8 pt-2 grid-bg">
            {columns.map((column) => (
              <BoardColumnModern
                key={column.id}
                column={column}
                columnCards={getCardsByColumn(filteredCards, column.id)}
                totalCardCount={hasActiveFilters ? getCardsByColumn(allCards, column.id).length : undefined}
                isDragOver={dragOverColumnId === column.id}
                onDragOverChange={(isOver) => handleDragOverChange(column.id, isOver)}
                projectId={projectId}
                addCard={addCard}
                updateCard={updateCard}
                deleteCard={deleteCard}
                deleteColumn={deleteColumn}
                renameColumn={(id, name) => updateColumn(id, { name })}
                updateColumnColor={(id, color) => updateColumn(id, { color })}
                onCardClick={(cardId) => setSelectedCardId(cardId)}
                justDroppedCardId={justDroppedCardId}
                blockedCardIds={blockedCardIds}
                dependencyCountMap={dependencyCountMap}
                isCollapsed={collapsedColumns.has(column.id)}
                onToggleCollapse={toggleColumnCollapse}
              />
            ))}

            {/* Add column placeholder */}
            {addingColumn ? (
              <div className="w-80 shrink-0 bg-surface-100 dark:bg-surface-800/50 rounded-2xl p-4 border border-surface-200 dark:border-surface-700 shadow-sm h-fit">
                <h3 className="text-sm font-bold text-surface-900 dark:text-surface-100 mb-3">New Column</h3>
                <input
                  ref={columnInputRef}
                  type="text"
                  value={newColumnName}
                  onChange={(e) => setNewColumnName(e.target.value)}
                  onKeyDown={handleColumnKeyDown}
                  placeholder="Enter column name..."
                  className="w-full bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-xl px-4 py-2.5 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 mb-3 shadow-sm"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={addColumn}
                    className="flex-1 btn-primary clip-corner-cut-sm text-sm font-medium px-4 py-2"
                  >
                    Create
                  </button>
                  <button
                    onClick={() => {
                      setNewColumnName('');
                      setAddingColumn(false);
                    }}
                    className="flex-1 bg-surface-200 hover:bg-surface-300 dark:bg-surface-700 dark:hover:bg-surface-600 text-surface-600 dark:text-surface-300 text-sm font-medium px-4 py-2 rounded-xl transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAddingColumn(true)}
                className="w-80 shrink-0 h-[100px] border-2 border-dashed border-[var(--color-border)] hover:border-[var(--color-accent-dim)] clip-corner-cut-sm flex flex-col items-center justify-center gap-2 text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] transition-all group"
              >
                <div className="w-10 h-10 rounded-full bg-[var(--color-accent-subtle)] group-hover:bg-[var(--color-accent-muted)] flex items-center justify-center transition-colors border border-[var(--color-border-accent)]">
                  <Plus size={20} className="group-hover:scale-110 transition-transform" />
                </div>
                <span className="text-sm font-hud">Add Column</span>
              </button>
            )}

            {/* Spacer for right padding */}
            <div className="w-2 shrink-0" />
          </div>
        </>
      )}

      {/* Card detail modal */}
      <Suspense fallback={null}>
        {selectedCard && (
          <CardDetailModal card={selectedCard} onUpdate={updateCard} onClose={() => setSelectedCardId(null)} />
        )}
      </Suspense>

      <ConfirmDialog
        open={!!deleteLabelConfirm}
        title="Delete Label"
        message={
          deleteLabelConfirm
            ? `This label is on ${deleteLabelConfirm.count} card${deleteLabelConfirm.count > 1 ? 's' : ''}. Delete it?`
            : ''
        }
        confirmLabel="Delete"
        variant="danger"
        onConfirm={confirmDeleteLabel}
        onCancel={() => setDeleteLabelConfirm(null)}
      />
    </div>
  );
}
