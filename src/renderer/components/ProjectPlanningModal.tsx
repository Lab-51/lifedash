// === FILE PURPOSE ===
// Full-screen overlay modal for AI-powered project planning. Allows users to
// generate a production-focused project plan with pillars, tasks, and milestones,
// then selectively apply suggestions as real boards, columns, and cards.
//
// === DEPENDENCIES ===
// react, lucide-react, taskStructuringStore, shared types, window.electronAPI
//
// === LIMITATIONS ===
// - Generated plans are transient (displayed in modal, not persisted)
// - Apply creates a single board; user may want to customize board name
// - Task deselection is by title (assumes unique titles within a plan)

import { useState, useEffect, useCallback } from 'react';
import {
  X,
  Sparkles,
  Check,
  RefreshCw,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { useTaskStructuringStore } from '../stores/taskStructuringStore';
import type { ProjectPillar, PillarTask } from '../../shared/types';

// === CONSTANTS ===

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-emerald-500/20 text-emerald-400',
  medium: 'bg-blue-500/20 text-blue-400',
  high: 'bg-amber-500/20 text-amber-400',
  urgent: 'bg-red-500/20 text-red-400',
};

const EFFORT_LABELS: Record<string, string> = {
  small: 'S',
  medium: 'M',
  large: 'L',
};

// === PROPS ===

interface ProjectPlanningModalProps {
  projectId: string;
  projectName: string;
  onClose: () => void;
}

export default function ProjectPlanningModal({
  projectId,
  projectName,
  onClose,
}: ProjectPlanningModalProps) {
  const { plan, planLoading, planError, generatePlan, clearPlan } =
    useTaskStructuringStore();

  // Local state
  const [additionalContext, setAdditionalContext] = useState('');
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [activePillar, setActivePillar] = useState(0);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [hasGenerated, setHasGenerated] = useState(false);

  // When plan loads, select all tasks by default
  useEffect(() => {
    if (plan) {
      const allTitles = new Set<string>();
      for (const pillar of plan.pillars) {
        for (const task of pillar.tasks) {
          allTitles.add(task.title);
        }
      }
      setSelectedTasks(allTitles);
      setActivePillar(0);
    }
  }, [plan]);

  // Close handler — clears plan and calls onClose
  const handleClose = useCallback(() => {
    clearPlan();
    onClose();
  }, [clearPlan, onClose]);

  // Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleClose]);

  // Overlay click to close
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) handleClose();
  };

  // Generate plan
  const handleGenerate = async () => {
    setHasGenerated(true);
    setApplyError(null);
    await generatePlan(projectId, additionalContext || undefined);
  };

  // Toggle task selection
  const toggleTask = (title: string) => {
    setSelectedTasks(prev => {
      const next = new Set(prev);
      if (next.has(title)) {
        next.delete(title);
      } else {
        next.add(title);
      }
      return next;
    });
  };

  // Count selected tasks
  const selectedCount = selectedTasks.size;
  const totalCount = plan
    ? plan.pillars.reduce((sum, p) => sum + p.tasks.length, 0)
    : 0;

  // Apply plan — create board + columns + cards
  const handleApply = async () => {
    if (!plan) return;
    setApplying(true);
    setApplyError(null);

    try {
      // Create board
      const board = await window.electronAPI.createBoard({
        projectId,
        name: 'AI Plan',
      });

      // For each pillar, create a column and cards
      for (const pillar of plan.pillars) {
        const column = await window.electronAPI.createColumn({
          boardId: board.id,
          name: pillar.name,
        });

        for (const task of pillar.tasks) {
          if (selectedTasks.has(task.title)) {
            await window.electronAPI.createCard({
              columnId: column.id,
              title: task.title,
              description: task.description,
              priority: task.priority,
            });
          }
        }
      }

      // Success — close modal
      clearPlan();
      onClose();
    } catch (error) {
      setApplyError(
        error instanceof Error ? error.message : 'Failed to apply plan',
      );
      setApplying(false);
    }
  };

  // Active pillar data
  const currentPillar: ProjectPillar | null =
    plan && plan.pillars[activePillar] ? plan.pillars[activePillar] : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleOverlayClick}
    >
      <div className="bg-surface-900 border border-surface-700 rounded-xl max-w-4xl w-full max-h-[85vh] overflow-y-auto p-6 mx-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sparkles size={20} className="text-primary-400" />
            <h2 className="text-lg font-semibold text-surface-100">
              AI Project Planning
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="text-surface-400 hover:text-surface-200 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Project name */}
        <p className="text-sm text-surface-400 mb-4">
          Planning for: <span className="text-surface-200">{projectName}</span>
        </p>

        {/* Context textarea */}
        <div className="mb-4">
          <label className="block text-sm text-surface-400 mb-1">
            Additional context (optional)
          </label>
          <textarea
            value={additionalContext}
            onChange={e => setAdditionalContext(e.target.value)}
            placeholder="Describe goals, tech stack, constraints, or any specific requirements..."
            rows={3}
            className="w-full text-sm bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-surface-200 placeholder:text-surface-500 focus:outline-none focus:border-primary-500 resize-none"
            disabled={planLoading}
          />
        </div>

        {/* Generate button */}
        <div className="mb-5">
          <button
            onClick={handleGenerate}
            disabled={planLoading}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm transition-colors"
          >
            {planLoading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Generating...
              </>
            ) : hasGenerated ? (
              <>
                <RefreshCw size={16} />
                Regenerate Plan
              </>
            ) : (
              <>
                <Sparkles size={16} />
                Generate Plan
              </>
            )}
          </button>
        </div>

        {/* Error state */}
        {planError && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2">
            <AlertCircle size={16} className="text-red-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm text-red-400">{planError}</p>
              <p className="text-xs text-surface-500 mt-1">
                Check that an AI provider is configured in Settings.
              </p>
            </div>
          </div>
        )}

        {/* Apply error */}
        {applyError && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2">
            <AlertCircle size={16} className="text-red-400 mt-0.5 shrink-0" />
            <p className="text-sm text-red-400">{applyError}</p>
          </div>
        )}

        {/* Loading state (inline, since button already shows spinner) */}
        {planLoading && !plan && (
          <div className="flex items-center gap-3 py-8 justify-center text-surface-400">
            <Loader2 size={24} className="animate-spin" />
            <p className="text-sm">
              Generating project plan... This may take a moment.
            </p>
          </div>
        )}

        {/* Plan results */}
        {plan && (
          <div className="space-y-5">
            {/* Summary */}
            <div>
              <h3 className="text-sm font-medium text-surface-400 mb-1">
                Summary
              </h3>
              <p className="text-sm text-surface-200">{plan.summary}</p>
            </div>

            {/* Pillar tabs */}
            <div>
              <h3 className="text-sm font-medium text-surface-400 mb-2">
                Pillars
              </h3>
              <div className="flex gap-1 mb-3 flex-wrap">
                {plan.pillars.map((pillar, idx) => (
                  <button
                    key={pillar.name}
                    onClick={() => setActivePillar(idx)}
                    className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                      idx === activePillar
                        ? 'bg-surface-700 text-surface-100'
                        : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800'
                    }`}
                  >
                    {pillar.name}
                  </button>
                ))}
              </div>

              {/* Active pillar content */}
              {currentPillar && (
                <div className="bg-surface-800/30 border border-surface-700/50 rounded-lg p-4">
                  <p className="text-sm text-surface-300 mb-3">
                    {currentPillar.description}
                  </p>

                  {/* Task list */}
                  <div className="space-y-2">
                    {currentPillar.tasks.map(task => (
                      <TaskRow
                        key={task.title}
                        task={task}
                        selected={selectedTasks.has(task.title)}
                        onToggle={() => toggleTask(task.title)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Milestones */}
            {plan.milestones.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-surface-400 mb-2">
                  Milestones
                </h3>
                <div className="space-y-3">
                  {plan.milestones.map(milestone => (
                    <div
                      key={milestone.name}
                      className="bg-surface-800/30 border border-surface-700/50 rounded-lg p-3"
                    >
                      <h4 className="text-sm font-medium text-surface-200">
                        {milestone.name}
                      </h4>
                      <p className="text-xs text-surface-400 mt-1">
                        {milestone.description}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {milestone.taskTitles.map(title => (
                          <span
                            key={title}
                            className="text-xs bg-surface-700/50 text-surface-300 px-2 py-0.5 rounded"
                          >
                            {title}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Apply / Cancel actions */}
            <div className="flex items-center justify-between pt-3 border-t border-surface-700">
              <p className="text-xs text-surface-500">
                {selectedCount} of {totalCount} tasks selected
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleClose}
                  className="text-surface-400 hover:text-surface-200 px-4 py-2 text-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleApply}
                  disabled={applying || selectedCount === 0}
                  className="flex items-center gap-2 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm transition-colors"
                >
                  {applying ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Check size={16} />
                      Apply Plan &mdash; Create Board &amp; Cards
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Empty state (no plan yet, not loading) */}
        {!plan && !planLoading && !planError && !hasGenerated && (
          <div className="py-8 text-center text-surface-500">
            <Sparkles size={32} className="mx-auto mb-3 text-surface-600" />
            <p className="text-sm">
              Generate an AI-powered project plan with production-focused
              pillars, tasks, and milestones.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// === TASK ROW COMPONENT ===

interface TaskRowProps {
  task: PillarTask;
  selected: boolean;
  onToggle: () => void;
}

function TaskRow({ task, selected, onToggle }: TaskRowProps) {
  return (
    <div className="bg-surface-800/50 rounded-lg px-4 py-2">
      <div className="flex items-center gap-3">
        {/* Checkbox */}
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="shrink-0 w-4 h-4 rounded border-surface-600 bg-surface-700 text-primary-500 focus:ring-primary-500 focus:ring-offset-0 cursor-pointer"
        />

        {/* Title */}
        <span className="text-sm text-surface-200 flex-1 min-w-0 truncate">
          {task.title}
        </span>

        {/* Priority badge */}
        <span
          className={`text-xs px-2 py-0.5 rounded shrink-0 ${PRIORITY_COLORS[task.priority] || ''}`}
        >
          {task.priority}
        </span>

        {/* Effort badge */}
        <span className="text-xs px-2 py-0.5 rounded bg-surface-700/50 text-surface-400 shrink-0">
          {EFFORT_LABELS[task.effort] || task.effort}
        </span>
      </div>

      {/* Description (subtle) */}
      {task.description && (
        <p className="text-xs text-surface-500 mt-1 ml-7 line-clamp-2">
          {task.description}
        </p>
      )}

      {/* Dependencies */}
      {task.dependencies && task.dependencies.length > 0 && (
        <p className="text-xs text-surface-500 mt-1 ml-7">
          <span className="text-surface-600">&rarr;</span> depends on:{' '}
          {task.dependencies.join(', ')}
        </p>
      )}
    </div>
  );
}
