// === FILE PURPOSE ===
// Checklist / subtask section for card detail view.
// Allows adding, checking, editing, and deleting checklist items.

// === DEPENDENCIES ===
// react, lucide-react, cardDetailStore (Zustand)

import { useState, useRef, useEffect } from 'react';
import { CheckSquare, X, GripVertical, Plus } from 'lucide-react';
import { useCardDetailStore } from '../stores/cardDetailStore';

interface ChecklistSectionProps {
  cardId: string;
}

function ChecklistSection({ cardId }: ChecklistSectionProps) {
  const items = useCardDetailStore(s => s.selectedCardChecklistItems);
  const addChecklistItem = useCardDetailStore(s => s.addChecklistItem);
  const updateChecklistItem = useCardDetailStore(s => s.updateChecklistItem);
  const deleteChecklistItem = useCardDetailStore(s => s.deleteChecklistItem);

  const [newItemTitle, setNewItemTitle] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const addInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Focus edit input when entering edit mode
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  // --- Progress ---
  const total = items.length;
  const done = items.filter(i => i.completed).length;
  const percentage = total > 0 ? Math.round((done / total) * 100) : 0;

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
  const startEditing = (id: string, title: string) => {
    setEditingId(id);
    setEditTitle(title);
  };

  const saveEdit = () => {
    if (!editingId) return;
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== items.find(i => i.id === editingId)?.title) {
      updateChecklistItem(editingId, { title: trimmed });
    }
    setEditingId(null);
    setEditTitle('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditTitle('');
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit();
    } else if (e.key === 'Escape') {
      cancelEdit();
    }
  };

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center gap-1.5 mb-1">
        <CheckSquare size={14} className="text-surface-400" />
        <span className="text-sm text-surface-400">Checklist</span>
        {total > 0 && (
          <span className="bg-surface-800 text-surface-300 text-xs px-1.5 py-0.5 rounded-full ml-1.5">
            {done}/{total}
          </span>
        )}
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="h-0.5 bg-surface-700 rounded-full mt-2 mb-3">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all"
            style={{ width: `${percentage}%` }}
          />
        </div>
      )}

      {/* Items list */}
      <div className="space-y-0.5 mb-3">
        {items.map(item => (
          <div
            key={item.id}
            className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-surface-800/50 group"
          >
            {/* Drag handle (visual only) */}
            <GripVertical size={14} className="text-surface-600 cursor-grab shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />

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
                onBlur={saveEdit}
                className="flex-1 bg-surface-800 border border-surface-700 rounded px-2 py-0.5 text-sm text-surface-100 focus:outline-none focus:border-primary-500"
              />
            ) : (
              <span
                className={`flex-1 text-sm cursor-pointer ${
                  item.completed ? 'line-through text-surface-500' : 'text-surface-200'
                }`}
                onClick={() => startEditing(item.id, item.title)}
              >
                {item.title}
              </span>
            )}

            {/* Delete button */}
            <button
              onClick={() => deleteChecklistItem(item.id)}
              className="text-surface-500 hover:text-surface-300 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
            >
              <X size={14} />
            </button>
          </div>
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
          className="flex-1 bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-surface-100 placeholder:text-surface-500 focus:outline-none focus:border-primary-500 transition-colors"
        />
      </div>
    </div>
  );
}

export default ChecklistSection;
