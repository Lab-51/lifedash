// === FILE PURPOSE ===
// Board view page — Modern Design
// Displays the Kanban board for a project with enhanced UI/UX.

import { Suspense, lazy, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Plus, X, Search, ChevronDown, Download, LayoutTemplate, SlidersHorizontal, Settings2, Pencil, Trash2, Check, ChevronsDownUp, ChevronsUpDown, DollarSign } from 'lucide-react';

const LABEL_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
import { useBoardController, exportBoardAsCsv } from '../hooks/useBoardController';
import { useProjectStore } from '../stores/projectStore';
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
        createLabel,
        updateLabel,
        deleteLabel,
        labelUsageCounts,
        handleDragOverChange,
        blockedCardIds,
        dependencyCountMap,
        getCardsByColumn,
    } = useBoardController();

    // Hourly rate — read from projectStore so updates reflect immediately
    const updateProject = useProjectStore(s => s.updateProject);
    const storeProjects = useProjectStore(s => s.projects);
    const liveProject = storeProjects.find(p => p.id === projectId) ?? project;
    const [editingRate, setEditingRate] = useState(false);
    const [editRate, setEditRate] = useState('');
    const handleSaveRate = async () => {
        if (!projectId) return;
        const val = editRate.trim();
        const rate = val ? parseFloat(val) : null;
        if (rate !== null && (isNaN(rate) || rate < 0)) { setEditingRate(false); return; }
        await updateProject(projectId, { hourlyRate: rate });
        setEditingRate(false);
    };

    // Collapsed columns state
    const [collapsedColumns, setCollapsedColumns] = useState<Set<string>>(new Set());
    const toggleColumnCollapse = (id: string) => {
        setCollapsedColumns(prev => {
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
            setCollapsedColumns(new Set(columns.map(c => c.id)));
        }
    };

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
        if (count > 0 && !window.confirm(`This label is on ${count} card${count > 1 ? 's' : ''}. Delete it?`)) return;
        await deleteLabel(id);
        if (labelFilter.includes(id)) toggleLabelFilter(id);
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
                        {editingRate ? (
                            <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl px-3 py-1.5 animate-in fade-in zoom-in-95 duration-150">
                                <div className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
                                    <DollarSign size={16} strokeWidth={2.5} />
                                </div>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={editRate}
                                    onChange={e => setEditRate(e.target.value)}
                                    onBlur={handleSaveRate}
                                    onKeyDown={e => { if (e.key === 'Enter') handleSaveRate(); if (e.key === 'Escape') setEditingRate(false); }}
                                    autoFocus
                                    placeholder="0.00"
                                    className="w-24 text-sm font-semibold bg-white dark:bg-surface-900 border border-green-300 dark:border-green-700 rounded-lg px-3 py-1.5 outline-none focus:outline-none focus:ring-0 focus:border-green-500 focus-visible:outline-none text-surface-900 dark:text-surface-100 placeholder-surface-400 shadow-sm transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                />
                                <span className="text-sm font-medium text-emerald-600/70 dark:text-emerald-400/70">/hr</span>
                                <button
                                    onClick={handleSaveRate}
                                    className="ml-1 p-1 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white transition-colors shadow-sm"
                                >
                                    <Check size={14} />
                                </button>
                                <button
                                    onClick={() => setEditingRate(false)}
                                    className="p-1 rounded-lg text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 hover:bg-surface-200/50 dark:hover:bg-surface-700/50 transition-colors"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        ) : liveProject?.hourlyRate ? (
                            <button
                                onClick={() => { setEditingRate(true); setEditRate(String(liveProject.hourlyRate)); }}
                                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 rounded-xl transition-all"
                            >
                                <DollarSign size={16} />{liveProject.hourlyRate}/hr
                            </button>
                        ) : (
                            <button
                                onClick={() => { setEditingRate(true); setEditRate(''); }}
                                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-surface-500 dark:text-surface-400 border border-dashed border-surface-300 dark:border-surface-700 hover:border-emerald-400 hover:text-emerald-600 dark:hover:text-emerald-400 rounded-xl transition-all"
                            >
                                <DollarSign size={16} />Set rate
                            </button>
                        )}
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
                            className="w-full bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-xl pl-10 pr-10 py-2.5 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 transition-all shadow-sm"
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
                            onClick={() => { setShowLabelDropdown(!showLabelDropdown); setShowPriorityDropdown(false); if (showLabelDropdown) { setManagingLabels(false); setEditingLabelId(null); setAddingNewLabel(false); } }}
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
                            <div className="absolute top-full left-0 mt-2 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl shadow-xl p-2 min-w-[260px] z-40 animate-in fade-in zoom-in-95 duration-200">
                                {!managingLabels ? (
                                    <>
                                        {/* Filter Mode */}
                                        <div className="px-3 py-2 text-xs font-semibold text-surface-400 uppercase tracking-wider">Filter by Label</div>
                                        {labels.length === 0 ? (
                                            <p className="text-sm text-surface-500 px-4 py-3 italic">No labels yet</p>
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
                                        <div className="h-px bg-surface-100 dark:bg-surface-700 my-1" />
                                        <button
                                            onClick={() => { setManagingLabels(true); setEditingLabelId(null); setAddingNewLabel(false); }}
                                            className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl text-sm font-medium text-surface-500 hover:text-surface-700 dark:hover:text-surface-200 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors"
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
                                            <span className="text-xs font-semibold text-surface-400 uppercase tracking-wider">Manage Labels</span>
                                        </div>
                                        {labels.length === 0 ? (
                                            <p className="text-sm text-surface-500 px-4 py-3 italic">No labels yet</p>
                                        ) : (
                                            labels.map(label => {
                                                const count = labelUsageCounts.get(label.id) ?? 0;
                                                if (editingLabelId === label.id) {
                                                    return (
                                                        <div key={label.id} className="px-3 py-2 space-y-2">
                                                            <input
                                                                type="text"
                                                                value={editLabelName}
                                                                onChange={e => setEditLabelName(e.target.value)}
                                                                onKeyDown={e => { if (e.key === 'Enter') saveEditLabel(); if (e.key === 'Escape') setEditingLabelId(null); }}
                                                                autoFocus
                                                                className="w-full bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-600 rounded-lg px-2.5 py-1.5 text-sm text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-1 focus:ring-primary-500"
                                                            />
                                                            <div className="flex items-center gap-1.5">
                                                                {LABEL_COLORS.map(c => (
                                                                    <button
                                                                        key={c}
                                                                        onClick={() => setEditLabelColor(c)}
                                                                        className={`w-5 h-5 rounded-full transition-all ${editLabelColor === c ? 'ring-2 ring-primary-500 scale-110' : 'hover:scale-110'}`}
                                                                        style={{ backgroundColor: c }}
                                                                    />
                                                                ))}
                                                                <div className="flex-1" />
                                                                <button onClick={saveEditLabel} className="p-1 rounded text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
                                                                    <Check size={14} />
                                                                </button>
                                                                <button onClick={() => setEditingLabelId(null)} className="p-1 rounded text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors">
                                                                    <X size={14} />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    );
                                                }
                                                return (
                                                    <div
                                                        key={label.id}
                                                        className="flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-sm hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors group"
                                                    >
                                                        <span
                                                            className="w-3 h-3 rounded-full shrink-0 ring-2 ring-white dark:ring-surface-800 shadow-sm"
                                                            style={{ backgroundColor: label.color }}
                                                        />
                                                        <span className="flex-1 text-left font-medium text-surface-700 dark:text-surface-200 truncate">{label.name}</span>
                                                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${count === 0 ? 'text-surface-400 bg-surface-100 dark:bg-surface-700' : 'text-surface-500 bg-surface-100 dark:bg-surface-700'}`}>
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
                                                    onChange={e => setNewLabelName(e.target.value)}
                                                    onKeyDown={e => { if (e.key === 'Enter') handleAddLabel(); if (e.key === 'Escape') setAddingNewLabel(false); }}
                                                    placeholder="Label name..."
                                                    autoFocus
                                                    className="w-full bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-600 rounded-lg px-2.5 py-1.5 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-1 focus:ring-primary-500"
                                                />
                                                <div className="flex items-center gap-1.5">
                                                    {LABEL_COLORS.map(c => (
                                                        <button
                                                            key={c}
                                                            onClick={() => setNewLabelColor(c)}
                                                            className={`w-5 h-5 rounded-full transition-all ${newLabelColor === c ? 'ring-2 ring-primary-500 scale-110' : 'hover:scale-110'}`}
                                                            style={{ backgroundColor: c }}
                                                        />
                                                    ))}
                                                    <div className="flex-1" />
                                                    <button onClick={handleAddLabel} className="p-1 rounded text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
                                                        <Check size={14} />
                                                    </button>
                                                    <button onClick={() => setAddingNewLabel(false)} className="p-1 rounded text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors">
                                                        <X size={14} />
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => setAddingNewLabel(true)}
                                                className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl text-sm font-medium text-surface-500 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors"
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
                            <div className="w-px h-8 bg-surface-200 dark:bg-surface-700 mx-1" />
                            <button
                                onClick={toggleCollapseAll}
                                className="flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl border border-surface-200 bg-white text-surface-600 dark:bg-surface-800 dark:border-surface-700 dark:text-surface-300 hover:border-surface-300 dark:hover:border-surface-600 hover:bg-surface-50 dark:hover:bg-surface-700 shadow-sm transition-all"
                                title={allColumnsCollapsed ? 'Expand all columns' : 'Collapse all columns'}
                            >
                                {allColumnsCollapsed ? <ChevronsUpDown size={16} /> : <ChevronsDownUp size={16} />}
                                {allColumnsCollapsed ? 'Expand All' : 'Collapse All'}
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Board Layout */}
            <div className="flex-1 flex items-start gap-6 overflow-x-auto px-8 pb-8 pt-6">
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
                            onChange={e => setNewColumnName(e.target.value)}
                            onKeyDown={handleColumnKeyDown}
                            placeholder="Enter column name..."
                            className="w-full bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-xl px-4 py-2.5 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 mb-3 shadow-sm"
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
