// === FILE PURPOSE ===
// Card detail modal — overlay for viewing and editing full card details.
// Contains title editing, priority selector, TipTap rich text description editor,
// labels, due date picker with status badge, comments, relationships, and activity log sections.

// === DEPENDENCIES ===
// react, lucide-react (X, Plus, FileText, Bot, PanelRightClose), @tiptap/react,
// @tiptap/starter-kit, @tiptap/extension-placeholder, shared types, boardStore,
// cardDetailStore, section components

import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { X, Plus, FileText, Sparkles, Check, RefreshCw, BookmarkPlus, Bot, PanelRightClose } from 'lucide-react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import type { Card, UpdateCardInput, CardPriority } from '../../shared/types';
import type { CardTemplate } from '../../shared/types/cards';
import { BUILTIN_TEMPLATES, type BuiltinTemplate } from '../constants/card-templates';
import { useBoardStore } from '../stores/boardStore';
import { useCardDetailStore } from '../stores/cardDetailStore';
import { getDueDateBadge, formatDate, formatRelativeTime } from '../utils/date-utils';
import { getNextRecurrenceDate } from '../../shared/utils/date-utils';
import AttachmentsSection from './AttachmentsSection';
import ChecklistSection from './ChecklistSection';
import CommentsSection from './CommentsSection';
import RelationshipsSection from './RelationshipsSection';
import ActivityLog from './ActivityLog';
import TaskBreakdownSection from './TaskBreakdownSection';
import { useGamificationStore } from '../stores/gamificationStore';
import { useCardAgentStore } from '../stores/cardAgentStore';
import { toast } from '../hooks/useToast';
import HudDatePicker from './HudDatePicker';
import HudSelect from './HudSelect';
import { PromptDialog } from './PromptDialog';

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


/** Format a Date as a friendly string like "Wed, Feb 25, 2026". */
function formatNextDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
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
  const [templatePromptOpen, setTemplatePromptOpen] = useState(false);
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
  const handleSaveAsTemplate = () => {
    setTemplatePromptOpen(true);
  };

  const handleTemplateSave = async (name: string) => {
    setTemplatePromptOpen(false);
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
    <>
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
                className="bg-white dark:bg-surface-950 border border-[var(--color-border)] rounded-lg px-3 py-2 text-3xl font-bold text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-dim)] focus:border-[var(--color-accent-dim)] w-full"
              />
            ) : (
              <h2
                className={`text-3xl font-bold cursor-text hover:text-[var(--color-text-secondary)] transition-colors ${card.completed ? 'text-[var(--color-text-muted)] line-through' : 'text-[var(--color-text-primary)]'}`}
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
                        <div className="absolute top-full right-0 mt-1 bg-white dark:bg-surface-900 border border-[var(--color-border)] rounded-lg shadow-lg py-1 min-w-[220px] z-40">
                          {dbTemplates.length > 0 && (
                            <>
                              <div className="px-3 py-1 text-xs text-surface-500 uppercase tracking-wide">Your Templates</div>
                              {dbTemplates.map(template => (
                                <button key={template.id} onClick={() => applyTemplate(template)} className="group/tpl flex items-center gap-2 w-full px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:bg-surface-100 dark:hover:bg-surface-800 hover:text-[var(--color-text-primary)] transition-colors text-left">
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
                            <button key={template.id} onClick={() => applyTemplate(template)} className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:bg-surface-100 dark:hover:bg-surface-800 hover:text-[var(--color-text-primary)] transition-colors text-left">
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
                      className="inline-flex items-center gap-1.5 text-xs font-medium bg-[var(--color-accent-subtle)] text-[var(--color-accent)] hover:bg-[var(--color-accent-muted)] border border-[var(--color-border-accent)] px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50"
                    >
                      <Sparkles size={14} className={generatingDescription ? 'animate-spin' : ''} />
                      {generatingDescription ? 'Generating...' : 'AI Generate'}
                    </button>
                  </div>
                </div>
                <div className="tiptap-editor bg-surface-50/50 dark:bg-surface-950/30 rounded-lg border border-[var(--color-border)] hover:border-[var(--color-border-accent)] transition-colors min-h-[140px] focus-within:border-[var(--color-accent-dim)] focus-within:ring-1 focus-within:ring-[var(--color-accent-dim)]/50 text-base">
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
                  className={`group/agent flex items-center gap-3 p-3 rounded-xl border transition-all text-left w-full ${showAgent
                    ? 'border-[var(--color-accent-dim)] bg-[var(--color-accent-subtle)] hover:border-[var(--color-accent)]'
                    : 'border-[var(--color-border)] hover:border-[var(--color-border-accent)]'
                    }`}
                >
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 border transition-colors ${showAgent ? 'bg-[var(--color-accent)] border-[var(--color-accent)]' : 'border-[var(--color-border)] bg-surface-100 dark:bg-surface-950 group-hover/agent:border-[var(--color-accent-dim)]'}`}>
                    <Bot size={14} className={`transition-colors ${showAgent ? 'text-surface-950' : 'text-[var(--color-accent-dim)] group-hover/agent:text-[var(--color-accent)]'}`} />
                  </div>
                  <div className="flex flex-col flex-1">
                    <span className={`text-sm font-semibold flex items-center gap-2 ${showAgent ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-primary)]'}`}>
                      AI Agent
                    </span>
                    <span className={`text-[11px] font-medium transition-colors ${showAgent ? 'text-[var(--color-accent-dim)]' : 'text-[var(--color-text-muted)] group-hover/agent:text-[var(--color-accent-dim)]'}`}>
                      {showAgent ? 'Panel open' : 'Get AI assistance'}
                    </span>
                  </div>
                  {agentMessageCount > 0 && (
                    <span className="text-[10px] font-data bg-[var(--color-accent-muted)] text-[var(--color-accent)] rounded-full min-w-[22px] h-[22px] flex items-center justify-center px-1.5">
                      {agentMessageCount}
                    </span>
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
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 border transition-colors ${card.completed ? 'bg-emerald-500 border-emerald-500' : 'border-[var(--color-border)] bg-surface-100 dark:bg-surface-950 group-hover/check:border-emerald-400'}`}>
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
                  {card.dueDate && !card.completed && (
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full self-start ${getDueDateBadge(card.dueDate).classes}`}>
                      {getDueDateBadge(card.dueDate).label}
                    </span>
                  )}
                  {card.dueDate && card.completed && (
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full self-start bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                      Done
                    </span>
                  )}
                  <HudDatePicker
                    value={card.dueDate}
                    onChange={(iso) => onUpdate(card.id, { dueDate: iso })}
                    placeholder="Set due date"
                  />
                </div>

                {/* Repeat */}
                <div className="flex flex-col gap-2.5">
                  <span className="font-hud text-[10px] text-[var(--color-accent-dim)] tracking-widest pl-1">Repeat</span>
                  <HudSelect
                    value={card.recurrenceType ?? ''}
                    onChange={(v) => onUpdate(card.id, { recurrenceType: v || null })}
                    icon={RefreshCw}
                    placeholder="None"
                    options={[
                      { value: '', label: 'None' },
                      { value: 'daily', label: 'Daily', description: 'Every day' },
                      { value: 'weekly', label: 'Weekly', description: 'Every 7 days' },
                      { value: 'biweekly', label: 'Bi-weekly', description: 'Every 14 days' },
                      { value: 'monthly', label: 'Monthly', description: 'Same day each month' },
                    ]}
                  />
                  {card.recurrenceType && (
                    <div className="flex flex-col gap-2 mt-1 bg-[var(--color-accent-subtle)]/30 rounded-lg p-2.5 border border-[var(--color-border)]">
                      {card.dueDate ? (
                        <p className="text-xs text-[var(--color-text-muted)]">Next: <span className="font-semibold text-[var(--color-text-primary)]">{formatNextDate(getNextRecurrenceDate(card.dueDate, card.recurrenceType))}</span></p>
                      ) : (
                        <p className="text-xs font-medium text-amber-500">Set due date to schedule</p>
                      )}
                      <div className="flex flex-col gap-1.5 mt-1 pt-2 border-t border-[var(--color-border)]">
                        <span className="text-[10px] font-hud tracking-wider text-[var(--color-text-muted)]">End Repeat</span>
                        <HudDatePicker
                          value={card.recurrenceEndDate ?? null}
                          onChange={(iso) => onUpdate(card.id, { recurrenceEndDate: iso })}
                          placeholder="No end date"
                          dateOnly
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Labels */}
                <div className="flex flex-col gap-2.5" ref={labelDropdownRef}>
                  <div className="flex items-center justify-between">
                    <span className="font-hud text-[10px] text-[var(--color-accent-dim)] tracking-widest pl-1">Labels</span>
                    <button
                      onClick={() => setShowLabelDropdown(!showLabelDropdown)}
                      className={`inline-flex items-center gap-1 text-[10px] font-hud tracking-wider transition-colors ${showLabelDropdown ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'}`}
                    >
                      <Plus size={12} /> {showLabelDropdown ? 'Close' : 'Add'}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {card.labels?.map(label => (
                      <span
                        key={label.id}
                        className="inline-flex items-center gap-1.5 border border-[var(--color-border)] rounded-md px-2 py-1 text-xs font-medium text-[var(--color-text-secondary)]"
                      >
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: label.color }} />
                        {label.name}
                        <button onClick={() => handleDetachLabel(label.id)} className="text-[var(--color-text-muted)] hover:text-red-500 transition-colors ml-0.5">
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                    {(!card.labels || card.labels.length === 0) && !showLabelDropdown && (
                      <span className="text-xs text-[var(--color-text-muted)]">No labels</span>
                    )}
                  </div>

                  {showLabelDropdown && (
                    <div className="flex flex-col gap-2.5 bg-surface-50 dark:bg-surface-950/50 rounded-lg p-3 border border-[var(--color-border)]">
                      {unattachedLabels.length > 0 && (
                        <>
                          <span className="text-[10px] font-hud tracking-wider text-[var(--color-text-muted)]">Existing</span>
                          <div className="flex flex-col gap-0.5 max-h-28 overflow-y-auto">
                            {unattachedLabels.map(label => (
                              <button
                                key={label.id}
                                onClick={() => handleAttachLabel(label.id)}
                                className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-subtle)] hover:text-[var(--color-text-primary)] transition-colors"
                              >
                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: label.color }} />
                                {label.name}
                                <Plus size={12} className="ml-auto text-[var(--color-text-muted)]" />
                              </button>
                            ))}
                          </div>
                          <div className="border-t border-[var(--color-border)]" />
                        </>
                      )}
                      <span className="text-[10px] font-hud tracking-wider text-[var(--color-text-muted)]">Create new</span>
                      <input
                        type="text"
                        value={newLabelName}
                        onChange={e => setNewLabelName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleCreateAndAttach(); }}
                        placeholder="Label name..."
                        className="w-full text-xs bg-surface-50 dark:bg-surface-950 border border-[var(--color-border)] rounded-lg px-2 py-1.5 text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-dim)]"
                      />
                      <div className="flex items-center gap-1.5 px-0.5">
                        {LABEL_COLORS.map(color => (
                          <button
                            key={color}
                            onClick={() => setNewLabelColor(color)}
                            className={`w-5 h-5 rounded-full transition-all ${newLabelColor === color ? 'ring-2 ring-[var(--color-accent-dim)] ring-offset-1 ring-offset-white dark:ring-offset-surface-900 scale-110' : 'hover:scale-110'}`}
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                      <button
                        onClick={handleCreateAndAttach}
                        disabled={!newLabelName.trim()}
                        className="bg-[var(--color-accent-muted)] hover:bg-[var(--color-accent-dim)] disabled:opacity-40 disabled:cursor-not-allowed text-[var(--color-accent)] border border-[var(--color-border-accent)] text-xs px-3 py-1.5 rounded-lg transition-colors w-full font-bold"
                      >
                        Create Label
                      </button>
                    </div>
                  )}
                </div>

                <div className="mt-auto pt-6 flex flex-col gap-2">
                  <div className="ruled-line-accent mb-2" />
                  <div className="flex justify-between font-data text-[11px] text-[var(--color-text-muted)]">
                    <span>Created</span>
                    <span className="text-[var(--color-text-secondary)]" title={formatDate(card.createdAt, true)}>{formatRelativeTime(card.createdAt)}</span>
                  </div>
                  <div className="flex justify-between font-data text-[11px] text-[var(--color-text-muted)]">
                    <span>Updated</span>
                    <span className="text-[var(--color-text-secondary)]" title={formatDate(card.updatedAt, true)}>{formatRelativeTime(card.updatedAt)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Agent panel (always rendered, width-animated) */}
            <div className={`shrink-0 overflow-hidden transition-all duration-300 ease-out border-l ${showAgent
              ? 'w-[360px] xl:w-[420px] border-[var(--color-border)]'
              : 'w-0 border-transparent'
              }`}>
              <div className="min-w-[360px] xl:min-w-[420px] h-full flex flex-col bg-[var(--color-chrome)]/60">
                <div className="flex items-center justify-between px-4 py-3 shrink-0">
                  <div className="flex items-center gap-2">
                    <div className="node-point-sm" />
                    <span className="font-hud text-xs tracking-widest uppercase text-[var(--color-accent-dim)]">Agent</span>
                    {agentMessageCount > 0 && (
                      <span className="text-[10px] font-data bg-[var(--color-accent-muted)] text-[var(--color-accent)] px-1.5 py-0.5 rounded-full">
                        {agentMessageCount}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setShowAgent(false)}
                    className="p-1.5 rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] transition-colors"
                  >
                    <PanelRightClose size={16} />
                  </button>
                </div>
                <div className="ruled-line-accent mx-4" />
                <div className="flex-1 min-h-0">
                    {agentEverOpened && (
                      <Suspense fallback={
                        <div className="flex items-center justify-center h-full">
                          <div className="animate-spin rounded-full h-8 w-8 border-2 border-[var(--color-accent)] border-t-transparent" />
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
    <PromptDialog
      open={templatePromptOpen}
      title="Save as Template"
      message="Enter a name for this template"
      defaultValue={card.title}
      confirmLabel="Save"
      onConfirm={handleTemplateSave}
      onCancel={() => setTemplatePromptOpen(false)}
    />
    </>
  );
}

export default CardDetailModal;
