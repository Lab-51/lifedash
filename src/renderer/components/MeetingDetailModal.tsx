// === FILE PURPOSE ===
// Meeting detail modal — overlay for viewing meeting info and transcript.
// Shows meeting metadata at top, scrollable transcript timeline below.
// During active recordings, new segments append and auto-scroll.
//
// === DEPENDENCIES ===
// react, lucide-react, meetingStore

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Clock, Trash2, Info, Search, Copy, Check, ArrowRight, Download, ChevronDown, ChevronRight, ClipboardList, FolderOpen } from 'lucide-react';
import HudSelect from './HudSelect';
import { useMeetingStore } from '../stores/meetingStore';
import { useProjectStore } from '../stores/projectStore';
import { toast } from '../hooks/useToast';
import BriefSection from './BriefSection';
import ActionItemList from './ActionItemList';
import ConvertActionModal from './ConvertActionModal';
import MeetingAnalyticsSection from './MeetingAnalyticsSection';
import { getSpeakerColor } from './MeetingAnalyticsSection';
import type { ActionItem, MeetingWithTranscript } from '../../shared/types';
import { MEETING_TEMPLATES, TRANSCRIPTION_LANGUAGES } from '../../shared/types';
import { useLicenseStore } from '../stores/licenseStore';
import { ProBadge } from './ProBadge';

interface MeetingDetailModalProps {
  onClose: () => void;
  /** When true, auto-generate brief + action items on open (post-recording) */
  autoGenerate?: boolean;
  initialTranscriptSearch?: string;
}

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  recording: { label: 'Recording', className: 'bg-red-500/15 text-red-400' },
  processing: { label: 'Processing', className: 'bg-amber-500/15 text-amber-400' },
  completed: { label: 'Completed', className: 'bg-emerald-500/15 text-emerald-400' },
};

function formatTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60).toString().padStart(2, '0');
  const sec = (totalSec % 60).toString().padStart(2, '0');
  return `${min}:${sec}`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  });
}

function formatDuration(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return 'In progress';
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}s`;
  return `${min}m ${sec}s`;
}

function formatTimestampHMS(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const hrs = Math.floor(totalSec / 3600).toString().padStart(2, '0');
  const min = Math.floor((totalSec % 3600) / 60).toString().padStart(2, '0');
  const sec = (totalSec % 60).toString().padStart(2, '0');
  return `${hrs}:${min}:${sec}`;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

/** Simple markdown renderer for prep briefing text: ## headings, - bullets, plain text. */
function renderPrepLine(line: string, idx: number): React.ReactNode {
  const trimmed = line.trim();
  if (!trimmed) return <div key={idx} className="h-1" />;

  if (trimmed.startsWith('## ')) {
    return (
      <p key={idx} className="text-xs font-semibold text-surface-800 dark:text-surface-200 mt-2 mb-0.5">
        {trimmed.slice(3)}
      </p>
    );
  }

  if (trimmed.startsWith('# ')) {
    return (
      <p key={idx} className="text-xs font-bold text-surface-100 mt-2 mb-0.5">
        {trimmed.slice(2)}
      </p>
    );
  }

  if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
    return (
      <p key={idx} className="text-xs text-surface-700 dark:text-surface-300 pl-3">
        <span className="text-surface-500 mr-1">{'\u2022'}</span>
        {trimmed.slice(2)}
      </p>
    );
  }

  return (
    <p key={idx} className="text-xs text-surface-700 dark:text-surface-300">{trimmed}</p>
  );
}

function formatMeetingAsMarkdown(
  meeting: MeetingWithTranscript,
  projectName: string | undefined,
): string {
  const lines: string[] = [];

  lines.push(`# ${meeting.title}`);
  lines.push('');

  const dateTime = new Date(meeting.startedAt);
  lines.push(`**Date:** ${dateTime.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} at ${dateTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`);

  if (meeting.endedAt) {
    const ms = new Date(meeting.endedAt).getTime() - dateTime.getTime();
    const minutes = Math.round(ms / 60000);
    lines.push(`**Duration:** ${minutes} minute${minutes !== 1 ? 's' : ''}`);
  }

  if (meeting.template && meeting.template !== 'none') {
    const tmpl = MEETING_TEMPLATES.find(t => t.type === meeting.template);
    if (tmpl) lines.push(`**Template:** ${tmpl.name}`);
  }

  if (projectName) {
    lines.push(`**Project:** ${projectName}`);
  }

  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(meeting.brief?.summary ?? 'No summary generated.');

  lines.push('');
  lines.push('## Action Items');
  lines.push('');
  if (meeting.actionItems.length === 0) {
    lines.push('No action items.');
  } else {
    for (const item of meeting.actionItems) {
      const checkbox = item.status === 'converted' ? '[x]'
        : item.status === 'dismissed' ? '[~]'
          : '[ ]';
      lines.push(`- ${checkbox} ${item.description}`);
    }
  }

  lines.push('');
  lines.push('## Transcript');
  lines.push('');
  if (meeting.segments.length === 0) {
    lines.push('No transcript available.');
  } else {
    for (const seg of meeting.segments) {
      const ts = `[${formatTimestampHMS(seg.startTime)}]`;
      const speaker = seg.speaker ? ` [${seg.speaker}]` : '';
      lines.push(`${ts}${speaker} ${seg.content}`);
    }
  }

  return lines.join('\n');
}

export default function MeetingDetailModal({ onClose, autoGenerate = false, initialTranscriptSearch }: MeetingDetailModalProps) {
  const navigate = useNavigate();
  const selectedMeeting = useMeetingStore(s => s.selectedMeeting);
  const updateMeeting = useMeetingStore(s => s.updateMeeting);
  const deleteMeeting = useMeetingStore(s => s.deleteMeeting);
  const clearSelectedMeeting = useMeetingStore(s => s.clearSelectedMeeting);
  const generateBrief = useMeetingStore(s => s.generateBrief);
  const generateActionItems = useMeetingStore(s => s.generateActionItems);
  const generatingBrief = useMeetingStore(s => s.generatingBrief);
  const generatingActions = useMeetingStore(s => s.generatingActions);
  const error = useMeetingStore(s => s.error);
  const updateActionItemStatus = useMeetingStore(s => s.updateActionItemStatus);
  const convertActionToCard = useMeetingStore(s => s.convertActionToCard);
  const loadAnalytics = useMeetingStore(s => s.loadAnalytics);
  const clearAnalytics = useMeetingStore(s => s.clearAnalytics);
  const projects = useProjectStore(s => s.projects);
  const loadProjects = useProjectStore(s => s.loadProjects);
  const isProEnabled = useLicenseStore(s => {
    const info = s.info;
    return info !== null && (info.status === 'active' || info.status === 'trial') && info.tier === 'pro';
  });
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [convertingAction, setConvertingAction] = useState<ActionItem | null>(null);
  const [batchConvertItems, setBatchConvertItems] = useState<Array<{ id: string; text: string }> | null>(null);
  const [quickPushing, setQuickPushing] = useState(false);
  const [transcriptSearch, setTranscriptSearch] = useState(initialTranscriptSearch ?? '');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showPrep, setShowPrep] = useState(false);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const prevSegmentCount = useRef(0);
  const autoGenerateBriefTriggered = useRef(false);
  const autoGenerateActionsTriggered = useRef(false);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Load projects for linking dropdown
  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // Load analytics for completed meetings
  useEffect(() => {
    if (selectedMeeting?.id && selectedMeeting.status === 'completed') {
      loadAnalytics(selectedMeeting.id);
    }
  }, [selectedMeeting?.id, selectedMeeting?.status, loadAnalytics]);

  // Auto-scroll to bottom when new segments arrive during recording
  useEffect(() => {
    if (!selectedMeeting) return;
    const count = selectedMeeting.segments.length;
    if (count > prevSegmentCount.current && selectedMeeting.status === 'recording') {
      transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevSegmentCount.current = count;
  }, [selectedMeeting?.segments.length, selectedMeeting?.status]);

  // Auto-generate brief when modal opens post-recording
  useEffect(() => {
    if (!autoGenerate) return;
    if (autoGenerateBriefTriggered.current) return;
    if (!selectedMeeting) return;
    if (selectedMeeting.status !== 'completed') return;
    if (selectedMeeting.segments.length === 0) return;
    if (selectedMeeting.brief) return;
    if (generatingBrief || generatingActions) return;

    autoGenerateBriefTriggered.current = true;
    generateBrief(selectedMeeting.id);
  }, [autoGenerate, selectedMeeting, generatingBrief, generatingActions, generateBrief]);

  // Auto-generate action items after brief completes
  useEffect(() => {
    if (!autoGenerate) return;
    if (autoGenerateActionsTriggered.current) return;
    if (!selectedMeeting) return;
    if (!selectedMeeting.brief) return;
    if (selectedMeeting.actionItems.length > 0) return;
    if (generatingActions) return;

    autoGenerateActionsTriggered.current = true;
    generateActionItems(selectedMeeting.id);
  }, [autoGenerate, selectedMeeting, generatingActions, generateActionItems]);

  if (!selectedMeeting) return null;

  const meeting = selectedMeeting;
  const status = STATUS_STYLES[meeting.status] || STATUS_STYLES.completed;

  // Resolve linked project name for batch push
  const linkedProject = meeting.projectId
    ? projects.find((p) => p.id === meeting.projectId)
    : null;
  const linkedProjectName = linkedProject?.name ?? undefined;

  const handleExport = () => {
    const markdown = formatMeetingAsMarkdown(meeting, linkedProjectName);
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const slug = slugify(meeting.title);
    const dateStr = new Date(meeting.startedAt).toISOString().slice(0, 10);
    a.download = `meeting-${slug}-${dateStr}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Meeting exported as Markdown', 'success');
  };

  // Title editing
  const startEditingTitle = () => {
    setEditTitle(meeting.title);
    setIsEditingTitle(true);
  };

  const saveTitleEdit = async () => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== meeting.title) {
      await updateMeeting(meeting.id, { title: trimmed });
    }
    setIsEditingTitle(false);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') saveTitleEdit();
    else if (e.key === 'Escape') {
      setEditTitle(meeting.title);
      setIsEditingTitle(false);
    }
  };

  // Delete
  const handleDelete = async () => {
    await deleteMeeting(meeting.id);
    onClose();
  };

  // Close handler that also clears selected meeting
  const handleClose = () => {
    clearAnalytics();
    clearSelectedMeeting();
    onClose();
  };

  // Overlay click
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) handleClose();
  };

  // --- Transcript search & copy helpers ---

  const searchQuery = transcriptSearch.trim().toLowerCase();
  const filteredSegments = searchQuery
    ? meeting.segments.filter(s => s.content.toLowerCase().includes(searchQuery))
    : meeting.segments;

  function highlightText(text: string, query: string): React.ReactNode {
    if (!query) return text;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, i) =>
      regex.test(part)
        ? <mark key={i} className="bg-yellow-500/30 text-yellow-200 rounded-sm px-0.5">{part}</mark>
        : part
    );
  }

  const handleCopy = (field: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  };

  const copyTranscript = () => {
    const text = meeting.segments.map(s => {
      const ts = `[${formatTimestamp(s.startTime)}]`;
      const speaker = s.speaker ? ` [${s.speaker}]` : '';
      return `${ts}${speaker} ${s.content}`;
    }).join('\n');
    handleCopy('transcript', text);
  };

  const copySummary = () => {
    if (meeting.brief) handleCopy('summary', meeting.brief.summary);
  };

  const copyActionItems = () => {
    const text = meeting.actionItems.map(item => {
      const checkbox = item.status === 'approved' ? '[x]' : '[ ]';
      return `- ${checkbox} ${item.description}`;
    }).join('\n');
    handleCopy('actions', text);
  };

  // Quick-push: convert all approved action items to cards in the linked project's first column
  const handleQuickPush = async (): Promise<{ pushedCount: number; columnName: string }> => {
    if (!meeting.projectId) throw new Error('No linked project');

    setQuickPushing(true);
    try {
      // 1. Get boards for the linked project
      const boards = await window.electronAPI.getBoards(meeting.projectId);
      if (boards.length === 0) throw new Error('No board found for this project');

      // 2. Get columns for the first board
      const board = boards[0];
      const columns = await window.electronAPI.getColumns(board.id);
      if (columns.length === 0) throw new Error('No columns found on this board');

      // 3. Pick the leftmost column (lowest position)
      const sortedColumns = [...columns].sort((a, b) => a.position - b.position);
      const targetColumn = sortedColumns[0];

      // 4. Get all approved action items
      const approvedItems = meeting.actionItems.filter((a) => a.status === 'approved');
      if (approvedItems.length === 0) throw new Error('No approved items to push');

      // 5. Convert each approved item to a card in the target column
      for (const item of approvedItems) {
        await convertActionToCard(item.id, targetColumn.id);
      }

      return { pushedCount: approvedItems.length, columnName: targetColumn.name };
    } finally {
      setQuickPushing(false);
    }
  };

  const CopyBtn = ({ field, label, onClick, disabled }: {
    field: string; label: string; onClick: () => void; disabled?: boolean;
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1 text-xs text-surface-400 hover:text-surface-800 dark:text-surface-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      title={label}
    >
      {copiedField === field ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
      <span className="hidden sm:inline">{copiedField === field ? 'Copied!' : label}</span>
    </button>
  );

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-surface-900/40 dark:bg-black/80 backdrop-blur-[2px]"
        onClick={handleOverlayClick}
      >
        <div className="hud-panel-accent clip-corner-cut shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto mx-4 p-8">
          {/* Header: Title + Close */}
          <div className="flex items-start justify-between gap-3 mb-6">
            <div className="flex-1 min-w-0">
              {isEditingTitle ? (
                <input
                  type="text"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  onKeyDown={handleTitleKeyDown}
                  onBlur={saveTitleEdit}
                  autoFocus
                  className="bg-surface-950 border border-[var(--color-border)] rounded-lg px-3 py-2 text-2xl font-bold text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-dim)] focus:border-[var(--color-accent-dim)] w-full"
                />
              ) : (
                <h2
                  className="font-hud text-xl text-[var(--color-accent)] text-glow cursor-text hover:opacity-80 transition-opacity"
                  onClick={startEditingTitle}
                >
                  {meeting.title}
                </h2>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0 bg-surface-100/50 dark:bg-surface-800/50 p-1 rounded-lg">
              <button
                onClick={handleExport}
                className="text-surface-500 hover:text-surface-800 dark:hover:text-surface-200 p-1.5 rounded-md hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors"
                title="Export as Markdown"
              >
                <Download size={16} />
              </button>
              <div className="w-px h-4 bg-surface-200 dark:bg-surface-700 mx-0.5" />
              <button
                onClick={handleClose}
                className="text-surface-500 hover:text-surface-800 dark:hover:text-surface-200 p-1.5 rounded-md hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Metadata row */}
          <div className="flex flex-wrap items-center gap-3 mb-8 text-sm bg-surface-950/50 p-3 rounded-xl border border-[var(--color-border)]">
            <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium ${status.className}`}>
              {status.label}
            </span>
            <div className="w-1 h-1 rounded-full bg-surface-300 dark:bg-surface-700" />
            <span className="flex items-center gap-1.5 font-data text-[var(--color-text-secondary)]">
              <Clock size={14} className="text-[var(--color-accent-dim)]" />
              {formatDuration(meeting.startedAt, meeting.endedAt)}
            </span>
            <span className="node-point-sm" />
            <span className="font-data text-[var(--color-text-secondary)]">
              {formatDate(meeting.startedAt)} at {formatTime(meeting.startedAt)}
            </span>
            {meeting.transcriptionLanguage && (
              <span className="text-surface-400">
                {TRANSCRIPTION_LANGUAGES.find(l => l.code === meeting.transcriptionLanguage)?.label ?? meeting.transcriptionLanguage}
              </span>
            )}
          </div>

          {/* Template info */}
          {meeting.template && meeting.template !== 'none' && (() => {
            const tmpl = MEETING_TEMPLATES.find(t => t.type === meeting.template);
            return tmpl ? (
              <div className="flex items-start gap-2 text-sm text-surface-700 dark:text-surface-300 mb-5">
                <span className="px-1.5 py-0.5 rounded bg-surface-700 text-xs font-medium">{tmpl.name}</span>
                {tmpl.agenda.length > 0 && (
                  <div className="text-xs text-surface-400">
                    {tmpl.agenda.map((item, i) => (
                      <div key={i}>{'\u2022'} {item}</div>
                    ))}
                  </div>
                )}
              </div>
            ) : null;
          })()}

          {/* Project linking */}
          <div className="flex items-center gap-3 mb-8">
            <span className="font-hud text-[10px] text-[var(--color-accent-dim)] tracking-widest shrink-0">Linked Project</span>
            <div className="flex-1 min-w-[180px] max-w-[240px]">
              <HudSelect
                value={meeting.projectId || ''}
                onChange={(v) => updateMeeting(meeting.id, { projectId: v || null })}
                icon={FolderOpen}
                placeholder="No project"
                options={[
                  { value: '', label: 'No project' },
                  ...projects.map(p => ({ value: p.id, label: p.name })),
                ]}
              />
            </div>
            {meeting.projectId && (
              <button
                onClick={() => {
                  navigate(`/projects/${meeting.projectId}`);
                  handleClose();
                }}
                className="flex items-center gap-1.5 text-[10px] font-hud tracking-wider border border-[var(--color-border)] hover:border-[var(--color-accent-dim)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] px-2.5 py-1.5 rounded-md transition-colors shrink-0"
                title="Go to project board"
              >
                Open Board
                <ArrowRight size={12} />
              </button>
            )}
          </div>

          {/* Meeting Prep (collapsible, only shown if prep was generated) */}
          {meeting.prepBriefing && meeting.prepBriefing.trim() !== '' && (
            <div className="mb-5">
              <button
                type="button"
                onClick={() => setShowPrep(!showPrep)}
                className="w-full flex items-center justify-between gap-2 mb-2 group"
              >
                <h3 className="text-sm font-medium text-surface-400 flex items-center gap-1.5">
                  <ClipboardList size={14} />
                  Meeting Prep
                </h3>
                {showPrep ? (
                  <ChevronDown size={16} className="text-surface-500 group-hover:text-surface-700 dark:text-surface-300 transition-colors" />
                ) : (
                  <ChevronRight size={16} className="text-surface-500 group-hover:text-surface-700 dark:text-surface-300 transition-colors" />
                )}
              </button>
              {showPrep && (
                <div className="bg-surface-100/50 dark:bg-surface-800/30 border border-surface-200 dark:border-surface-700/50 rounded-lg p-3">
                  <div className="space-y-0.5">
                    {meeting.prepBriefing.split('\n').map(renderPrepLine)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Meeting Analytics */}
          <div className="mb-5">
            <MeetingAnalyticsSection
              meetingId={meeting.id}
              isCompleted={meeting.status === 'completed'}
            />
          </div>

          {/* AI provider error hint (shown when auto-generate fails) */}
          {autoGenerate && error && !meeting.brief && !generatingBrief && (
            <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <div className="flex items-start gap-2">
                <Info size={14} className="text-amber-400 mt-0.5 shrink-0" />
                <p className="text-sm text-amber-300">
                  Configure an AI provider in Settings to generate meeting intelligence.
                </p>
              </div>
            </div>
          )}

          {/* AI Brief */}
          <div className="mb-5">
            <BriefSection
              meetingId={meeting.id}
              brief={meeting.brief}
              isCompleted={meeting.status === 'completed'}
              generatingBrief={generatingBrief}
              onGenerate={() => generateBrief(meeting.id)}
            />
          </div>

          {/* Action Items */}
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-[var(--color-text-muted)]">Auto-convert action items to cards requires</span>
              <ProBadge />
            </div>
            <ActionItemList
              meetingId={meeting.id}
              actionItems={meeting.actionItems}
              isCompleted={meeting.status === 'completed'}
              generatingActions={generatingActions}
              onGenerate={() => generateActionItems(meeting.id)}
              onUpdateStatus={updateActionItemStatus}
              onConvert={(item) => {
                if (!isProEnabled) {
                  toast('Upgrade to Pro to auto-convert action items to cards', 'info');
                  return;
                }
                setConvertingAction(item);
              }}
              meetingProjectId={meeting.projectId ?? undefined}
              meetingProjectName={linkedProjectName}
              onBatchConvert={(items) => {
                if (!isProEnabled) {
                  toast('Upgrade to Pro to auto-convert action items to cards', 'info');
                  return;
                }
                setBatchConvertItems(items);
              }}
              onQuickPush={meeting.projectId && isProEnabled ? handleQuickPush : undefined}
              quickPushing={quickPushing}
            />
          </div>

          {/* Transcript section */}
          <div className="mb-5">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="font-hud text-xs text-[var(--color-text-secondary)] shrink-0">
                Transcript
                {meeting.segments.length > 0 && (
                  <span className="ml-2 text-surface-500">
                    {searchQuery
                      ? `(${filteredSegments.length} of ${meeting.segments.length})`
                      : `(${meeting.segments.length} segment${meeting.segments.length !== 1 ? 's' : ''})`
                    }
                  </span>
                )}
              </h3>
              <div className="flex items-center gap-3">
                {/* Copy buttons */}
                {meeting.segments.length > 0 && (
                  <div className="flex items-center gap-2">
                    <CopyBtn field="transcript" label="Transcript" onClick={copyTranscript} />
                    <CopyBtn field="summary" label="Summary" onClick={copySummary} disabled={!meeting.brief} />
                    <CopyBtn field="actions" label="Actions" onClick={copyActionItems} disabled={meeting.actionItems.length === 0} />
                  </div>
                )}
                {/* Search input */}
                {meeting.segments.length > 0 && (
                  <div className="relative">
                    <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" />
                    <input
                      type="text"
                      value={transcriptSearch}
                      onChange={e => setTranscriptSearch(e.target.value)}
                      placeholder="Search..."
                      className="bg-surface-950 border border-[var(--color-border)] hover:border-[var(--color-border-accent)] rounded-lg text-xs text-[var(--color-text-primary)] pl-7 pr-6 py-1 w-32 focus:outline-none focus:border-[var(--color-accent-dim)] placeholder:text-[var(--color-text-muted)] transition-colors"
                    />
                    {transcriptSearch && (
                      <button
                        onClick={() => setTranscriptSearch('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {meeting.segments.length === 0 ? (
              <div className="text-center py-12 bg-surface-50 dark:bg-surface-800/20 rounded-xl border border-dashed border-surface-200 dark:border-surface-700 text-surface-500 text-sm">
                {meeting.status === 'recording'
                  ? 'Transcription in progress...'
                  : 'No transcript available'}
              </div>
            ) : filteredSegments.length === 0 ? (
              <div className="text-center py-10 bg-surface-50 dark:bg-surface-800/20 rounded-xl border border-dashed border-surface-200 dark:border-surface-700 text-surface-500 text-sm">
                No segments match &ldquo;{transcriptSearch}&rdquo;
              </div>
            ) : (
              <div className="max-h-80 overflow-y-auto rounded-xl bg-surface-950/50 border border-[var(--color-border)] p-4 space-y-3 font-data">
                {filteredSegments.map(segment => {
                  const speakerColor = segment.speaker ? getSpeakerColor(segment.speaker) : null;
                  return (
                    <div key={segment.id} className="flex gap-4 text-sm hover:bg-[var(--color-border)]/30 p-2 -mx-2 rounded-lg transition-colors">
                      <span className="font-data text-xs text-[var(--color-accent-dim)] pt-0.5 shrink-0 w-12 text-right">
                        {formatTimestamp(segment.startTime)}
                      </span>
                      <p className="text-surface-800 dark:text-surface-200 flex-1 leading-relaxed">
                        {segment.speaker && speakerColor && (
                          <span className={`${speakerColor.text} font-medium text-xs mr-1.5`}>
                            [{segment.speaker}]
                          </span>
                        )}
                        {searchQuery ? highlightText(segment.content, transcriptSearch) : segment.content}
                      </p>
                    </div>
                  );
                })}
                <div ref={transcriptEndRef} />
              </div>
            )}
          </div>

          {/* Delete button */}
          <div className="pt-3 border-t border-[var(--color-border)]">
            {confirmDelete ? (
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-surface-600 dark:text-surface-300">Delete this meeting?</span>
                <button
                  onClick={handleDelete}
                  className="text-sm font-medium bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 px-3 py-1.5 rounded-md transition-colors"
                >
                  Yes, delete
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-sm font-medium text-surface-500 hover:text-surface-800 dark:text-surface-400 dark:hover:text-surface-200 px-3 py-1.5 rounded-md transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 text-sm font-medium text-surface-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400 px-3 py-1.5 rounded-md transition-colors -ml-3"
              >
                <Trash2 size={16} />
                Delete Meeting
              </button>
            )}
          </div>
        </div>
      </div>
      {convertingAction && (
        <ConvertActionModal
          actionItem={convertingAction}
          preselectedProjectId={meeting.projectId ?? undefined}
          preselectedProjectName={linkedProjectName}
          onConvert={convertActionToCard}
          onClose={() => setConvertingAction(null)}
        />
      )}
      {batchConvertItems && batchConvertItems.length > 0 && (
        <ConvertActionModal
          actionItems={batchConvertItems}
          preselectedProjectId={meeting.projectId ?? undefined}
          preselectedProjectName={linkedProjectName}
          onConvert={convertActionToCard}
          onClose={() => setBatchConvertItems(null)}
        />
      )}
    </>
  );
}
