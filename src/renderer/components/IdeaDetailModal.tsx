// === FILE PURPOSE ===
// Detail modal for viewing and editing an idea. Supports inline editing of title,
// description, status, effort, impact, and tags. Includes delete with confirmation
// and convert-to-project / convert-to-card wizard (same pattern as ConvertActionModal).
//
// === DEPENDENCIES ===
// react, lucide-react (X, Loader2, Trash2, FolderPlus, ArrowRightCircle, ChevronLeft),
// ideaStore, shared types, window.electronAPI (getProjects, getBoards, getColumns)

import { useState, useEffect } from 'react';
import {
  X,
  Loader2,
  Trash2,
  FolderPlus,
  ArrowRightCircle,
  ChevronLeft,
} from 'lucide-react';
import { useIdeaStore } from '../stores/ideaStore';
import type {
  IdeaStatus,
  EffortLevel,
  ImpactLevel,
  Project,
  Board,
  Column,
} from '../../shared/types';

// === CONSTANTS ===

const STATUS_OPTIONS: { label: string; value: IdeaStatus }[] = [
  { label: 'New', value: 'new' },
  { label: 'Exploring', value: 'exploring' },
  { label: 'Active', value: 'active' },
  { label: 'Archived', value: 'archived' },
];

const EFFORT_OPTIONS: { label: string; value: EffortLevel }[] = [
  { label: 'Trivial', value: 'trivial' },
  { label: 'Small', value: 'small' },
  { label: 'Medium', value: 'medium' },
  { label: 'Large', value: 'large' },
  { label: 'Epic', value: 'epic' },
];

const IMPACT_OPTIONS: { label: string; value: ImpactLevel }[] = [
  { label: 'Minimal', value: 'minimal' },
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Critical', value: 'critical' },
];

// === PROPS ===

interface IdeaDetailModalProps {
  ideaId: string;
  onClose: () => void;
}

export default function IdeaDetailModal({ ideaId, onClose }: IdeaDetailModalProps) {
  const {
    selectedIdea,
    loadIdea,
    updateIdea,
    deleteIdea,
    clearSelectedIdea,
    convertToProject,
    convertToCard,
  } = useIdeaStore();

  // Local edit state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<IdeaStatus>('new');
  const [effort, setEffort] = useState<EffortLevel | ''>('');
  const [impact, setImpact] = useState<ImpactLevel | ''>('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Convert-to-card wizard state
  const [convertMode, setConvertMode] = useState<'none' | 'project' | 'card'>('none');
  const [convertStep, setConvertStep] = useState<1 | 2 | 3>(1);
  const [projects, setProjects] = useState<Project[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);
  const [selectedColumnId, setSelectedColumnId] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);

  // Load idea on mount
  useEffect(() => {
    loadIdea(ideaId);
    return () => clearSelectedIdea();
  }, [ideaId, loadIdea, clearSelectedIdea]);

  // Sync local state when selectedIdea loads
  useEffect(() => {
    if (selectedIdea) {
      setTitle(selectedIdea.title);
      setDescription(selectedIdea.description ?? '');
      setStatus(selectedIdea.status);
      setEffort(selectedIdea.effort ?? '');
      setImpact(selectedIdea.impact ?? '');
      setTags([...selectedIdea.tags]);
    }
  }, [selectedIdea]);

  // Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Load projects when entering card convert mode
  useEffect(() => {
    if (convertMode !== 'card') return;
    let cancelled = false;
    window.electronAPI.getProjects().then((result) => {
      if (!cancelled) setProjects(result.filter((p) => !p.archived));
    });
    return () => { cancelled = true; };
  }, [convertMode]);

  // Load boards when project selected
  useEffect(() => {
    if (convertMode !== 'card' || !selectedProjectId) return;
    let cancelled = false;
    window.electronAPI.getBoards(selectedProjectId).then((result) => {
      if (!cancelled) {
        setBoards(result);
        if (result.length === 1) {
          setSelectedBoardId(result[0].id);
          setConvertStep(3);
        }
      }
    });
    return () => { cancelled = true; };
  }, [selectedProjectId, convertMode]);

  // Load columns when board selected
  useEffect(() => {
    if (convertMode !== 'card' || !selectedBoardId) return;
    let cancelled = false;
    window.electronAPI.getColumns(selectedBoardId).then((result) => {
      if (!cancelled) {
        setColumns(result);
        if (result.length === 1) setSelectedColumnId(result[0].id);
      }
    });
    return () => { cancelled = true; };
  }, [selectedBoardId, convertMode]);

  // === HANDLERS ===

  const handleSave = async () => {
    if (!selectedIdea || saving) return;
    setSaving(true);
    try {
      await updateIdea(selectedIdea.id, {
        title: title.trim() || selectedIdea.title,
        description: description.trim() || null,
        status,
        effort: effort || null,
        impact: impact || null,
        tags,
      });
    } finally {
      setSaving(false);
    }
  };

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
    }
    setTagInput('');
  };

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag();
    }
  };

  const handleDelete = async () => {
    if (!selectedIdea || deleting) return;
    setDeleting(true);
    try {
      await deleteIdea(selectedIdea.id);
      onClose();
    } finally {
      setDeleting(false);
    }
  };

  const handleConvertToProject = async () => {
    if (!selectedIdea || converting) return;
    setConverting(true);
    try {
      await convertToProject(selectedIdea.id);
      onClose();
    } finally {
      setConverting(false);
    }
  };

  const handleConvertToCard = async () => {
    if (!selectedIdea || !selectedColumnId || converting) return;
    setConverting(true);
    try {
      await convertToCard(selectedIdea.id, selectedColumnId);
      onClose();
    } finally {
      setConverting(false);
    }
  };

  const resetCardWizard = () => {
    setConvertMode('none');
    setConvertStep(1);
    setProjects([]);
    setBoards([]);
    setColumns([]);
    setSelectedProjectId(null);
    setSelectedBoardId(null);
    setSelectedColumnId(null);
  };

  const handleWizardNext = () => {
    if (convertStep === 1 && selectedProjectId) {
      setConvertStep(2);
    } else if (convertStep === 2 && selectedBoardId) {
      setConvertStep(3);
    } else if (convertStep === 3) {
      handleConvertToCard();
    }
  };

  const handleWizardBack = () => {
    if (convertStep === 3) {
      if (boards.length === 1) {
        setSelectedProjectId(null);
        setSelectedBoardId(null);
        setSelectedColumnId(null);
        setBoards([]);
        setColumns([]);
        setConvertStep(1);
      } else {
        setSelectedBoardId(null);
        setSelectedColumnId(null);
        setColumns([]);
        setConvertStep(2);
      }
    } else if (convertStep === 2) {
      setSelectedProjectId(null);
      setSelectedBoardId(null);
      setBoards([]);
      setConvertStep(1);
    }
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const canAdvanceWizard =
    (convertStep === 1 && selectedProjectId) ||
    (convertStep === 2 && selectedBoardId) ||
    (convertStep === 3 && selectedColumnId);

  // Step indicator dots
  const stepDots = [1, 2, 3].map((s) => {
    if (s < convertStep) return 'bg-primary-500/50';
    if (s === convertStep) return 'bg-primary-500';
    return 'bg-surface-700';
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleOverlayClick}
    >
      <div className="bg-surface-900 rounded-xl border border-surface-700 w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto p-5">
        {/* Header row */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Idea title..."
            className="flex-1 bg-transparent text-lg font-semibold text-surface-100 focus:outline-none border-b border-transparent focus:border-primary-500 pb-1"
          />
          <button
            onClick={onClose}
            className="text-surface-500 hover:text-surface-300 p-1 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Loading state */}
        {!selectedIdea && (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin text-surface-400" />
          </div>
        )}

        {/* Content — only when selectedIdea is loaded */}
        {selectedIdea && (
          <>
            {/* Metadata row */}
            <div className="flex items-center gap-3 mt-4">
              <div>
                <label className="text-xs text-surface-400 mb-1 block">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as IdeaStatus)}
                  className="bg-surface-800 border border-surface-700 rounded-lg text-sm text-surface-200 px-2 py-1.5 focus:outline-none focus:border-primary-500"
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-surface-400 mb-1 block">Effort</label>
                <select
                  value={effort}
                  onChange={(e) => setEffort(e.target.value as EffortLevel | '')}
                  className="bg-surface-800 border border-surface-700 rounded-lg text-sm text-surface-200 px-2 py-1.5 focus:outline-none focus:border-primary-500"
                >
                  <option value="">--</option>
                  {EFFORT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-surface-400 mb-1 block">Impact</label>
                <select
                  value={impact}
                  onChange={(e) => setImpact(e.target.value as ImpactLevel | '')}
                  className="bg-surface-800 border border-surface-700 rounded-lg text-sm text-surface-200 px-2 py-1.5 focus:outline-none focus:border-primary-500"
                >
                  <option value="">--</option>
                  {IMPACT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Description */}
            <div className="mt-4">
              <label className="text-sm font-medium text-surface-300 mb-1 block">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add a description..."
                className="bg-surface-800 border border-surface-700 rounded-lg p-3 text-sm text-surface-200 placeholder:text-surface-500 w-full min-h-[80px] resize-y focus:outline-none focus:border-primary-500"
              />
            </div>

            {/* Tags */}
            <div className="mt-4">
              <label className="text-sm font-medium text-surface-300 mb-2 block">
                Tags
              </label>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="bg-surface-700 text-surface-300 text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1"
                    >
                      #{tag}
                      <button
                        onClick={() => removeTag(tag)}
                        className="text-surface-500 hover:text-surface-100 transition-colors"
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                  placeholder="Add tag..."
                  className="bg-surface-800 border border-surface-700 rounded-lg px-3 py-1.5 text-sm text-surface-200 placeholder:text-surface-500 focus:outline-none focus:border-primary-500 flex-1"
                />
                <button
                  onClick={addTag}
                  className="text-sm text-primary-400 hover:text-primary-300 transition-colors"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-surface-700 mt-4 pt-4">
              <label className="text-sm font-medium text-surface-300 mb-2 block">
                Convert
              </label>

              {/* Default: two convert buttons */}
              {convertMode === 'none' && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setConvertMode('project')}
                    className="flex-1 flex items-center justify-center gap-2 p-3 border border-surface-700 rounded-lg text-sm text-surface-200 hover:border-primary-500 hover:bg-primary-500/10 transition-colors cursor-pointer"
                  >
                    <FolderPlus size={16} />
                    Create Project
                  </button>
                  <button
                    onClick={() => setConvertMode('card')}
                    className="flex-1 flex items-center justify-center gap-2 p-3 border border-surface-700 rounded-lg text-sm text-surface-200 hover:border-primary-500 hover:bg-primary-500/10 transition-colors cursor-pointer"
                  >
                    <ArrowRightCircle size={16} />
                    Add as Card
                  </button>
                </div>
              )}

              {/* Convert to project confirmation */}
              {convertMode === 'project' && (
                <div>
                  <p className="text-sm text-surface-300 mb-3">
                    Create a new project from this idea?
                  </p>
                  <div className="flex items-center gap-2 justify-end">
                    <button
                      onClick={() => setConvertMode('none')}
                      className="text-sm text-surface-400 hover:text-surface-200 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleConvertToProject}
                      disabled={converting}
                      className="bg-primary-600 hover:bg-primary-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm px-4 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
                    >
                      {converting && <Loader2 size={14} className="animate-spin" />}
                      Confirm
                    </button>
                  </div>
                </div>
              )}

              {/* Convert to card wizard */}
              {convertMode === 'card' && (
                <div>
                  {/* Step indicator dots */}
                  <div className="flex items-center justify-center gap-2 my-3">
                    {stepDots.map((cls, i) => (
                      <div key={i} className={`w-2 h-2 rounded-full ${cls}`} />
                    ))}
                  </div>

                  {/* Step content */}
                  <div className="min-h-[100px]">
                    {/* Step 1: Select Project */}
                    {convertStep === 1 && (
                      <div>
                        <p className="text-sm text-surface-300 mb-2">Choose a project</p>
                        <div className="max-h-48 overflow-y-auto space-y-1.5">
                          {projects.map((p) => (
                            <div
                              key={p.id}
                              onClick={() => setSelectedProjectId(p.id)}
                              className={`rounded-lg p-2.5 cursor-pointer border transition ${
                                selectedProjectId === p.id
                                  ? 'border-primary-500 bg-primary-500/10'
                                  : 'border-surface-700 hover:border-surface-600'
                              }`}
                            >
                              <span className="flex items-center text-sm text-surface-200">
                                <span
                                  className="w-3 h-3 rounded-full inline-block mr-2 shrink-0"
                                  style={{ backgroundColor: p.color || '#6b7280' }}
                                />
                                {p.name}
                              </span>
                            </div>
                          ))}
                          {projects.length === 0 && (
                            <p className="text-sm text-surface-500 text-center py-4">
                              No projects found
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Step 2: Select Board */}
                    {convertStep === 2 && (
                      <div>
                        <p className="text-sm text-surface-300 mb-2">Choose a board</p>
                        <div className="max-h-48 overflow-y-auto space-y-1.5">
                          {boards.map((b) => (
                            <div
                              key={b.id}
                              onClick={() => setSelectedBoardId(b.id)}
                              className={`rounded-lg p-2.5 cursor-pointer border transition ${
                                selectedBoardId === b.id
                                  ? 'border-primary-500 bg-primary-500/10'
                                  : 'border-surface-700 hover:border-surface-600'
                              }`}
                            >
                              <span className="text-sm text-surface-200">{b.name}</span>
                            </div>
                          ))}
                          {boards.length === 0 && (
                            <p className="text-sm text-surface-500 text-center py-4">
                              No boards found
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Step 3: Select Column */}
                    {convertStep === 3 && (
                      <div>
                        <p className="text-sm text-surface-300 mb-2">Choose a column</p>
                        <div className="max-h-48 overflow-y-auto space-y-1.5">
                          {columns.map((c) => (
                            <div
                              key={c.id}
                              onClick={() => setSelectedColumnId(c.id)}
                              className={`rounded-lg p-2.5 cursor-pointer border transition ${
                                selectedColumnId === c.id
                                  ? 'border-primary-500 bg-primary-500/10'
                                  : 'border-surface-700 hover:border-surface-600'
                              }`}
                            >
                              <span className="text-sm text-surface-200">{c.name}</span>
                            </div>
                          ))}
                          {columns.length === 0 && (
                            <p className="text-sm text-surface-500 text-center py-4">
                              No columns found
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Wizard footer */}
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-surface-700">
                    <div>
                      {convertStep > 1 && (
                        <button
                          onClick={handleWizardBack}
                          className="text-sm text-surface-400 hover:text-surface-200 flex items-center gap-1 transition-colors"
                        >
                          <ChevronLeft size={14} />
                          Back
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={resetCardWizard}
                        className="text-sm text-surface-400 hover:text-surface-200 transition-colors"
                      >
                        Cancel
                      </button>
                      {convertStep < 3 ? (
                        <button
                          onClick={handleWizardNext}
                          disabled={!canAdvanceWizard}
                          className="bg-primary-600 hover:bg-primary-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm px-4 py-1.5 rounded-lg transition-colors"
                        >
                          Next
                        </button>
                      ) : (
                        <button
                          onClick={handleConvertToCard}
                          disabled={!selectedColumnId || converting}
                          className="bg-primary-600 hover:bg-primary-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm px-4 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
                        >
                          {converting && <Loader2 size={14} className="animate-spin" />}
                          Convert
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="border-t border-surface-700 mt-4 pt-4">
              {/* Footer: Save + Delete */}
              <div className="flex items-center justify-between">
                {/* Save */}
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="bg-primary-600 hover:bg-primary-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm px-4 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
                >
                  {saving && <Loader2 size={14} className="animate-spin" />}
                  {saving ? 'Saving...' : 'Save'}
                </button>

                {/* Delete */}
                <div className="flex items-center gap-2">
                  {!confirmDelete ? (
                    <button
                      onClick={() => setConfirmDelete(true)}
                      className="text-surface-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-surface-800 transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  ) : (
                    <>
                      <span className="text-sm text-red-400">Delete?</span>
                      <button
                        onClick={() => setConfirmDelete(false)}
                        className="text-sm text-surface-400 hover:text-surface-200 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleDelete}
                        disabled={deleting}
                        className="bg-red-500/20 text-red-400 hover:bg-red-500/30 text-sm px-3 py-1 rounded-lg transition-colors flex items-center gap-1.5"
                      >
                        {deleting && <Loader2 size={14} className="animate-spin" />}
                        Confirm
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
