// === FILE PURPOSE ===
// AI task breakdown section — generates subtask suggestions for a card
// and creates them as new cards in the same column.

// === DEPENDENCIES ===
// react, lucide-react, taskStructuringStore, window.electronAPI

// === LIMITATIONS ===
// - Subtask suggestions are transient (not persisted until created as cards)
// - Depends on AI provider being configured for 'task_structuring' task type

import { useState, useEffect } from 'react';
import { Sparkles, Loader2, AlertCircle, Check, ListTodo, ListChecks } from 'lucide-react';
import { useTaskStructuringStore } from '../stores/taskStructuringStore';
import { useCardDetailStore } from '../stores/cardDetailStore';
import { toast } from '../hooks/useToast';
import type { SubtaskSuggestion } from '../../shared/types';

interface TaskBreakdownSectionProps {
  cardId: string;
  columnId: string;
}

const PRIORITY_BADGE: Record<SubtaskSuggestion['priority'], string> = {
  low: 'bg-emerald-500/20 text-emerald-400',
  medium: 'bg-blue-500/20 text-blue-400',
  high: 'bg-amber-500/20 text-amber-400',
  urgent: 'bg-red-500/20 text-red-400',
};

const PRIORITY_LABEL: Record<SubtaskSuggestion['priority'], string> = {
  low: 'LOW',
  medium: 'MED',
  high: 'HIGH',
  urgent: 'URG',
};

const EFFORT_LABEL: Record<SubtaskSuggestion['effort'], string> = {
  small: 'S',
  medium: 'M',
  large: 'L',
};

function TaskBreakdownSection({ cardId, columnId }: TaskBreakdownSectionProps) {
  const breakdown = useTaskStructuringStore(s => s.breakdown);
  const breakdownLoading = useTaskStructuringStore(s => s.breakdownLoading);
  const breakdownError = useTaskStructuringStore(s => s.breakdownError);
  const generateBreakdown = useTaskStructuringStore(s => s.generateBreakdown);
  const clearBreakdown = useTaskStructuringStore(s => s.clearBreakdown);

  const [selectedSubtasks, setSelectedSubtasks] = useState<Set<number>>(new Set());
  const [applying, setApplying] = useState(false);
  const [addingToChecklist, setAddingToChecklist] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  // Auto-select all subtasks when breakdown loads
  useEffect(() => {
    if (breakdown) {
      setSelectedSubtasks(new Set(breakdown.subtasks.map((_, i) => i)));
    }
  }, [breakdown]);

  const handleGenerate = () => {
    setApplyError(null);
    setApplied(false);
    generateBreakdown(cardId);
  };

  const toggleSubtask = (index: number) => {
    setSelectedSubtasks(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (!breakdown) return;
    if (selectedSubtasks.size === breakdown.subtasks.length) {
      setSelectedSubtasks(new Set());
    } else {
      setSelectedSubtasks(new Set(breakdown.subtasks.map((_, i) => i)));
    }
  };

  const handleApply = async () => {
    if (!breakdown || selectedSubtasks.size === 0) return;

    setApplying(true);
    setApplyError(null);

    try {
      // Create cards for selected subtasks in order
      const sortedIndices = Array.from(selectedSubtasks).sort((a, b) => a - b);

      for (const index of sortedIndices) {
        const subtask = breakdown.subtasks[index];
        await window.electronAPI.createCard({
          columnId,
          title: subtask.title,
          description: subtask.description,
          priority: subtask.priority,
        });
      }

      setApplying(false);
      setApplied(true);

      // Brief success display, then clear
      setTimeout(() => {
        setApplied(false);
        clearBreakdown();
      }, 1500);
    } catch (error) {
      setApplyError(
        error instanceof Error ? error.message : 'Failed to create cards',
      );
      setApplying(false);
    }
  };

  const handleAddToChecklist = async () => {
    if (!breakdown || selectedSubtasks.size === 0) return;

    setAddingToChecklist(true);
    setApplyError(null);

    try {
      const sortedIndices = Array.from(selectedSubtasks).sort((a, b) => a - b);
      const titles = sortedIndices.map(i => breakdown.subtasks[i].title);

      await window.electronAPI.addChecklistItemsBatch(cardId, titles);

      // Refresh checklist items in the store
      await useCardDetailStore.getState().loadChecklistItems(cardId);

      toast(`Added ${titles.length} items to checklist`, 'success');
      setAddingToChecklist(false);
      setApplied(true);

      setTimeout(() => {
        setApplied(false);
        clearBreakdown();
      }, 1500);
    } catch (error) {
      setApplyError(
        error instanceof Error ? error.message : 'Failed to add to checklist',
      );
      setAddingToChecklist(false);
    }
  };

  return (
    <div>
      {/* Section title */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5 text-sm font-medium text-surface-700 dark:text-surface-300">
          <Sparkles size={14} />
          AI Task Breakdown
        </div>

        {breakdown && !breakdownLoading && (
          <button
            onClick={toggleAll}
            className="text-[10px] text-surface-500 hover:text-surface-700 dark:text-surface-300 transition-colors"
          >
            {selectedSubtasks.size === breakdown.subtasks.length
              ? 'Deselect all'
              : 'Select all'}
          </button>
        )}
      </div>

      {/* Empty state — no breakdown yet */}
      {!breakdown && !breakdownLoading && !breakdownError && (
        <div className="flex items-center gap-3">
          <button
            onClick={handleGenerate}
            className="text-xs bg-surface-800 hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-800 dark:text-surface-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors"
          >
            <ListTodo size={13} />
            Break into Subtasks
          </button>
          <span className="text-xs text-surface-500">
            Use AI to break this task into smaller subtasks.
          </span>
        </div>
      )}

      {/* Loading state */}
      {breakdownLoading && (
        <div className="flex items-center gap-2 text-sm text-surface-400 py-2">
          <Loader2 size={14} className="animate-spin" />
          Analyzing task...
        </div>
      )}

      {/* Error state */}
      {breakdownError && (
        <div className="flex items-center gap-2 text-sm text-red-400 py-2">
          <AlertCircle size={14} />
          {breakdownError}
        </div>
      )}

      {/* Breakdown results */}
      {breakdown && !breakdownLoading && (
        <div className="space-y-2">
          {/* Regenerate button */}
          <button
            onClick={handleGenerate}
            className="text-xs bg-surface-800 hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-800 dark:text-surface-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors mb-3"
          >
            <Sparkles size={13} />
            Regenerate
          </button>

          {/* Subtask list */}
          <div className="space-y-1.5">
            {breakdown.subtasks.map((subtask, index) => {
              const isSelected = selectedSubtasks.has(index);
              return (
                <button
                  key={index}
                  onClick={() => toggleSubtask(index)}
                  className={`flex items-center gap-2 w-full bg-surface-100/50 dark:bg-surface-800/50 rounded-lg px-3 py-2 text-left transition-colors ${
                    isSelected
                      ? 'ring-1 ring-surface-600'
                      : 'opacity-50'
                  }`}
                >
                  {/* Checkbox */}
                  <div
                    className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                      isSelected
                        ? 'bg-primary-600 border-primary-500'
                        : 'border-surface-600 bg-surface-800'
                    }`}
                  >
                    {isSelected && <Check size={10} className="text-white" />}
                  </div>

                  {/* Order number */}
                  <span className="text-[10px] font-medium text-surface-500 w-4 text-center shrink-0">
                    {subtask.order}
                  </span>

                  {/* Title */}
                  <span className="text-sm text-surface-800 dark:text-surface-200 flex-1 truncate">
                    {subtask.title}
                  </span>

                  {/* Priority badge */}
                  <span
                    className={`text-[10px] font-medium rounded px-1.5 py-0.5 shrink-0 ${PRIORITY_BADGE[subtask.priority]}`}
                  >
                    {PRIORITY_LABEL[subtask.priority]}
                  </span>

                  {/* Effort badge */}
                  <span className="text-[10px] font-medium text-surface-400 bg-surface-700 rounded px-1.5 py-0.5 shrink-0">
                    {EFFORT_LABEL[subtask.effort]}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Notes */}
          {breakdown.notes && (
            <p className="text-xs text-surface-500 mt-3 leading-relaxed">
              {breakdown.notes}
            </p>
          )}

          {/* Apply error */}
          {applyError && (
            <div className="flex items-center gap-2 text-xs text-red-400 mt-2">
              <AlertCircle size={12} />
              {applyError}
            </div>
          )}

          {/* Applied success */}
          {applied && (
            <div className="flex items-center gap-2 text-xs text-emerald-400 mt-2">
              <Check size={12} />
              Done!
            </div>
          )}

          {/* Action buttons */}
          {!applied && (
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={handleApply}
                disabled={applying || addingToChecklist || selectedSubtasks.size === 0}
                className="bg-primary-600 hover:bg-primary-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
              >
                {applying ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <ListTodo size={13} />
                    Create as Cards ({selectedSubtasks.size})
                  </>
                )}
              </button>
              <button
                onClick={handleAddToChecklist}
                disabled={applying || addingToChecklist || selectedSubtasks.size === 0}
                className="bg-surface-700 hover:bg-surface-600 disabled:opacity-40 disabled:cursor-not-allowed text-surface-800 dark:text-surface-200 text-sm px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
              >
                {addingToChecklist ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    Adding...
                  </>
                ) : (
                  <>
                    <ListChecks size={13} />
                    Add to Checklist ({selectedSubtasks.size})
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default TaskBreakdownSection;
