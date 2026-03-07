// === FILE PURPOSE ===
// Detail modal for viewing/editing an existing idea OR creating a new one.
// Supports inline editing of title, description, status, effort, impact, and tags.
// Includes delete with confirmation, convert-to-project / convert-to-card wizard,
// AI analysis, and brainstorm navigation.

import { useState, useEffect, useRef } from 'react';
import {
  X,
  Loader2,
  Trash2,
  FolderPlus,
  ArrowRightCircle,
  MessageSquare,
  Sparkles,
} from 'lucide-react';
import { useIdeaStore } from '../stores/ideaStore';
import { useBrainstormStore } from '../stores/brainstormStore';
import { useSettingsStore } from '../stores/settingsStore';
import type {
  IdeaStatus,
  EffortLevel,
  ImpactLevel,
} from '../../shared/types';
import IdeaAnalysisSection from './IdeaAnalysisSection';
import IdeaConvertWizard from './IdeaConvertWizard';
import HudSelect from './HudSelect';
import EmptyAIState from './EmptyAIState';

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
  /** Pass an idea ID to edit, or null to create a new idea */
  ideaId: string | null;
  onClose: () => void;
  onNavigate?: (path: string) => void;
}

export default function IdeaDetailModal({ ideaId, onClose, onNavigate }: IdeaDetailModalProps) {
  const isCreateMode = ideaId === null;

  const selectedIdea = useIdeaStore(s => s.selectedIdea);
  const loadIdea = useIdeaStore(s => s.loadIdea);
  const createIdea = useIdeaStore(s => s.createIdea);
  const updateIdea = useIdeaStore(s => s.updateIdea);
  const deleteIdea = useIdeaStore(s => s.deleteIdea);
  const clearSelectedIdea = useIdeaStore(s => s.clearSelectedIdea);
  const convertToProject = useIdeaStore(s => s.convertToProject);
  const analysis = useIdeaStore(s => s.analysis);
  const analyzing = useIdeaStore(s => s.analyzing);
  const analysisError = useIdeaStore(s => s.analysisError);
  const analyzeIdea = useIdeaStore(s => s.analyzeIdea);
  const clearAnalysis = useIdeaStore(s => s.clearAnalysis);
  const hasAnyEnabledProvider = useSettingsStore(s => s.hasAnyEnabledProvider);

  // Local edit state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<IdeaStatus>('new');
  const [effort, setEffort] = useState<EffortLevel | ''>('');
  const [impact, setImpact] = useState<ImpactLevel | ''>('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [creating, setCreating] = useState(false);

  // Convert mode toggle
  const [convertMode, setConvertMode] = useState<'none' | 'project' | 'card'>('none');
  const [converting, setConverting] = useState(false);

  const titleInputRef = useRef<HTMLInputElement>(null);

  // Load idea on mount (edit mode only)
  useEffect(() => {
    if (!isCreateMode) {
      loadIdea(ideaId);
    }
    return () => clearSelectedIdea();
  }, [ideaId, isCreateMode, loadIdea, clearSelectedIdea]);

  // Sync local state when selectedIdea loads (edit mode)
  useEffect(() => {
    if (selectedIdea && !isCreateMode) {
      setTitle(selectedIdea.title);
      setDescription(selectedIdea.description ?? '');
      setStatus(selectedIdea.status);
      setEffort(selectedIdea.effort ?? '');
      setImpact(selectedIdea.impact ?? '');
      setTags([...selectedIdea.tags]);
    }
  }, [selectedIdea, isCreateMode]);

  // Auto-focus title
  useEffect(() => {
    // Small delay for the modal transition
    const timer = setTimeout(() => titleInputRef.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, []);

  // Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // === HANDLERS ===

  const handleCreate = async () => {
    if (!title.trim() || creating) return;
    setCreating(true);
    try {
      await createIdea({
        title: title.trim(),
        description: description.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
      });
      onClose();
    } finally {
      setCreating(false);
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (isCreateMode && e.key === 'Enter') {
      e.preventDefault();
      handleCreate();
    }
  };

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !tags.includes(tag)) {
      const newTags = [...tags, tag];
      setTags(newTags);
      if (!isCreateMode && selectedIdea) {
        updateIdea(selectedIdea.id, { tags: newTags });
      }
    }
    setTagInput('');
  };

  const removeTag = (tagToRemove: string) => {
    const newTags = tags.filter((t) => t !== tagToRemove);
    setTags(newTags);
    if (!isCreateMode && selectedIdea) {
      updateIdea(selectedIdea.id, { tags: newTags });
    }
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

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleBrainstormIdea = async () => {
    if (!selectedIdea) return;
    try {
      const store = useBrainstormStore.getState();
      const session = await store.createSession({
        title: `Brainstorm: ${selectedIdea.title}`,
        projectId: selectedIdea.projectId || undefined,
      });
      const desc = selectedIdea.description ? `\n\n${selectedIdea.description}` : '';
      const tagList = selectedIdea.tags?.length ? `\n\nTags: ${selectedIdea.tags.join(', ')}` : '';
      store.setDraftInput(
        `I'd like to brainstorm about this idea:\n\n**${selectedIdea.title}**${desc}${tagList}`
      );
      if (onNavigate) onNavigate(`/brainstorm?openSession=${session.id}`);
      onClose();
    } catch (error) {
      console.error('Failed to start brainstorm session:', error);
    }
  };

  // In edit mode, show loading while idea hasn't arrived yet
  const showLoading = !isCreateMode && !selectedIdea;
  // Content is ready when in create mode or when selectedIdea has loaded
  const showContent = isCreateMode || !!selectedIdea;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-surface-900/40 dark:bg-black/80 backdrop-blur-[2px]"
      onClick={handleOverlayClick}
    >
      <div className="hud-panel-accent clip-corner-cut shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto p-6 md:p-8">
        {/* Header row */}
        <div className="flex items-start justify-between gap-4 mb-2">
          {isCreateMode ? (
            <div className="flex items-center gap-2.5 mb-1">
              <Sparkles size={20} className="text-[var(--color-accent)] shrink-0" />
              <span className="font-hud text-lg text-[var(--color-accent)]">New Idea</span>
            </div>
          ) : (
            <div className="flex-1" />
          )}
          <div className="bg-surface-100/50 dark:bg-surface-800/50 p-1 rounded-lg shrink-0">
            <button
              onClick={onClose}
              className="text-surface-500 hover:text-surface-800 dark:hover:text-surface-200 p-1.5 rounded-md hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Title input */}
        <input
          ref={titleInputRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            if (!isCreateMode && selectedIdea && title.trim() && title.trim() !== selectedIdea.title) {
              updateIdea(selectedIdea.id, { title: title.trim() });
            }
          }}
          onKeyDown={handleTitleKeyDown}
          placeholder={isCreateMode ? 'What\'s your idea?' : 'Idea title...'}
          className="w-full bg-transparent text-xl md:text-2xl font-bold text-surface-900 dark:text-surface-50 focus:outline-none border-b-2 border-transparent focus:border-[var(--color-accent)] pb-1 transition-colors"
        />

        {/* Loading state (edit mode) */}
        {showLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin text-surface-400" />
          </div>
        )}

        {/* Content */}
        {showContent && (
          <>
            {/* Description */}
            <div className="mt-5">
              <label className="text-xs font-semibold text-surface-500 mb-1.5 block">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={() => {
                  if (!isCreateMode && selectedIdea && description !== (selectedIdea.description ?? '')) {
                    updateIdea(selectedIdea.id, { description: description.trim() || null });
                  }
                }}
                placeholder="Describe your idea..."
                rows={3}
                className="w-full text-sm bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] rounded-lg p-3 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] resize-y focus:outline-none focus:border-[var(--color-accent-dim)]"
              />
            </div>

            {/* Tags */}
            <div className="mt-4">
              <label className="text-xs font-semibold text-surface-500 mb-1.5 block">Tags</label>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="bg-[var(--color-accent-subtle)] text-[var(--color-accent-dim)] border border-[var(--color-border-accent)] text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1"
                    >
                      #{tag}
                      <button
                        onClick={() => removeTag(tag)}
                        className="text-[var(--color-accent-dim)] hover:text-[var(--color-accent)] transition-colors"
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
                  placeholder="Add tag and press Enter..."
                  className="flex-1 text-sm bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] rounded-lg px-3 py-1.5 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)]"
                />
                {tagInput.trim() && (
                  <button
                    onClick={addTag}
                    className="text-sm text-[var(--color-accent)] hover:text-[var(--color-accent-bright)] transition-colors font-medium"
                  >
                    Add
                  </button>
                )}
              </div>
            </div>

            {/* Create mode: Create button */}
            {isCreateMode && (
              <div className="mt-6">
                <button
                  onClick={handleCreate}
                  disabled={!title.trim() || creating}
                  className="btn-primary w-full rounded-xl px-5 py-3 font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {creating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                  Create Idea
                </button>
                <p className="text-[11px] text-[var(--color-text-muted)] text-center mt-2">
                  You can add more details after creating.
                </p>
              </div>
            )}

            {/* === Edit-mode-only sections below === */}
            {!isCreateMode && selectedIdea && (
              <>
                {/* Metadata row */}
                <div className="flex flex-wrap items-center gap-4 mt-5">
                  <div className="flex-1 min-w-[120px]">
                    <label className="text-xs font-semibold text-surface-500 mb-1.5 block">Status</label>
                    <HudSelect
                      value={status}
                      onChange={(v) => {
                        const newStatus = v as IdeaStatus;
                        setStatus(newStatus);
                        updateIdea(selectedIdea.id, { status: newStatus });
                      }}
                      options={STATUS_OPTIONS.map(opt => ({ value: opt.value, label: opt.label }))}
                    />
                  </div>
                  <div className="flex-1 min-w-[120px]">
                    <label className="text-xs font-semibold text-surface-500 mb-1.5 block">Effort</label>
                    <HudSelect
                      value={effort}
                      onChange={(v) => {
                        const newEffort = v as EffortLevel | '';
                        setEffort(newEffort);
                        updateIdea(selectedIdea.id, { effort: newEffort || null });
                      }}
                      placeholder="--"
                      options={[
                        { value: '', label: '--' },
                        ...EFFORT_OPTIONS.map(opt => ({ value: opt.value, label: opt.label })),
                      ]}
                    />
                  </div>
                  <div className="flex-1 min-w-[120px]">
                    <label className="text-xs font-semibold text-surface-500 mb-1.5 block">Impact</label>
                    <HudSelect
                      value={impact}
                      onChange={(v) => {
                        const newImpact = v as ImpactLevel | '';
                        setImpact(newImpact);
                        updateIdea(selectedIdea.id, { impact: newImpact || null });
                      }}
                      placeholder="--"
                      options={[
                        { value: '', label: '--' },
                        ...IMPACT_OPTIONS.map(opt => ({ value: opt.value, label: opt.label })),
                      ]}
                    />
                  </div>
                </div>

                {/* AI Analysis */}
                {hasAnyEnabledProvider() ? (
                  <IdeaAnalysisSection
                    analyzing={analyzing}
                    analysisError={analysisError}
                    analysis={analysis}
                    onAnalyze={() => analyzeIdea(selectedIdea.id)}
                    onClearAnalysis={clearAnalysis}
                    onApplyEffort={(newEffort) => {
                      setEffort(newEffort);
                      updateIdea(selectedIdea.id, { effort: newEffort });
                    }}
                    onApplyImpact={(newImpact) => {
                      setImpact(newImpact);
                      updateIdea(selectedIdea.id, { impact: newImpact });
                    }}
                  />
                ) : (
                  <EmptyAIState featureName="idea analysis" />
                )}

                {/* Divider — Actions */}
                <div className="border-t border-surface-200 dark:border-surface-700 mt-4 pt-4">
                  <label className="text-xs font-semibold text-surface-500 mb-2 block">Actions</label>

                  {convertMode === 'none' && (
                    <div className="space-y-2">
                      <button
                        onClick={handleBrainstormIdea}
                        className="flex items-center gap-2 px-4 py-2 border border-[var(--color-border)] hover:border-[var(--color-border-accent)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] rounded-lg text-sm transition-colors w-full"
                      >
                        <MessageSquare size={16} />
                        Brainstorm This Idea
                      </button>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setConvertMode('project')}
                          className="flex-1 flex items-center justify-center gap-2 p-3 border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-primary)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] transition-colors cursor-pointer"
                        >
                          <FolderPlus size={16} />
                          Create Project
                        </button>
                        <button
                          onClick={() => setConvertMode('card')}
                          className="flex-1 flex items-center justify-center gap-2 p-3 border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-primary)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] transition-colors cursor-pointer"
                        >
                          <ArrowRightCircle size={16} />
                          Add as Card
                        </button>
                      </div>
                    </div>
                  )}

                  {convertMode === 'project' && (
                    <div>
                      <p className="text-sm text-surface-700 dark:text-surface-300 mb-3">
                        Create a new project from this idea?
                      </p>
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          onClick={() => setConvertMode('none')}
                          className="text-sm text-surface-400 hover:text-surface-800 dark:text-surface-200 transition-colors"
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

                  {convertMode === 'card' && selectedIdea && (
                    <IdeaConvertWizard
                      ideaId={selectedIdea.id}
                      onComplete={onClose}
                      onCancel={() => setConvertMode('none')}
                    />
                  )}
                </div>

                {/* Delete section */}
                <div className="border-t border-surface-200 dark:border-surface-700 mt-4 pt-4">
                  <div className="flex items-center justify-end">
                    <div className="flex items-center gap-2">
                      {!confirmDelete ? (
                        <button
                          onClick={() => setConfirmDelete(true)}
                          className="flex items-center gap-1.5 text-sm font-medium text-surface-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400 px-3 py-1.5 rounded-md transition-colors"
                        >
                          <Trash2 size={16} />
                          Delete Idea
                        </button>
                      ) : (
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-medium text-surface-600 dark:text-surface-300">Delete this idea?</span>
                          <button
                            onClick={handleDelete}
                            disabled={deleting}
                            className="text-sm font-medium bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5"
                          >
                            {deleting && <Loader2 size={14} className="animate-spin" />}
                            Yes, delete
                          </button>
                          <button
                            onClick={() => setConfirmDelete(false)}
                            className="text-sm font-medium text-surface-500 hover:text-surface-800 dark:text-surface-400 dark:hover:text-surface-200 px-3 py-1.5 rounded-md transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
