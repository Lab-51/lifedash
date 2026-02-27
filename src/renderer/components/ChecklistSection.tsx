// === FILE PURPOSE ===
// Checklist / subtask section for card detail view.
// Allows adding, checking, editing, deleting, and reordering checklist items.

// === DEPENDENCIES ===
// react, lucide-react, cardDetailStore (Zustand), @atlaskit/pragmatic-drag-and-drop

import { useState, useRef, useEffect, useCallback } from 'react';
import { CheckSquare, X, GripVertical, Plus } from 'lucide-react';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { attachClosestEdge, extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import type { Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { useCardDetailStore } from '../stores/cardDetailStore';

interface ChecklistSectionProps {
  cardId: string;
}

// Individual checklist item with drag-and-drop
function ChecklistItem({
  item,
  cardId,
  editingId,
  editTitle,
  setEditingId,
  setEditTitle,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
}: {
  item: { id: string; title: string; completed: boolean; position: number };
  cardId: string;
  editingId: string | null;
  editTitle: string;
  setEditingId: (id: string | null) => void;
  setEditTitle: (title: string) => void;
  onStartEdit: (id: string, title: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
}) {
  const updateChecklistItem = useCardDetailStore(s => s.updateChecklistItem);
  const deleteChecklistItem = useCardDetailStore(s => s.deleteChecklistItem);

  const rowRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null);

  useEffect(() => {
    if (editingId === item.id && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId, item.id]);

  // Draggable
  useEffect(() => {
    const el = rowRef.current;
    const handle = handleRef.current;
    if (!el || !handle) return;

    return draggable({
      element: el,
      dragHandle: handle,
      getInitialData: () => ({
        type: 'checklist-item',
        itemId: item.id,
        cardId,
      }),
      onDragStart: () => setIsDragging(true),
      onDrop: () => setIsDragging(false),
    });
  }, [item.id, cardId]);

  // Drop target
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;

    return dropTargetForElements({
      element: el,
      canDrop: ({ source }) =>
        source.data.type === 'checklist-item' &&
        source.data.itemId !== item.id &&
        source.data.cardId === cardId,
      getData: ({ input, element }) => {
        return attachClosestEdge(
          { type: 'checklist-item', itemId: item.id },
          { input, element, allowedEdges: ['top', 'bottom'] },
        );
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
  }, [item.id, cardId]);

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onSaveEdit();
    } else if (e.key === 'Escape') {
      onCancelEdit();
    }
  };

  return (
    <div
      ref={rowRef}
      className={`relative flex items-center gap-2 py-1.5 px-2 rounded hover:bg-surface-100 dark:hover:bg-surface-800/50 group ${
        isDragging ? 'opacity-40' : ''
      }`}
    >
      {/* Drop indicator line */}
      {closestEdge === 'top' && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-[var(--color-accent)] rounded-full z-10" />
      )}
      {closestEdge === 'bottom' && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--color-accent)] rounded-full z-10" />
      )}

      {/* Drag handle */}
      <div
        ref={handleRef}
        className="text-surface-600 cursor-grab shrink-0 opacity-0 group-hover:opacity-100 transition-opacity active:cursor-grabbing"
      >
        <GripVertical size={14} />
      </div>

      {/* Checkbox */}
      <input
        type="checkbox"
        checked={item.completed}
        onChange={() => updateChecklistItem(item.id, { completed: !item.completed })}
        className="accent-emerald-500 shrink-0 cursor-pointer"
      />

      {/* Title — inline edit or display */}
      {editingId === item.id ? (
        <input
          ref={editInputRef}
          type="text"
          value={editTitle}
          onChange={e => setEditTitle(e.target.value)}
          onKeyDown={handleEditKeyDown}
          onBlur={onSaveEdit}
          className="flex-1 text-sm bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] rounded px-2 py-0.5 text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-dim)]"
        />
      ) : (
        <span
          className={`flex-1 text-sm cursor-pointer ${
            item.completed ? 'line-through text-surface-500' : 'text-surface-800 dark:text-surface-200'
          }`}
          onClick={() => onStartEdit(item.id, item.title)}
        >
          {item.title}
        </span>
      )}

      {/* Delete button */}
      <button
        onClick={() => deleteChecklistItem(item.id)}
        className="text-surface-500 hover:text-surface-700 dark:text-surface-300 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
      >
        <X size={14} />
      </button>
    </div>
  );
}

function ChecklistSection({ cardId }: ChecklistSectionProps) {
  const items = useCardDetailStore(s => s.selectedCardChecklistItems);
  const addChecklistItem = useCardDetailStore(s => s.addChecklistItem);
  const reorderChecklistItems = useCardDetailStore(s => s.reorderChecklistItems);

  const [newItemTitle, setNewItemTitle] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const addInputRef = useRef<HTMLInputElement>(null);

  // --- Progress ---
  const total = items.length;
  const done = items.filter(i => i.completed).length;
  const percentage = total > 0 ? Math.round((done / total) * 100) : 0;

  // --- Global drop monitor for checklist reorder ---
  useEffect(() => {
    return monitorForElements({
      canMonitor: ({ source }) =>
        source.data.type === 'checklist-item' && source.data.cardId === cardId,
      onDrop: ({ source, location }) => {
        const target = location.current.dropTargets[0];
        if (!target) return;

        const sourceId = source.data.itemId as string;
        const targetId = target.data.itemId as string;
        if (sourceId === targetId) return;

        const edge = extractClosestEdge(target.data);
        const currentIds = items.map(i => i.id);
        const sourceIndex = currentIds.indexOf(sourceId);
        let targetIndex = currentIds.indexOf(targetId);

        if (sourceIndex === -1 || targetIndex === -1) return;

        // Remove source from array
        const newIds = [...currentIds];
        newIds.splice(sourceIndex, 1);

        // Recalculate target index after removal
        targetIndex = newIds.indexOf(targetId);
        const insertIndex = edge === 'bottom' ? targetIndex + 1 : targetIndex;

        newIds.splice(insertIndex, 0, sourceId);
        reorderChecklistItems(cardId, newIds);
      },
    });
  }, [cardId, items, reorderChecklistItems]);

  // --- Add item ---
  const handleAdd = async () => {
    const trimmed = newItemTitle.trim();
    if (!trimmed) return;
    await addChecklistItem(cardId, trimmed);
    setNewItemTitle('');
    addInputRef.current?.focus();
  };

  const handleAddKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  // --- Inline editing ---
  const startEditing = useCallback((id: string, title: string) => {
    setEditingId(id);
    setEditTitle(title);
  }, []);

  const saveEdit = useCallback(() => {
    if (!editingId) return;
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== items.find(i => i.id === editingId)?.title) {
      useCardDetailStore.getState().updateChecklistItem(editingId, { title: trimmed });
    }
    setEditingId(null);
    setEditTitle('');
  }, [editingId, editTitle, items]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditTitle('');
  }, []);

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center gap-1.5 mb-1">
        <CheckSquare size={14} className="text-[var(--color-accent-dim)]" />
        <span className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent-dim)]">Checklist</span>
        {total > 0 && (
          <span className="font-data text-xs px-1.5 py-0.5 rounded-full ml-1.5 text-[var(--color-accent-dim)] bg-[var(--color-accent-subtle)] border border-[var(--color-border-accent)]">
            {done}/{total}
          </span>
        )}
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="h-0.5 bg-[var(--color-border)] rounded-full mt-2 mb-3">
          <div
            className="h-full bg-[var(--color-accent)] rounded-full transition-all shadow-[0_0_4px_rgba(62,232,228,0.4)]"
            style={{ width: `${percentage}%` }}
          />
        </div>
      )}

      {/* Items list */}
      <div className="space-y-0.5 mb-3">
        {items.map(item => (
          <ChecklistItem
            key={item.id}
            item={item}
            cardId={cardId}
            editingId={editingId}
            editTitle={editTitle}
            setEditingId={setEditingId}
            setEditTitle={setEditTitle}
            onStartEdit={startEditing}
            onSaveEdit={saveEdit}
            onCancelEdit={cancelEdit}
          />
        ))}
      </div>

      {/* Add item input */}
      <div className="flex items-center gap-2">
        <Plus size={14} className="text-surface-500 shrink-0" />
        <input
          ref={addInputRef}
          type="text"
          value={newItemTitle}
          onChange={e => setNewItemTitle(e.target.value)}
          onKeyDown={handleAddKeyDown}
          placeholder="Add a checklist item..."
          className="flex-1 text-sm bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] rounded-lg px-3 py-2 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)] transition-colors"
        />
      </div>
    </div>
  );
}

export default ChecklistSection;
