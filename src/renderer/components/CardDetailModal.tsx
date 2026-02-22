// === FILE PURPOSE ===
// Card detail modal — overlay for viewing and editing full card details.
// Contains title editing, priority selector, TipTap rich text description editor,
// labels, due date picker with status badge, comments, relationships, and activity log sections.

// === DEPENDENCIES ===
// react, lucide-react (X, Plus, FileText, Calendar, Bot, PanelRightClose), @tiptap/react,
// @tiptap/starter-kit, @tiptap/extension-placeholder, shared types, boardStore,
// cardDetailStore, section components

import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { X, Plus, FileText, Calendar, Sparkles, Check, RefreshCw, BookmarkPlus, Bot, PanelRightClose } from 'lucide-react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import type { Card, UpdateCardInput, CardPriority } from '../../shared/types';
import type { CardTemplate } from '../../shared/types/cards';
import { useBoardStore } from '../stores/boardStore';
import { useCardDetailStore } from '../stores/cardDetailStore';
import { getDueDateBadge } from '../utils/date-utils';
import AttachmentsSection from './AttachmentsSection';
import ChecklistSection from './ChecklistSection';
import CommentsSection from './CommentsSection';
import RelationshipsSection from './RelationshipsSection';
import ActivityLog from './ActivityLog';
import TaskBreakdownSection from './TaskBreakdownSection';
import { useTaskStructuringStore } from '../stores/taskStructuringStore';
import { useGamificationStore } from '../stores/gamificationStore';
import { useCardAgentStore } from '../stores/cardAgentStore';
import { toast } from '../hooks/useToast';

interface CardDetailModalProps {
  card: Card;
  onUpdate: (id: string, data: UpdateCardInput) => Promise<void>;
  onClose: () => void;
}

const PRIORITY_OPTIONS: { value: CardPriority; label: string; activeClass: string; inactiveClass: string }[] = [
  { value: 'low', label: 'LOW', activeClass: 'bg-emerald-500/30 text-emerald-400 ring-1 ring-emerald-500/50', inactiveClass: 'text-surface-400 hover:text-emerald-400' },
  { value: 'medium', label: 'MED', activeClass: 'bg-blue-500/30 text-blue-400 ring-1 ring-blue-500/50', inactiveClass: 'text-surface-400 hover:text-blue-400' },
  { value: 'high', label: 'HIGH', activeClass: 'bg-amber-500/30 text-amber-400 ring-1 ring-amber-500/50', inactiveClass: 'text-surface-400 hover:text-amber-400' },
  { value: 'urgent', label: 'URG', activeClass: 'bg-red-500/30 text-red-400 ring-1 ring-red-500/50', inactiveClass: 'text-surface-400 hover:text-red-400' },
];

const LABEL_COLORS = [
  '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899',
];

interface BuiltinTemplate {
  id: string;
  name: string;
  icon: string;
  priority: CardPriority;
  description: string;
}

// Built-in templates (always available, not DB-backed)
const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: 'bug',
    name: 'Bug Report',
    icon: '🐛',
    priority: 'high',
    description: '<h2>Steps to Reproduce</h2><ol><li></li></ol><h2>Expected Behavior</h2><p></p><h2>Actual Behavior</h2><p></p><h2>Environment</h2><p></p>',
  },
  {
    id: 'feature',
    name: 'Feature Request',
    icon: '✨',
    priority: 'medium',
    description: '<h2>User Story</h2><p>As a [user], I want [goal] so that [benefit].</p><h2>Acceptance Criteria</h2><ul><li></li></ul><h2>Notes</h2><p></p>',
  },
  {
    id: 'action',
    name: 'Meeting Action',
    icon: '📋',
    priority: 'medium',
    description: '<h2>Meeting</h2><p></p><h2>Action Required</h2><p></p><h2>Assignee</h2><p></p><h2>Due Date</h2><p></p>',
  },
  {
    id: 'note',
    name: 'Quick Note',
    icon: '📝',
    priority: 'low',
    description: '<p></p>',
  },
  {
    id: 'research',
    name: 'Research Task',
    icon: '🔍',
    priority: 'medium',
    description: '<h2>Topic</h2><p></p><h2>Key Questions</h2><ul><li></li></ul><h2>Findings</h2><p></p><h2>Next Steps</h2><p></p>',
  },
];

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatRelativeTime(isoDate: string): string {
  const seconds = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  const days = Math.floor(seconds / 86400);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** Calculate the next recurrence date from a due date and recurrence type. */
function getNextRecurrenceDate(dueDate: string, recurrenceType: string): Date {
  const d = new Date(dueDate);
  switch (recurrenceType) {
    case 'daily':
      d.setDate(d.getDate() + 1);
      break;
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'biweekly':
      d.setDate(d.getDate() + 14);
      break;
    case 'monthly':
      d.setMonth(d.getMonth() + 1);
      break;
  }
  return d;
}

/** Format a Date as a friendly string like "Wed, Feb 25, 2026". */
function formatNextDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Convert ISO string to datetime-local input value (YYYY-MM-DDTHH:mm) */
function toDateTimeLocalValue(isoStr: string): string {
  const d = new Date(isoStr);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

const CardAgentPanel = lazy(() => import('./CardAgentPanel'));

function CardDetailModal({ card, onUpdate, onClose }: CardDetailModalProps) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState(card.title);
  const [showLabelDropdown, setShowLabelDropdown] = useState(false);
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState(LABEL_COLORS[0]);
  const labelDropdownRef = useRef<HTMLDivElement>(null);
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false);
  const templateDropdownRef = useRef<HTMLDivElement>(null);
  const [generatingDescription, setGeneratingDescription] = useState(false);
  const [dbTemplates, setDbTemplates] = useState<CardTemplate[]>([]);
  const [showAgent, setShowAgent] = useState(false);
  const [agentEverOpened, setAgentEverOpened] = useState(false);
  const showAgentRef = useRef(false);
  const agentMessageCount = useCardAgentStore(s => s.messageCount);

  const project = useBoardStore(s => s.project);
  const labels = useBoardStore(s => s.labels);
  const createLabel = useBoardStore(s => s.createLabel);
  const attachLabel = useBoardStore(s => s.attachLabel);
  const detachLabel = useBoardStore(s => s.detachLabel);
  const loadCardDetails = useCardDetailStore(s => s.loadCardDetails);
  const clearCardDetails = useCardDetailStore(s => s.clearCardDetails);
  const loadingCardDetails = useCardDetailStore(s => s.loadingCardDetails);
  const clearBreakdown = useTaskStructuringStore(s => s.clearBreakdown);

  // TipTap editor setup
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Add a description...' }),
    ],
    content: card.description || '',
    immediatelyRender: true,
    onBlur: ({ editor }) => {
      const html = editor.getHTML();
      const isEmpty = html === '<p></p>' || html === '';
      const newDesc = isEmpty ? null : html;
      if (newDesc !== card.description) {
        onUpdate(card.id, { description: newDesc });
      }
    },
  });

  // Keep ref in sync with state (avoids stale closures in keydown handler)
  useEffect(() => {
    showAgentRef.current = showAgent;
    if (showAgent && !agentEverOpened) {
      setAgentEverOpened(true);
    }
  }, [showAgent, agentEverOpened]);

  // Close on Escape key — two-stage: first close agent panel, then close modal
  // Skip when focus is inside an input/textarea/contenteditable to avoid conflicts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return;
      if (showAgentRef.current) {
        setShowAgent(false);
      } else {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Load card details (comments, relationships, activities) on mount
  useEffect(() => {
    loadCardDetails(card.id);
    useCardAgentStore.getState().loadMessageCount(card.id);
    return () => {
      clearCardDetails();
      clearBreakdown();
      useCardAgentStore.getState().reset();
    };
  }, [card.id, loadCardDetails, clearCardDetails, clearBreakdown]);

  // Close label dropdown on outside click
  useEffect(() => {
    if (!showLabelDropdown) return;
    const handleClick = (e: MouseEvent) => {
      if (labelDropdownRef.current && !labelDropdownRef.current.contains(e.target as Node)) {
        setShowLabelDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showLabelDropdown]);

  // Close template dropdown on outside click
  useEffect(() => {
    if (!showTemplateDropdown) return;
    const handleClick = (e: MouseEvent) => {
      if (templateDropdownRef.current && !templateDropdownRef.current.contains(e.target as Node)) {
        setShowTemplateDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showTemplateDropdown]);

  // Fetch DB templates when dropdown is opened
  const fetchDbTemplates = useCallback(async () => {
    try {
      const templates = await window.electronAPI.getCardTemplates(project?.id);
      setDbTemplates(templates);
    } catch {
      // Silently fail — built-in templates still available
    }
  }, [project?.id]);

  useEffect(() => {
    if (showTemplateDropdown) {
      fetchDbTemplates();
    }
  }, [showTemplateDropdown, fetchDbTemplates]);

  // Title editing handlers
  const startEditingTitle = () => {
    setEditTitle(card.title);
    setIsEditingTitle(true);
  };

  const saveTitleEdit = async () => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== card.title) {
      await onUpdate(card.id, { title: trimmed });
    }
    setIsEditingTitle(false);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      saveTitleEdit();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      setEditTitle(card.title);
      setIsEditingTitle(false);
    }
  };

  // Priority change handler
  const handlePriorityChange = (priority: CardPriority) => {
    if (priority !== card.priority) {
      onUpdate(card.id, { priority });
    }
  };

  // Template handler — works for both built-in and DB templates
  const applyTemplate = (template: { description: string | null; priority: CardPriority }) => {
    if (editor && template.description) {
      editor.commands.setContent(template.description);
      onUpdate(card.id, { description: template.description });
    }
    if (template.priority !== card.priority) {
      onUpdate(card.id, { priority: template.priority });
    }
    setShowTemplateDropdown(false);
  };

  // Delete a DB template
  const handleDeleteDbTemplate = async (templateId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await window.electronAPI.deleteCardTemplate(templateId);
      setDbTemplates(prev => prev.filter(t => t.id !== templateId));
      toast('Template deleted', 'success');
    } catch {
      toast('Failed to delete template', 'error');
    }
  };

  // Save current card as template
  const handleSaveAsTemplate = async () => {
    const name = window.prompt('Template name:', card.title);
    if (!name) return;
    try {
      await window.electronAPI.saveCardAsTemplate(card.id, name);
      toast('Saved template: ' + name, 'success');
      // Refresh if dropdown is open
      if (showTemplateDropdown) {
        fetchDbTemplates();
      }
    } catch {
      toast('Failed to save template', 'error');
    }
  };

  // AI description generation handler
  const handleGenerateDescription = async () => {
    setGeneratingDescription(true);
    try {
      const result = await window.electronAPI.generateCardDescription(card.id);
      if (result?.description && editor) {
        editor.commands.setContent(result.description);
        onUpdate(card.id, { description: result.description });
        useGamificationStore.getState().awardXP('ai_description');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate description';
      toast(message, 'error');
    } finally {
      setGeneratingDescription(false);
    }
  };

  // Label handlers
  const unattachedLabels = labels.filter(
    l => !card.labels?.some(cl => cl.id === l.id)
  );

  const handleAttachLabel = async (labelId: string) => {
    await attachLabel(card.id, labelId);
  };

  const handleDetachLabel = async (labelId: string) => {
    await detachLabel(card.id, labelId);
  };

  const handleCreateAndAttach = async () => {
    const name = newLabelName.trim();
    if (!name) return;
    const label = await createLabel(name, newLabelColor);
    await attachLabel(card.id, label.id);
    setNewLabelName('');
    setNewLabelColor(LABEL_COLORS[0]);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/60"
    >
      <div className={`bg-white dark:bg-surface-900 rounded-xl border border-surface-200 dark:border-surface-600 w-full ${
        showAgent ? 'max-w-[90vw] xl:max-w-7xl' : 'max-w-3xl'
      } max-h-[85vh] mx-4 flex flex-col overflow-hidden transition-all duration-300 ease-out`}>
        {/* Header: Title + AI Agent toggle + Close button */}
        <div className="flex items-start justify-between gap-3 p-6 pb-4 shrink-0">
          <div className="flex-1 min-w-0">
            {isEditingTitle ? (
              <input
                type="text"
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                onKeyDown={handleTitleKeyDown}
                onBlur={saveTitleEdit}
                autoFocus
                className="bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg px-3 py-2 text-xl font-bold text-surface-900 dark:text-surface-100 focus:outline-none focus:border-primary-500 w-full"
              />
            ) : (
              <h2
                className={`text-xl font-bold cursor-pointer hover:text-surface-800 dark:hover:text-surface-200 ${card.completed ? 'text-surface-500 line-through' : 'text-surface-900 dark:text-surface-100'}`}
                onClick={startEditingTitle}
              >
                {card.title}
              </h2>
            )}
          </div>
          <button
            onClick={() => setShowAgent(!showAgent)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors duration-200 shrink-0 ${
              showAgent
                ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                : 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800'
            }`}
          >
            <Bot size={16} />
            AI Agent
            {agentMessageCount > 0 && (
              <span className="text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                {agentMessageCount}
              </span>
            )}
          </button>
          <button
            onClick={onClose}
            className="text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 p-1 transition-colors shrink-0"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content area: details (left) + agent panel (right) */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left: Details (always visible) */}
          <div className="flex-1 overflow-y-auto min-w-0 px-6 pb-6 pr-5">
            {/* Priority selector */}
            <div className="mb-5">
              <span className="text-sm text-surface-400 block mb-2">Priority</span>
              <div className="flex items-center gap-2">
                {PRIORITY_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => handlePriorityChange(opt.value)}
                    className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${card.priority === opt.value ? opt.activeClass : opt.inactiveClass
                      }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Template selector + Save as template + AI generate */}
            <div className="mb-5 flex items-center gap-4">
              <div className="relative" ref={templateDropdownRef}>
                <button
                  onClick={() => setShowTemplateDropdown(!showTemplateDropdown)}
                  className="inline-flex items-center gap-1.5 text-xs text-surface-400 hover:text-surface-100 transition-colors"
                >
                  <FileText size={14} />
                  Apply Template
                </button>

                {showTemplateDropdown && (
                  <div className="absolute top-full left-0 mt-1 bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-600 rounded-lg shadow-lg py-1 min-w-[220px] z-40">
                    {dbTemplates.length > 0 && (
                      <>
                        <div className="px-3 py-1 text-xs text-surface-500 uppercase tracking-wide">
                          Your Templates
                        </div>
                        {dbTemplates.map(template => (
                          <button
                            key={template.id}
                            onClick={() => applyTemplate(template)}
                            className="group/tpl flex items-center gap-2 w-full px-3 py-1.5 text-sm text-surface-800 dark:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors text-left"
                          >
                            <span className="truncate flex-1">{template.name}</span>
                            <span
                              onClick={(e) => handleDeleteDbTemplate(template.id, e)}
                              className="opacity-0 group-hover/tpl:opacity-100 text-surface-500 hover:text-red-400 transition-all shrink-0 p-0.5"
                              title="Delete template"
                            >
                              <X size={12} />
                            </span>
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
                    {BUILTIN_TEMPLATES.map(template => (
                      <button
                        key={template.id}
                        onClick={() => applyTemplate(template)}
                        className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-surface-800 dark:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors text-left"
                      >
                        <span>{template.icon}</span>
                        {template.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={handleSaveAsTemplate}
                className="inline-flex items-center gap-1.5 text-xs text-surface-400 hover:text-surface-100 transition-colors"
                title="Save as template"
              >
                <BookmarkPlus size={14} />
                Save as Template
              </button>

              <button
                onClick={handleGenerateDescription}
                disabled={generatingDescription}
                className="inline-flex items-center gap-1.5 text-xs text-surface-400 hover:text-surface-100 transition-colors disabled:opacity-50"
                title="Generate description from card title using AI"
              >
                <Sparkles size={14} className={generatingDescription ? 'animate-spin' : ''} />
                {generatingDescription ? 'Generating...' : 'Generate with AI'}
              </button>
            </div>

            {/* Description — TipTap editor */}
            <div className="mb-5">
              <span className="text-sm text-surface-400 block mb-2">Description</span>
              <div className="tiptap-editor bg-surface-100/50 dark:bg-surface-800/50 rounded-lg border border-surface-200 dark:border-surface-700">
                <EditorContent editor={editor} />
              </div>
            </div>

            {/* Labels */}
            <div className="mb-5">
              <span className="text-sm text-surface-400 block mb-2">Labels</span>
              <div className="flex flex-wrap items-center gap-2">
                {card.labels?.map(label => (
                  <span
                    key={label.id}
                    className="inline-flex items-center gap-1.5 bg-surface-50 dark:bg-surface-800 rounded-full px-2.5 py-1 text-xs text-surface-800 dark:text-surface-200"
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: label.color }}
                    />
                    {label.name}
                    <button
                      onClick={() => handleDetachLabel(label.id)}
                      className="text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors ml-0.5"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}

                {/* Add label button + dropdown */}
                <div className="relative" ref={labelDropdownRef}>
                  <button
                    onClick={() => setShowLabelDropdown(!showLabelDropdown)}
                    className="inline-flex items-center gap-1 text-xs text-surface-400 hover:text-surface-800 dark:hover:text-surface-200 bg-surface-50 dark:bg-surface-800 rounded-full px-2.5 py-1 transition-colors"
                  >
                    <Plus size={12} />
                    Add
                  </button>

                  {showLabelDropdown && (
                    <div className="absolute top-full left-0 mt-1 bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-600 rounded-lg shadow-lg p-2 min-w-[220px] z-40">
                      {/* Existing unattached labels */}
                      {unattachedLabels.length > 0 && (
                        <div className="mb-2">
                          {unattachedLabels.map(label => (
                            <button
                              key={label.id}
                              onClick={() => handleAttachLabel(label.id)}
                              className="flex items-center gap-2 w-full px-2 py-1.5 rounded text-xs text-surface-800 dark:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
                            >
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: label.color }}
                              />
                              {label.name}
                              <Plus size={12} className="ml-auto text-surface-500" />
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Divider */}
                      {unattachedLabels.length > 0 && (
                        <div className="border-t border-surface-200 dark:border-surface-700 my-2" />
                      )}

                      {/* Create new label */}
                      <div className="space-y-2">
                        <span className="text-[10px] uppercase tracking-wider text-surface-500 font-medium">
                          Create new
                        </span>
                        <input
                          type="text"
                          value={newLabelName}
                          onChange={e => setNewLabelName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleCreateAndAttach(); }}
                          placeholder="Label name..."
                          className="bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded px-2 py-1 text-xs text-surface-900 dark:text-surface-100 placeholder:text-surface-500 focus:outline-none focus:border-primary-500 w-full"
                        />
                        <div className="flex items-center gap-1.5">
                          {LABEL_COLORS.map(color => (
                            <button
                              key={color}
                              onClick={() => setNewLabelColor(color)}
                              className={`w-5 h-5 rounded-full transition-all ${newLabelColor === color ? 'ring-2 ring-white/70 scale-110' : 'hover:scale-110'
                                }`}
                              style={{ backgroundColor: color }}
                            />
                          ))}
                        </div>
                        <button
                          onClick={handleCreateAndAttach}
                          disabled={!newLabelName.trim()}
                          className="bg-primary-600 hover:bg-primary-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs px-3 py-1 rounded transition-colors w-full"
                        >
                          Add Label
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Completion */}
            <div className="mb-5">
              <span className="text-sm text-surface-400 block mb-2">Status</span>
              <button
                onClick={() => onUpdate(card.id, { completed: !card.completed })}
                className="flex items-center gap-2.5 group/check"
              >
                <div
                  className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                    card.completed
                      ? 'bg-emerald-600 border-emerald-500'
                      : 'border-surface-300 dark:border-surface-600 bg-surface-50 dark:bg-surface-800 group-hover/check:border-surface-400'
                  }`}
                >
                  {card.completed && <Check size={12} className="text-white" />}
                </div>
                <span className={`text-sm ${card.completed ? 'text-emerald-400' : 'text-surface-700 dark:text-surface-300'}`}>
                  {card.completed ? 'Completed' : 'Mark as complete'}
                </span>
              </button>
            </div>

            {/* Due Date */}
            <div className="mb-5">
              <span className="text-sm text-surface-400 block mb-2">Due Date</span>
              <div className="flex items-center gap-3">
                <Calendar size={16} className="text-surface-400 shrink-0" />
                <input
                  type="datetime-local"
                  value={card.dueDate ? toDateTimeLocalValue(card.dueDate) : ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    onUpdate(card.id, {
                      dueDate: val ? new Date(val).toISOString() : null,
                    });
                  }}
                  className="bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg px-3 py-1.5 text-sm text-surface-900 dark:text-surface-100 focus:outline-none focus:border-primary-500 dark:[color-scheme:dark]"
                />
                {card.dueDate && (
                  <>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${card.completed ? 'bg-emerald-500/20 text-emerald-400' : getDueDateBadge(card.dueDate).classes}`}>
                      {card.completed ? 'Done' : getDueDateBadge(card.dueDate).label}
                    </span>
                    <button
                      onClick={() => onUpdate(card.id, { dueDate: null })}
                      className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors"
                    >
                      Clear
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Repeat / Recurrence */}
            <div className="mb-5">
              <span className="text-sm text-surface-400 flex items-center gap-1.5 mb-2">
                <RefreshCw size={14} />
                Repeat
              </span>
              <select
                value={card.recurrenceType ?? ''}
                onChange={(e) => {
                  const val = e.target.value;
                  onUpdate(card.id, { recurrenceType: val || null });
                }}
                className="bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg px-3 py-1.5 text-sm text-surface-900 dark:text-surface-100 focus:outline-none focus:border-primary-500 dark:[color-scheme:dark]"
              >
                <option value="">None</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Bi-weekly</option>
                <option value="monthly">Monthly</option>
              </select>

              {/* Next date preview */}
              {card.recurrenceType && card.dueDate && (
                <p className="text-xs text-surface-400 mt-2">
                  Next: {formatNextDate(getNextRecurrenceDate(card.dueDate, card.recurrenceType))}
                </p>
              )}
              {card.recurrenceType && !card.dueDate && (
                <p className="text-xs text-amber-400 mt-2">
                  Set a due date for auto-scheduling
                </p>
              )}

              {/* End repeat date */}
              {card.recurrenceType && (
                <div className="flex items-center gap-3 mt-3">
                  <span className="text-xs text-surface-500">End repeat:</span>
                  <input
                    type="datetime-local"
                    value={card.recurrenceEndDate ? toDateTimeLocalValue(card.recurrenceEndDate) : ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      onUpdate(card.id, {
                        recurrenceEndDate: val ? new Date(val).toISOString() : null,
                      });
                    }}
                    className="bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg px-3 py-1.5 text-sm text-surface-900 dark:text-surface-100 focus:outline-none focus:border-primary-500 dark:[color-scheme:dark]"
                  />
                  {card.recurrenceEndDate && (
                    <button
                      onClick={() => onUpdate(card.id, { recurrenceEndDate: null })}
                      className="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Card Details: Comments, Relationships, Activity */}
            {loadingCardDetails ? (
              <div className="text-sm text-surface-500 py-4 text-center">Loading details...</div>
            ) : (
              <>
                <div className="mb-5">
                  <ChecklistSection cardId={card.id} />
                </div>
                <div className="mb-5">
                  <AttachmentsSection cardId={card.id} />
                </div>
                <div className="mb-5">
                  <CommentsSection cardId={card.id} />
                </div>
                <div className="mb-5">
                  <RelationshipsSection cardId={card.id} />
                </div>
                <div className="mb-5">
                  <ActivityLog cardId={card.id} />
                </div>
                <div className="mb-5">
                  <TaskBreakdownSection cardId={card.id} columnId={card.columnId} />
                </div>
              </>
            )}

            {/* Timestamps */}
            <div className="text-xs text-surface-500 flex items-center gap-1">
              <span>Created: {formatDate(card.createdAt)} ({formatRelativeTime(card.createdAt)})</span>
              <span>·</span>
              <span>Updated: {formatDate(card.updatedAt)} ({formatRelativeTime(card.updatedAt)})</span>
            </div>
          </div>

          {/* Right: Agent panel (always rendered, width-animated) */}
          <div className={`shrink-0 overflow-hidden transition-all duration-300 ease-out border-l ${
            showAgent
              ? 'w-[360px] xl:w-[420px] border-surface-200 dark:border-surface-700'
              : 'w-0 border-transparent'
          }`}>
            <div className="min-w-[360px] xl:min-w-[420px] h-full flex flex-col bg-surface-50 dark:bg-surface-800/50">
              <div className="flex items-center justify-between px-3 py-2 border-b border-surface-200 dark:border-surface-700 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-surface-900 dark:text-surface-100">AI Agent</span>
                  {agentMessageCount > 0 && (
                    <span className="text-xs bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded-full">
                      {agentMessageCount}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setShowAgent(false)}
                  className="p-1 rounded text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors"
                >
                  <PanelRightClose size={16} />
                </button>
              </div>
              <div className="flex-1 min-h-0">
                {agentEverOpened && (
                  <Suspense fallback={
                    <div className="flex items-center justify-center h-32">
                      <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary-500 border-t-transparent" />
                    </div>
                  }>
                    <CardAgentPanel cardId={card.id} />
                  </Suspense>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CardDetailModal;
