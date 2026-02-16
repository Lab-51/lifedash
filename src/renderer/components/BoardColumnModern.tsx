// === FILE PURPOSE ===
// BoardColumnModern — renders a single Kanban column with modern styling.

import { memo, useRef, useState, useEffect, useCallback } from 'react';
import { Plus, X, GripVertical, MoreHorizontal } from 'lucide-react';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { attachClosestEdge, extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import type { Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import KanbanCardModern from './KanbanCardModern';
import type { Card, Column, UpdateCardInput } from '../../shared/types';

interface BoardColumnProps {
    column: Column;
    columnCards: Card[];
    totalCardCount?: number;
    isDragOver: boolean;
    onDragOverChange: (isOver: boolean) => void;
    addCard: (columnId: string, title: string) => Promise<void>;
    updateCard: (id: string, data: UpdateCardInput) => Promise<void>;
    deleteCard: (id: string) => Promise<void>;
    deleteColumn: (id: string) => Promise<void>;
    renameColumn: (id: string, name: string) => Promise<void>;
    onCardClick: (cardId: string) => void;
    justDroppedCardId: string | null;
    blockedCardIds?: Set<string>;
    dependencyCountMap?: Map<string, number>;
}

const BoardColumnModern = memo(function BoardColumnModern({
    column,
    columnCards,
    totalCardCount,
    isDragOver,
    onDragOverChange,
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

    // Combined drag-and-drop setup
    useEffect(() => {
        const el = columnRef.current;
        const handleEl = headerRef.current;
        if (!el || !handleEl) return;

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

    // Auto-dismiss delete confirmation
    useEffect(() => {
        if (!deleteConfirm) return;
        const timer = setTimeout(() => setDeleteConfirm(false), 2000);
        return () => clearTimeout(timer);
    }, [deleteConfirm]);

    // Focus rename input
    useEffect(() => {
        if (isRenaming) renameInputRef.current?.focus();
    }, [isRenaming]);

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
        await addCard(column.id, title);
        setNewCardTitle('');
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
            className={`w-80 shrink-0 flex flex-col bg-surface-50 dark:bg-surface-900/50 rounded-2xl border border-surface-200 dark:border-surface-800/50 transition-all relative ${isDragOver ? 'ring-2 ring-primary-500/30 bg-primary-50/50 dark:bg-primary-900/10' : ''
                } ${isDragging ? 'opacity-50 scale-95 rotate-1' : ''}`}
        >
            {/* Column reorder edge indicators */}
            {closestColumnEdge === 'left' && (
                <div className="absolute -left-1 top-0 bottom-0 w-1 bg-primary-500 rounded-full z-10 box-content border-2 border-white dark:border-surface-900" />
            )}
            {closestColumnEdge === 'right' && (
                <div className="absolute -right-1 top-0 bottom-0 w-1 bg-primary-500 rounded-full z-10 box-content border-2 border-white dark:border-surface-900" />
            )}

            {/* Column header (drag handle) */}
            <div ref={headerRef} className="group px-4 py-3 flex items-center justify-between cursor-grab active:cursor-grabbing border-b border-transparent hover:border-surface-200 dark:hover:border-surface-700 transition-colors rounded-t-2xl">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    <GripVertical size={16} className="text-surface-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />

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
                            className="font-bold text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 rounded px-2 py-1 w-full outline-none ring-2 ring-primary-500 shadow-sm"
                        />
                    ) : (
                        <div
                            className="flex items-center gap-2 truncate"
                            onDoubleClick={(e) => {
                                e.stopPropagation();
                                setIsRenaming(true);
                                setRenameName(column.name);
                            }}
                        >
                            <h3 className="font-bold text-sm text-surface-700 dark:text-surface-200 truncate cursor-text hover:text-surface-900 dark:hover:text-surface-100 transition-colors">
                                {column.name}
                            </h3>
                            <span className="bg-surface-200 dark:bg-surface-800 text-surface-600 dark:text-surface-400 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                                {columnCards.length}
                            </span>
                        </div>
                    )}
                </div>

                {/* Delete button */}
                {deleteConfirm ? (
                    <button
                        onClick={handleDeleteColumn}
                        className="text-xs font-semibold text-red-500 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                    >
                        Confirm?
                    </button>
                ) : (
                    <button
                        onClick={handleDeleteColumn}
                        className="opacity-0 group-hover:opacity-100 p-1 text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 hover:bg-surface-200 dark:hover:bg-surface-700 rounded transition-all"
                    >
                        <MoreHorizontal size={16} />
                    </button>
                )}
            </div>

            {/* Card list */}
            <div className="flex-1 px-3 pb-3 overflow-y-auto flex flex-col gap-3 min-h-[100px]">
                {columnCards.map(card => (
                    <KanbanCardModern
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
                {columnCards.length === 0 && !addingCard && (
                    <div className="flex flex-col items-center justify-center py-8 text-surface-400 border-2 border-dashed border-surface-200 dark:border-surface-800 rounded-xl">
                        <p className="text-xs font-medium">No cards</p>
                        <button
                            onClick={() => setAddingCard(true)}
                            className="mt-2 text-xs text-primary-600 hover:underline"
                        >
                            Create one
                        </button>
                    </div>
                )}
            </div>

            {/* Add card form */}
            <div className="px-3 pb-3 pt-1 sticky bottom-0 bg-gradient-to-t from-surface-50 via-surface-50 to-transparent dark:from-surface-900 dark:via-surface-900 rounded-b-2xl z-10">
                {addingCard ? (
                    <div className="flex flex-col gap-2 bg-white dark:bg-surface-800 p-2 rounded-xl shadow-lg border border-surface-200 dark:border-surface-700 animate-in slide-in-from-bottom-2">
                        <input
                            ref={cardInputRef}
                            type="text"
                            value={newCardTitle}
                            onChange={e => setNewCardTitle(e.target.value)}
                            onKeyDown={handleCardKeyDown}
                            placeholder="Enter card title..."
                            className="w-full bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-lg px-3 py-2 text-sm text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all font-medium placeholder:font-normal"
                        />
                        <div className="flex items-center justify-between gap-2">
                            <button
                                onClick={() => {
                                    setNewCardTitle('');
                                    setAddingCard(false);
                                }}
                                className="text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 text-xs font-medium px-2 py-1.5 rounded hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => handleAddCard()}
                                className="bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-sm transition-all"
                            >
                                Create Card
                            </button>
                        </div>
                    </div>
                ) : (
                    <button
                        onClick={() => setAddingCard(true)}
                        className="flex items-center justify-center gap-1.5 text-surface-500 hover:text-primary-600 dark:hover:text-primary-400 text-sm font-medium w-full px-3 py-2.5 rounded-xl transition-all hover:bg-white dark:hover:bg-surface-800 hover:shadow-sm border border-transparent hover:border-surface-200 dark:hover:border-surface-700"
                    >
                        <Plus size={16} />
                        <span>Add Card</span>
                    </button>
                )}
            </div>
        </div>
    );
});

export default BoardColumnModern;
