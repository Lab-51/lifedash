// === FILE PURPOSE ===
// Full-screen overlay modal for AI-powered project planning. Allows users to
// generate a production-focused project plan with pillars, tasks, and milestones,
// then edit and customize the entire plan before applying it as real boards,
// columns, and cards.
//
// === DEPENDENCIES ===
// react, lucide-react, taskStructuringStore, shared types, window.electronAPI
//
// === LIMITATIONS ===
// - Generated plans are transient (displayed in modal, not persisted)
// - Milestones are informational only (not applied to the board)
// - Editing milestones is not supported (pillars/tasks are the actionable parts)

import { useState, useEffect, useCallback, useRef } from 'react';
import FocusTrap from './FocusTrap';
import {
  X,
  Sparkles,
  Check,
  RefreshCw,
  AlertCircle,
  Loader2,
  Trash2,
  Plus,
} from 'lucide-react';
import { useTaskStructuringStore } from '../stores/taskStructuringStore';
import type { ProjectPillar, PillarTask, ProjectMilestone } from '../../shared/types';

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

const PRIORITIES: PillarTask['priority'][] = ['low', 'medium', 'high', 'urgent'];
const EFFORTS: PillarTask['effort'][] = ['small', 'medium', 'large'];

// === EDITABLE PLAN TYPES ===

interface EditableTask extends PillarTask {
  _id: string;
}

interface EditablePillar {
  _id: string;
  name: string;
  description: string;
  tasks: EditableTask[];
}

interface EditablePlan {
  summary: string;
  pillars: EditablePillar[];
  milestones: ProjectMilestone[];
}

let _idCounter = 0;
function genId(prefix: string): string {
  return `${prefix}-${++_idCounter}`;
}

function buildEditablePlan(plan: {
  pillars: ProjectPillar[];
  milestones: ProjectMilestone[];
  summary: string;
}): EditablePlan {
  return {
    summary: plan.summary,
    milestones: plan.milestones,
    pillars: plan.pillars.map(p => ({
      _id: genId('p'),
      name: p.name,
      description: p.description,
      tasks: p.tasks.map(t => ({ ...t, _id: genId('t') })),
    })),
  };
}

// === PROPS ===

interface ProjectPlanningModalProps {
  projectId: string;
  projectName: string;
  onClose: () => void;
  onApplied?: (projectId: string) => void;
}

export default function ProjectPlanningModal({
  projectId,
  projectName,
  onClose,
  onApplied,
}: ProjectPlanningModalProps) {
  const plan = useTaskStructuringStore(s => s.plan);
  const planLoading = useTaskStructuringStore(s => s.planLoading);
  const planError = useTaskStructuringStore(s => s.planError);
  const generatePlan = useTaskStructuringStore(s => s.generatePlan);
  const clearPlan = useTaskStructuringStore(s => s.clearPlan);

  // Local state
  const [additionalContext, setAdditionalContext] = useState('');
  const [editablePlan, setEditablePlan] = useState<EditablePlan | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [activePillar, setActivePillar] = useState(0);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [hasGenerated, setHasGenerated] = useState(false);

  // Initialize editable plan when AI plan loads
  useEffect(() => {
    if (plan) {
      const ep = buildEditablePlan(plan);
      setEditablePlan(ep);
      const allIds = new Set<string>();
      for (const pillar of ep.pillars) {
        for (const task of pillar.tasks) allIds.add(task._id);
      }
      setSelectedTaskIds(allIds);
      setActivePillar(0);
    }
  }, [plan]);

  // Close handler
  const handleClose = useCallback(() => {
    clearPlan();
    onClose();
  }, [clearPlan, onClose]);

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

  // === PLAN MUTATION HELPERS ===

  const toggleTask = (taskId: string) => {
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const updateTask = (pillarId: string, taskId: string, updates: Partial<PillarTask>) => {
    setEditablePlan(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        pillars: prev.pillars.map(p =>
          p._id === pillarId
            ? { ...p, tasks: p.tasks.map(t => (t._id === taskId ? { ...t, ...updates } : t)) }
            : p,
        ),
      };
    });
  };

  const deleteTask = (pillarId: string, taskId: string) => {
    if (!editablePlan) return;
    setEditablePlan({
      ...editablePlan,
      pillars: editablePlan.pillars.map(p =>
        p._id === pillarId ? { ...p, tasks: p.tasks.filter(t => t._id !== taskId) } : p,
      ),
    });
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    });
  };

  const addTask = (pillarId: string) => {
    if (!editablePlan) return;
    const newTask: EditableTask = {
      _id: genId('t'),
      title: 'New task',
      description: '',
      priority: 'medium',
      effort: 'medium',
    };
    setEditablePlan({
      ...editablePlan,
      pillars: editablePlan.pillars.map(p =>
        p._id === pillarId ? { ...p, tasks: [...p.tasks, newTask] } : p,
      ),
    });
    setSelectedTaskIds(prev => new Set([...prev, newTask._id]));
  };

  const updatePillarName = (pillarId: string, name: string) => {
    setEditablePlan(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        pillars: prev.pillars.map(p => (p._id === pillarId ? { ...p, name } : p)),
      };
    });
  };

  const deletePillar = (pillarId: string) => {
    if (!editablePlan || editablePlan.pillars.length <= 1) return;
    const pillar = editablePlan.pillars.find(p => p._id === pillarId);
    const newPillars = editablePlan.pillars.filter(p => p._id !== pillarId);
    setEditablePlan({ ...editablePlan, pillars: newPillars });
    if (pillar) {
      setSelectedTaskIds(prev => {
        const next = new Set(prev);
        for (const task of pillar.tasks) next.delete(task._id);
        return next;
      });
    }
    setActivePillar(prev => Math.min(prev, newPillars.length - 1));
  };

  const addPillar = () => {
    if (!editablePlan) return;
    const newPillar: EditablePillar = {
      _id: genId('p'),
      name: 'New Pillar',
      description: '',
      tasks: [],
    };
    setEditablePlan({ ...editablePlan, pillars: [...editablePlan.pillars, newPillar] });
    setActivePillar(editablePlan.pillars.length);
  };

  // === COUNTS ===

  const selectedCount = selectedTaskIds.size;
  const totalCount = editablePlan
    ? editablePlan.pillars.reduce((sum, p) => sum + p.tasks.length, 0)
    : 0;

  // === APPLY ===

  const handleApply = async () => {
    if (!editablePlan) return;
    setApplying(true);
    setApplyError(null);

    try {
      // Use existing board if available, otherwise create one
      const boards = await window.electronAPI.getBoards(projectId);
      const board =
        boards.length > 0
          ? boards[0]
          : await window.electronAPI.createBoard({ projectId, name: projectName || 'Board' });

      // For each pillar, create a column and cards for selected tasks
      for (const pillar of editablePlan.pillars) {
        const column = await window.electronAPI.createColumn({
          boardId: board.id,
          name: pillar.name,
        });

        for (const task of pillar.tasks) {
          if (selectedTaskIds.has(task._id)) {
            await window.electronAPI.createCard({
              columnId: column.id,
              title: task.title,
              description: task.description || undefined,
              priority: task.priority,
            });
          }
        }
      }

      // Success — close modal and navigate to the board
      clearPlan();
      if (onApplied) {
        onApplied(projectId);
      } else {
        onClose();
      }
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : 'Failed to apply plan');
      setApplying(false);
    }
  };

  // Active pillar data
  const currentPillar: EditablePillar | null =
    editablePlan && editablePlan.pillars[activePillar]
      ? editablePlan.pillars[activePillar]
      : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={handleOverlayClick}
    >
      <FocusTrap active={true} onDeactivate={handleClose}>
      <div className="hud-panel-accent clip-corner-cut max-w-4xl w-full max-h-[85vh] overflow-y-auto p-6 mx-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sparkles size={20} className="text-[var(--color-accent)]" />
            <h2 className="font-hud text-sm tracking-widest uppercase text-[var(--color-accent)]">AI Project Planning</h2>
          </div>
          <button
            onClick={handleClose}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Project name */}
        <p className="text-sm text-surface-400 mb-4">
          Planning for: <span className="text-surface-800 dark:text-surface-200">{projectName}</span>
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
            className="w-full text-sm bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] rounded-lg px-3 py-2 text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)] resize-none"
            disabled={planLoading}
          />
        </div>

        {/* Generate button */}
        <div className="mb-5">
          <button
            onClick={handleGenerate}
            disabled={planLoading}
            className="flex items-center gap-2 border border-[var(--color-accent-dim)] hover:border-[var(--color-accent)] text-[var(--color-accent)] hover:shadow-[0_0_12px_var(--color-chrome-glow)] disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm transition-all"
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

        {/* Loading state */}
        {planLoading && !editablePlan && (
          <div className="flex items-center gap-3 py-8 justify-center text-surface-400">
            <Loader2 size={24} className="animate-spin" />
            <p className="text-sm">Generating project plan... This may take a moment.</p>
          </div>
        )}

        {/* Plan results */}
        {editablePlan && (
          <div className="space-y-5">
            {/* Summary */}
            <div>
              <h3 className="font-hud text-[0.625rem] tracking-widest uppercase text-[var(--color-accent-dim)] mb-1">Summary</h3>
              <p className="text-sm text-surface-800 dark:text-surface-200">{editablePlan.summary}</p>
            </div>

            {/* Edit hint */}
            <p className="text-xs text-surface-500 italic">
              Customize before applying &mdash; click titles to edit, click badges to cycle
              priority/effort, add or remove tasks and pillars.
            </p>

            {/* Pillar tabs */}
            <div>
              <h3 className="font-hud text-[0.625rem] tracking-widest uppercase text-[var(--color-accent-dim)] mb-2">Pillars (columns)</h3>
              <div className="flex gap-1 mb-3 flex-wrap items-center">
                {editablePlan.pillars.map((pillar, idx) => (
                  <button
                    key={pillar._id}
                    onClick={() => setActivePillar(idx)}
                    className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                      idx === activePillar
                        ? 'bg-surface-700 text-surface-900 dark:text-surface-100'
                        : 'text-surface-400 hover:text-surface-800 dark:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800'
                    }`}
                  >
                    {pillar.name}
                    <span className="ml-1.5 text-xs text-surface-500">
                      ({pillar.tasks.length})
                    </span>
                  </button>
                ))}
                <button
                  onClick={addPillar}
                  className="px-2 py-1.5 rounded-lg text-surface-500 hover:text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                  title="Add pillar"
                >
                  <Plus size={14} />
                </button>
              </div>

              {/* Active pillar content */}
              {currentPillar && (
                <div className="hud-panel rounded-lg p-4">
                  {/* Pillar name + delete */}
                  <div className="flex items-center gap-2 mb-2">
                    <label className="text-xs text-surface-500 shrink-0">Column name:</label>
                    <input
                      type="text"
                      value={currentPillar.name}
                      onChange={e => updatePillarName(currentPillar._id, e.target.value)}
                      className="flex-1 text-sm bg-surface-800 border border-surface-700 rounded px-2 py-1 text-surface-800 dark:text-surface-200 focus:outline-none focus:border-primary-500"
                    />
                    {editablePlan.pillars.length > 1 && (
                      <button
                        onClick={() => deletePillar(currentPillar._id)}
                        className="text-surface-500 hover:text-red-400 transition-colors shrink-0"
                        title="Delete pillar"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>

                  {/* Pillar description */}
                  {currentPillar.description && (
                    <p className="text-sm text-surface-400 mb-3">{currentPillar.description}</p>
                  )}

                  {/* Task list */}
                  <div className="space-y-2">
                    {currentPillar.tasks.map(task => (
                      <EditableTaskRow
                        key={task._id}
                        task={task}
                        selected={selectedTaskIds.has(task._id)}
                        onToggle={() => toggleTask(task._id)}
                        onUpdate={updates => updateTask(currentPillar._id, task._id, updates)}
                        onDelete={() => deleteTask(currentPillar._id, task._id)}
                      />
                    ))}
                  </div>

                  {/* Add task button */}
                  <button
                    onClick={() => addTask(currentPillar._id)}
                    className="mt-3 flex items-center gap-1.5 text-xs text-surface-500 hover:text-primary-400 transition-colors"
                  >
                    <Plus size={12} />
                    Add task
                  </button>
                </div>
              )}
            </div>

            {/* Milestones */}
            {editablePlan.milestones.length > 0 && (
              <div>
                <h3 className="font-hud text-[0.625rem] tracking-widest uppercase text-[var(--color-accent-dim)] mb-2">Milestones</h3>
                <div className="space-y-3">
                  {editablePlan.milestones.map(milestone => (
                    <div
                      key={milestone.name}
                      className="hud-panel rounded-lg p-3"
                    >
                      <h4 className="text-sm font-medium text-surface-800 dark:text-surface-200">{milestone.name}</h4>
                      <p className="text-xs text-surface-400 mt-1">{milestone.description}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {milestone.taskTitles.map(title => (
                          <span
                            key={title}
                            className="text-xs bg-surface-700/50 text-surface-700 dark:text-surface-300 px-2 py-0.5 rounded"
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
            <div className="flex items-center justify-between pt-3 border-t border-[var(--color-border)]">
              <p className="text-xs text-surface-500">
                {selectedCount} of {totalCount} tasks selected
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleClose}
                  className="text-surface-400 hover:text-surface-800 dark:text-surface-200 px-4 py-2 text-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleApply}
                  disabled={applying || selectedCount === 0}
                  className="flex items-center gap-2 border border-[var(--color-accent-dim)] hover:border-[var(--color-accent)] text-[var(--color-accent)] hover:shadow-[0_0_12px_var(--color-chrome-glow)] disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm transition-all"
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

        {/* Empty state */}
        {!editablePlan && !planLoading && !planError && !hasGenerated && (
          <div className="py-8 text-center text-surface-500">
            <Sparkles size={32} className="mx-auto mb-3 text-surface-600" />
            <p className="text-sm">
              Generate an AI-powered project plan with production-focused pillars, tasks, and
              milestones.
            </p>
          </div>
        )}
      </div>
      </FocusTrap>
    </div>
  );
}

// === EDITABLE TASK ROW ===

interface EditableTaskRowProps {
  task: EditableTask;
  selected: boolean;
  onToggle: () => void;
  onUpdate: (updates: Partial<PillarTask>) => void;
  onDelete: () => void;
}

function EditableTaskRow({ task, selected, onToggle, onUpdate, onDelete }: EditableTaskRowProps) {
  const [editingField, setEditingField] = useState<'title' | 'description' | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus when entering edit mode
  useEffect(() => {
    if (editingField === 'title' && inputRef.current) inputRef.current.focus();
    if (editingField === 'description' && textareaRef.current) textareaRef.current.focus();
  }, [editingField]);

  const commitEdit = () => {
    if (editingField === 'title') {
      const trimmed = editValue.trim();
      if (trimmed && trimmed !== task.title) onUpdate({ title: trimmed });
    } else if (editingField === 'description') {
      if (editValue !== task.description) onUpdate({ description: editValue });
    }
    setEditingField(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && editingField === 'title') {
      e.preventDefault();
      commitEdit();
    }
    if (e.key === 'Escape') {
      // Prevent modal close when cancelling inline edit
      e.nativeEvent.stopImmediatePropagation();
      setEditingField(null);
    }
  };

  const cyclePriority = () => {
    const idx = PRIORITIES.indexOf(task.priority);
    onUpdate({ priority: PRIORITIES[(idx + 1) % PRIORITIES.length] });
  };

  const cycleEffort = () => {
    const idx = EFFORTS.indexOf(task.effort);
    onUpdate({ effort: EFFORTS[(idx + 1) % EFFORTS.length] });
  };

  return (
    <div className="bg-surface-100/50 dark:bg-surface-800/50 rounded-lg px-4 py-2 group">
      <div className="flex items-center gap-3">
        {/* Checkbox */}
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="shrink-0 w-4 h-4 rounded border-surface-600 bg-surface-700 text-primary-500 focus:ring-primary-500 focus:ring-offset-0 cursor-pointer"
        />

        {/* Title — click to edit */}
        {editingField === 'title' ? (
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            className="flex-1 min-w-0 text-sm bg-surface-800 border border-primary-500 rounded px-2 py-0.5 text-surface-800 dark:text-surface-200 focus:outline-none"
          />
        ) : (
          <span
            className="text-sm text-surface-800 dark:text-surface-200 flex-1 min-w-0 truncate cursor-pointer hover:text-primary-300 transition-colors"
            onClick={() => {
              setEditingField('title');
              setEditValue(task.title);
            }}
            title="Click to edit"
          >
            {task.title}
          </span>
        )}

        {/* Priority badge — click to cycle */}
        <button
          onClick={cyclePriority}
          className={`text-xs px-2 py-0.5 rounded shrink-0 hover:ring-1 hover:ring-surface-500 transition-all ${PRIORITY_COLORS[task.priority] || ''}`}
          title="Click to change priority"
        >
          {task.priority}
        </button>

        {/* Effort badge — click to cycle */}
        <button
          onClick={cycleEffort}
          className="text-xs px-2 py-0.5 rounded bg-surface-700/50 text-surface-400 shrink-0 hover:ring-1 hover:ring-surface-500 transition-all"
          title="Click to change effort"
        >
          {EFFORT_LABELS[task.effort] || task.effort}
        </button>

        {/* Delete */}
        <button
          onClick={onDelete}
          className="text-surface-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all shrink-0"
          title="Remove task"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Description — click to edit */}
      {editingField === 'description' ? (
        <textarea
          ref={textareaRef}
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
          rows={2}
          className="w-full mt-1 ml-7 text-xs bg-surface-800 border border-primary-500 rounded px-2 py-1 text-surface-700 dark:text-surface-300 focus:outline-none resize-none"
        />
      ) : task.description ? (
        <p
          className="text-xs text-surface-500 mt-1 ml-7 line-clamp-2 cursor-pointer hover:text-surface-400 transition-colors"
          onClick={() => {
            setEditingField('description');
            setEditValue(task.description);
          }}
          title="Click to edit"
        >
          {task.description}
        </p>
      ) : (
        <button
          onClick={() => {
            setEditingField('description');
            setEditValue('');
          }}
          className="text-xs text-surface-600 mt-1 ml-7 hover:text-surface-400 transition-colors"
        >
          + Add description
        </button>
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
