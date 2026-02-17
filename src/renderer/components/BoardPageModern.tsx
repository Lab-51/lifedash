// === FILE PURPOSE ===
// Board view page — Modern Design
// Displays the Kanban board for a project with enhanced UI/UX.

import { Suspense, lazy } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Plus, X, Search, ChevronDown, Download, LayoutTemplate, SlidersHorizontal } from 'lucide-react';
import { useBoardController, exportBoardAsCsv } from '../hooks/useBoardController';
import LoadingSpinner from '../components/LoadingSpinner';
import BoardColumnModern from '../components/BoardColumnModern';
import type { CardPriority } from '../../shared/types';

const CardDetailModal = lazy(() => import('../components/CardDetailModal'));

export default function BoardPageModern() {
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

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <LoadingSpinner size="lg" label="Loading board..." />
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center gap-4">
                <p className="text-red-400 text-sm font-medium">{error}</p>
                <button
                    onClick={() => projectId && loadBoard(projectId)}
                    className="bg-primary-600 hover:bg-primary-500 text-white px-5 py-2.5 rounded-xl text-sm font-medium shadow-sm transition-all hover:scale-105 active:scale-95"
                >
                    Retry
                </button>
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col bg-surface-50 dark:bg-surface-950">
            {/* Modern Header */}
            <div className="px-8 pt-8 pb-6 shrink-0 bg-white dark:bg-surface-900 border-b border-surface-200 dark:border-surface-800">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-4">
                        <Link
                            to="/projects"
                            className="p-2 -ml-2 rounded-xl text-surface-400 hover:text-surface-900 dark:hover:text-surface-100 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                        >
                            <ArrowLeft size={24} />
                        </Link>
                        <div>
                            <h1 className="text-3xl font-light tracking-tight text-surface-900 dark:text-surface-50 flex items-center gap-2">
                                {project?.name ?? 'Board'}
                            </h1>
                            <p className="text-surface-500 mt-1 flex items-center gap-2 text-sm font-medium">
                                <LayoutTemplate size={14} />
                                Kanban View
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => exportBoardAsCsv(columns, allCards, labels)}
                            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-surface-600 dark:text-surface-300 bg-surface-100 dark:bg-surface-800 hover:bg-surface-200 dark:hover:bg-surface-700 rounded-xl transition-all"
                        >
                            <Download size={16} />
                            Export
                        </button>
                    </div>
                </div>

                {/* Toolbar */}
                <div className="flex items-center gap-3">
                    {/* Search */}
                    <div className="relative flex-1 max-w-sm group">
                        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-surface-400 group-focus-within:text-primary-500 transition-colors" />
                        <input
                            ref={searchInputRef}
                            type="text"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Search cards..."
                            className="w-full bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-xl pl-10 pr-10 py-2.5 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all shadow-sm"
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

                    <div className="w-px h-8 bg-surface-200 dark:bg-surface-700 mx-1" />

                    {/* Filters */}
                    <div className="relative" ref={priorityDropdownRef}>
                        <button
                            onClick={() => { setShowPriorityDropdown(!showPriorityDropdown); setShowLabelDropdown(false); }}
                            className={`flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl border transition-all ${priorityFilter.length > 0
                                    ? 'border-primary-200 bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:border-primary-800 dark:text-primary-300 shadow-sm'
                                    : 'border-surface-200 bg-white text-surface-600 dark:bg-surface-800 dark:border-surface-700 dark:text-surface-300 hover:border-surface-300 dark:hover:border-surface-600 hover:bg-surface-50 dark:hover:bg-surface-700 shadow-sm'
                                }`}
                        >
                            <SlidersHorizontal size={16} />
                            Priority
                            {priorityFilter.length > 0 && (
                                <span className="bg-primary-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] shadow-sm">
                                    {priorityFilter.length}
                                </span>
                            )}
                            <ChevronDown size={14} className="opacity-50" />
                        </button>

                        {showPriorityDropdown && (
                            <div className="absolute top-full left-0 mt-2 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl shadow-xl p-2 min-w-[200px] z-40 animate-in fade-in zoom-in-95 duration-200">
                                <div className="px-3 py-2 text-xs font-semibold text-surface-400 uppercase tracking-wider">Filter by Priority</div>
                                {([
                                    { value: 'low' as CardPriority, label: 'Low', dot: 'bg-emerald-500' },
                                    { value: 'medium' as CardPriority, label: 'Medium', dot: 'bg-blue-500' },
                                    { value: 'high' as CardPriority, label: 'High', dot: 'bg-amber-500' },
                                    { value: 'urgent' as CardPriority, label: 'Urgent', dot: 'bg-red-500' },
                                ]).map(opt => (
                                    <button
                                        key={opt.value}
                                        onClick={() => togglePriorityFilter(opt.value)}
                                        className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium text-surface-700 dark:text-surface-200 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors group"
                                    >
                                        <span className={`w-2.5 h-2.5 rounded-full ${opt.dot} ring-2 ring-white dark:ring-surface-800 shadow-sm`} />
                                        <span className="flex-1 text-left">{opt.label}</span>
                                        {priorityFilter.includes(opt.value) && (
                                            <span className="text-primary-600 dark:text-primary-400 font-bold bg-primary-50 dark:bg-primary-900/20 px-2 py-0.5 rounded text-xs">Active</span>
                                        )}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="relative" ref={labelDropdownRef}>
                        <button
                            onClick={() => { setShowLabelDropdown(!showLabelDropdown); setShowPriorityDropdown(false); }}
                            className={`flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl border transition-all ${labelFilter.length > 0
                                    ? 'border-primary-200 bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:border-primary-800 dark:text-primary-300 shadow-sm'
                                    : 'border-surface-200 bg-white text-surface-600 dark:bg-surface-800 dark:border-surface-700 dark:text-surface-300 hover:border-surface-300 dark:hover:border-surface-600 hover:bg-surface-50 dark:hover:bg-surface-700 shadow-sm'
                                }`}
                        >
                            Labels
                            {labelFilter.length > 0 && (
                                <span className="bg-primary-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] shadow-sm">
                                    {labelFilter.length}
                                </span>
                            )}
                            <ChevronDown size={14} className="opacity-50" />
                        </button>

                        {showLabelDropdown && (
                            <div className="absolute top-full left-0 mt-2 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl shadow-xl p-2 min-w-[200px] z-40 animate-in fade-in zoom-in-95 duration-200">
                                <div className="px-3 py-2 text-xs font-semibold text-surface-400 uppercase tracking-wider">Filter by Label</div>
                                {labels.length === 0 ? (
                                    <p className="text-sm text-surface-500 px-4 py-3 italic">No labels found</p>
                                ) : (
                                    labels.map(label => (
                                        <button
                                            key={label.id}
                                            onClick={() => toggleLabelFilter(label.id)}
                                            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium text-surface-700 dark:text-surface-200 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors"
                                        >
                                            <span
                                                className="w-3 h-3 rounded-full shrink-0 ring-2 ring-white dark:ring-surface-800 shadow-sm"
                                                style={{ backgroundColor: label.color }}
                                            />
                                            <span className="flex-1 text-left">{label.name}</span>
                                            {labelFilter.includes(label.id) && (
                                                <span className="text-primary-600 dark:text-primary-400 font-bold bg-primary-50 dark:bg-primary-900/20 px-2 py-0.5 rounded text-xs">Active</span>
                                            )}
                                        </button>
                                    ))
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
                </div>
            </div>

            {/* Board Layout */}
            <div className="flex-1 flex gap-6 overflow-x-auto px-8 pb-8 pt-6">
                {columns.map(column => (
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
                        onCardClick={(cardId) => setSelectedCardId(cardId)}
                        justDroppedCardId={justDroppedCardId}
                        blockedCardIds={blockedCardIds}
                        dependencyCountMap={dependencyCountMap}
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
                            onChange={e => setNewColumnName(e.target.value)}
                            onKeyDown={handleColumnKeyDown}
                            placeholder="Enter column name..."
                            className="w-full bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-xl px-4 py-2.5 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 mb-3 shadow-sm"
                        />
                        <div className="flex items-center gap-2">
                            <button
                                onClick={addColumn}
                                className="flex-1 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-2 rounded-xl transition-all shadow-sm"
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
                        className="w-80 shrink-0 h-[100px] border-2 border-dashed border-surface-300 dark:border-surface-700 hover:border-primary-400 dark:hover:border-primary-500 rounded-2xl flex flex-col items-center justify-center gap-2 text-surface-500 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-all group"
                    >
                        <div className="w-10 h-10 rounded-full bg-surface-200 dark:bg-surface-800 group-hover:bg-primary-100 dark:group-hover:bg-primary-900/30 flex items-center justify-center transition-colors">
                            <Plus size={20} className="group-hover:scale-110 transition-transform" />
                        </div>
                        <span className="text-sm font-medium">Add Column</span>
                    </button>
                )}

                {/* Spacer for right padding */}
                <div className="w-2 shrink-0" />
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
