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
      useCardAgentStore.getState().reset();
    };
  }, [card.id, loadCardDetails, clearCardDetails]);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-[2px]">
      <div className={`hud-panel-accent clip-corner-cut shadow-2xl w-full flex flex-col overflow-hidden transition-all duration-300 ease-out ${showAgent ? 'max-w-[95vw] xl:max-w-[1400px]' : 'max-w-5xl'
        } max-h-[90vh] mx-4`}>
        {/* Header: Breadcrumb + Title + Close button */}
        <div className="flex flex-col gap-2 px-8 pt-6 pb-4 shrink-0">
          <div className="flex items-center justify-between w-full text-[var(--color-text-secondary)]">
            <div className="flex items-center gap-2 font-hud text-xs tracking-widest">
              <div className="node-point-sm" />
              <span className="text-[var(--color-accent-dim)]">{project?.name || 'Project'}</span>
              <span className="text-[var(--color-text-muted)]">/</span>
              <span className="text-[var(--color-text-secondary)]">Card Details</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] p-1.5 rounded-lg hover:bg-[var(--color-accent-subtle)] transition-colors shrink-0"
              >
                <X size={18} />
              </button>
            </div>
          </div>
          <div className="ruled-line-accent mt-2" />

          <div className="w-full mt-2">
            {isEditingTitle ? (
              <input
                type="text"
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                onKeyDown={handleTitleKeyDown}
                onBlur={saveTitleEdit}
                autoFocus
                className="bg-white dark:bg-surface-900 border border-surface-300 dark:border-surface-600 rounded-lg px-3 py-2 text-3xl font-bold text-surface-900 dark:text-surface-50 focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 w-full shadow-sm"
              />
            ) : (
              <h2
                className={`text-3xl font-bold cursor-text hover:text-surface-700 dark:hover:text-surface-300 transition-colors ${card.completed ? 'text-surface-500 line-through' : 'text-surface-900 dark:text-surface-50'}`}
                onClick={startEditingTitle}
              >
                {card.title}
              </h2>
            )}
          </div>
        </div>

        {/* Content area: main, properties sidebar, agent panel */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          <div className="flex-1 overflow-y-auto min-w-0 flex flex-col md:flex-row">

            {/* Left: Main Content */}
            <div className="flex-1 px-8 py-8 overflow-y-auto min-w-0 flex flex-col gap-10">

              {/* Description Section */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent-dim)] flex items-center gap-2">
                    <FileText size={14} className="text-[var(--color-accent-dim)]" />
                    Description
                  </span>
                  <div className="flex items-center gap-3">
                    {/* Template selector */}
                    <div className="relative" ref={templateDropdownRef}>
                      <button
                        onClick={() => setShowTemplateDropdown(!showTemplateDropdown)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors border border-[var(--color-border)] hover:border-[var(--color-border-accent)] px-2.5 py-1.5 rounded-md"
                      >
                        Templates
                      </button>
                      {showTemplateDropdown && (
                        <div className="absolute top-full right-0 mt-1 bg-surface-900 border border-[var(--color-border)] rounded-lg shadow-lg py-1 min-w-[220px] z-40">
                          {dbTemplates.length > 0 && (
                            <>
                              <div className="px-3 py-1 text-xs text-surface-500 uppercase tracking-wide">Your Templates</div>
                              {dbTemplates.map(template => (
                                <button key={template.id} onClick={() => applyTemplate(template)} className="group/tpl flex items-center gap-2 w-full px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:bg-surface-800 hover:text-[var(--color-text-primary)] transition-colors text-left">
                                  <span className="truncate flex-1">{template.name}</span>
                                  <span onClick={(e) => handleDeleteDbTemplate(template.id, e)} className="opacity-0 group-hover/tpl:opacity-100 text-surface-500 hover:text-red-400 transition-all shrink-0 p-0.5" title="Delete template">
                                    <X size={12} />
                                  </span>
                                </button>
                              ))}
                              <div className="border-t border-[var(--color-border)] my-1" />
                            </>
                          )}
                          <div className="px-3 py-1 text-xs text-surface-500 uppercase tracking-wide">Built-in</div>
                          {BUILTIN_TEMPLATES.map(template => (
                            <button key={template.id} onClick={() => applyTemplate(template)} className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:bg-surface-800 hover:text-[var(--color-text-primary)] transition-colors text-left">
                              <span>{template.icon}</span> {template.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <button
                      onClick={handleSaveAsTemplate}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors border border-[var(--color-border)] hover:border-[var(--color-border-accent)] px-2.5 py-1.5 rounded-md"
                    >
                      <BookmarkPlus size={14} /> Save Template
                    </button>

                    <button
                      onClick={handleGenerateDescription}
                      disabled={generatingDescription}
                      className="inline-flex items-center gap-1.5 text-xs font-medium bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900/40 px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50"
                    >
                      <Sparkles size={14} className={generatingDescription ? 'animate-spin' : ''} />
                      {generatingDescription ? 'Generating...' : 'AI Generate'}
                    </button>
                  </div>
                </div>
                <div className="tiptap-editor bg-[var(--color-accent-subtle)]/30 rounded-lg border border-[var(--color-border)] hover:border-[var(--color-border-accent)] transition-colors min-h-[140px] focus-within:border-[var(--color-accent-dim)] focus-within:ring-1 focus-within:ring-[var(--color-accent-dim)]/50 text-base">
                  <EditorContent editor={editor} />
                </div>
              </div>

              {/* Extra Sections */}
              {loadingCardDetails ? (
                <div className="text-sm text-surface-500 py-12 text-center animate-pulse">Loading details...</div>
              ) : (
                <div className="flex flex-col gap-10">
                  <TaskBreakdownSection cardId={card.id} columnId={card.columnId} />
                  <ChecklistSection cardId={card.id} />
                  <AttachmentsSection cardId={card.id} />
                  <RelationshipsSection cardId={card.id} />
                  <CommentsSection cardId={card.id} />
                  <ActivityLog cardId={card.id} />
                </div>
              )}
            </div>

            {/* Right: Properties Sidebar */}
            <div className="w-full md:w-[320px] bg-[var(--color-chrome)]/30 border-l border-[var(--color-border)] p-6 overflow-y-auto flex flex-col gap-8 shrink-0">

              <div className="flex flex-col gap-6">
                {/* AI Agent Button */}
                <button
                  onClick={() => setShowAgent(!showAgent)}
                  className={`group/agent flex items-center justify-between p-3 rounded-xl border transition-all text-left w-full shadow-sm relative overflow-hidden ${showAgent
                    ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 shadow-emerald-500/10'
                    : 'border-primary-200 dark:border-primary-800 bg-gradient-to-r from-primary-50 to-white dark:from-primary-900/20 dark:to-surface-800 hover:border-primary-400 dark:hover:border-primary-600 hover:shadow-primary-500/10'
                    }`}
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 dark:via-white/5 to-transparent -translate-x-full group-hover/agent:animate-[shimmer_1.5s_infinite]" />
                  <div className="relative flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border shadow-sm transition-colors ${showAgent ? 'bg-emerald-500 border-emerald-500' : 'border-[var(--color-border)] group-hover/agent:border-primary-500'}`}>
                      <Bot size={16} className={`transition-colors ${showAgent ? 'text-white' : 'text-primary-600 dark:text-primary-400 group-hover/agent:text-primary-500'}`} />
                    </div>
                    <div className="flex flex-col">
                      <span className={`text-sm font-bold ${showAgent ? 'text-emerald-800 dark:text-emerald-300' : 'text-primary-900 dark:text-primary-100'}`}>
                        AI Agent
                      </span>
                      <span className={`text-[11px] font-semibold transition-colors ${showAgent ? 'text-emerald-600 dark:text-emerald-400' : 'text-primary-600/70 dark:text-primary-400/70 group-hover/agent:text-primary-600 dark:group-hover/agent:text-primary-400'}`}>
                        {showAgent ? 'Panel open' : 'Get AI assistance'}
                      </span>
                    </div>
                  </div>
                  {agentMessageCount > 0 && (
                    <div className="relative">
                      <span className={`text-xs font-bold rounded-full min-w-[24px] h-[24px] flex items-center justify-center px-1.5 shadow-sm border ${showAgent
                        ? 'bg-emerald-100 dark:bg-emerald-800/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700'
                        : 'bg-primary-100 dark:bg-primary-800/50 text-primary-700 dark:text-primary-300 border-primary-200 dark:border-primary-700'
                        }`}>
                        {agentMessageCount}
                      </span>
                    </div>
                  )}
                </button>

                <div className="ruled-line-accent my-1" />

                {/* Status Action Button */}
                <div className="flex flex-col gap-2.5">
                  <span className="font-hud text-[10px] text-[var(--color-accent-dim)] tracking-widest pl-1">Status</span>
                  <button
                    onClick={() => onUpdate(card.id, { completed: !card.completed })}
                    className={`group/check flex items-center gap-3 p-3 rounded-xl border transition-all text-left w-full ${card.completed
                      ? 'border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/50 dark:bg-emerald-900/10 hover:border-emerald-300 dark:hover:border-emerald-700'
                      : 'border-[var(--color-border)] hover:border-[var(--color-border-accent)]'
                      }`}
                  >
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 border transition-colors ${card.completed ? 'bg-emerald-500 border-emerald-500' : 'border-[var(--color-border)] bg-surface-950 group-hover/check:border-emerald-400'}`}>
                      <Check size={14} className={`transition-opacity ${card.completed ? 'text-white opacity-100' : 'text-emerald-500 opacity-0 group-hover/check:opacity-100'}`} />
                    </div>
                    <div className="flex flex-col">
                      <span className={`text-sm font-semibold ${card.completed ? 'text-emerald-700 dark:text-emerald-400' : 'text-surface-900 dark:text-surface-100'}`}>
                        {card.completed ? 'Completed' : 'Active Task'}
                      </span>
                      {!card.completed && <span className="text-[11px] font-medium text-surface-500 group-hover/check:text-emerald-600 dark:group-hover/check:text-emerald-400 transition-colors">Click to mark complete</span>}
                    </div>
                  </button>
                </div>

                {/* Priority */}
                <div className="flex flex-col gap-2.5">
                  <span className="font-hud text-[10px] text-[var(--color-accent-dim)] tracking-widest pl-1">Priority</span>
                  <div className="grid grid-cols-4 gap-1.5">
                    {PRIORITY_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => handlePriorityChange(opt.value)}
                        className={`text-[11px] font-bold px-2 py-1.5 rounded-md transition-colors ${card.priority === opt.value ? opt.activeClass : 'border border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-border-accent)] hover:text-[var(--color-text-primary)]'}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Due Date */}
                <div className="flex flex-col gap-2.5">
                  <span className="font-hud text-[10px] text-[var(--color-accent-dim)] tracking-widest pl-1">Due Date</span>
                  <div className="flex flex-col gap-2">
                    <div className="relative">
                      <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                      <input
                        type="datetime-local"
                        value={card.dueDate ? toDateTimeLocalValue(card.dueDate) : ''}
                        onChange={(e) => onUpdate(card.id, { dueDate: e.target.value ? new Date(e.target.value).toISOString() : null })}
                        className="w-full pl-9 pr-3 py-1.5 text-sm bg-surface-950 border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-dim)] dark:[color-scheme:dark] transition-colors"
                      />
                    </div>
                    {card.dueDate && (
                      <div className="flex items-center justify-between px-1">
                        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${card.completed ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : getDueDateBadge(card.dueDate).classes}`}>
                          {card.completed ? 'Done' : getDueDateBadge(card.dueDate).label}
                        </span>
                        <button onClick={() => onUpdate(card.id, { dueDate: null })} className="text-xs font-medium text-surface-400 hover:text-red-500 transition-colors">
                          Clear
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Repeat */}
                <div className="flex flex-col gap-2.5">
                  <span className="font-hud text-[10px] text-[var(--color-accent-dim)] tracking-widest pl-1">Repeat</span>
                  <div className="relative">
                    <RefreshCw size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                    <select
                      value={card.recurrenceType ?? ''}
                      onChange={(e) => onUpdate(card.id, { recurrenceType: e.target.value || null })}
                      className="w-full pl-9"
                    >
                      <option value="">None</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="biweekly">Bi-weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>
                  {card.recurrenceType && (
                    <div className="flex flex-col gap-2 px-1 mt-1 bg-surface-100/50 dark:bg-surface-800/50 rounded-lg p-2 border border-surface-200 dark:border-surface-700">
                      {card.dueDate ? (
                        <p className="text-xs text-surface-500">Next: <span className="font-semibold text-surface-700 dark:text-surface-300">{formatNextDate(getNextRecurrenceDate(card.dueDate, card.recurrenceType))}</span></p>
                      ) : (
                        <p className="text-xs font-medium text-amber-500">Set due date to schedule</p>
                      )}
                      <div className="flex items-center justify-between gap-2 mt-1 pt-2 border-t border-surface-200 dark:border-surface-700">
                        <span className="text-xs font-medium text-surface-500 shrink-0">End Repeat:</span>
                        <input
                          type="date"
                          value={card.recurrenceEndDate ? card.recurrenceEndDate.split('T')[0] : ''}
                          onChange={(e) => onUpdate(card.id, { recurrenceEndDate: e.target.value ? new Date(e.target.value).toISOString() : null })}
                          className="bg-transparent border-none text-xs font-semibold text-surface-800 dark:text-surface-200 focus:outline-none dark:[color-scheme:dark] flex-1 text-right"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Labels */}
                <div className="flex flex-col gap-2.5">
                  <span className="font-hud text-[10px] text-[var(--color-accent-dim)] tracking-widest pl-1">Labels</span>
                  <div className="flex flex-wrap gap-1.5">
                    {card.labels?.map(label => (
                      <span
                        key={label.id}
                        className="inline-flex items-center gap-1.5 border border-[var(--color-border)] rounded-md px-2 py-1 text-xs font-medium text-[var(--color-text-secondary)]"
                      >
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: label.color }} />
                        {label.name}
                        <button onClick={() => handleDetachLabel(label.id)} className="text-surface-400 hover:text-red-500 transition-colors ml-0.5">
                          <X size={12} />
                        </button>
                      </span>
                    ))}

                    <div className="relative" ref={labelDropdownRef}>
                      <button
                        onClick={() => setShowLabelDropdown(!showLabelDropdown)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] border border-dashed border-[var(--color-border)] hover:border-[var(--color-border-accent)] rounded-md px-2 py-1 transition-colors"
                      >
                        <Plus size={12} /> Add
                      </button>

                      {showLabelDropdown && (
                        <div className="absolute top-full left-0 mt-1 bg-surface-900 border border-[var(--color-border)] rounded-xl shadow-xl p-2 min-w-[220px] z-40">
                          {unattachedLabels.length > 0 && (
                            <div className="max-h-32 overflow-y-auto mb-2 pr-1 scrollbar-thin">
                              {unattachedLabels.map(label => (
                                <button
                                  key={label.id}
                                  onClick={() => handleAttachLabel(label.id)}
                                  className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-xs font-medium text-[var(--color-text-secondary)] hover:bg-surface-800 hover:text-[var(--color-text-primary)] transition-colors"
                                >
                                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: label.color }} />
                                  {label.name}
                                  <Plus size={12} className="ml-auto text-surface-400 opacity-0 group-hover:opacity-100" />
                                </button>
                              ))}
                            </div>
                          )}
                          {unattachedLabels.length > 0 && <div className="border-t border-[var(--color-border)] my-2" />}
                          <div className="space-y-2">
                            <span className="text-[10px] uppercase tracking-wider text-surface-500 font-bold ml-1">Create new</span>
                            <input
                              type="text"
                              value={newLabelName}
                              onChange={e => setNewLabelName(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') handleCreateAndAttach(); }}
                              placeholder="Label name..."
                              className="w-full text-xs bg-surface-950 border border-[var(--color-border)] rounded-lg px-2 py-1.5 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)]"
                            />
                            <div className="flex items-center gap-1.5 pt-1 px-1">
                              {LABEL_COLORS.map(color => (
                                <button
                                  key={color}
                                  onClick={() => setNewLabelColor(color)}
                                  className={`w-5 h-5 rounded-full transition-all ${newLabelColor === color ? 'ring-2 ring-primary-500 ring-offset-1 ring-offset-surface-900 scale-110' : 'hover:scale-110'}`}
                                  style={{ backgroundColor: color }}
                                />
                              ))}
                            </div>
                            <button
                              onClick={handleCreateAndAttach}
                              disabled={!newLabelName.trim()}
                              className="bg-primary-600 hover:bg-primary-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs px-3 py-1.5 rounded-lg transition-colors w-full mt-2 font-bold"
                            >
                              Create Label
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-auto pt-6 flex flex-col gap-2">
                  <div className="ruled-line-accent mb-2" />
                  <div className="flex justify-between font-data text-[11px] text-[var(--color-text-muted)]">
                    <span>Created</span>
                    <span className="text-[var(--color-text-secondary)]" title={formatDate(card.createdAt)}>{formatRelativeTime(card.createdAt)}</span>
                  </div>
                  <div className="flex justify-between font-data text-[11px] text-[var(--color-text-muted)]">
                    <span>Updated</span>
                    <span className="text-[var(--color-text-secondary)]" title={formatDate(card.updatedAt)}>{formatRelativeTime(card.updatedAt)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Agent panel (always rendered, width-animated) */}
            <div className={`shrink-0 overflow-hidden transition-all duration-300 ease-out border-l ${showAgent
              ? 'w-[360px] xl:w-[420px] border-surface-200 dark:border-surface-700'
              : 'w-0 border-transparent'
              }`}>
              <div className="min-w-[360px] xl:min-w-[420px] h-full flex flex-col bg-white dark:bg-surface-800/50">
                <div className="flex items-center justify-between px-4 py-3 border-b border-surface-100 dark:border-surface-700 shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-surface-900 dark:text-surface-100">AI Agent</span>
                    {agentMessageCount > 0 && (
                      <span className="text-xs bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded-full font-bold">
                        {agentMessageCount}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setShowAgent(false)}
                    className="p-1.5 rounded-lg text-surface-400 hover:text-surface-700 dark:hover:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
                  >
                    <PanelRightClose size={16} />
                  </button>
                </div>
                <div className="flex-1 min-h-0 bg-surface-50/50 dark:bg-transparent">
                  {agentEverOpened && (
                    <Suspense fallback={
                      <div className="flex items-center justify-center h-full">
                        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary-500 border-t-transparent" />
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
    </div>
  );
}

export default CardDetailModal;
