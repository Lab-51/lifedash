// === FILE PURPOSE ===
// Board view page — Classic Design
// Displays the Kanban board for a project.

import { Suspense, lazy } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Plus, X, Search, ChevronDown, Download } from 'lucide-react';
import { useBoardController, exportBoardAsCsv } from '../hooks/useBoardController';
import LoadingSpinner from '../components/LoadingSpinner';
import BoardColumn from '../components/BoardColumn';
import type { CardPriority } from '../../shared/types';

const CardDetailModal = lazy(() => import('../components/CardDetailModal'));

export default function BoardPageClassic() {
    const {
        projectId,
        project,
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
        handleDragOverChange,
        blockedCardIds,
        dependencyCountMap,
        getCardsByColumn,
    } = useBoardController();

    const handleColumnKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            addColumn();
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
                            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${priorityFilter.length > 0
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
                            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${labelFilter.length > 0
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
                        onClick={() => exportBoardAsCsv(columns, allCards, labels)}
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
                            Showing {filteredCards.length} of {allCards.length} cards
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
                        totalCardCount={hasActiveFilters ? getCardsByColumn(allCards, column.id).length : undefined}
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
                                onClick={addColumn}
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
