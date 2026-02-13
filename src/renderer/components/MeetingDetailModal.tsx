// === FILE PURPOSE ===
// Meeting detail modal — overlay for viewing meeting info and transcript.
// Shows meeting metadata at top, scrollable transcript timeline below.
// During active recordings, new segments append and auto-scroll.
//
// === DEPENDENCIES ===
// react, lucide-react, meetingStore

import { useState, useEffect, useRef } from 'react';
import { X, Clock, Trash2 } from 'lucide-react';
import { useMeetingStore } from '../stores/meetingStore';
import { useProjectStore } from '../stores/projectStore';
import BriefSection from './BriefSection';
import ActionItemList from './ActionItemList';
import ConvertActionModal from './ConvertActionModal';
import MeetingAnalyticsSection from './MeetingAnalyticsSection';
import { getSpeakerColor } from './MeetingAnalyticsSection';
import type { ActionItem } from '../../shared/types';
import { MEETING_TEMPLATES } from '../../shared/types';

interface MeetingDetailModalProps {
  onClose: () => void;
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

export default function MeetingDetailModal({ onClose }: MeetingDetailModalProps) {
  const {
    selectedMeeting, updateMeeting, deleteMeeting, clearSelectedMeeting,
    generateBrief, generateActionItems,
    generatingBrief, generatingActions,
    updateActionItemStatus, convertActionToCard,
    loadAnalytics, clearAnalytics,
  } = useMeetingStore();
  const { projects, loadProjects } = useProjectStore();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [convertingAction, setConvertingAction] = useState<ActionItem | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const prevSegmentCount = useRef(0);

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

  if (!selectedMeeting) return null;

  const meeting = selectedMeeting;
  const status = STATUS_STYLES[meeting.status] || STATUS_STYLES.completed;

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

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleOverlayClick}
    >
      <div className="bg-surface-900 rounded-xl border border-surface-700 w-full max-w-2xl max-h-[80vh] overflow-y-auto mx-4 p-6">
        {/* Header: Title + Close */}
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
                className="text-xl font-bold text-surface-100 cursor-pointer hover:text-surface-200"
                onClick={startEditingTitle}
              >
                {meeting.title}
              </h2>
            )}
          </div>
          <button
            onClick={handleClose}
            className="text-surface-500 hover:text-surface-300 p-1 transition-colors shrink-0"
          >
            <X size={20} />
          </button>
        </div>

        {/* Metadata row */}
        <div className="flex flex-wrap items-center gap-3 mb-5 text-sm">
          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${status.className}`}>
            {status.label}
          </span>
          <span className="flex items-center gap-1 text-surface-400">
            <Clock size={14} />
            {formatDuration(meeting.startedAt, meeting.endedAt)}
          </span>
          <span className="text-surface-400">
            {formatDate(meeting.startedAt)} at {formatTime(meeting.startedAt)}
          </span>
        </div>

        {/* Template info */}
        {meeting.template && meeting.template !== 'none' && (() => {
          const tmpl = MEETING_TEMPLATES.find(t => t.type === meeting.template);
          return tmpl ? (
            <div className="flex items-start gap-2 text-sm text-surface-300 mb-5">
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
        <div className="flex items-center gap-3 mb-5">
          <span className="text-sm text-surface-400">Project:</span>
          <select
            value={meeting.projectId || ''}
            onChange={(e) => updateMeeting(meeting.id, {
              projectId: e.target.value || null,
            })}
            className="bg-surface-800 border border-surface-700 rounded-lg px-3 py-1.5
                       text-sm text-surface-200 focus:outline-none focus:border-primary-500"
          >
            <option value="">No project</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Meeting Analytics */}
        <div className="mb-5">
          <MeetingAnalyticsSection
            meetingId={meeting.id}
            isCompleted={meeting.status === 'completed'}
          />
        </div>

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
          <ActionItemList
            meetingId={meeting.id}
            actionItems={meeting.actionItems}
            isCompleted={meeting.status === 'completed'}
            generatingActions={generatingActions}
            onGenerate={() => generateActionItems(meeting.id)}
            onUpdateStatus={updateActionItemStatus}
            onConvert={(item) => setConvertingAction(item)}
          />
        </div>

        {/* Transcript section */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-surface-300">
              Transcript
              {meeting.segments.length > 0 && (
                <span className="ml-2 text-surface-500">
                  ({meeting.segments.length} segment{meeting.segments.length !== 1 ? 's' : ''})
                </span>
              )}
            </h3>
          </div>

          {meeting.segments.length === 0 ? (
            <div className="text-center py-8 text-surface-500 text-sm">
              {meeting.status === 'recording'
                ? 'Transcription in progress...'
                : 'No transcript available'}
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-lg bg-surface-800/50 border border-surface-700 p-3 space-y-2">
              {meeting.segments.map(segment => {
                const speakerColor = segment.speaker ? getSpeakerColor(segment.speaker) : null;
                return (
                  <div key={segment.id} className="flex gap-3 text-sm">
                    <span className="font-mono text-xs text-surface-500 pt-0.5 shrink-0 w-12 text-right">
                      {formatTimestamp(segment.startTime)}
                    </span>
                    <p className="text-surface-200 flex-1">
                      {segment.speaker && speakerColor && (
                        <span className={`${speakerColor.text} font-medium text-xs mr-1.5`}>
                          [{segment.speaker}]
                        </span>
                      )}
                      {segment.content}
                    </p>
                  </div>
                );
              })}
              <div ref={transcriptEndRef} />
            </div>
          )}
        </div>

        {/* Delete button */}
        <div className="pt-3 border-t border-surface-700">
          {confirmDelete ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-surface-400">Are you sure?</span>
              <button
                onClick={handleDelete}
                className="text-sm text-red-400 hover:text-red-300 font-medium transition-colors"
              >
                Confirm Delete
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-sm text-surface-400 hover:text-surface-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 text-sm text-surface-500 hover:text-red-400 transition-colors"
            >
              <Trash2 size={14} />
              Delete Meeting
            </button>
          )}
        </div>
      </div>
    </div>
    {convertingAction && (
      <ConvertActionModal
        actionItem={convertingAction}
        onConvert={convertActionToCard}
        onClose={() => setConvertingAction(null)}
      />
    )}
    </>
  );
}
