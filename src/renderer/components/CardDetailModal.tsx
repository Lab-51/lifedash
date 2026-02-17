// === FILE PURPOSE ===
// Card detail modal — overlay for viewing and editing full card details.
// Contains title editing, priority selector, TipTap rich text description editor,
// labels, due date picker with status badge, comments, relationships, and activity log sections.

// === DEPENDENCIES ===
// react, lucide-react (X, Plus, FileText, Calendar), @tiptap/react, @tiptap/starter-kit,
// @tiptap/extension-placeholder, shared types, boardStore, cardDetailStore, section components

import { useState, useEffect, useRef } from 'react';
import { X, Plus, FileText, Calendar, Sparkles, Check } from 'lucide-react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import type { Card, UpdateCardInput, CardPriority } from '../../shared/types';
import { useBoardStore } from '../stores/boardStore';
import { useCardDetailStore } from '../stores/cardDetailStore';
import { getDueDateBadge } from '../utils/date-utils';
import AttachmentsSection from './AttachmentsSection';
import CommentsSection from './CommentsSection';
import RelationshipsSection from './RelationshipsSection';
import ActivityLog from './ActivityLog';
import TaskBreakdownSection from './TaskBreakdownSection';
import { useTaskStructuringStore } from '../stores/taskStructuringStore';
import { toast } from '../hooks/useToast';

interface CardDetailModalProps {
  card: Card;
  onUpdate: (id: string, data: UpdateCardInput) => Promise<void>;
  onClose: () => void;
}

const PRIORITY_OPTIONS: { value: CardPriority; label: string; activeClass: string; inactiveClass: string }[] = [
  { value: 'low', label: 'LOW', activeClass: 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40', inactiveClass: 'text-surface-400 hover:text-emerald-400' },
  { value: 'medium', label: 'MED', activeClass: 'bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/40', inactiveClass: 'text-surface-400 hover:text-blue-400' },
  { value: 'high', label: 'HIGH', activeClass: 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40', inactiveClass: 'text-surface-400 hover:text-amber-400' },
  { value: 'urgent', label: 'URG', activeClass: 'bg-red-500/20 text-red-400 ring-1 ring-red-500/40', inactiveClass: 'text-surface-400 hover:text-red-400' },
];

const LABEL_COLORS = [
  '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899',
];

interface CardTemplate {
  id: string;
  name: string;
  icon: string;
  priority: CardPriority;
  description: string;
}

const CARD_TEMPLATES: CardTemplate[] = [
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

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Load card details (comments, relationships, activities) on mount
  useEffect(() => {
    loadCardDetails(card.id);
    return () => {
      clearCardDetails();
      clearBreakdown();
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

  // Template handler
  const applyTemplate = (template: CardTemplate) => {
    if (editor) {
      editor.commands.setContent(template.description);
      onUpdate(card.id, { description: template.description });
    }
    if (template.priority !== card.priority) {
      onUpdate(card.id, { priority: template.priority });
    }
    setShowTemplateDropdown(false);
  };

  // AI description generation handler
  const handleGenerateDescription = async () => {
    setGeneratingDescription(true);
    try {
      const result = await window.electronAPI.generateCardDescription(card.id);
      if (result?.description && editor) {
        editor.commands.setContent(result.description);
        onUpdate(card.id, { description: result.description });
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

  // Click overlay (not modal) to close
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <div className="bg-surface-900 rounded-xl border border-surface-700 w-full max-w-3xl max-h-[80vh] overflow-y-auto mx-4 p-6">
        {/* Header: Title + Close button */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex-1 min-w-0">
            {isEditingTitle ? (
              <input
                type="text"
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                onKeyDown={handleTitleKeyDown}
                onBlur={saveTitleEdit}
                autoFocus
                className="bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-xl font-bold text-surface-100 focus:outline-none focus:border-primary-500 w-full"
              />
            ) : (
              <h2
                className={`text-xl font-bold cursor-pointer hover:text-surface-200 ${card.completed ? 'text-surface-500 line-through' : 'text-surface-100'}`}
                onClick={startEditingTitle}
              >
                {card.title}
              </h2>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-surface-500 hover:text-surface-300 p-1 transition-colors shrink-0"
          >
            <X size={20} />
          </button>
        </div>

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

        {/* Template selector + AI generate */}
        <div className="mb-5 flex items-center gap-4">
          <div className="relative" ref={templateDropdownRef}>
            <button
              onClick={() => setShowTemplateDropdown(!showTemplateDropdown)}
              className="inline-flex items-center gap-1.5 text-xs text-surface-400 hover:text-surface-200 transition-colors"
            >
              <FileText size={14} />
              Apply Template
            </button>

            {showTemplateDropdown && (
              <div className="absolute top-full left-0 mt-1 bg-surface-800 border border-surface-700 rounded-lg shadow-lg py-1 min-w-[200px] z-40">
                {CARD_TEMPLATES.map(template => (
                  <button
                    key={template.id}
                    onClick={() => applyTemplate(template)}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-surface-200 hover:bg-surface-700 transition-colors text-left"
                  >
                    <span>{template.icon}</span>
                    {template.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={handleGenerateDescription}
            disabled={generatingDescription}
            className="inline-flex items-center gap-1.5 text-xs text-surface-400 hover:text-surface-200 transition-colors disabled:opacity-50"
            title="Generate description from card title using AI"
          >
            <Sparkles size={14} className={generatingDescription ? 'animate-spin' : ''} />
            {generatingDescription ? 'Generating...' : 'Generate with AI'}
          </button>
        </div>

        {/* Description — TipTap editor */}
        <div className="mb-5">
          <span className="text-sm text-surface-400 block mb-2">Description</span>
          <div className="tiptap-editor bg-surface-800/50 rounded-lg border border-surface-700">
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
                className="inline-flex items-center gap-1.5 bg-surface-800 rounded-full px-2.5 py-1 text-xs text-surface-200"
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: label.color }}
                />
                {label.name}
                <button
                  onClick={() => handleDetachLabel(label.id)}
                  className="text-surface-500 hover:text-surface-300 transition-colors ml-0.5"
                >
                  <X size={12} />
                </button>
              </span>
            ))}

            {/* Add label button + dropdown */}
            <div className="relative" ref={labelDropdownRef}>
              <button
                onClick={() => setShowLabelDropdown(!showLabelDropdown)}
                className="inline-flex items-center gap-1 text-xs text-surface-400 hover:text-surface-200 bg-surface-800 rounded-full px-2.5 py-1 transition-colors"
              >
                <Plus size={12} />
                Add
              </button>

              {showLabelDropdown && (
                <div className="absolute top-full left-0 mt-1 bg-surface-800 border border-surface-700 rounded-lg shadow-lg p-2 min-w-[220px] z-40">
                  {/* Existing unattached labels */}
                  {unattachedLabels.length > 0 && (
                    <div className="mb-2">
                      {unattachedLabels.map(label => (
                        <button
                          key={label.id}
                          onClick={() => handleAttachLabel(label.id)}
                          className="flex items-center gap-2 w-full px-2 py-1.5 rounded text-xs text-surface-200 hover:bg-surface-700 transition-colors"
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
                    <div className="border-t border-surface-700 my-2" />
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
                      className="bg-surface-900 border border-surface-700 rounded px-2 py-1 text-xs text-surface-100 placeholder:text-surface-500 focus:outline-none focus:border-primary-500 w-full"
                    />
                    <div className="flex items-center gap-1.5">
                      {LABEL_COLORS.map(color => (
                        <button
                          key={color}
                          onClick={() => setNewLabelColor(color)}
                          className={`w-5 h-5 rounded-full transition-all ${newLabelColor === color ? 'ring-2 ring-white/50 scale-110' : 'hover:scale-110'
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
                  : 'border-surface-600 bg-surface-800 group-hover/check:border-surface-400'
              }`}
            >
              {card.completed && <Check size={12} className="text-white" />}
            </div>
            <span className={`text-sm ${card.completed ? 'text-emerald-400' : 'text-surface-300'}`}>
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
              className="bg-surface-800 border border-surface-700 rounded-lg px-3 py-1.5 text-sm text-surface-100 focus:outline-none focus:border-primary-500 [color-scheme:dark]"
            />
            {card.dueDate && (
              <>
                <span className={`text-xs px-2 py-0.5 rounded-full ${card.completed ? 'bg-emerald-500/20 text-emerald-400' : getDueDateBadge(card.dueDate).classes}`}>
                  {card.completed ? 'Done' : getDueDateBadge(card.dueDate).label}
                </span>
                <button
                  onClick={() => onUpdate(card.id, { dueDate: null })}
                  className="text-xs text-surface-500 hover:text-surface-300 transition-colors"
                >
                  Clear
                </button>
              </>
            )}
          </div>
        </div>

        {/* Card Details: Comments, Relationships, Activity */}
        {loadingCardDetails ? (
          <div className="text-sm text-surface-500 py-4 text-center">Loading details...</div>
        ) : (
          <>
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
    </div>
  );
}

export default CardDetailModal;
