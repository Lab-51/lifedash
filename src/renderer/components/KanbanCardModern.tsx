// === FILE PURPOSE ===
// KanbanCard Modern — renders a single card in a Kanban column with modern styling.

import { memo, useState, useRef, useEffect } from 'react';
import { Pencil, Trash2, Clock, Link2, AlertCircle, Check } from 'lucide-react';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { attachClosestEdge, extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import type { Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import type { Card, UpdateCardInput } from '../../shared/types';
import { getDueDateBadge } from '../utils/date-utils';
import { toast } from '../hooks/useToast';
import { useBoardStore } from '../stores/boardStore';

interface KanbanCardProps {
    card: Card;
    onUpdate: (id: string, data: UpdateCardInput) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
    onClick?: () => void;
    justDropped?: boolean;
    isBlocked?: boolean;
    dependencyCount?: number;
}

const PRIORITY_STYLES = {
    low: { color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20', border: 'border-emerald-200 dark:border-emerald-800' },
    medium: { color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-blue-200 dark:border-blue-800' },
    high: { color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-200 dark:border-amber-800' },
    urgent: { color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-red-200 dark:border-red-800' },
} as const;

const KanbanCardModern = memo(function KanbanCardModern({ card, onUpdate, onDelete, onClick, justDropped, isBlocked, dependencyCount }: KanbanCardProps) {
    const cardRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [closestEdge, setClosestEdge] = useState<Edge | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [editTitle, setEditTitle] = useState(card.title);
    const editInputRef = useRef<HTMLInputElement>(null);
    const removeCardFromUI = useBoardStore(s => s.removeCardFromUI);
    const restoreCardToUI = useBoardStore(s => s.restoreCardToUI);

    const priorityStyle = PRIORITY_STYLES[card.priority] ?? PRIORITY_STYLES.medium;

    // Auto-focus input when entering edit mode
    useEffect(() => {
        if (isEditing && editInputRef.current) {
            editInputRef.current.focus();
            editInputRef.current.select();
        }
    }, [isEditing]);

    // Set up drag behavior
    useEffect(() => {
        const el = cardRef.current;
        if (!el) return;

        return draggable({
            element: el,
            getInitialData: () => ({
                type: 'card',
                cardId: card.id,
                sourceColumnId: card.columnId,
                sourcePosition: card.position,
            }),
            onDragStart: () => setIsDragging(true),
            onDrop: () => setIsDragging(false),
        });
    }, [card.id, card.columnId, card.position]);

    // Set up drop target behavior
    useEffect(() => {
        const el = cardRef.current;
        if (!el) return;

        return dropTargetForElements({
            element: el,
            canDrop: ({ source }) =>
                source.data.type === 'card' && source.data.cardId !== card.id,
            getData: ({ input, element }) => {
                const data: Record<string, unknown> = {
                    type: 'card',
                    cardId: card.id,
                    columnId: card.columnId,
                    position: card.position,
                };
                return attachClosestEdge(data, {
                    input,
                    element,
                    allowedEdges: ['top', 'bottom'],
                });
            },
            onDragEnter: ({ self }) => {
                setClosestEdge(extractClosestEdge(self.data));
            },
            onDrag: ({ self }) => {
                setClosestEdge(extractClosestEdge(self.data));
            },
            onDragLeave: () => setClosestEdge(null),
            onDrop: () => setClosestEdge(null),
        });
    }, [card.id, card.columnId, card.position]);

    const startEditing = () => {
        setEditTitle(card.title);
        setIsEditing(true);
    };

    const saveEdit = async () => {
        const trimmed = editTitle.trim();
        if (trimmed && trimmed !== card.title) {
            await onUpdate(card.id, { title: trimmed });
        }
        setIsEditing(false);
    };

    const cancelEdit = () => {
        setEditTitle(card.title);
        setIsEditing(false);
    };

    const handleEditKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            saveEdit();
        } else if (e.key === 'Escape') {
            cancelEdit();
        }
    };

    const handleDeleteClick = () => {
        const cardSnapshot = { ...card };
        const cardId = card.id;

        removeCardFromUI(cardId);

        let cancelled = false;
        const timer = setTimeout(() => {
            if (!cancelled) {
                onDelete(cardId);
            }
        }, 5000);

        toast('Card deleted', 'info', {
            label: 'Undo',
            onClick: () => {
                cancelled = true;
                clearTimeout(timer);
                restoreCardToUI(cardSnapshot);
            },
        }, 5000);
    };

    return (
        <div
            ref={cardRef}
            onClick={onClick}
            className={`group relative bg-white dark:bg-surface-800 rounded-xl p-3.5 border border-surface-200 dark:border-surface-700 cursor-pointer shadow-sm hover:shadow-md hover:border-primary-300 dark:hover:border-primary-700 transition-all ${isBlocked ? 'opacity-75 bg-surface-50 dark:bg-surface-900' : ''
                }`}
            style={
                isDragging
                    ? { opacity: 0.5 }
                    : justDropped
                        ? { animation: 'card-drop 300ms ease-out' }
                        : undefined
            }
        >
            {/* Drop edge indicators */}
            {closestEdge === 'top' && (
                <div className="absolute -top-1 left-0 right-0 h-1 bg-primary-500 rounded-full z-10" />
            )}
            {closestEdge === 'bottom' && (
                <div className="absolute -bottom-1 left-0 right-0 h-1 bg-primary-500 rounded-full z-10" />
            )}

            {/* Priority Indicator Line */}
            <div className={`absolute top-3 bottom-3 left-0 w-1 rounded-r-full ${priorityStyle.bg.replace('/20', '')}`} />

            <div className="pl-2.5">
                {/* Header row */}
                <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                        <button
                            onClick={e => { e.stopPropagation(); onUpdate(card.id, { completed: !card.completed }); }}
                            className="mt-0.5 shrink-0"
                            title={card.completed ? 'Mark incomplete' : 'Mark complete'}
                        >
                            <div
                                className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                                    card.completed
                                        ? 'bg-emerald-600 border-emerald-500'
                                        : 'border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 hover:border-surface-400'
                                }`}
                            >
                                {card.completed && <Check size={10} className="text-white" />}
                            </div>
                        </button>
                        <div className="flex-1 min-w-0">
                            {isEditing ? (
                                <input
                                    ref={editInputRef}
                                    type="text"
                                    value={editTitle}
                                    onChange={e => setEditTitle(e.target.value)}
                                    onKeyDown={handleEditKeyDown}
                                    onBlur={saveEdit}
                                    onClick={e => e.stopPropagation()}
                                    className="w-full bg-surface-50 dark:bg-surface-900 border border-primary-500 rounded px-2 py-1 text-sm font-medium focus:outline-none"
                                />
                            ) : (
                                <h4 className={`text-sm font-medium leading-snug line-clamp-3 ${card.completed ? 'line-through text-surface-500' : isBlocked ? 'line-through text-surface-500' : 'text-surface-900 dark:text-surface-100'}`}>
                                    {card.title}
                                </h4>
                            )}
                        </div>
                    </div>

                    {isBlocked && (
                        <AlertCircle size={14} className="text-red-500 shrink-0" />
                    )}
                </div>

                {/* Description preview */}
                {card.description && !isEditing && (
                    <p className="text-xs text-surface-500 line-clamp-2 mb-3 leading-relaxed">
                        {card.description.replace(/<[^>]*>/g, '').trim()}
                    </p>
                )}

                {/* Footer info using badges */}
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {/* Priority Badge */}
                    <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-md ${priorityStyle.bg} ${priorityStyle.color} border ${priorityStyle.border}`}>
                        {card.priority}
                    </span>

                    {/* Link Count */}
                    {(dependencyCount ?? 0) > 0 && (
                        <span className="flex items-center gap-1 text-[10px] text-surface-500 bg-surface-100 dark:bg-surface-700 px-1.5 py-0.5 rounded-md">
                            <Link2 size={10} />
                            {dependencyCount}
                        </span>
                    )}

                    {/* Due Date */}
                    {card.dueDate && (
                        <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border ${getDueDateBadge(card.dueDate).classes.replace('text-', 'text-').replace('bg-', 'bg-').replace('/10', '/20')}`}>
                            <Clock size={10} />
                            {new Date(card.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </span>
                    )}

                    {/* Labels */}
                    {card.labels?.map(label => (
                        <div key={label.id} className="w-2 h-2 rounded-full ring-1 ring-surface-200 dark:ring-surface-700" style={{ backgroundColor: label.color }} title={label.name} />
                    ))}
                </div>

                {/* Hover Actions */}
                <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 dark:bg-surface-800/90 rounded-lg p-1 shadow-sm border border-surface-100 dark:border-surface-700 backdrop-blur-sm">
                    {!isEditing && (
                        <button
                            onClick={e => { e.stopPropagation(); startEditing(); }}
                            className="p-1 text-surface-400 hover:text-primary-600 rounded hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
                        >
                            <Pencil size={12} />
                        </button>
                    )}
                    <button
                        onClick={e => { e.stopPropagation(); handleDeleteClick(); }}
                        className="p-1 text-surface-400 hover:text-red-500 rounded hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
                    >
                        <Trash2 size={12} />
                    </button>
                </div>

            </div>
        </div>
    );
});

export default KanbanCardModern;
