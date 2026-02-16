// === FILE PURPOSE ===
// Board Controller Hook
// Encapsulates all state and logic for the Kanban board, including data loading,
// filtering, drag-and-drop monitoring, and user actions.

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { useBoardStore, getCardsByColumn } from '../stores/boardStore';
import type { CardPriority, Column, Card, Label } from '../../shared/types';

// Helper for CSV export
export function exportBoardAsCsv(columns: Column[], cards: Card[], labels: Label[]) {
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

export function useBoardController() {
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

    // UI state
    const [addingColumn, setAddingColumn] = useState(false);
    const [newColumnName, setNewColumnName] = useState('');
    const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);
    const [justDroppedCardId, setJustDroppedCardId] = useState<string | null>(null);
    const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
    const [searchParams, setSearchParams] = useSearchParams();

    // Filter state
    const [searchQuery, setSearchQuery] = useState('');
    const [priorityFilter, setPriorityFilter] = useState<CardPriority[]>([]);
    const [labelFilter, setLabelFilter] = useState<string[]>([]);
    const [showPriorityDropdown, setShowPriorityDropdown] = useState(false);
    const [showLabelDropdown, setShowLabelDropdown] = useState(false);

    // Refs
    const columnInputRef = useRef<HTMLInputElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const priorityDropdownRef = useRef<HTMLDivElement>(null);
    const labelDropdownRef = useRef<HTMLDivElement>(null);

    // Derived data
    const selectedCard = selectedCardId ? cards.find(c => c.id === selectedCardId) ?? null : null;
    const hasActiveFilters = searchQuery !== '' || priorityFilter.length > 0 || labelFilter.length > 0;

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

    const dependencyCountMap = useMemo(() => {
        const counts = new Map<string, number>();
        for (const rel of relationships) {
            counts.set(rel.sourceCardId, (counts.get(rel.sourceCardId) ?? 0) + 1);
            counts.set(rel.targetCardId, (counts.get(rel.targetCardId) ?? 0) + 1);
        }
        return counts;
    }, [relationships]);

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

    // Effects
    useEffect(() => {
        if (projectId) {
            loadBoard(projectId);
        }
    }, [projectId, loadBoard]);

    useEffect(() => {
        const openCardId = searchParams.get('openCard');
        if (openCardId && !loading && cards.length > 0) {
            setSelectedCardId(openCardId);
            searchParams.delete('openCard');
            setSearchParams(searchParams, { replace: true });
        }
    }, [searchParams, setSearchParams, loading, cards.length]);

    useEffect(() => {
        if (addingColumn && columnInputRef.current) {
            columnInputRef.current.focus();
        }
    }, [addingColumn]);

    useEffect(() => {
        if (!justDroppedCardId) return;
        const timer = setTimeout(() => setJustDroppedCardId(null), 300);
        return () => clearTimeout(timer);
    }, [justDroppedCardId]);

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

    // Card DnD
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

                const cardTarget = dropTargets.find(t => t.data.type === 'card');
                const columnTarget = dropTargets.find(t => t.data.columnId && t.data.type !== 'card');

                if (cardTarget) {
                    const targetColumnId = cardTarget.data.columnId as string;
                    const targetPosition = cardTarget.data.position as number;
                    const edge = extractClosestEdge(cardTarget.data);

                    let newPosition: number;
                    if (sourceColumnId === targetColumnId) {
                        if (edge === 'top') {
                            newPosition = sourcePosition < targetPosition ? targetPosition - 1 : targetPosition;
                        } else {
                            newPosition = sourcePosition < targetPosition ? targetPosition : targetPosition + 1;
                        }
                        if (newPosition === sourcePosition) return;
                    } else {
                        newPosition = edge === 'top' ? targetPosition : targetPosition + 1;
                    }

                    moveCard(cardId, targetColumnId, newPosition);
                } else if (columnTarget) {
                    const targetColumnId = columnTarget.data.columnId as string;
                    if (sourceColumnId === targetColumnId) return;
                    const targetCards = getCardsByColumn(cards, targetColumnId);
                    moveCard(cardId, targetColumnId, targetCards.length);
                }

                setDragOverColumnId(null);
                if (cardId) setJustDroppedCardId(cardId);
            },
        });
    }, [cards, moveCard]);

    // Column Reorder DnD
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

    const handleDragOverChange = useCallback((columnId: string, isOver: boolean) => {
        setDragOverColumnId(isOver ? columnId : null);
    }, []);

    const handleAddColumn = async () => {
        const name = newColumnName.trim();
        if (!name) return;
        await addColumn(name);
        setNewColumnName('');
        setAddingColumn(false);
    };

    const clearFilters = () => {
        setSearchQuery('');
        setPriorityFilter([]);
        setLabelFilter([]);
    };

    const togglePriorityFilter = (p: CardPriority) => {
        setPriorityFilter(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
    };

    const toggleLabelFilter = (id: string) => {
        setLabelFilter(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    return {
        projectId,
        project,
        columns,
        cards: filteredCards, // return filtered cards
        allCards: cards,
        labels,
        loading,
        error,
        loadBoard,
        addColumn: handleAddColumn,
        deleteColumn,
        addCard,
        updateCard,
        deleteCard,
        moveCard,
        updateColumn,
        // UI state
        addingColumn,
        setAddingColumn,
        newColumnName,
        setNewColumnName,
        dragOverColumnId,
        justDroppedCardId,
        selectedCard,
        selectedCardId,
        setSelectedCardId,
        // Filters
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
        // Refs
        columnInputRef,
        searchInputRef,
        priorityDropdownRef,
        labelDropdownRef,
        // Helpers
        handleDragOverChange,
        blockedCardIds,
        dependencyCountMap,
        getCardsByColumn,
    };
}
