// === FILE PURPOSE ===
// BoardColumnModern — renders a single Kanban column with modern styling.

import { memo, useRef, useState, useEffect, useCallback } from 'react';
import { Plus, X, GripVertical, MoreHorizontal, ChevronDown, ChevronRight, Palette, Check } from 'lucide-react';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { attachClosestEdge, extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import type { Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import KanbanCardModern from './KanbanCardModern';
import type { Card, Column, UpdateCardInput, CardPriority } from '../../shared/types';
import type { CardTemplate } from '../../shared/types/cards';
import { toast } from '../hooks/useToast';

/** Built-in template shape (non-DB). */
interface BuiltinTemplate {
    id: string;
    name: string;
    icon: string;
    priority: CardPriority;
    description: string;
}

/** Built-in templates shown in the creation dropdown. */
const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
    { id: 'bug', name: 'Bug Report', icon: '\u{1F41B}', priority: 'high', description: '<h2>Steps to Reproduce</h2><ol><li></li></ol><h2>Expected Behavior</h2><p></p><h2>Actual Behavior</h2><p></p>' },
    { id: 'feature', name: 'Feature Request', icon: '\u2728', priority: 'medium', description: '<h2>User Story</h2><p>As a [user], I want [goal] so that [benefit].</p><h2>Acceptance Criteria</h2><ul><li></li></ul>' },
    { id: 'action', name: 'Meeting Action', icon: '\u{1F4CB}', priority: 'medium', description: '<h2>Action Required</h2><p></p><h2>Assignee</h2><p></p><h2>Due Date</h2><p></p>' },
    { id: 'note', name: 'Quick Note', icon: '\u{1F4DD}', priority: 'low', description: '<p></p>' },
];

const COLUMN_COLORS = [
    { value: null, label: 'Default' },
    { value: '#3b82f6', label: 'Blue' },
    { value: '#22c55e', label: 'Green' },
    { value: '#f59e0b', label: 'Amber' },
    { value: '#ef4444', label: 'Red' },
    { value: '#8b5cf6', label: 'Purple' },
    { value: '#ec4899', label: 'Pink' },
    { value: '#06b6d4', label: 'Cyan' },
];

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
    updateColumnColor: (id: string, color: string | null) => Promise<void>;
    onCardClick: (cardId: string) => void;
    justDroppedCardId: string | null;
    blockedCardIds?: Set<string>;
    dependencyCountMap?: Map<string, number>;
    isCollapsed?: boolean;
    onToggleCollapse?: (id: string) => void;
}

const BoardColumnModern = memo(function BoardColumnModern({
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
    updateColumnColor,
    onCardClick,
    justDroppedCardId,
    blockedCardIds,
    dependencyCountMap,
    isCollapsed,
    onToggleCollapse,
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

    // Color picker state
    const [showColorPicker, setShowColorPicker] = useState(false);
    const colorPickerRef = useRef<HTMLDivElement>(null);

    // Template state for card creation
    const [showCreateTemplateDropdown, setShowCreateTemplateDropdown] = useState(false);
    const [selectedTemplate, setSelectedTemplate] = useState<BuiltinTemplate | CardTemplate | null>(null);
    const [dbTemplates, setDbTemplates] = useState<CardTemplate[]>([]);
    const [hasTemplates, setHasTemplates] = useState<boolean | null>(null);
    const createTemplateDropdownRef = useRef<HTMLDivElement>(null);

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

    // Close color picker on outside click
    useEffect(() => {
        if (!showColorPicker) return;
        const handleClick = (e: MouseEvent) => {
            if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
                setShowColorPicker(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [showColorPicker]);

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

    // Collapsed view — vertical tab
    if (isCollapsed) {
        return (
            <div
                ref={columnRef}
                onClick={() => onToggleCollapse?.(column.id)}
                className="w-12 shrink-0 flex flex-col items-center rounded-2xl border border-surface-200 dark:border-surface-800 cursor-pointer hover:border-primary-400 dark:hover:border-primary-600 transition-all relative group overflow-hidden"
                style={column.color ? { backgroundColor: `${column.color}15`, borderColor: `${column.color}40` } : undefined}
            >
                {/* Column reorder edge indicators */}
                {closestColumnEdge === 'left' && (
                    <div className="absolute -left-1 top-0 bottom-0 w-1 bg-primary-500 rounded-full z-10 box-content border-2 border-white dark:border-surface-900" />
                )}
                {closestColumnEdge === 'right' && (
                    <div className="absolute -right-1 top-0 bottom-0 w-1 bg-primary-500 rounded-full z-10 box-content border-2 border-white dark:border-surface-900" />
                )}
                <div ref={headerRef} className="py-3 cursor-grab active:cursor-grabbing shrink-0">
                    <ChevronRight size={14} className="text-surface-400 group-hover:text-primary-500 transition-colors" />
                </div>
                <span className="bg-surface-200 dark:bg-surface-700 text-surface-600 dark:text-surface-300 text-[10px] font-bold w-6 h-6 flex items-center justify-center rounded-full mb-2 shrink-0">
                    {columnCards.length}
                </span>
                <span className="text-xs font-bold text-surface-500 dark:text-surface-400 whitespace-nowrap [writing-mode:vertical-lr] rotate-180 pt-3 pb-5">
                    {column.name}
                </span>
            </div>
        );
    }

    const columnBgStyle = column.color
        ? { backgroundColor: `${column.color}08` }
        : undefined;
    const columnBorderStyle = column.color
        ? { borderColor: `${column.color}30` }
        : undefined;

    return (
        <div
            ref={columnRef}
            className={`w-80 shrink-0 flex flex-col rounded-2xl border transition-all relative ${
                column.color ? '' : 'bg-surface-50 dark:bg-surface-900 border-surface-200 dark:border-surface-800'
            } ${isDragOver ? 'ring-2 ring-primary-500/30 bg-primary-50/50 dark:bg-primary-900/20' : ''
                } ${isDragging ? 'opacity-50 scale-95 rotate-1' : ''}`}
            style={column.color ? { ...columnBgStyle, ...columnBorderStyle } : undefined}
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
                            <span className="bg-surface-200 dark:bg-surface-700 text-surface-600 dark:text-surface-300 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                                {columnCards.length}
                            </span>
                        </div>
                    )}
                </div>

                {/* Column actions */}
                {deleteConfirm ? (
                    <button
                        onClick={handleDeleteColumn}
                        className="text-xs font-semibold text-red-500 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                    >
                        {columnCards.length > 0 ? `Delete column + ${columnCards.length} cards?` : 'Delete column?'}
                    </button>
                ) : (
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
                        {/* Collapse button */}
                        <button
                            onClick={(e) => { e.stopPropagation(); onToggleCollapse?.(column.id); }}
                            className="p-1 text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 hover:bg-surface-200 dark:hover:bg-surface-700 rounded transition-all"
                            title="Collapse column"
                        >
                            <ChevronDown size={14} className="rotate-90" />
                        </button>
                        {/* Color picker */}
                        <div className="relative" ref={colorPickerRef}>
                            <button
                                onClick={(e) => { e.stopPropagation(); setShowColorPicker(!showColorPicker); }}
                                className="p-1 text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 hover:bg-surface-200 dark:hover:bg-surface-700 rounded transition-all"
                                title="Column color"
                            >
                                <Palette size={14} />
                            </button>
                            {showColorPicker && (
                                <div className="absolute right-0 top-full mt-1 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl shadow-lg p-3 z-40 animate-in fade-in zoom-in-95 duration-100">
                                    <div className="grid grid-cols-4 gap-2.5">
                                        {COLUMN_COLORS.map(c => (
                                            <button
                                                key={c.label}
                                                onClick={(e) => { e.stopPropagation(); updateColumnColor(column.id, c.value); setShowColorPicker(false); }}
                                                className={`w-8 h-8 rounded-full transition-all flex items-center justify-center ${
                                                    column.color === c.value
                                                        ? 'ring-2 ring-offset-2 ring-offset-white dark:ring-offset-surface-800 ring-primary-500 scale-110'
                                                        : 'hover:scale-110'
                                                } ${!c.value ? 'bg-surface-100 dark:bg-surface-700 border-2 border-dashed border-surface-300 dark:border-surface-500' : ''}`}
                                                style={c.value ? { backgroundColor: c.value } : undefined}
                                                title={c.label}
                                            >
                                                {!c.value && (
                                                    <X size={12} className="text-surface-400" />
                                                )}
                                                {column.color === c.value && c.value && (
                                                    <Check size={12} className="text-white drop-shadow-sm" />
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                        {/* Delete / menu */}
                        <button
                            onClick={handleDeleteColumn}
                            className="p-1 text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 hover:bg-surface-200 dark:hover:bg-surface-700 rounded transition-all"
                        >
                            <MoreHorizontal size={16} />
                        </button>
                    </div>
                )}
            </div>

            {/* Card list */}
            <div className="px-3 pb-3 flex flex-col gap-3">
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
                    <div className="flex flex-col items-center justify-center py-8 text-surface-400 border-2 border-dashed border-surface-200 dark:border-surface-700 rounded-xl">
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
            <div
                className={`px-3 pb-3 pt-1 sticky bottom-0 rounded-b-2xl z-10 ${
                    column.color ? '' : 'bg-gradient-to-t from-surface-50 via-surface-50 to-transparent dark:from-surface-900 dark:via-surface-900'
                }`}
            >
                {addingCard ? (
                    <div className="flex flex-col gap-2 bg-white dark:bg-surface-800 p-2 rounded-xl shadow-lg border border-surface-200 dark:border-surface-700 animate-in slide-in-from-bottom-2">
                        <input
                            ref={cardInputRef}
                            type="text"
                            value={newCardTitle}
                            onChange={e => setNewCardTitle(e.target.value)}
                            onKeyDown={handleCardKeyDown}
                            placeholder="Enter card title..."
                            className="w-full bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-lg px-3 py-2 text-sm text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:focus:ring-primary-500/40 focus:border-primary-500 transition-all font-medium placeholder:font-normal"
                        />

                        {/* Template selector for card creation */}
                        {hasTemplates && (
                            <div className="relative" ref={createTemplateDropdownRef}>
                                <button
                                    className="text-xs text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 inline-flex items-center gap-1"
                                    onClick={() => setShowCreateTemplateDropdown(!showCreateTemplateDropdown)}
                                >
                                    From template <ChevronDown size={10} />
                                </button>

                                {showCreateTemplateDropdown && (
                                    <div className="absolute bottom-full left-0 mb-1 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl shadow-lg py-1 min-w-[200px] z-40 max-h-48 overflow-y-auto">
                                        {dbTemplates.length > 0 && (
                                            <>
                                                <div className="px-3 py-1 text-xs text-surface-500 uppercase tracking-wide">
                                                    Your Templates
                                                </div>
                                                {dbTemplates.map(t => (
                                                    <button
                                                        key={t.id}
                                                        onClick={() => { setSelectedTemplate(t); setShowCreateTemplateDropdown(false); }}
                                                        className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-surface-700 dark:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors text-left"
                                                    >
                                                        <span className="truncate">{t.name}</span>
                                                    </button>
                                                ))}
                                                <div className="border-t border-surface-200 dark:border-surface-700 my-1" />
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
                                                className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-surface-700 dark:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors text-left"
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
                            <div className="flex items-center gap-1 text-xs text-primary-600 dark:text-blue-400">
                                <span>Using: {selectedTemplate.name}</span>
                                <button
                                    onClick={() => setSelectedTemplate(null)}
                                    className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-300"
                                >
                                    <X size={10} />
                                </button>
                            </div>
                        )}

                        <div className="flex items-center justify-between gap-2">
                            <button
                                onClick={() => {
                                    setNewCardTitle('');
                                    setSelectedTemplate(null);
                                    setShowCreateTemplateDropdown(false);
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
                        className="flex items-center justify-center gap-1.5 text-surface-500 hover:text-primary-600 dark:hover:text-primary-400 text-sm font-medium w-full px-3 py-2.5 rounded-xl transition-all hover:bg-white dark:hover:bg-surface-800/80 hover:shadow-sm border border-transparent hover:border-surface-200 dark:hover:border-surface-700"
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
